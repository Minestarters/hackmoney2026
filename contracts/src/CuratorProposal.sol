// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {MinestartersFactory} from "./MinestartersFactory.sol";
import {ECDSA} from "./CuratorProposalLibs.sol";

/// @title CuratorProposal
/// @notice Collects curator allocations, aggregates stake-weighted company weights, and creates a project.
contract CuratorProposal {
    struct Settlement {
        address curator;
        uint256 stake;
        uint256 nonce;
        uint256 permitDeadline;
        uint8 permitV;
        bytes32 permitR;
        bytes32 permitS;
        uint256[] allocations;
        bytes signature;
    }

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant ALLOCATION_TYPEHASH =
        keccak256("CuratorAllocation(address curator,uint256 stake,uint256 nonce,bytes32 allocationsHash)");

    bytes32 private immutable DOMAIN_SEPARATOR;

    MinestartersFactory public immutable factory;
    IERC20 public immutable mine;
    IERC20Permit public immutable minePermit;
    address public immutable proposer;

    string public projectName;
    uint256 public commitmentDeadline;
    uint256 public minimumRaise;
    uint256 public deadline;
    address public withdrawAddress;
    uint256 public raiseFeeBps;
    uint256 public profitFeeBps;

    string[] private candidateCompanies;
    uint256[] private candidateStakeTotals;
    uint256 public totalStake;

    mapping(address => uint256) public nonces;

    bool public finalized;

    event SettlementApplied(address indexed curator, uint256 stake);
    event Finalized(address indexed factory, address indexed vault);

    error AlreadyFinalized();
    error InvalidSignature();
    error InvalidAllocations();
    error InvalidSettlement();
    error CommitmentNotReached();
    error ZeroStake();
    error ZeroAddress();

    constructor(
        address factoryAddress,
        address mineToken,
        string memory projectName_,
        string[] memory companyNames,
        uint256 commitmentDeadline_,
        uint256 minimumRaise_,
        uint256 deadline_,
        address withdrawAddress_,
        uint256 raiseFeeBps_,
        uint256 profitFeeBps_
    ) {
        if (factoryAddress == address(0) || mineToken == address(0) || withdrawAddress_ == address(0)) {
            revert ZeroAddress();
        }
        require(companyNames.length > 0, "No companies");
        require(commitmentDeadline_ > block.timestamp, "Commitment must be future");
        require(deadline_ > block.timestamp, "Deadline must be future");
        require(commitmentDeadline_ < deadline_, "Commitment must precede deadline");
        require(raiseFeeBps_ <= 10_000, "Invalid raise fee");
        require(profitFeeBps_ <= 10_000, "Invalid profit fee");
        require(minimumRaise_ > 0, "Minimum raise required");

        factory = MinestartersFactory(factoryAddress);
        mine = IERC20(mineToken);
        minePermit = IERC20Permit(mineToken);
        proposer = msg.sender;

        projectName = projectName_;
        commitmentDeadline = commitmentDeadline_;
        minimumRaise = minimumRaise_;
        deadline = deadline_;
        withdrawAddress = withdrawAddress_;
        raiseFeeBps = raiseFeeBps_;
        profitFeeBps = profitFeeBps_;

        candidateCompanies = companyNames;
        candidateStakeTotals = new uint256[](companyNames.length);

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("CuratorProposal")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function candidateCount() external view returns (uint256) {
        return candidateCompanies.length;
    }

    function getCandidate(uint256 index) external view returns (string memory name, uint256 stakeTotal) {
        require(index < candidateCompanies.length, "Index out of bounds");
        return (candidateCompanies[index], candidateStakeTotals[index]);
    }

    function settleBatch(Settlement[] calldata settlements) external {
        if (block.timestamp < commitmentDeadline) {
            revert CommitmentNotReached();
        }
        if (finalized) {
            revert AlreadyFinalized();
        }

        _applySettlements(settlements);
    }

    function settleAndFinalize(Settlement[] calldata settlements) external returns (address vault) {
        if (msg.sender != proposer) {
            revert("Only proposer");
        }
        if (block.timestamp < commitmentDeadline) {
            revert CommitmentNotReached();
        }
        if (finalized) {
            revert AlreadyFinalized();
        }

        _applySettlements(settlements);
        vault = _finalize();
    }

    function _applySettlements(Settlement[] calldata settlements) internal {
        uint256 candidateLen = candidateCompanies.length;
        for (uint256 i = 0; i < settlements.length; i++) {
            Settlement calldata settlement = settlements[i];
            if (settlement.curator == address(0)) {
                revert ZeroAddress();
            }
            if (settlement.stake == 0) {
                revert ZeroStake();
            }
            if (settlement.allocations.length != candidateLen) {
                revert InvalidAllocations();
            }
            if (settlement.nonce != nonces[settlement.curator]) {
                revert InvalidSettlement();
            }

            bytes32 allocationsHash = keccak256(abi.encodePacked(settlement.allocations));
            bytes32 structHash = keccak256(
                abi.encode(ALLOCATION_TYPEHASH, settlement.curator, settlement.stake, settlement.nonce, allocationsHash)
            );
            bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
            address recovered = ECDSA.recover(digest, settlement.signature);
            if (recovered != settlement.curator) {
                revert InvalidSignature();
            }

            uint256 allocationSum;
            for (uint256 j = 0; j < candidateLen; j++) {
                allocationSum += settlement.allocations[j];
            }
            if (allocationSum != 100) {
                revert InvalidAllocations();
            }

            minePermit.permit(
                settlement.curator,
                address(this),
                settlement.stake,
                settlement.permitDeadline,
                settlement.permitV,
                settlement.permitR,
                settlement.permitS
            );
            bool ok = mine.transferFrom(settlement.curator, address(this), settlement.stake);
            require(ok, "Transfer failed");

            uint256 allocatedTotal;
            for (uint256 j = 0; j < candidateLen; j++) {
                uint256 portion = (settlement.stake * settlement.allocations[j]) / 100;
                candidateStakeTotals[j] += portion;
                allocatedTotal += portion;
            }
            if (allocatedTotal < settlement.stake) {
                candidateStakeTotals[candidateLen - 1] += settlement.stake - allocatedTotal;
            }

            totalStake += settlement.stake;
            nonces[settlement.curator] = settlement.nonce + 1;

            emit SettlementApplied(settlement.curator, settlement.stake);
        }
    }

    function finalize() external returns (address vault) {
        if (block.timestamp < commitmentDeadline) {
            revert CommitmentNotReached();
        }
        if (finalized) {
            revert AlreadyFinalized();
        }
        require(msg.sender == proposer, "Only proposer");
        require(totalStake > 0, "No stake");

        vault = _finalize();
    }

    function _finalize() internal returns (address vault) {
        finalized = true;

        uint256 candidateLen = candidateCompanies.length;
        uint256[] memory weights = new uint256[](candidateLen);
        uint256 sumWeights;
        for (uint256 i = 0; i < candidateLen; i++) {
            uint256 weight = (candidateStakeTotals[i] * 100) / totalStake;
            weights[i] = weight;
            sumWeights += weight;
        }
        if (sumWeights < 100) {
            weights[candidateLen - 1] += 100 - sumWeights;
        }

        factory.createProject(
            projectName,
            candidateCompanies,
            weights,
            minimumRaise,
            deadline,
            withdrawAddress,
            raiseFeeBps,
            profitFeeBps
        );

        uint256 burnAmount = mine.balanceOf(address(this));
        if (burnAmount > 0) {
            IMineBurnable(address(mine)).burn(burnAmount);
        }

        vault = factory.getProjectAt(factory.getProjectCount() - 1);
        emit Finalized(address(factory), vault);
    }
}

interface IMineBurnable {
    function burn(uint256 amount) external;
}
