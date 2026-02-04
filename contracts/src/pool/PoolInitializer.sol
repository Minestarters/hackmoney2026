// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @notice Helper to initialize a V4 pool for shareToken/USDC
contract PoolInitializer {
    IPoolManager public immutable poolManager;

    event PoolInitialized(
        address token0, address token1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96
    );

    constructor(address _poolManager) {
        poolManager = IPoolManager(_poolManager);
    }

    function initializePool(
        address shareToken,
        address usdc,
        uint24 fee,
        int24 tickSpacing,
        address hooks,
        uint256 initialPrice
    ) external returns (PoolKey memory key) {
        (address token0, address token1) = shareToken < usdc ? (shareToken, usdc) : (usdc, shareToken);

        key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: IHooks(hooks)
        });

        uint160 sqrtPriceX96 = priceToSqrtPriceX96(initialPrice);

        poolManager.initialize(key, sqrtPriceX96);

        emit PoolInitialized(token0, token1, fee, tickSpacing, hooks, sqrtPriceX96);
    }

    function priceToSqrtPriceX96(uint256 price) public pure returns (uint160) {
        uint256 sqrtPrice = sqrt(price * 1e12);
        return uint160((sqrtPrice * (1 << 96)) / 1e9);
    }

    function sqrtPriceX96ToPrice(uint160 sqrtPriceX96) public pure returns (uint256) {
        uint256 sqrtPrice = uint256(sqrtPriceX96);
        return (sqrtPrice * sqrtPrice * 1e6) >> 192;
    }

    function sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }

    function navToSqrtPriceX96(uint256 nav) external pure returns (uint160) {
        return priceToSqrtPriceX96(nav);
    }
}
