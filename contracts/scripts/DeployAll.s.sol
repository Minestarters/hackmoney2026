// SPDX-License-Identifier: ISC
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MinestartersFactory} from "../src/MinestartersFactory.sol";
import {MinestartersDistributor} from "../src/MinestartersDistributor.sol";
import {NAVEngine} from "../src/NAVEngine.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";

/// @title DeployAll - Deploy entire Minestarters protocol
/// @notice Deploys: MockUSDC, Factory, NAVEngine, Distributor (uses existing PoolManager on fork)
/// @dev Run: forge script scripts/DeployAll.s.sol --rpc-url http://localhost:8545 --broadcast
contract DeployAll is Script {
    // Deployed addresses
    MockUSDC public usdc;
    IPoolManager public poolManager;
    MinestartersFactory public factory;
    NAVEngine public navEngine;
    MinestartersDistributor public distributor;

    // Sepolia Uniswap V4 addresses
    address constant SEPOLIA_POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant SEPOLIA_POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;

    // Bot address for LP Manager (derived from PRIVATE_KEY in .env)
    address constant LP_MANAGER = 0x11851E512244d32425cC5124e6F6606e89BfD3d3;

    // Config
    uint256 public constant INITIAL_GOLD_PRICE = 2000e6; // $2000 per oz
    uint256 public constant INITIAL_USDC_MINT = 10_000_000e6; // 10M USDC
    uint256 public constant BOT_USDC_MINT = 1_000_000e6; // 1M USDC for bot

    function run() external {}
}
