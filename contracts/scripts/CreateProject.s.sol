// SPDX-License-Identifier: ISC
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MinestartersFactory} from "../src/MinestartersFactory.sol";

/// @dev Run: forge script scripts/CreateProject.s.sol --rpc-url http://localhost:8545 --broadcast
contract CreateProject is Script {
    address constant FACTORY = 0x2D52Fb54535E9373041D7451f6d0721D9AA80e62;

    function run() external {
        uint256 deployerPrivateKey = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        
        vm.startBroadcast(deployerPrivateKey);

        MinestartersFactory factory = MinestartersFactory(FACTORY);
        // Create project with NAV
        string[] memory companyNames = new string[](3);
        companyNames[0] = "Luisiana Silver and Gold";
        companyNames[1] = "New Orleans Mining Co.";
        companyNames[2] = "Orlando Lithium Corp.";

        uint256[] memory ownershipPercentages = new uint256[](3);
        ownershipPercentages[0] = 50;
        ownershipPercentages[1] = 25;
        ownershipPercentages[2] = 25;

        address vault = factory.createProjectWithNAV(
            "Amazon Mining Project",
            companyNames,
            ownershipPercentages,
            250_000e6,      // 250k oz gold reserves
            block.timestamp + 30 days,     
            address(1),     
            0               // initial nav override
        );

        console.log("Project created!");
        console.log("Vault:", vault);

        vm.stopBroadcast();
    }
}
