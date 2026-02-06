// SPDX-License-Identifier: ISC
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MineStarters} from "../src/MineStarters.sol";

contract DeployMineStarters is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        MineStarters mineStarters = new MineStarters();
        console.log("MineStarters deployed at:", address(mineStarters));

        vm.stopBroadcast();
    }
}
