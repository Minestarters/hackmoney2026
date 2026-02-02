// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NAVEngine} from "../src/NAVEngine.sol";

contract NAVEngineTest is Test {
    NAVEngine public engine;

    address public vault = makeAddr("vault");
    address public oracle = makeAddr("oracle");

    uint256 constant GOLD_PRICE = 430e6;
    uint256 constant RESOURCE_TONNES = 10;
    uint256 constant RECOVERY_BPS = 9000;
    uint256 constant TOKEN_SUPPLY = 1_000_000;
    uint256 constant FLOOR_NAV = 1e6;
    uint256 constant YEARS_TO_PROD = 5;
    uint256 constant MINE_LIFE = 20;
    uint256 constant DISCOUNT_RATE = 1000;

    function setUp() public {
        engine = new NAVEngine(GOLD_PRICE, address(0));
        engine.setOracle(oracle);
    }

    function test_RegisterProject() public {
        engine.registerProject(
            vault, RESOURCE_TONNES, RECOVERY_BPS, TOKEN_SUPPLY, FLOOR_NAV, YEARS_TO_PROD, MINE_LIFE, DISCOUNT_RATE
        );

        (uint256 resourceTonnes,,,, NAVEngine.Stage stage,,) = engine.getProject(vault);

        assertEq(resourceTonnes, RESOURCE_TONNES);
        assertEq(uint8(stage), uint8(NAVEngine.Stage.Exploration));
    }

    function test_RevertIfNotRegistered() public {
        vm.expectRevert(NAVEngine.ProjectNotRegistered.selector);
        engine.getCurrentNAV(vault);
    }

    function test_AdvanceStage() public {
        _registerProject();

        engine.advanceStage(vault);
        (,,,, NAVEngine.Stage stage,,) = engine.getProject(vault);
        assertEq(uint8(stage), uint8(NAVEngine.Stage.Permits));

        engine.advanceStage(vault);
        (,,,, stage,,) = engine.getProject(vault);
        assertEq(uint8(stage), uint8(NAVEngine.Stage.Construction));

        engine.advanceStage(vault);
        (,,,, stage,,) = engine.getProject(vault);
        assertEq(uint8(stage), uint8(NAVEngine.Stage.Production));
    }

    function test_RevertAdvancePastProduction() public {
        _registerProject();

        engine.advanceStage(vault);
        engine.advanceStage(vault);
        engine.advanceStage(vault);

        vm.expectRevert(NAVEngine.AlreadyProduction.selector);
        engine.advanceStage(vault);
    }

    function test_ExplorationNAV_ReturnsFloor() public {
        _registerProject();
        uint256 nav = engine.getCurrentNAV(vault);
        assertEq(nav, FLOOR_NAV);
    }

    function test_PermitsNAV() public {
        _registerProject();
        engine.advanceStage(vault);

        uint256 nav = engine.getCurrentNAV(vault);

        assertTrue(nav > 0);
        assertTrue(nav < _calculateGrossValue());
    }

    function test_ConstructionNAV_HigherThanPermits() public {
        _registerProject();

        engine.advanceStage(vault);
        uint256 permitsNav = engine.getCurrentNAV(vault);

        engine.advanceStage(vault);
        uint256 constructionNav = engine.getCurrentNAV(vault);

        assertTrue(constructionNav > permitsNav);
    }

    function test_ProductionNAV() public {
        _registerProject();

        engine.advanceStage(vault);
        engine.advanceStage(vault);
        engine.advanceStage(vault);

        uint256 nav = engine.getCurrentNAV(vault);
        assertTrue(nav > 0);
    }

    function test_ProductionNAV_IncreasesWithMining() public {
        _registerProject();

        engine.advanceStage(vault);
        engine.advanceStage(vault);
        engine.advanceStage(vault);

        uint256 navBefore = engine.getCurrentNAV(vault);
        engine.updateMinedTonnes(vault, 1);
        uint256 navAfter = engine.getCurrentNAV(vault);

        assertTrue(navAfter > navBefore);
    }

    function test_DCF_ZeroYears() public {
        _registerProject();

        engine.updateProjectParameters(vault, 0, MINE_LIFE, DISCOUNT_RATE, 3500, 7000, 9000);
        engine.advanceStage(vault);

        uint256 nav = engine.getCurrentNAV(vault);
        assertTrue(nav > 0);
    }

    function test_UpdateGoldPrice() public {
        _registerProject();
        engine.advanceStage(vault);

        uint256 navBefore = engine.getCurrentNAV(vault);
        engine.updateGoldPrice(4000e6);
        uint256 navAfter = engine.getCurrentNAV(vault);

        assertTrue(navAfter > navBefore * 15 / 10);
    }

    function test_OnlyOracleCanUpdatePrice() public {
        address notOracle = address(0x9999);

        vm.prank(notOracle);
        vm.expectRevert(NAVEngine.Unauthorized.selector);
        engine.updateGoldPrice(3000e6);
    }

    function test_OracleCanUpdatePrice() public {
        vm.prank(oracle);
        engine.updateGoldPrice(3000e6);
        assertEq(engine.goldPriceUsd(), 3000e6);
    }

    function test_RevertInvalidPrice() public {
        vm.expectRevert(NAVEngine.InvalidPrice.selector);
        engine.updateGoldPrice(0);
    }

    function test_OnlyOwnerCanRegister() public {
        address notOwner = address(0x9999);

        vm.prank(notOwner);
        vm.expectRevert();
        engine.registerProject(
            vault, RESOURCE_TONNES, RECOVERY_BPS, TOKEN_SUPPLY, FLOOR_NAV, YEARS_TO_PROD, MINE_LIFE, DISCOUNT_RATE
        );
    }

    function test_CannotUpdateMinedBeforeProduction() public {
        _registerProject();

        vm.expectRevert(NAVEngine.NotInProduction.selector);
        engine.updateMinedTonnes(vault, 1);
    }

    function test_CannotDecreaseMined() public {
        _registerProject();
        engine.advanceStage(vault);
        engine.advanceStage(vault);
        engine.advanceStage(vault);

        engine.updateMinedTonnes(vault, 5);

        vm.expectRevert(NAVEngine.CannotDecreaseMined.selector);
        engine.updateMinedTonnes(vault, 3);
    }

    function test_CannotExceedResource() public {
        _registerProject();
        engine.advanceStage(vault);
        engine.advanceStage(vault);
        engine.advanceStage(vault);

        vm.expectRevert(NAVEngine.ExceedsResource.selector);
        engine.updateMinedTonnes(vault, RESOURCE_TONNES + 1);
    }

    function _registerProject() internal {
        engine.registerProject(
            vault, RESOURCE_TONNES, RECOVERY_BPS, TOKEN_SUPPLY, FLOOR_NAV, YEARS_TO_PROD, MINE_LIFE, DISCOUNT_RATE
        );
    }

    function _calculateGrossValue() internal pure returns (uint256) {
        return RESOURCE_TONNES * 32150 * RECOVERY_BPS / 10000 * GOLD_PRICE / 1e6;
    }
}
