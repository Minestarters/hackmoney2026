// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {NAVEngine} from "./NAVEngine.sol";
import {NAVPricingHook} from "./pool/NAVPricingHook.sol";
import {IPositionManager} from "v4-periphery/interfaces/IPositionManager.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";

/// @title MinestartersDistributor
/// @notice Distributes profit payouts and manages LP positions for NAV based pools
contract MinestartersDistributor is Ownable, IERC721Receiver {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    struct PoolInfo {
        PoolKey poolKey;
        address vault;
        address shareToken;
        address quoteToken;
        uint256 lpTokenId;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        bool active;
        bool isToken0Share;
    }

    struct RebalanceParams {
        int24 tickSpread;
        uint256 maxSlippage;
    }

    NAVEngine public navEngine;
    NAVPricingHook public navPricingHook;
    IPoolManager public poolManager;
    address public positionManager; // uniswap v4 Position Manager

    mapping(address vault => PoolInfo) public vaultPools;

    address[] public activeVaults;

    RebalanceParams public defaultParams;

    mapping(address => bool) public isLp;

    mapping(address => bool) public isAgent;

    mapping(address => bool) public isKeeper;

    event Payout(address indexed recipient, uint256 amount);
    event PoolRegistered(address indexed vault, PoolId indexed poolId);
    event PoolRebalanced(address indexed vault, int24 newTickLower, int24 newTickUpper);
    event LPReceived(address indexed vault, uint256 lpTokenId);
    event NAVChanged(address indexed vault, uint256 oldNAV, uint256 newNAV);
    event KeeperUpdated(address indexed keeper, bool status);

    error PoolNotRegistered();
    error PoolAlreadyRegistered();
    error PoolNotActive();
    error InvalidPool();
    error Unauthorized();
    error InvalidNAV();
    error RebalanceFailed();

    modifier onlyNAVEngine() {
        if (msg.sender != address(navEngine)) revert Unauthorized();
        _;
    }

    modifier onlyKeeper() {
        if (!isKeeper[msg.sender] && msg.sender != owner()) revert Unauthorized();
        _;
    }

    constructor(address _navEngine, address _poolManager) Ownable(msg.sender) {
        navEngine = NAVEngine(_navEngine);
        poolManager = IPoolManager(_poolManager);

        // Default parameters: 10% tick spread, 1% max slippage
        defaultParams = RebalanceParams({
            tickSpread: 1000, // ~10% price range
            maxSlippage: 100 // 1%
        });

        isKeeper[msg.sender] = true;
    }

    //todo:add auth
    function registerPool(address vault, PoolKey calldata poolKey, uint256 lpTokenId, bool isToken0Share) external {
        if (vaultPools[vault].active) revert PoolAlreadyRegistered();
        if (vault == address(0)) revert InvalidPool();

        address shareToken = isToken0Share
            ? Currency.unwrap(poolKey.currency0)  // token0 is share
            : Currency.unwrap(poolKey.currency1); // token1 is share

        address quoteToken = isToken0Share
            ? Currency.unwrap(poolKey.currency1)  // token1 is quote
            : Currency.unwrap(poolKey.currency0); // token0 is quote

        vaultPools[vault] = PoolInfo({
            poolKey: poolKey,
            vault: vault,
            shareToken: shareToken,
            quoteToken: quoteToken,
            lpTokenId: lpTokenId,
            tickLower: 0,
            tickUpper: 0,
            liquidity: 0,
            active: true,
            isToken0Share: isToken0Share
        });

        activeVaults.push(vault);

        emit PoolRegistered(vault, poolKey.toId());
    }

    function setNAVPricingHook(address _hook) external onlyOwner {
        navPricingHook = NAVPricingHook(_hook);
    }

    function setPositionManager(address _positionManager) external onlyOwner {
        positionManager = _positionManager;
    }

    /// @notice add initial liquidity to create the first position for a vault
    /// @param vault the vault address
    /// @param tickLower lower tick for the position
    /// @param tickUpper upper tick for the position
    /// @param amount liquidity amount to add
    function addInitialLiquidity(address vault, int24 tickLower, int24 tickUpper, uint128 amount) external {
        PoolInfo storage pool = vaultPools[vault];
        if (!pool.active) revert PoolNotActive();
        if (pool.liquidity > 0) revert("Position already exists");

        // create the position
        _addLiquidity(pool.poolKey, tickLower, tickUpper, amount);

        // update pool state
        pool.tickLower = tickLower;
        pool.tickUpper = tickUpper;
        pool.liquidity = amount;
    }

    function onNAVChanged(address vault) external onlyNAVEngine {
        PoolInfo storage pool = vaultPools[vault];

        // Skip if pool hasn't been registered yet or is not active
        if (!pool.active) return;

        uint256 newNAV = navEngine.getCurrentNAV(vault);
        if (newNAV == 0) return; // Invalid NAV, skip

        _rebalancePool(vault, newNAV);
    }

    /// @notice manual rebalance trigger by keeper
    function rebalancePool(address vault) external onlyKeeper {
        PoolInfo storage pool = vaultPools[vault];
        if (!pool.active) revert PoolNotActive();

        uint256 currentNAV = navEngine.getCurrentNAV(vault);
        if (currentNAV == 0) revert InvalidNAV();

        _rebalancePool(vault, currentNAV);
    }

    /// @notice rebalance pool liquidity to center on new NAV price
    function _rebalancePool(address vault, uint256 targetNAV) internal {
        PoolInfo storage pool = vaultPools[vault];

        // Calculate target tick based on NAV
        int24 targetTick = calculateTickForNAV(targetNAV, pool.isToken0Share);
        int24 spread = defaultParams.tickSpread;

        int24 newTickLower = targetTick - spread;
        int24 newTickUpper = targetTick + spread;

        // Round ticks to tick spacing
        int24 tickSpacing = pool.poolKey.tickSpacing;
        newTickLower = (newTickLower / tickSpacing) * tickSpacing;
        newTickUpper = (newTickUpper / tickSpacing) * tickSpacing;

        // only rebalance if we have liquidity and position manager is set
        if (positionManager != address(0)) {
            // step 1: remove liquidity from old position
            _removeLiquidity(pool.poolKey, pool.tickLower, pool.tickUpper, pool.liquidity);

            // step 2: add liquidity at new tick range
            uint128 newLiquidity = _addLiquidity(pool.poolKey, newTickLower, newTickUpper, pool.liquidity);

            // step 3: update stored position info
            pool.liquidity = newLiquidity;
        }

        pool.tickLower = newTickLower;
        pool.tickUpper = newTickUpper;

        // Step 4: Swap to move price to target tick (so quotes reflect new NAV)
        if (pool.liquidity > 0) {
            _swapToTargetTick(pool.poolKey, targetTick, pool.isToken0Share);
        }

        emit PoolRebalanced(vault, newTickLower, newTickUpper);
    }

    /// @notice remove liquidity from a position
    function _removeLiquidity(PoolKey memory key, int24 tickLower, int24 tickUpper, uint128 liquidity) internal {
        if (liquidity == 0) return;

        IPoolManager.ModifyLiquidityParams memory params = IPoolManager.ModifyLiquidityParams({
            tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: -int256(uint256(liquidity)), salt: bytes32(0)
        });

        // call pool manager to remove liquidity
        poolManager.unlock(abi.encode(CallbackAction.RemoveLiquidity, abi.encode(key, params)));
    }

    /// @notice add liquidity to a position
    function _addLiquidity(PoolKey memory key, int24 tickLower, int24 tickUpper, uint128 targetLiquidity)
        internal
        returns (uint128)
    {
        IPoolManager.ModifyLiquidityParams memory params = IPoolManager.ModifyLiquidityParams({
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidityDelta: int256(uint256(targetLiquidity)),
            salt: bytes32(0)
        });

        // call pool manager to add liquidity
        poolManager.unlock(abi.encode(CallbackAction.AddLiquidity, abi.encode(key, params)));

        return targetLiquidity;
    }

    enum CallbackAction {
        AddLiquidity,
        RemoveLiquidity,
        SwapToTarget
    }

    /// @notice Callback from PoolManager.unlock()
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert Unauthorized();

        (CallbackAction action, bytes memory actionData) = abi.decode(data, (CallbackAction, bytes));

        if (action == CallbackAction.AddLiquidity || action == CallbackAction.RemoveLiquidity) {
            (PoolKey memory key, IPoolManager.ModifyLiquidityParams memory params) =
                abi.decode(actionData, (PoolKey, IPoolManager.ModifyLiquidityParams));

            (BalanceDelta delta,) = poolManager.modifyLiquidity(key, params, "");

            // Settle balances with pool manager
            _settleDeltas(key, delta, params.liquidityDelta > 0);
        } else if (action == CallbackAction.SwapToTarget) {
            (PoolKey memory key, IPoolManager.SwapParams memory params) =
                abi.decode(actionData, (PoolKey, IPoolManager.SwapParams));

            BalanceDelta delta = poolManager.swap(key, params, "");

            // Settle swap deltas
            _settleSwapDeltas(key, delta, params.zeroForOne);
        }

        return "";
    }

    /// @notice Settle token balances with pool manager after liquidity modification
    function _settleDeltas(PoolKey memory key, BalanceDelta delta, bool isAdding) internal {
        int128 delta0 = delta.amount0();
        int128 delta1 = delta.amount1();

        // Convert Currency to address for IERC20
        address token0 = _currencyToAddress(key.currency0);
        address token1 = _currencyToAddress(key.currency1);

        if (isAdding) {
            // Adding liquidity: deltas are NEGATIVE (we owe tokens to the pool)
            if (delta0 < 0) {
                uint256 amount = uint256(uint128(-delta0));
                poolManager.sync(key.currency0);
                IERC20(token0).safeTransfer(address(poolManager), amount);
                poolManager.settle();
            }
            if (delta1 < 0) {
                uint256 amount = uint256(uint128(-delta1));
                poolManager.sync(key.currency1);
                IERC20(token1).safeTransfer(address(poolManager), amount);
                poolManager.settle();
            }
        } else {
            // Removing liquidity: deltas are POSITIVE (pool owes us tokens)
            if (delta0 > 0) {
                poolManager.take(key.currency0, address(this), uint128(delta0));
            }
            if (delta1 > 0) {
                poolManager.take(key.currency1, address(this), uint128(delta1));
            }
        }
    }

    /// @notice Convert Currency type to address
    function _currencyToAddress(Currency currency) internal pure returns (address) {
        return Currency.unwrap(currency);
    }

    /// @notice Settle swap deltas with pool manager
    function _settleSwapDeltas(PoolKey memory key, BalanceDelta delta, bool zeroForOne) internal {
        int128 delta0 = delta.amount0();
        int128 delta1 = delta.amount1();

        address token0 = _currencyToAddress(key.currency0);
        address token1 = _currencyToAddress(key.currency1);

        // For swaps: one delta is negative (we owe), one is positive (we receive)
        if (delta0 < 0) {
            uint256 amount = uint256(uint128(-delta0));
            poolManager.sync(key.currency0);
            IERC20(token0).safeTransfer(address(poolManager), amount);
            poolManager.settle();
        }
        if (delta1 < 0) {
            uint256 amount = uint256(uint128(-delta1));
            poolManager.sync(key.currency1);
            IERC20(token1).safeTransfer(address(poolManager), amount);
            poolManager.settle();
        }
        if (delta0 > 0) {
            poolManager.take(key.currency0, address(this), uint128(delta0));
        }
        if (delta1 > 0) {
            poolManager.take(key.currency1, address(this), uint128(delta1));
        }
    }

    /// @notice Swap to move price to target tick
    function _swapToTargetTick(PoolKey memory key, int24 targetTick, bool isToken0Share) internal {
        // Get current tick
        (uint160 currentSqrtPrice, int24 currentTick,,) = poolManager.getSlot0(key.toId());

        // If already at target, skip
        if (_abs(currentTick - targetTick) <= key.tickSpacing) return;

        // Determine swap direction
        bool zeroForOne = currentTick > targetTick;

        // Calculate sqrtPriceLimit at target tick
        uint160 sqrtPriceLimitX96 = TickMath.getSqrtPriceAtTick(targetTick);

        // Small buffer to ensure we reach the tick
        if (zeroForOne) {
            sqrtPriceLimitX96 = sqrtPriceLimitX96 > 1 ? sqrtPriceLimitX96 - 1 : 1;
        } else {
            sqrtPriceLimitX96 = sqrtPriceLimitX96 < type(uint160).max ? sqrtPriceLimitX96 + 1 : type(uint160).max;
        }

        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: type(int256).max, // Swap as much as needed to reach price
            sqrtPriceLimitX96: sqrtPriceLimitX96
        });

        poolManager.unlock(abi.encode(CallbackAction.SwapToTarget, abi.encode(key, params)));
    }

    /// @notice Calculate tick for a given NAV price using Uniswap's TickMath
    /// @dev Converts NAV (6 decimals USDC) to sqrtPriceX96, then gets tick
    /// @param navPerToken NAV per share token in USDC (6 decimals)
    /// @param isToken0Share True if share token is token0 in the pool
    function calculateTickForNAV(uint256 navPerToken, bool isToken0Share) public pure returns (int24) {
        if (navPerToken == 0) return 0;
        uint256 priceX192;
        if (isToken0Share) {
            priceX192 = FullMath.mulDiv(navPerToken, 1 << 192, 1e6);
        } else {
            priceX192 = FullMath.mulDiv(1e6, 1 << 192, navPerToken);
        }

        uint160 sqrtPriceX96 = uint160(_sqrt(priceX192));

        if (sqrtPriceX96 < TickMath.MIN_SQRT_PRICE) {
            sqrtPriceX96 = TickMath.MIN_SQRT_PRICE;
        } else if (sqrtPriceX96 > TickMath.MAX_SQRT_PRICE) {
            sqrtPriceX96 = TickMath.MAX_SQRT_PRICE;
        }

        return TickMath.getTickAtSqrtPrice(sqrtPriceX96);
    }

    /// @notice Calculate sqrtPriceX96 from NAV for direct price setting
    function getSqrtPriceFromNAV(uint256 navPerToken, bool isToken0Share) external pure returns (uint160) {
        if (navPerToken == 0) return TickMath.MIN_SQRT_PRICE;

        uint256 priceX192;
        if (isToken0Share) {
            priceX192 = FullMath.mulDiv(navPerToken, 1 << 192, 1e6);
        } else {
            priceX192 = FullMath.mulDiv(1e6, 1 << 192, navPerToken);
        }

        uint160 sqrtPriceX96 = uint160(_sqrt(priceX192));

        if (sqrtPriceX96 < TickMath.MIN_SQRT_PRICE) return TickMath.MIN_SQRT_PRICE;
        if (sqrtPriceX96 > TickMath.MAX_SQRT_PRICE) return TickMath.MAX_SQRT_PRICE;

        return sqrtPriceX96;
    }

    /// @notice Babylonian square root
    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }

    function _abs(int24 x) internal pure returns (int24) {
        return x >= 0 ? x : -x;
    }

    // ============ LP Token Management ============

    /// @notice ERC721 receiver for LP position NFTs
    function onERC721Received(address, address, uint256 tokenId, bytes calldata data)
        external
        override
        returns (bytes4)
    {
        // Decode vault address from data if provided
        if (data.length >= 32) {
            address vault = abi.decode(data, (address));
            if (vaultPools[vault].active) {
                vaultPools[vault].lpTokenId = tokenId;
                emit LPReceived(vault, tokenId);
            }
        }

        return this.onERC721Received.selector;
    }

    /// @notice Distributes tokens to multiple recipients
    function batchPayout(address token, address[] calldata recipients, uint256[] calldata amounts) external {
        require(token != address(0), "Invalid token");
        require(recipients.length == amounts.length, "Length mismatch");

        for (uint256 i = 0; i < recipients.length; i++) {
            address recipient = recipients[i];
            uint256 amount = amounts[i];

            require(recipient != address(0), "Invalid recipient");

            if (amount > 0) {
                IERC20(token).safeTransferFrom(msg.sender, recipient, amount);
                emit Payout(recipient, amount);
            }
        }
    }

    function setNAVEngine(address _navEngine) external onlyOwner {
        navEngine = NAVEngine(_navEngine);
    }

    function setDefaultParams(int24 tickSpread, uint256 maxSlippage) external onlyOwner {
        defaultParams = RebalanceParams({tickSpread: tickSpread, maxSlippage: maxSlippage});
    }

    function setKeeper(address keeper, bool status) external onlyOwner {
        isKeeper[keeper] = status;
        emit KeeperUpdated(keeper, status);
    }

    function register(address _rec, uint256 _index) external onlyOwner {
        if (_index == 1) isLp[_rec] = true;
        if (_index == 2) isAgent[_rec] = true;
    }

    function deactivatePool(address vault) external onlyOwner {
        vaultPools[vault].active = false;
    }

    function getPoolInfo(address vault) external view returns (PoolInfo memory) {
        return vaultPools[vault];
    }

    function getActiveVaultsCount() external view returns (uint256) {
        return activeVaults.length;
    }

    function isPoolActive(address vault) external view returns (bool) {
        return vaultPools[vault].active;
    }
}
