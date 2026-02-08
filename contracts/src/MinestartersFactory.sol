// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BasketVault} from "./BasketVault.sol";
import {NAVEngine} from "./NAVEngine.sol";

contract MinestartersFactory {
    address[] private projects;
    address public immutable USDC;
    NAVEngine public navEngine;

    event ProjectCreated(address indexed creator, address vault, address token, string name);
    event ProjectCreatedWithNAV(address indexed vault, uint256 companyCount);

    constructor(address usdcToken) {
        require(usdcToken != address(0), "USDC required");
        USDC = usdcToken;
        navEngine = new NAVEngine(address(0), address(this));
        navEngine.setFactory(address(this));
        navEngine.transferOwnership(msg.sender);
    }

    function createProject(
        string memory projectName,
        string[] memory companyNames,
        uint256[] memory companyWeights,
        uint256 minimumRaise,
        uint256 deadline,
        address withdrawAddress,
        uint256 raiseFeeBps
    ) external {
        require(companyNames.length == companyWeights.length, "Invalid companies");
        require(companyNames.length > 0, "No companies");
        require(minimumRaise > 0, "Minimum raise required");
        require(deadline > block.timestamp, "Deadline must be future");
        require(withdrawAddress != address(0), "Withdraw address required");
        require(raiseFeeBps <= 10_000, "Invalid raise fee");

        uint256 totalWeight;
        for (uint256 i = 0; i < companyWeights.length; i++) {
            totalWeight += companyWeights[i];
        }
        require(totalWeight == 100, "Weights must sum to 100");

        BasketVault vault = new BasketVault(
            projectName,
            companyNames,
            companyWeights,
            USDC,
            msg.sender,
            withdrawAddress,
            minimumRaise,
            deadline,
            raiseFeeBps
        );

        projects.push(address(vault));
        emit ProjectCreated(msg.sender, address(vault), vault.shareToken(), projectName);
    }

    function createProjectWithNAV(
        string memory projectName,
        string[] memory companyNames,
        uint256[] memory companyWeights,
        uint256 minimumRaise,
        uint256 deadline,
        address withdrawAddress,
        uint256 raiseFeeBps
    ) external returns (address) {
        uint256 len = companyNames.length;
        require(len > 0, "No companies");
        require(companyWeights.length == len, "Invalid weights");
        require(minimumRaise > 0, "Minimum raise required");
        require(deadline > block.timestamp, "Deadline must be future");
        require(withdrawAddress != address(0), "Withdraw address required");
        require(raiseFeeBps <= 10_000, "Invalid raise fee");

        uint256 totalWeight;
        for (uint256 i = 0; i < len; i++) {
            totalWeight += companyWeights[i];
        }
        require(totalWeight == 100, "Weights must sum to 100");

        BasketVault vault = new BasketVault(
            projectName,
            companyNames,
            companyWeights,
            USDC,
            msg.sender,
            withdrawAddress,
            minimumRaise,
            deadline,
            raiseFeeBps
        );

        projects.push(address(vault));
        emit ProjectCreated(msg.sender, address(vault), vault.shareToken(), projectName);

        navEngine.registerVault(address(vault), 0, msg.sender);

        for (uint256 i = 0; i < len; i++) {
            uint256 floorNav = (minimumRaise * companyWeights[i]) / 100;
            navEngine.registerCompany(
                address(vault), companyNames[i], companyWeights[i], 10_000, 8500, 5, 15, 1000, floorNav
            );
        }

        emit ProjectCreatedWithNAV(address(vault), len);
        return address(vault);
    }

    function getAllProjects() external view returns (address[] memory) {
        return projects;
    }

    function getProjectCount() external view returns (uint256) {
        return projects.length;
    }

    function getProjectAt(uint256 index) external view returns (address) {
        require(index < projects.length, "Index out of bounds");
        return projects[index];
    }
}
