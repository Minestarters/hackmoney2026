// SPDX-License-Identifier: ISC
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MinestartersFactory.sol";

contract DeployFactory is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdcAddress = vm.envAddress("USDC_ADDRESS");
        uint256 initialGoldPrice = vm.envOr("GOLD_PRICE", uint256(4800e6));

        vm.startBroadcast(deployerPrivateKey);

        MinestartersFactory factory = new MinestartersFactory(usdcAddress);
        console.log("MinestartersFactory deployed at:", address(factory));
        console.log("NAVEngine deployed at:", address(factory.navEngine()));

        factory.navEngine().updateGoldPrice(initialGoldPrice);
        console.log("Gold price set to:", initialGoldPrice);

        vm.stopBroadcast();
    }
}
