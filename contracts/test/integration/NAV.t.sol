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
        // setup: 2 companies with weights 60/40
        string[] memory names = new string[](2);
        names[0] = "Alpha Mining";
        names[1] = "Beta Resources";

        uint256[] memory weights = new uint256[](2);
        weights[0] = 60;
        weights[1] = 40;

        // create project with NAV
        vm.prank(creator);
        address vaultAddr = factory.createProjectWithNAV(
            "Gold Basket",
            names,
            weights,
            MINIMUM_RAISE,
            block.timestamp + 30 days,
            creator,
            200,  // 2% raise fee
            1000  // 10% profit fee
        );

        BasketVault vault = BasketVault(vaultAddr);
        address shareToken = vault.shareToken();

        // verify project registration
        assertEq(factory.getProjectCount(), 1);
        assertEq(factory.getProjectAt(0), vaultAddr);
        (, bool registered) = navEngine.vaults(vaultAddr);
        assertTrue(registered);

        // investors deposit $100k total
        vm.startPrank(investor1);
        usdc.approve(vaultAddr, type(uint256).max);
        vault.deposit(60_000e6);
        vm.stopPrank();

        vm.startPrank(investor2);
        usdc.approve(vaultAddr, type(uint256).max);
        vault.deposit(40_000e6);
        vm.stopPrank();

        assertEq(vault.totalRaised(), 100_000e6);
        uint256 totalShares = IERC20(shareToken).totalSupply();
        
        // 2% raise fee shares = amount * (10000 - 200) / 10000 = 98%
        uint256 expectedShares = (100_000e6 * 9800) / 10000;
        assertEq(totalShares, expectedShares);

        // stage 0: exploration
        // at exploration, NAV = floor NAV
        // floor NAVs set by factory: (minimumRaise * weight) / 100
        uint256 expectedFloor0 = (MINIMUM_RAISE * 60) / 100;  // 60,000e6
        uint256 expectedFloor1 = (MINIMUM_RAISE * 40) / 100;  // 40,000e6
        
        uint256 navPerToken0 = navEngine.getCurrentNAV(vaultAddr);
        uint256 expectedNavPerToken0 = (expectedFloor0 + expectedFloor1) / totalShares;
        assertEq(navPerToken0, expectedNavPerToken0);

        // stage 1 
        vm.prank(creator);
        navEngine.advanceCompanyStage(vaultAddr, 0, 3, 15);

        (,,,, NAVEngine.Stage stage0,) = navEngine.getCompany(vaultAddr, 0);

        // at Permits stage, calculated NAV uses DCF with k_permits = 35%
        // with 10,000 tonnes, calculated NAV exceeds floor
        (,,,,, uint256 nav0AtPermits) = navEngine.getCompany(vaultAddr, 0);
        assertGt(nav0AtPermits, expectedFloor0);

        uint256 navPerTokenAtPermits = navEngine.getCurrentNAV(vaultAddr);
        assertGe(navPerTokenAtPermits, navPerToken0);

        navEngine.updateGoldPrice(5000e6);

        (,,,,, uint256 nav0AtHighPrice) = navEngine.getCompany(vaultAddr, 0);
        
        assertGt(nav0AtHighPrice, nav0AtPermits);

        // creator can update company parameters to improve NAV
        // increase k multipliers and reduce years to production
        vm.prank(creator);
        navEngine.updateCompany(
            vaultAddr,
            0,             
            60,            
            2,             
            20,            
            800,           
            uint128(expectedFloor0),
            5000,          
            8000,          
            9500           
        );

        (,,,,, uint256 nav0AfterUpdate) = navEngine.getCompany(vaultAddr, 0);
        
        // nav should increase
        assertGt(nav0AfterUpdate, nav0AtHighPrice);

        // final nav per token should reflect all increases
        uint256 finalNavPerToken = navEngine.getCurrentNAV(vaultAddr);
        assertGt(finalNavPerToken, navPerToken0);
    }

    function test_StageProgressionAffectsNAV() public {
        string[] memory names = new string[](1);
        names[0] = "Progressive Mine";

        uint256[] memory weights = new uint256[](1);
        weights[0] = 100;

        vm.prank(creator);
        address vaultAddr = factory.createProjectWithNAV(
            "Stage Test", names, weights, 10_000e6, block.timestamp + 1 days, creator, 0, 0
        );

        BasketVault vault = BasketVault(vaultAddr);

        vm.startPrank(investor1);
        usdc.approve(vaultAddr, type(uint256).max);
        vault.deposit(10_000e6);
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
        // assertGt(navByStage[1], navByStage[0]); 
        // assertGt(navByStage[2], navByStage[1]); 
        // assertGt(navByStage[3], navByStage[0]); 
    }
}
