// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MinestartersFactory} from "../../src/MinestartersFactory.sol";
import {NAVEngine} from "../../src/NAVEngine.sol";
import {BasketVault} from "../../src/BasketVault.sol";
import {MockUSDC} from "../../src/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract NAVIntegrationTest is Test {
    MinestartersFactory factory;
    NAVEngine navEngine;
    MockUSDC usdc;

    address creator = makeAddr("creator");
    address investor1 = makeAddr("investor1");
    address investor2 = makeAddr("investor2");

    uint256 constant GOLD_PRICE = 2500e6;
    uint256 constant MINIMUM_RAISE = 100_000e6;

    function setUp() public {
        usdc = new MockUSDC();
        factory = new MinestartersFactory(address(usdc));
        navEngine = factory.navEngine();
        navEngine.updateGoldPrice(GOLD_PRICE);

        usdc.mint(investor1, 500_000e6);
        usdc.mint(investor2, 500_000e6);
    }

    function test_FullProjectLifecycle() public {
        // ============ PROJECT SETUP ============
        string[] memory names = new string[](1);
        names[0] = "Gold Mine Alpha";

        uint256[] memory weights = new uint256[](1);
        weights[0] = 100;

        vm.prank(creator);
        address vaultAddr = factory.createProjectWithNAV(
            "Gold Basket",
            names,
            weights,
            MINIMUM_RAISE,
            block.timestamp + 30 days,
            creator,
            200 // 2% raise fee
        );

        BasketVault vault = BasketVault(vaultAddr);
        address shareToken = vault.shareToken();

        // verify registration
        assertEq(factory.getProjectCount(), 1);
        (, bool registered) = navEngine.vaults(vaultAddr);
        assertTrue(registered);

        // investor deposit
        vm.startPrank(investor1);
        usdc.approve(vaultAddr, type(uint256).max);
        vault.deposit(100_000e6, 1);
        vm.stopPrank();

        uint256 totalShares = IERC20(shareToken).totalSupply();
        assertGt(totalShares, 0);

        // stage 0 exploration
        (,,,, NAVEngine.Stage stage,) = navEngine.getCompany(vaultAddr, 0);
        assertEq(uint8(stage), 0); // exploration

        uint256 floorNav = MINIMUM_RAISE; // 100% weight = full raise
        (,,,,, uint256 navExploration) = navEngine.getCompany(vaultAddr, 0);
        assertEq(navExploration, floorNav); // at exploration, NAV = floor

        uint256 navPerTokenExploration = navEngine.getCurrentNAV(vaultAddr);

        // stage 1 permits
        vm.prank(creator);
        navEngine.advanceCompanyStage(vaultAddr, 0, 4, 20); // 4 years to production, 20 year mine life

        (,,,, stage,) = navEngine.getCompany(vaultAddr, 0);
        assertEq(uint8(stage), 1); // permits

        (,,,,, uint256 navPermits) = navEngine.getCompany(vaultAddr, 0);
        assertGt(navPermits, navExploration); // k_permits = 35% applied

        uint256 navPerTokenPermits = navEngine.getCurrentNAV(vaultAddr);
        assertGe(navPerTokenPermits, navPerTokenExploration); // may round same

        // stage 2 construction
        vm.prank(creator);
        navEngine.advanceCompanyStage(vaultAddr, 0, 2, 20); // 2 years to production

        (,,,, stage,) = navEngine.getCompany(vaultAddr, 0);
        assertEq(uint8(stage), 2); // construction

        (,,,,, uint256 navConstruction) = navEngine.getCompany(vaultAddr, 0);
        assertGt(navConstruction, navPermits); // k_construction = 70% > k_permits = 35%

        uint256 navPerTokenConstruction = navEngine.getCurrentNAV(vaultAddr);
        assertGe(navPerTokenConstruction, navPerTokenPermits); // may round same

        // stage 3 production
        vm.prank(creator);
        navEngine.advanceCompanyStage(vaultAddr, 0, 0, 18); // production started, 18 years remaining

        (,,,, stage,) = navEngine.getCompany(vaultAddr, 0);
        assertEq(uint8(stage), 3); // production

        (,,,,, uint256 navProduction) = navEngine.getCompany(vaultAddr, 0);
        // production NAV uses different calculation with inventory
        assertGt(navProduction, floorNav); // still above floor

        // inventory update
        // mine extracts 1000 tonnes of ore
        vm.prank(creator);
        navEngine.updateInventory(vaultAddr, 0, 1000, 17); // 1000 tonnes, 17 years remaining

        (,,, uint256 inventory,,) = navEngine.getCompany(vaultAddr, 0);
        assertEq(inventory, 1000);

        (,,,,, uint256 navAfterMining) = navEngine.getCompany(vaultAddr, 0);
        assertGt(navAfterMining, floorNav);

        // gold price increase
        navEngine.updateGoldPrice(5000e6); // gold price doubles

        (,,,,, uint256 navAfterPriceUp) = navEngine.getCompany(vaultAddr, 0);
        assertGt(navAfterPriceUp, navAfterMining); // NAV responds to price

        // final state
        uint256 finalNavPerToken = navEngine.getCurrentNAV(vaultAddr);
        assertGt(finalNavPerToken, navPerTokenExploration);
    }

    function test_StageProgressionAffectsNAV() public {
        string[] memory names = new string[](1);
        names[0] = "Progressive Mine";

        uint256[] memory weights = new uint256[](1);
        weights[0] = 100;

        vm.prank(creator);
        address vaultAddr =
            factory.createProjectWithNAV("Stage Test", names, weights, 10_000e6, block.timestamp + 1 days, creator, 0);

        BasketVault vault = BasketVault(vaultAddr);

        vm.startPrank(investor1);
        usdc.approve(vaultAddr, type(uint256).max);
        vault.deposit(10_000e6, 1);
        vm.stopPrank();

        uint256[] memory navByStage = new uint256[](4);

        (,,,,, navByStage[0]) = navEngine.getCompany(vaultAddr, 0);

        vm.prank(creator);
        navEngine.advanceCompanyStage(vaultAddr, 0, 3, 15);
        (,,,,, navByStage[1]) = navEngine.getCompany(vaultAddr, 0);

        vm.prank(creator);
        navEngine.advanceCompanyStage(vaultAddr, 0, 3, 15);
        (,,,,, navByStage[2]) = navEngine.getCompany(vaultAddr, 0);

        vm.prank(creator);
        navEngine.advanceCompanyStage(vaultAddr, 0, 3, 15);
        (,,,,, navByStage[3]) = navEngine.getCompany(vaultAddr, 0);

        assertEq(navByStage[0], 10_000e6);

        // due to higher k multipliers (35% -> 70% -> 90%)
        assertGt(navByStage[1], navByStage[0]);
        assertGt(navByStage[2], navByStage[1]);
        assertGt(navByStage[3], navByStage[0]);
    }
}
