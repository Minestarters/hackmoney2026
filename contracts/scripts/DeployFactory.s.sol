// SPDX-License-Identifier: ISC
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MinestartersFactory.sol";

contract DeployFactory is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdcAddress = vm.envAddress("USDC_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        MinestartersFactory factory = new MinestartersFactory(usdcAddress);
        console.log("MinestartersFactory deployed at:", address(factory));

        vm.stopBroadcast();
    }
}
