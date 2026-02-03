// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BasketVault} from "./BasketVault.sol";
import {NAVEngine} from "./NAVEngine.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MinestartersFactory {
    address[] private projects;
    address public immutable usdc;
    NAVEngine public immutable navEngine;

    event ProjectCreated(address indexed creator, address vault, address token, string name);
    event ProjectRegisteredWithNAV(address indexed vault, uint256 companyCount);

    constructor(address usdcToken, address _navEngine) {
        require(usdcToken != address(0), "USDC required");
        require(_navEngine != address(0), "NAVEngine required");
        usdc = usdcToken;
        navEngine = NAVEngine(_navEngine);
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

    function createProjectNAV(
        string memory projectName,
        string[] memory companyNames,
        uint256[] memory companyWeights,
        uint256 minimumRaise,
        uint256 deadline,
        address withdrawAddress,
        uint256 raiseFeeBps,
        uint256 profitFeeBps
    ) external returns (address) {
        uint256 len = companyNames.length;
        require(len > 0, "No companies");
        require(companyWeights.length == len, "Invalid weights");
        require(minimumRaise > 0, "Minimum raise required");
        require(deadline > block.timestamp, "Deadline must be future");
        require(withdrawAddress != address(0), "Withdraw address required");
        require(raiseFeeBps <= 10_000, "Invalid raise fee");
        require(profitFeeBps <= 10_000, "Invalid profit fee");

        uint256 totalWeight;
        for (uint256 i = 0; i < len; i++) {
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

        navEngine.registerVault(address(vault), 0);

        for (uint256 i = 0; i < len; i++) {
            navEngine.registerCompany(
                address(vault),
                companyNames[i],
                companyWeights[i],
                10, // resourceTonnes
                8500, // recoveryBps
                5, // yearsToProduction
                15, // mineLifeYears
                1000, // discountRateBps
                1_000_000e6 // floorNavUsd
            );
        }

        emit ProjectRegisteredWithNAV(address(vault), len);
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
