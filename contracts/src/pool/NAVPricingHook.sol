// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/types/BeforeSwapDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";
import {NAVEngine} from "../NAVEngine.sol";
import {BasketVault} from "../BasketVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract NAVPricingHook is IHooks {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    error NotPoolManager();
    error PoolNotRegistered();
    error PriceDeviationExceedsNAV();
    error LiquidityAmountTooLarge();
    error Unauthorized();

    struct PoolConfig {
        address vault;
        bool isToken0ShareToken;
        bool registered;
    }

    IPoolManager public immutable poolManager;
    NAVEngine public immutable navEngine;
    address public owner;
    address public agent;

    uint256 public constant MAX_DEVIATION_BPS = 300;
    uint256 public constant MAX_LP_PERCENT_BPS = 500;
    uint256 public constant BPS = 10000;
    uint256 public constant Q96 = 2 ** 96;

    mapping(PoolId => PoolConfig) public poolConfigs;

    event PoolRegistered(PoolId indexed poolId, address vault, bool isToken0ShareToken);
    event AgentUpdated(address oldAgent, address newAgent);

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(IPoolManager _poolManager, address _navEngine) {
        poolManager = _poolManager;
        navEngine = NAVEngine(_navEngine);
        owner = msg.sender;
        agent = msg.sender;
    }

    function setAgent(address _agent) external onlyOwner {
        emit AgentUpdated(agent, _agent);
        agent = _agent;
    }

    function registerPool(PoolKey calldata key, address vault, bool isToken0ShareToken) external onlyOwner {
        PoolId poolId = key.toId();
        poolConfigs[poolId] = PoolConfig({vault: vault, isToken0ShareToken: isToken0ShareToken, registered: true});
        emit PoolRegistered(poolId, vault, isToken0ShareToken);
    }

    function getNAV(address vault) public view returns (uint256) {
        return navEngine.getCurrentNAV(vault);
    }

    function getCompanyNAV(address vault, uint256 companyIndex)
        public
        view
        returns (
            string memory name,
            uint256 weight,
            uint256 resourceTonnes,
            uint256 inventoryTonnes,
            NAVEngine.Stage stage,
            uint256 navUsd
        )
    {
        return navEngine.getCompany(vault, companyIndex);
    }

    function getPoolPrice(PoolKey calldata key) public view returns (uint256 priceX96) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(key.toId());
        priceX96 = FullMath.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), Q96);
    }

    function _isPriceWithinNAVBounds(PoolKey calldata key, PoolConfig memory config) internal view returns (bool) {
        uint256 navPerToken = getNAV(config.vault);
        if (navPerToken == 0) return true;

        uint256 poolPriceX96 = getPoolPrice(key);
        uint256 poolPrice = FullMath.mulDiv(poolPriceX96, 1e6, Q96);

        if (!config.isToken0ShareToken) {
            poolPrice = poolPrice > 0 ? (1e12 / poolPrice) : 0;
        }

        uint256 lowerBound = (navPerToken * (BPS - MAX_DEVIATION_BPS)) / BPS;
        uint256 upperBound = (navPerToken * (BPS + MAX_DEVIATION_BPS)) / BPS;

        return poolPrice >= lowerBound && poolPrice <= upperBound;
    }

    function _isOwnerOrAgent(address sender) internal view returns (bool) {
        return sender == owner || sender == agent;
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: true,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: true,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        return IHooks.beforeInitialize.selector;
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        return IHooks.afterInitialize.selector;
    }

    function beforeAddLiquidity(
        address sender,
        PoolKey calldata key,
        IPoolManager.ModifyLiquidityParams calldata params,
        bytes calldata
    ) external view onlyPoolManager returns (bytes4) {
        PoolId poolId = key.toId();
        PoolConfig memory config = poolConfigs[poolId];

        if (!config.registered) {
            return IHooks.beforeAddLiquidity.selector;
        }

        if (_isOwnerOrAgent(sender)) {
            return IHooks.beforeAddLiquidity.selector;
        }

        if (!_isPriceWithinNAVBounds(key, config)) {
            revert PriceDeviationExceedsNAV();
        }

        uint128 currentLiquidity = poolManager.getLiquidity(poolId);
        if (currentLiquidity > 0) {
            uint256 maxAllowed = (uint256(currentLiquidity) * MAX_LP_PERCENT_BPS) / BPS;
            if (params.liquidityDelta > 0 && uint256(uint128(int128(params.liquidityDelta))) > maxAllowed) {
                revert LiquidityAmountTooLarge();
            }
        }

        return IHooks.beforeAddLiquidity.selector;
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        return (IHooks.afterAddLiquidity.selector, BalanceDelta.wrap(0));
    }

    function beforeRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external view onlyPoolManager returns (bytes4) {
        PoolId poolId = key.toId();
        PoolConfig memory config = poolConfigs[poolId];

        if (!config.registered) {
            return IHooks.beforeRemoveLiquidity.selector;
        }

        if (_isOwnerOrAgent(sender)) {
            return IHooks.beforeRemoveLiquidity.selector;
        }

        if (!_isPriceWithinNAVBounds(key, config)) {
            revert PriceDeviationExceedsNAV();
        }

        return IHooks.beforeRemoveLiquidity.selector;
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        return (IHooks.afterRemoveLiquidity.selector, BalanceDelta.wrap(0));
    }

    function beforeSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId poolId = key.toId();
        PoolConfig memory config = poolConfigs[poolId];

        if (!config.registered) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        if (!_isPriceWithinNAVBounds(key, config)) {
            revert PriceDeviationExceedsNAV();
        }

        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function afterSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, BalanceDelta, bytes calldata)
        external
        pure
        returns (bytes4, int128)
    {
        return (IHooks.afterSwap.selector, 0);
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return IHooks.beforeDonate.selector;
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return IHooks.afterDonate.selector;
    }
}
