// SPDX-License-Identifier: ISC
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MinestartersFactory.sol";
import "../src/NAVEngine.sol";

contract DeployFactory is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdcAddress = vm.envAddress("USDC_ADDRESS");
        uint256 initialGoldPrice = vm.envOr("GOLD_PRICE", uint256(2000e6));

        vm.startBroadcast(deployerPrivateKey);

        NAVEngine navEngine = new NAVEngine(initialGoldPrice, msg.sender);
        console.log("NAVEngine deployed at:", address(navEngine));

        MinestartersFactory factory = new MinestartersFactory(usdcAddress, address(navEngine));
        console.log("MinestartersFactory deployed at:", address(factory));

        vm.stopBroadcast();
    }
}
