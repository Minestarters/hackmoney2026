// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BasketShareToken, IBasketVault} from "./BasketShareToken.sol";

/// @title BasketVault
/// @notice Manages fundraising, share minting, and profit distribution for a single project.
contract BasketVault is IBasketVault, ReentrancyGuard {
    enum Stage {
        Fundraising,
        Active,
        Failed
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
    uint256 public profitFeeBps;
    uint256 public totalRaised;
    uint256 public accruedRaiseFees;
    uint256 public totalRaiseFeesCollected;
    uint256 public totalProfit;
    uint256 public totalProfitFeesCollected;
    uint256 public profitPerShare;
    bool public finalized;
    uint256 public withdrawnPrincipal;

    IERC20 public immutable usdc;

    mapping(address => uint256) public shareBalances;
    mapping(address => uint256) public claimedProfits;

    mapping(address => uint256) private profitDebt;
    mapping(address => uint256) private pendingProfits;

    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant PROFIT_SCALE = 1e18;

    modifier profitsUnlocked() {
        require(totalRaised >= minimumRaise, "Profit flows unavailable");
        _;
    }

    event Deposited(address indexed user, uint256 amount, uint256 shares);
    event FundsWithdrawn();
    event FundraisingFinalized();
    event Refunded(address indexed user, uint256 amount);
    event ProfitDeposited(uint256 amount);
    event ProfitClaimed(address indexed user, uint256 amount);

    constructor(
        string memory projectName,
        string[] memory _companyNames,
        uint256[] memory _companyWeights,
        address usdcToken,
        address _creator,
        address _withdrawAddress,
        uint256 _minimumRaise,
        uint256 _deadline,
        uint256 _raiseFeeBps,
        uint256 _profitFeeBps
    ) {
        require(_companyNames.length == _companyWeights.length, "Invalid companies");
        require(_companyNames.length > 0, "No companies");
        require(usdcToken != address(0), "USDC required");
        require(_withdrawAddress != address(0), "Withdraw address required");
        require(_deadline > block.timestamp, "Deadline must be future");
        require(_raiseFeeBps <= BPS_DENOMINATOR, "Invalid raise fee");
        require(_profitFeeBps <= BPS_DENOMINATOR, "Invalid profit fee");

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
        profitFeeBps = _profitFeeBps;
        usdc = IERC20(usdcToken);

        string memory tokenName = string.concat(projectName, " Share");
        shareToken = address(new BasketShareToken(tokenName, "MNS", address(this)));
    }

    function deposit(uint256 amount) external nonReentrant {
        require(!_fundraiseFailed(), "Fundraise closed");
        require(amount > 0, "Amount required");

        _updateUser(msg.sender);

        uint256 fee = (amount * raiseFeeBps) / BPS_DENOMINATOR;
        uint256 netAmount = amount - fee;
        require(netAmount > 0, "Net zero");

        totalRaised += amount;
        accruedRaiseFees += fee;
        usdc.transferFrom(msg.sender, address(this), amount);

        BasketShareToken(shareToken).mint(msg.sender, netAmount);

        emit Deposited(msg.sender, amount, netAmount);

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

        usdc.transfer(withdrawAddress, principal);
        if (fees > 0) {
            usdc.transfer(creator, fees);
        }

        emit FundsWithdrawn();
    }

    function refund() external nonReentrant {
        _finalizeIfNeeded();
        require(currentStage() == Stage.Failed, "Refunds unavailable");

        _updateUser(msg.sender);

        uint256 balance = shareBalances[msg.sender];
        require(balance > 0, "No shares to refund");

        uint256 supply = BasketShareToken(shareToken).totalSupply();
        uint256 vaultBalance = usdc.balanceOf(address(this));
        uint256 amount = (vaultBalance * balance) / supply;

        BasketShareToken(shareToken).burn(msg.sender, balance);

        emit Refunded(msg.sender, amount);

        usdc.transfer(msg.sender, amount);
    }

    function depositProfit(uint256 amount) external nonReentrant profitsUnlocked {
        require(amount > 0, "Amount required");
        require(BasketShareToken(shareToken).totalSupply() > 0, "No shares minted");

        usdc.transferFrom(msg.sender, address(this), amount);

        uint256 fee = (amount * profitFeeBps) / BPS_DENOMINATOR;
        uint256 netAmount = amount - fee;
        require(netAmount > 0, "Net zero");

        if (fee > 0) {
            totalProfitFeesCollected += fee;
            usdc.transfer(creator, fee);
        }

        totalProfit += netAmount;
        profitPerShare += (netAmount * PROFIT_SCALE) / BasketShareToken(shareToken).totalSupply();

        emit ProfitDeposited(netAmount);
    }

    function claimProfit() external nonReentrant profitsUnlocked {
        _updateUser(msg.sender);

        uint256 amount = pendingProfits[msg.sender];
        require(amount > 0, "No profit");

        pendingProfits[msg.sender] = 0;
        claimedProfits[msg.sender] += amount;

        emit ProfitClaimed(msg.sender, amount);

        usdc.transfer(msg.sender, amount);
    }

    /// @notice // TODO: replace with indexer.
    function getProjectInfo()
        external
        view
        returns (
            string memory projectName,
            string[] memory companies,
            uint256[] memory weights,
            address shareTokenAddress,
            address projectCreator,
            address projectWithdrawAddress,
            uint256 minRaise,
            uint256 projectDeadline,
            uint256 raiseFee,
            uint256 profitFee,
            uint256 raised,
            uint256 profit,
            uint256 raiseFeesPaid,
            uint256 profitFeesPaid,
            uint256 currentProfitPerShare,
            bool isFinalized,
            Stage stage
        )
    {
        projectName = name;
        companies = companyNames;
        weights = companyWeights;
        shareTokenAddress = shareToken;
        projectCreator = creator;
        projectWithdrawAddress = withdrawAddress;
        minRaise = minimumRaise;
        projectDeadline = deadline;
        raiseFee = raiseFeeBps;
        profitFee = profitFeeBps;
        raised = totalRaised;
        profit = totalProfit;
        raiseFeesPaid = totalRaiseFeesCollected;
        profitFeesPaid = totalProfitFeesCollected;
        currentProfitPerShare = profitPerShare;
        isFinalized = finalized;
        stage = currentStage();
    }

    /// @notice // TODO: replace with indexer.
    function getUserInfo(address user) external view returns (uint256 shares, uint256 totalClaimed) {
        shares = shareBalances[user];
        totalClaimed = claimedProfits[user];
    }

    function pendingProfit(address user) external view returns (uint256) {
        uint256 balance = BasketShareToken(shareToken).balanceOf(user);
        uint256 accrued = (balance * profitPerShare) / PROFIT_SCALE;
        uint256 debt = profitDebt[user];
        uint256 owed = accrued > debt ? accrued - debt : 0;
        return pendingProfits[user] + owed;
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

    function beforeShareTransfer(address user) external override {
        require(msg.sender == shareToken, "Unauthorized");
        _updateUser(user);
    }

    function afterShareTransfer(address user) external override {
        require(msg.sender == shareToken, "Unauthorized");
        shareBalances[user] = BasketShareToken(shareToken).balanceOf(user);
        profitDebt[user] = (shareBalances[user] * profitPerShare) / PROFIT_SCALE;
    }

    function _updateUser(address user) private {
        uint256 balance = shareBalances[user];
        uint256 accrued = (balance * profitPerShare) / PROFIT_SCALE;
        uint256 owed = accrued > profitDebt[user] ? accrued - profitDebt[user] : 0;
        if (owed > 0) {
            pendingProfits[user] += owed;
            profitDebt[user] = accrued;
        } else {
            profitDebt[user] = accrued;
        }
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
