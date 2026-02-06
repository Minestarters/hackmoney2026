// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BasketShareToken} from "./BasketShareToken.sol";

/// @title BasketVault
/// @notice Manages fundraising, share minting, and profit distribution for a single project.
contract BasketVault is ReentrancyGuard {
    enum Stage {
        Fundraising,
        Active,
        Failed
    }

    struct ProjectInfo {
        string projectName;
        string[] companies;
        uint256[] weights;
        address shareTokenAddress;
        address projectCreator;
        address projectWithdrawAddress;
        uint256 minRaise;
        uint256 projectDeadline;
        uint256 raiseFee;
        uint256 raised;
        uint256 raiseFeesPaid;
        bool isFinalized;
        Stage stage;
    }

    string public name;
    string[] public companyNames;
    uint256[] public companyWeights;
    address public shareToken;
    address public creator;
    address public withdrawAddress;
    uint256 public minimumRaise;
    uint256 public deadline;
    uint256 public raiseFeeBps;
    uint256 public totalRaised;
    uint256 public accruedRaiseFees;
    uint256 public totalRaiseFeesCollected;
    bool public finalized;
    uint256 public withdrawnPrincipal;

    IERC20 public immutable USDC;

    uint256 private constant BPS_DENOMINATOR = 10_000;

    event Deposited(address indexed user, uint256 amount, uint256 shares, uint256 sourceChainId);
    event FundsWithdrawn();
    event FundraisingFinalized();
    event Refunded(address indexed user, uint256 amount);

    constructor(
        string memory projectName,
        string[] memory _companyNames,
        uint256[] memory _companyWeights,
        address usdcToken,
        address _creator,
        address _withdrawAddress,
        uint256 _minimumRaise,
        uint256 _deadline,
        uint256 _raiseFeeBps
    ) {
        require(_companyNames.length == _companyWeights.length, "Invalid companies");
        require(_companyNames.length > 0, "No companies");
        require(usdcToken != address(0), "USDC required");
        require(_withdrawAddress != address(0), "Withdraw address required");
        require(_deadline > block.timestamp, "Deadline must be future");
        require(_raiseFeeBps <= BPS_DENOMINATOR, "Invalid raise fee");

        uint256 totalWeight;
        for (uint256 i = 0; i < _companyWeights.length; i++) {
            totalWeight += _companyWeights[i];
        }
        require(totalWeight == 100, "Weights must sum to 100");

        name = projectName;
        companyNames = _companyNames;
        companyWeights = _companyWeights;
        creator = _creator;
        withdrawAddress = _withdrawAddress;
        minimumRaise = _minimumRaise;
        deadline = _deadline;
        raiseFeeBps = _raiseFeeBps;
        USDC = IERC20(usdcToken);

        string memory tokenName = string.concat(projectName, " Share");
        shareToken = address(new BasketShareToken(tokenName, "MNS", address(this)));
    }

    function deposit(uint256 amount, uint256 sourceChainId) external nonReentrant {
        require(!_fundraiseFailed(), "Fundraise closed");
        require(amount > 0, "Amount required");

        uint256 fee = (amount * raiseFeeBps) / BPS_DENOMINATOR;
        uint256 netAmount = amount - fee;
        require(netAmount > 0, "Net zero");

        totalRaised += amount;
        accruedRaiseFees += fee;
        bool success = USDC.transferFrom(msg.sender, address(this), amount);
        require(success, "Transfer failed");

        BasketShareToken(shareToken).mint(msg.sender, netAmount);

        emit Deposited(msg.sender, amount, netAmount, sourceChainId);

        _finalizeIfNeeded();
    }

    function withdrawRaisedFunds() external nonReentrant {
        _finalizeIfNeeded();
        // TODO: DRY
        require(totalRaised >= minimumRaise, "Minimum raise not met");
        (uint256 principal, uint256 fees) = withdrawableFunds();
        require(principal > 0, "Nothing to withdraw");

        accruedRaiseFees = 0;
        totalRaiseFeesCollected += fees;
        withdrawnPrincipal += principal + fees;

        bool success = USDC.transfer(withdrawAddress, principal);
        require(success, "Transfer failed");
        if (fees > 0) {
            success = USDC.transfer(creator, fees);
            require(success, "Fee transfer failed");
        }

        emit FundsWithdrawn();
    }

    function refund() external nonReentrant {
        _finalizeIfNeeded();
        require(currentStage() == Stage.Failed, "Refunds unavailable");

        uint256 balance = BasketShareToken(shareToken).balanceOf(msg.sender);
        require(balance > 0, "No shares to refund");

        uint256 supply = BasketShareToken(shareToken).totalSupply();
        uint256 vaultBalance = USDC.balanceOf(address(this));
        uint256 amount = (vaultBalance * balance) / supply;

        BasketShareToken(shareToken).burn(msg.sender, balance);

        emit Refunded(msg.sender, amount);

        bool success = USDC.transfer(msg.sender, amount);
        require(success, "Transfer failed");
    }

    /// @notice // TODO: replace with indexer.
    function getProjectInfo() external view returns (ProjectInfo memory info) {
        info.projectName = name;
        info.companies = companyNames;
        info.weights = companyWeights;
        info.shareTokenAddress = shareToken;
        info.projectCreator = creator;
        info.projectWithdrawAddress = withdrawAddress;
        info.minRaise = minimumRaise;
        info.projectDeadline = deadline;
        info.raiseFee = raiseFeeBps;
        info.raised = totalRaised;
        info.raiseFeesPaid = totalRaiseFeesCollected;
        info.isFinalized = finalized;
        info.stage = currentStage();
    }

    function currentStage() public view returns (Stage) {
        // TODO: store
        return _fundraiseFailed() ? Stage.Failed : Stage.Active;
    }

    function withdrawableFunds() public view returns (uint256 principal, uint256 fees) {
        if (totalRaised < minimumRaise) {
            return (0, accruedRaiseFees);
        }

        // TODO: DRY
        if (totalRaised <= withdrawnPrincipal) {
            return (0, accruedRaiseFees);
        }

        uint256 available = totalRaised - withdrawnPrincipal;

        fees = available <= accruedRaiseFees ? available : accruedRaiseFees;

        if (available <= fees) {
            return (0, fees);
        }

        principal = available - fees;
    }

    function _finalizeIfNeeded() private {
        if (!finalized && block.timestamp >= deadline) {
            finalized = true;
            emit FundraisingFinalized();
        }
    }

    function _fundraiseFailed() private view returns (bool) {
        return block.timestamp >= deadline && totalRaised < minimumRaise;
    }
}
