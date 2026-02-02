// SPDX-License-Identifier: ISC
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/BasketVault.sol";
import "../src/BasketShareToken.sol";
import "../src/MockUSDC.sol";

contract BasketVaultTest is Test {
    BasketVault public vault;
    BasketShareToken public shareToken;
    MockUSDC public usdc;

    address public creator = address(1);
    address public withdrawer = address(2);
    address public investor = address(3);
    address public investorTwo = address(4);
    address public profitPayer = address(5);

    uint256 public constant MINIMUM_RAISE = 10000 * 1e6;
    uint256 public constant RAISE_FEE_BPS = 200;
    uint256 public constant PROFIT_FEE_BPS = 500;
    uint256 public constant DAY = 1 days;

    function setUp() public {
        usdc = new MockUSDC();

        uint256 deadline = block.timestamp + 7 * DAY;

        string[] memory companies = new string[](2);
        companies[0] = "Alpha Metals";
        companies[1] = "Beta Minerals";

        uint256[] memory weights = new uint256[](2);
        weights[0] = 60;
        weights[1] = 40;

        vm.startPrank(creator);
        vault = new BasketVault(
            "Iron Mine A",
            companies,
            weights,
            address(usdc),
            creator,
            withdrawer,
            MINIMUM_RAISE,
            deadline,
            RAISE_FEE_BPS,
            PROFIT_FEE_BPS
        );
        vm.stopPrank();

        shareToken = BasketShareToken(vault.shareToken());

        uint256 initialMint = 1000000 * 1e6;
        usdc.mint(investor, initialMint);
        usdc.mint(investorTwo, initialMint);
        usdc.mint(profitPayer, initialMint);

        vm.prank(investor);
        usdc.approve(address(vault), initialMint);
        vm.prank(investorTwo);
        usdc.approve(address(vault), initialMint);
        vm.prank(profitPayer);
        usdc.approve(address(vault), initialMint);
    }

    function test_Deposit() public {
        uint256 depositAmount = 15000 * 1e6;
        uint256 expectedNet = (depositAmount * (10000 - RAISE_FEE_BPS)) / 10000;

        vm.prank(investor);
        vault.deposit(depositAmount);

        assertEq(vault.totalRaised(), depositAmount);
        assertEq(shareToken.balanceOf(investor), expectedNet);
    }

    function test_WithdrawRaisedFunds() public {
        uint256 depositAmount = 15000 * 1e6;
        vm.prank(investor);
        vault.deposit(depositAmount);

        uint256 expectedNet = (depositAmount * (10000 - RAISE_FEE_BPS)) / 10000;
        uint256 withdrawerStart = usdc.balanceOf(withdrawer);

        vm.prank(creator);
        vault.withdrawRaisedFunds();

        assertEq(usdc.balanceOf(withdrawer), withdrawerStart + expectedNet);
    }
}
