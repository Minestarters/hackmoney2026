// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/NAVEngine.sol";

contract DeployNAVEngine is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 initialGoldPrice = vm.envOr("GOLD_PRICE", uint256(4800e6));
        address factory = vm.envAddress("FACTORY_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        NAVEngine navEngine = new NAVEngine(address(0), msg.sender);
        console.log("NAVEngine deployed at:", address(navEngine));

        navEngine.updateGoldPrice(initialGoldPrice);
        console.log("Gold price set to:", initialGoldPrice);

        navEngine.setFactory(factory);
        console.log("Factory set:", factory);

        vm.stopBroadcast();
    }
}
