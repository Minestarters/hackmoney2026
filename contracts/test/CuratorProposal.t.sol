// SPDX-License-Identifier: ISC
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/CuratorProposal.sol";
import "../src/MinestartersFactory.sol";
import "../src/MineStarters.sol";
import "../src/MockUSDC.sol";
import "../src/BasketVault.sol";

contract CuratorProposalTest is Test {
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant ALLOCATION_TYPEHASH =
        keccak256("CuratorAllocation(address curator,uint256 stake,uint256 nonce,bytes32 allocationsHash)");
    bytes32 private constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    MinestartersFactory public factory;
    MineStarters public mine;
    MockUSDC public usdc;
    CuratorProposal public proposal;

    uint256 private curatorKeyOne = 0xA11CE;
    uint256 private curatorKeyTwo = 0xB0B;
    address private curatorOne;
    address private curatorTwo;

    function setUp() public {
        curatorOne = vm.addr(curatorKeyOne);
        curatorTwo = vm.addr(curatorKeyTwo);

        usdc = new MockUSDC();
        factory = new MinestartersFactory(address(usdc));
        mine = new MineStarters();

        mine.mint(curatorOne, 10_000 ether);
        mine.mint(curatorTwo, 10_000 ether);

        string[] memory companies = new string[](3);
        companies[0] = "Alpha Metals";
        companies[1] = "Beta Minerals";
        companies[2] = "Gamma Logistics";

        proposal = new CuratorProposal(
            address(factory),
            address(mine),
            "Mine Basket",
            companies,
            block.timestamp + 1 days,
            1_000e6,
            block.timestamp + 7 days,
            address(0xBEEF),
            200,
            500
        );
    }

    function test_SettleAndFinalize() public {
        uint256 stakeOne = 1_000 ether;
        uint256 stakeTwo = 3_000 ether;
        uint256 permitDeadline = block.timestamp + 3 days;

        uint256[] memory allocationsOne = new uint256[](3);
        allocationsOne[0] = 50;
        allocationsOne[1] = 30;
        allocationsOne[2] = 20;

        uint256[] memory allocationsTwo = new uint256[](3);
        allocationsTwo[0] = 20;
        allocationsTwo[1] = 50;
        allocationsTwo[2] = 30;

        (uint8 permitV1, bytes32 permitR1, bytes32 permitS1) = _signPermit(
            curatorKeyOne,
            curatorOne,
            address(proposal),
            stakeOne,
            permitDeadline
        );
        (uint8 permitV2, bytes32 permitR2, bytes32 permitS2) = _signPermit(
            curatorKeyTwo,
            curatorTwo,
            address(proposal),
            stakeTwo,
            permitDeadline
        );

        bytes memory allocationSigOne = _signAllocation(curatorKeyOne, curatorOne, stakeOne, 0, allocationsOne);
        bytes memory allocationSigTwo = _signAllocation(curatorKeyTwo, curatorTwo, stakeTwo, 0, allocationsTwo);

        CuratorProposal.Settlement[] memory settlements = new CuratorProposal.Settlement[](2);
        settlements[0] = CuratorProposal.Settlement({
            curator: curatorOne,
            stake: stakeOne,
            nonce: 0,
            permitDeadline: permitDeadline,
            permitV: permitV1,
            permitR: permitR1,
            permitS: permitS1,
            allocations: allocationsOne,
            signature: allocationSigOne
        });
        settlements[1] = CuratorProposal.Settlement({
            curator: curatorTwo,
            stake: stakeTwo,
            nonce: 0,
            permitDeadline: permitDeadline,
            permitV: permitV2,
            permitR: permitR2,
            permitS: permitS2,
            allocations: allocationsTwo,
            signature: allocationSigTwo
        });

        vm.warp(block.timestamp + 2 days);
        proposal.settleAndFinalize(settlements);

        assertEq(proposal.totalStake(), stakeOne + stakeTwo);
        assertEq(mine.balanceOf(address(proposal)), 0);

        (, uint256 totalAlpha) = proposal.getCandidate(0);
        (, uint256 totalBeta) = proposal.getCandidate(1);
        (, uint256 totalGamma) = proposal.getCandidate(2);

        assertEq(totalAlpha, 1_100 ether);
        assertEq(totalBeta, 1_800 ether);
        assertEq(totalGamma, 1_100 ether);

        assertEq(factory.getProjectCount(), 1);
        address vaultAddress = factory.getProjectAt(0);
        BasketVault vault = BasketVault(vaultAddress);

        assertEq(vault.companyWeights(0), 27);
        assertEq(vault.companyWeights(1), 45);
        assertEq(vault.companyWeights(2), 28);
    }

    function test_FinalizeCannotBeCalledTwice() public {
        uint256 stake = 1_000 ether;
        uint256 permitDeadline = block.timestamp + 3 days;
        uint256[] memory allocations = new uint256[](3);
        allocations[0] = 50;
        allocations[1] = 30;
        allocations[2] = 20;

        (uint8 permitV, bytes32 permitR, bytes32 permitS) = _signPermit(
            curatorKeyOne,
            curatorOne,
            address(proposal),
            stake,
            permitDeadline
        );

        bytes memory allocationSig = _signAllocation(curatorKeyOne, curatorOne, stake, 0, allocations);

        CuratorProposal.Settlement[] memory settlements = new CuratorProposal.Settlement[](1);
        settlements[0] = CuratorProposal.Settlement({
            curator: curatorOne,
            stake: stake,
            nonce: 0,
            permitDeadline: permitDeadline,
            permitV: permitV,
            permitR: permitR,
            permitS: permitS,
            allocations: allocations,
            signature: allocationSig
        });

        vm.warp(block.timestamp + 2 days);
        proposal.settleAndFinalize(settlements);

        vm.expectRevert(CuratorProposal.AlreadyFinalized.selector);
        proposal.finalize();
    }

    function test_InvalidSignatureReverts() public {
        uint256 stake = 1_000 ether;
        uint256 permitDeadline = block.timestamp + 3 days;
        uint256[] memory allocations = new uint256[](3);
        allocations[0] = 50;
        allocations[1] = 30;
        allocations[2] = 20;

        (uint8 permitV, bytes32 permitR, bytes32 permitS) = _signPermit(
            curatorKeyOne,
            curatorOne,
            address(proposal),
            stake,
            permitDeadline
        );

        bytes memory allocationSig = _signAllocation(curatorKeyTwo, curatorTwo, stake, 0, allocations);

        CuratorProposal.Settlement[] memory settlements = new CuratorProposal.Settlement[](1);
        settlements[0] = CuratorProposal.Settlement({
            curator: curatorOne,
            stake: stake,
            nonce: 0,
            permitDeadline: permitDeadline,
            permitV: permitV,
            permitR: permitR,
            permitS: permitS,
            allocations: allocations,
            signature: allocationSig
        });

        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(CuratorProposal.InvalidSignature.selector);
        proposal.settleAndFinalize(settlements);
    }

    function _signAllocation(
        uint256 key,
        address curator,
        uint256 stake,
        uint256 nonce,
        uint256[] memory allocations
    ) internal view returns (bytes memory) {
        bytes32 allocationsHash = keccak256(abi.encodePacked(allocations));
        bytes32 structHash = keccak256(
            abi.encode(ALLOCATION_TYPEHASH, curator, stake, nonce, allocationsHash)
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes("CuratorProposal")),
                keccak256(bytes("1")),
                block.chainid,
                address(proposal)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signPermit(
        uint256 key,
        address owner,
        address spender,
        uint256 value,
        uint256 deadline
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        uint256 nonce = mine.nonces(owner);
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", mine.DOMAIN_SEPARATOR(), structHash));
        return vm.sign(key, digest);
    }
}
