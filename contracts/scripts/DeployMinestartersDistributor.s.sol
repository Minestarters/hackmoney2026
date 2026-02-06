// SPDX-License-Identifier: ISC
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MinestartersDistributor} from "../src/MinestartersDistributor.sol";

contract DeployMinestartersDistributor is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        MinestartersDistributor distributor = new MinestartersDistributor();
        console.log("MinestartersDistributor deployed at:", address(distributor));

        vm.stopBroadcast();
    }
}
