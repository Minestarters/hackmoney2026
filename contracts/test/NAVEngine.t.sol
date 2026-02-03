// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NAVEngine} from "../src/NAVEngine.sol";
import {BasketVault} from "../src/BasketVault.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract NAVEngineTest is Test {
    NAVEngine public navEngine;

    address public vault = makeAddr("vault");
    address public oracle = makeAddr("oracle");

    uint256 public constant GOLD_PRICE = 2000e6;

    function setUp() public {
        navEngine = new NAVEngine(GOLD_PRICE, oracle);
    }

    function test_RegisterCompany() public {
        navEngine.registerVault(vault, 1_000_000);

        navEngine.registerCompany(vault, "Golden Mountain Mining", 100, 10, 9000, 5, 20, 1000, 1e6);

        (string memory name, uint256 weight,,, NAVEngine.Stage stage,) = navEngine.getCompany(vault, 0);
        assertEq(name, "Golden Mountain Mining");
        assertEq(weight, 100);
        assertEq(uint8(stage), 0);
    }


    function test_PermitsNAV() public {
        navEngine.registerVault(vault, 1_000_000);
        navEngine.registerCompany(vault, "Test Mine", 100, 10, 9000, 5, 20, 1000, 1e6);

        navEngine.advanceCompanyStage(vault, 0);

        (,,,,, uint256 navUsd) = navEngine.getCompany(vault, 0);
        assertGt(navUsd, 1e6);
    }

    function test_WeightedBasketNAV() public {
        // Create real vault with 2 companies
        MockUSDC usdc = new MockUSDC();
        string[] memory names = new string[](2);
        names[0] = "Alpha";
        names[1] = "Beta";
        uint256[] memory weights = new uint256[](2);
        weights[0] = 60;
        weights[1] = 40;
        
        BasketVault realVault = new BasketVault(
            "Test Basket", names, weights, address(usdc),
            address(this), address(this), 1, block.timestamp + 1 days, 0, 0
        );
        
        usdc.mint(address(this), 1_000_000);
        usdc.approve(address(realVault), type(uint256).max);
        realVault.deposit(1_000_000);
        
        uint256 totalShares = IERC20(realVault.shareToken()).totalSupply();
        assertEq(totalShares, 1_000_000, "Should have 1M shares");
        
        navEngine.registerVault(address(realVault), totalShares);
        navEngine.registerCompany(address(realVault), "Alpha", 60, 10, 9000, 5, 20, 1000, 1_000_000e6);
        navEngine.registerCompany(address(realVault), "Beta", 40, 5, 8500, 3, 15, 1200, 500_000e6);

        uint256 navPerToken = navEngine.getCurrentNAV(address(realVault));
        // Weighted floor NAV: (1M * 60 + 500k * 40) / 100 = 800k e6, divided by 1M shares = 800_000
        assertEq(navPerToken, 800_000);
    }

    function test_NavPerToken() public {
        // Create real vault with 1 company
        MockUSDC usdc = new MockUSDC();
        string[] memory names = new string[](1);
        names[0] = "Test Mine";
        uint256[] memory weights = new uint256[](1);
        weights[0] = 100;
        
        BasketVault realVault = new BasketVault(
            "Test Basket", names, weights, address(usdc),
            address(this), address(this), 1, block.timestamp + 1 days, 0, 0
        );
        
        usdc.mint(address(this), 1_000_000);
        usdc.approve(address(realVault), type(uint256).max);
        realVault.deposit(1_000_000);
        
        uint256 totalShares = IERC20(realVault.shareToken()).totalSupply();
        assertEq(totalShares, 1_000_000, "Should have 1M shares");
        
        navEngine.registerVault(address(realVault), totalShares);
        navEngine.registerCompany(address(realVault), "Test Mine", 100, 10, 9000, 5, 20, 1000, 5_000_000e6);

        uint256 navPerToken = navEngine.getCurrentNAV(address(realVault));
        // Floor NAV: 5M e6 * 100 / 100 = 5M e6, divided by 1M shares = 5e6
        assertEq(navPerToken, 5e6);
    }

    function test_AdvanceStage() public {
        navEngine.registerVault(vault, 1_000_000);
        navEngine.registerCompany(vault, "Test Mine", 100, 10, 9000, 6, 20, 1000, 1e6);

        navEngine.advanceCompanyStage(vault, 0);
        (,,,, NAVEngine.Stage stage,) = navEngine.getCompany(vault, 0);
        assertEq(uint8(stage), 1);
    }

    function test_RevertAdvancePastProduction() public {
        navEngine.registerVault(vault, 1_000_000);
        navEngine.registerCompany(vault, "Test Mine", 100, 10, 9000, 5, 20, 1000, 1e6);

        navEngine.advanceCompanyStage(vault, 0);
        navEngine.advanceCompanyStage(vault, 0);
        navEngine.advanceCompanyStage(vault, 0);

        vm.expectRevert(NAVEngine.AlreadyProduction.selector);
        navEngine.advanceCompanyStage(vault, 0);
    }


    function test_RevertInventoryBeforeProduction() public {
        navEngine.registerVault(vault, 1_000_000);
        navEngine.registerCompany(vault, "Test Mine", 100, 10, 9000, 5, 20, 1000, 1e6);

        vm.expectRevert(NAVEngine.NotInProduction.selector);
        navEngine.updateInventory(vault, 0, 1);
    }

    function test_DCF_YearsToProductionAffectsNAV() public {
        navEngine.registerVault(vault, 1_000_000);
        navEngine.registerCompany(vault, "Near Term", 100, 10, 9000, 5, 20, 1000, 1e6);
        navEngine.advanceCompanyStage(vault, 0);
        (,,,,, uint256 nav5Years) = navEngine.getCompany(vault, 0);

        address vault2 = makeAddr("vault2");
        navEngine.registerVault(vault2, 1_000_000);
        navEngine.registerCompany(vault2, "Far Term", 100, 10, 9000, 10, 20, 1000, 1e6);
        navEngine.advanceCompanyStage(vault2, 0);
        (,,,,, uint256 nav10Years) = navEngine.getCompany(vault2, 0);

        assertGt(nav5Years, nav10Years);
    }

    function test_NAV_Value() public {
        vm.prank(oracle);
        navEngine.updateGoldPrice(4895e6);

        navEngine.registerVault(vault, 1_000_000);
        navEngine.registerCompany(vault, "Gold Mine", 100, 1, 10000, 0, 20, 1000, 1e6);
        navEngine.advanceCompanyStage(vault, 0);

        (,,,,, uint256 actualNAV) = navEngine.getCompany(vault, 0);
        uint256 expectedNAV = 55_080_987;

        assertEq(actualNAV, expectedNAV);
    }


    function test_SimulateFullNAVEngineProcess() public {
        MockUSDC usdc = new MockUSDC();
        address creator = makeAddr("creator");
        address withdrawAddr = makeAddr("withdrawAddr");
        address investor1 = makeAddr("investor1");
        address investor2 = makeAddr("investor2");
        
        string[] memory companyNames = new string[](3);
        companyNames[0] = "alpha gold corp";
        companyNames[1] = "beta mining ltd";
        companyNames[2] = "gamma resources";
        
        uint256[] memory weights = new uint256[](3);
        weights[0] = 50;
        weights[1] = 30;
        weights[2] = 20;
        
        BasketVault realVault = new BasketVault(
            "gold mining basket",
            companyNames,
            weights,
            address(usdc),
            creator,
            withdrawAddr,
            100_000e6,
            block.timestamp + 7 days,
            200,
            500
        );
        
        usdc.mint(investor1, 200_000e6);
        usdc.mint(investor2, 100_000e6);
        
        vm.startPrank(investor1);
        usdc.approve(address(realVault), type(uint256).max);
        realVault.deposit(150_000e6);
        vm.stopPrank();
        
        vm.startPrank(investor2);
        usdc.approve(address(realVault), type(uint256).max);
        realVault.deposit(50_000e6);
        vm.stopPrank();
        
        uint256 totalShares = IERC20(realVault.shareToken()).totalSupply();
        assertEq(realVault.totalRaised(), 200_000e6);
        assertGt(totalShares, 0);
        
        navEngine.registerVault(address(realVault), totalShares);
        
        navEngine.registerCompany(
            address(realVault), companyNames[0], 50, 50, 9000, 3, 15, 1000, 10_000_000e6
        );
        navEngine.registerCompany(
            address(realVault), companyNames[1], 30, 30, 8500, 5, 12, 1200, 5_000_000e6
        );
        navEngine.registerCompany(
            address(realVault), companyNames[2], 20, 15, 8000, 8, 10, 1500, 2_000_000e6
        );
        
        uint256 navExploration = navEngine.getCurrentNAV(address(realVault));
        assertGt(navExploration, 0);
        
        (,,,, NAVEngine.Stage alphaStage,) = navEngine.getCompany(address(realVault), 0);
        (,,,, NAVEngine.Stage betaStage,) = navEngine.getCompany(address(realVault), 1);
        (,,,, NAVEngine.Stage gammaStage,) = navEngine.getCompany(address(realVault), 2);
        assertEq(uint8(alphaStage), 0);
        assertEq(uint8(betaStage), 0);
        assertEq(uint8(gammaStage), 0);
        
        navEngine.advanceCompanyStage(address(realVault), 0);
        
        uint256 navAlphaPermits = navEngine.getCurrentNAV(address(realVault));
        assertGe(navAlphaPermits, navExploration);
        
        (,,,, alphaStage,) = navEngine.getCompany(address(realVault), 0);
        assertEq(uint8(alphaStage), 1);
        
        uint256 newPrice = 2500e6;
        
        vm.prank(oracle);
        navEngine.updateGoldPrice(newPrice);
        
        uint256 navAfterPriceIncrease = navEngine.getCurrentNAV(address(realVault));
        assertGe(navAfterPriceIncrease, navAlphaPermits);
        
        navEngine.advanceCompanyStage(address(realVault), 0);
        navEngine.advanceCompanyStage(address(realVault), 1);
        navEngine.advanceCompanyStage(address(realVault), 1);
        
        uint256 navConstruction = navEngine.getCurrentNAV(address(realVault));
        assertGe(navConstruction, navAfterPriceIncrease);
        
        (,,,, alphaStage,) = navEngine.getCompany(address(realVault), 0);
        (,,,, betaStage,) = navEngine.getCompany(address(realVault), 1);
        assertEq(uint8(alphaStage), 2);
        assertEq(uint8(betaStage), 2);
        
        navEngine.advanceCompanyStage(address(realVault), 0);
        
        (,,,, alphaStage,) = navEngine.getCompany(address(realVault), 0);
        assertEq(uint8(alphaStage), 3);
        
        navEngine.updateInventory(address(realVault), 0, 10);
        
        uint256 navAfterExtraction = navEngine.getCurrentNAV(address(realVault));
        
        (,,, uint256 alphaInventory,,) = navEngine.getCompany(address(realVault), 0);
        assertEq(alphaInventory, 10);
        
        uint256 crashPrice = 1500e6;
        vm.prank(oracle);
        navEngine.updateGoldPrice(crashPrice);
        
        uint256 navAfterCrash = navEngine.getCurrentNAV(address(realVault));
        assertLe(navAfterCrash, navAfterExtraction);
        
        (,,,,, uint256 gammaNav) = navEngine.getCompany(address(realVault), 2);
        assertEq(gammaNav, 2_000_000e6);
        
        vm.prank(oracle);
        navEngine.updateGoldPrice(3000e6);
        
        navEngine.advanceCompanyStage(address(realVault), 1);
        navEngine.advanceCompanyStage(address(realVault), 2);
        navEngine.advanceCompanyStage(address(realVault), 2);
        navEngine.advanceCompanyStage(address(realVault), 2);
        
        (,,,, alphaStage,) = navEngine.getCompany(address(realVault), 0);
        (,,,, betaStage,) = navEngine.getCompany(address(realVault), 1);
        (,,,, gammaStage,) = navEngine.getCompany(address(realVault), 2);
        assertEq(uint8(alphaStage), 3);
        assertEq(uint8(betaStage), 3);
        assertEq(uint8(gammaStage), 3);
        
        uint256 finalNav = navEngine.getCurrentNAV(address(realVault));
        
        (,,,,, uint256 alphaFinalNav) = navEngine.getCompany(address(realVault), 0);
        (,,,,, uint256 betaFinalNav) = navEngine.getCompany(address(realVault), 1);
        (,,,,, uint256 gammaFinalNav) = navEngine.getCompany(address(realVault), 2);
        
        assertGt(alphaFinalNav, 0);
        assertGt(betaFinalNav, 0);
        assertGt(gammaFinalNav, 0);
        
        assertGe(finalNav, 0);
    }

}
