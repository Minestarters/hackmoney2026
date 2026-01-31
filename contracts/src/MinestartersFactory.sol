// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BasketVault} from "./BasketVault.sol";

/// @title MinestartersFactory
/// @notice Deploys BasketVaults and tracks created projects.
contract MinestartersFactory {
    address[] private projects;
    address public immutable usdc;

    event ProjectCreated(address indexed creator, address vault, address token, string name);

    constructor(address usdcToken) {
        require(usdcToken != address(0), "USDC required");
        usdc = usdcToken;
    }

    function createProject(
        string memory projectName,
        string[] memory companyNames,
        uint256[] memory companyWeights,
        uint256 minimumRaise,
        uint256 deadline,
        address withdrawAddress,
        uint256 raiseFeeBps,
        uint256 profitFeeBps
    ) external {
        require(companyNames.length == companyWeights.length, "Invalid companies");
        require(companyNames.length > 0, "No companies");
        require(minimumRaise > 0, "Minimum raise required");
        require(deadline > block.timestamp, "Deadline must be future");
        require(withdrawAddress != address(0), "Withdraw address required");
        require(raiseFeeBps <= 10_000, "Invalid raise fee");
        require(profitFeeBps <= 10_000, "Invalid profit fee");

        uint256 totalWeight;
        for (uint256 i = 0; i < companyWeights.length; i++) {
            totalWeight += companyWeights[i];
        }
        require(totalWeight == 100, "Weights must sum to 100");

        BasketVault vault = new BasketVault(
            projectName,
            companyNames,
            companyWeights,
            usdc,
            msg.sender,
            withdrawAddress,
            minimumRaise,
            deadline,
            raiseFeeBps,
            profitFeeBps
        );

        projects.push(address(vault));
        emit ProjectCreated(msg.sender, address(vault), vault.shareToken(), projectName);
    }

    /// @notice // TODO: replace with indexer.
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
