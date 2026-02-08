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

    function run() external {
        // Get deployer from private key
        uint256 deployerPrivateKey = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        address deployer;

        //local deployment
        if (deployerPrivateKey == 0) {
            // Use default anvil account if no key provided
            deployerPrivateKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
            deployer = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
            console.log("Using default Anvil account");
        } else {
            deployer = vm.addr(deployerPrivateKey);
        }

        console.log("Deployer:", deployer);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy MockUSDC
        usdc = new MockUSDC();
        console.log("MockUSDC:", address(usdc));

        // Mint initial USDC to deployer
        usdc.mint(deployer, INITIAL_USDC_MINT);
        console.log("Minted", INITIAL_USDC_MINT / 1e6, "USDC to deployer");

        // Mint USDC to bot for LP operations
        usdc.mint(LP_MANAGER, BOT_USDC_MINT);
        console.log("Minted", BOT_USDC_MINT / 1e6, "USDC to bot");

        poolManager = IPoolManager(SEPOLIA_POOL_MANAGER);
        console.log("PoolManager:", address(poolManager));

        // 3. Deploy MinestartersFactory (creates NAVEngine internally)
        factory = new MinestartersFactory(address(usdc));
        navEngine = factory.navEngine();
        console.log("Factory:", address(factory));
        console.log("NAVEngine:", address(navEngine));

        // 4. Set initial gold price
        navEngine.updateGoldPrice(INITIAL_GOLD_PRICE);
        console.log("Gold price: $", INITIAL_GOLD_PRICE / 1e6);

        // 5. Deploy MinestartersDistributor
        distributor = new MinestartersDistributor(address(navEngine), address(poolManager));
        console.log("Distributor:", address(distributor));

        // Set distributor in NAVEngine
        navEngine.setDistributor(address(distributor));
        console.log("NAVEngine -> Distributor linked");

        // Set Position Manager for LP repositioning
        distributor.setPositionManager(SEPOLIA_POSITION_MANAGER);
        console.log("PositionManager:", SEPOLIA_POSITION_MANAGER);

        // Fund bot with ETH for gas
        // address(LP_MANAGER).call{value:0.05 ether}("");

        // Fund Distributor with USDC for rebalance swaps
        usdc.mint(address(distributor), BOT_USDC_MINT);
        console.log("Minted", BOT_USDC_MINT / 1e6, "USDC to Distributor");

        vm.stopBroadcast();

        _printSummary(deployer);
    }

    function _printSummary(address deployer) internal view {
        console.log("USDC:", address(usdc));
        console.log("PoolManager:", address(poolManager));
        console.log("MinestartersFactory:", address(factory));
        console.log("NAVEngine:", address(navEngine));
        console.log("Distributor:", address(distributor));
        console.log("*Minestarters**");
        console.log("Configuration:");
        console.log("Gold Price: $", INITIAL_GOLD_PRICE / 1e6);
        console.log("Deployer USDC:", INITIAL_USDC_MINT / 1e6);
        console.log("*Minestarters**");
        console.log("For lp_manager.py, add to .env:");
        console.log("FACTORY_ADDRESS=", address(factory));
        console.log("DISTRIBUTOR_ADDRESS=", address(distributor));
        console.log("POOL_MANAGER_ADDRESS=", address(poolManager));
        console.log("NAV_ENGINE_ADDRESS=", address(navEngine));
        console.log("USDC_ADDRESS=", address(usdc));
    }
}
