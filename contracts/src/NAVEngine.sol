// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";

/// @title NAVEngine
contract NAVEngine is Ownable {
    // ============ Errors ============

    error ProjectNotRegistered();
    error AlreadyProduction();
    error NotInProduction();
    error CannotDecreaseMined();
    error ExceedsResource();
    error Unauthorized();
    error InvalidPrice();

    uint256 public constant OZ_PER_TONNE = 32150;

    /// @notice basis points denominator
    uint256 public constant BPS = 10000;

    /// @notice fixed point precision (18 decimals)
    uint256 public constant WAD = 1e18;

    uint256 public constant DEFAULT_K_PERMITS = 3500; // 35% (mid-range 0.25-0.40)
    uint256 public constant DEFAULT_K_CONSTRUCTION = 7000; // 70% (mid-range 0.60-0.80)
    uint256 public constant DEFAULT_K_PRODUCTION = 9000; // 90% (mid-range 0.85-0.95)

    enum Stage {
        Exploration,
        Permits,
        Construction,
        Production
    }

    struct Project {
        uint256 totalResourceTonnes;
        uint256 minedTonnes;
        uint256 recoveryRateBps;
        uint256 totalTokenSupply;
        uint256 floorNavPerToken;
        uint256 yearsToProduction;
        uint256 mineLifeYears;
        uint256 discountRateBps;
        uint256 kPermits;
        uint256 kConstruction;
        uint256 kProduction;
        Stage currentStage;
    }

    /// @notice project data by vault address
    mapping(address => Project) public projects;

    /// @notice gold spot price in USD (6 decimals)
    uint256 public goldPriceUsd;

    /// @notice authorized price updater
    address public oracle;

    event ProjectRegistered(address indexed vault, uint256 resourceTonnes);
    event StageAdvanced(address indexed vault, Stage newStage);
    event PriceUpdated(uint256 newPrice);
    event MinedTonnesUpdated(address indexed vault, uint256 tonnes);
    event ProjectParametersUpdated(address indexed vault);

    // ============ Constructor ============

    constructor(uint256 _initialGoldPrice, address _oracle) Ownable(msg.sender) {
        goldPriceUsd = _initialGoldPrice;
        if (address(_oracle) == address(0)) oracle = msg.sender;
        else oracle = _oracle;
    }


    /// @notice get current NAV per token for a vault
    /// @param vault The vault address
    /// @return navPerToken NAV in USD (6 decimals)
    function getCurrentNAV(address vault) external view returns (uint256 navPerToken) {
        Project memory p = projects[vault];
        if (p.totalTokenSupply == 0) revert ProjectNotRegistered();

        uint256 totalNav = _calculateTotalNAV(p);
        navPerToken = (totalNav * 1e6) / p.totalTokenSupply;

        if (navPerToken < p.floorNavPerToken) {
            navPerToken = p.floorNavPerToken;
        }
    }

    function getProject(address vault)
        external
        view
        returns (
            uint256 resourceTonnes,
            uint256 minedTonnes,
            uint256 recoveryBps,
            uint256 tokenSupply,
            Stage stage,
            uint256 yearsToProduction,
            uint256 discountRate
        )
    {
        Project memory p = projects[vault];
        return (
            p.totalResourceTonnes,
            p.minedTonnes,
            p.recoveryRateBps,
            p.totalTokenSupply,
            p.currentStage,
            p.yearsToProduction,
            p.discountRateBps
        );
    }

    function _calculateTotalNAV(Project memory p) internal view returns (uint256) {
        if (p.currentStage == Stage.Production) {
            return _productionNAV(p);
        }
        return _preProductionNAV(p);
    }

    /// @notice pre-production: V_ground × k_stage × dcf(t_prod)
    function _preProductionNAV(Project memory p) internal view returns (uint256) {
        if (p.currentStage == Stage.Exploration) {
            // no verified resource, return floor
            return p.floorNavPerToken * p.totalTokenSupply / 1e6;
        }

        // V_ground = total resource × oz/tonne × recovery × gold price
        uint256 ozInGround = p.totalResourceTonnes * OZ_PER_TONNE * p.recoveryRateBps / BPS;
        uint256 grossValue = ozInGround * goldPriceUsd / 1e6;

        // get risk multiplier for current stage
        uint256 k = _getRiskMultiplier(p);

        // calculate dcf(t_prod) = 1 / (1 + r)^t
        uint256 dcf = _calculateDCF(p.yearsToProduction, p.discountRateBps);

        // NAV = V_ground × k × dcf (multiply all first, then divide)
        return grossValue * k * dcf / BPS / WAD;
    }

    /// @notice production: mined inventory (spot) + remaining (discounted)
    function _productionNAV(Project memory p) internal view returns (uint256) {
        // mined inventory at spot (no discount)
        uint256 minedOz = p.minedTonnes * OZ_PER_TONNE * p.recoveryRateBps / BPS;
        uint256 inventoryValue = minedOz * goldPriceUsd / 1e6;

        // remaining in-ground (discounted)
        uint256 remainingTonnes = p.totalResourceTonnes - p.minedTonnes;
        uint256 remainingOz = remainingTonnes * OZ_PER_TONNE * p.recoveryRateBps / BPS;
        uint256 remainingGross = remainingOz * goldPriceUsd / 1e6;

        // apply k_production and dcf(t_life)
        uint256 dcf = _calculateDCF(p.mineLifeYears, p.discountRateBps);
        uint256 remainingDiscounted = remainingGross * p.kProduction * dcf / BPS / WAD;

        // total NAV
        return inventoryValue + remainingDiscounted;
    }

    /// @notice calculate dcf(t) = 1 / (1 + r)^t using Solady
    /// @param numYears Number of years (t)
    /// @param rateBps Annual discount rate in bps
    /// @return dcf Discount factor in WAD
    function _calculateDCF(uint256 numYears, uint256 rateBps) internal pure returns (uint256 dcf) {
        if (numYears == 0) return WAD;

        uint256 rate = WAD + (rateBps * 1e14);

        // (1 + r)^t using rpow
        uint256 denominator = FixedPointMathLib.rpow(rate, numYears, WAD);

        // DCF = 1 / (1 + r)^t
        return FixedPointMathLib.divWad(WAD, denominator);
    }

    function _getRiskMultiplier(Project memory p) internal pure returns (uint256) {
        if (p.currentStage == Stage.Permits) return p.kPermits;
        if (p.currentStage == Stage.Construction) return p.kConstruction;
        return p.kProduction;
    }

    /// @notice register a new project with full parameters
    function registerProject(
        address vault,
        uint256 resourceTonnes,
        uint256 recoveryBps,
        uint256 tokenSupply,
        uint256 floorNav,
        uint256 yearsToProduction,
        uint256 mineLifeYears,
        uint256 discountRateBps
    ) external onlyOwner {
        projects[vault] = Project({
            totalResourceTonnes: resourceTonnes,
            minedTonnes: 0,
            recoveryRateBps: recoveryBps,
            totalTokenSupply: tokenSupply,
            floorNavPerToken: floorNav,
            yearsToProduction: yearsToProduction,
            mineLifeYears: mineLifeYears,
            discountRateBps: discountRateBps,
            kPermits: DEFAULT_K_PERMITS,
            kConstruction: DEFAULT_K_CONSTRUCTION,
            kProduction: DEFAULT_K_PRODUCTION,
            currentStage: Stage.Exploration
        });

        emit ProjectRegistered(vault, resourceTonnes);
    }

    function updateProjectParameters(
        address vault,
        uint256 yearsToProduction,
        uint256 mineLifeYears,
        uint256 discountRateBps,
        uint256 kPermits,
        uint256 kConstruction,
        uint256 kProduction
    ) external onlyOwner {
        Project storage p = projects[vault];
        if (p.totalTokenSupply == 0) revert ProjectNotRegistered();

        p.yearsToProduction = yearsToProduction;
        p.mineLifeYears = mineLifeYears;
        p.discountRateBps = discountRateBps;
        p.kPermits = kPermits;
        p.kConstruction = kConstruction;
        p.kProduction = kProduction;

        emit ProjectParametersUpdated(vault);
    }

    /// @notice advance to next stage
    function advanceStage(address vault) external onlyOwner {
        Project storage p = projects[vault];
        if (p.totalTokenSupply == 0) revert ProjectNotRegistered();
        if (uint8(p.currentStage) >= 3) revert AlreadyProduction();

        p.currentStage = Stage(uint8(p.currentStage) + 1);

        // update yearsToProduction as stages advance
        if (p.currentStage != Stage.Production && p.yearsToProduction > 0) {
            // reduce time estimate as project progresses
            p.yearsToProduction = p.yearsToProduction > 2 ? p.yearsToProduction - 2 : 0;
        }

        emit StageAdvanced(vault, p.currentStage);
    }

    /// @notice update mined tonnes
    function updateMinedTonnes(address vault, uint256 tonnes) external onlyOwner {
        Project storage p = projects[vault];
        if (p.currentStage != Stage.Production) revert NotInProduction();
        if (tonnes < p.minedTonnes) revert CannotDecreaseMined();
        if (tonnes > p.totalResourceTonnes) revert ExceedsResource();

        p.minedTonnes = tonnes;
        emit MinedTonnesUpdated(vault, tonnes);
    }

    /// @notice update gold price
    function updateGoldPrice(uint256 newPrice) external {
        if (msg.sender != oracle && msg.sender != owner()) revert Unauthorized();
        if (newPrice == 0) revert InvalidPrice();
        goldPriceUsd = newPrice;
        emit PriceUpdated(newPrice);
    }

    /// @notice set oracle address
    function setOracle(address _oracle) external onlyOwner {
        oracle = _oracle;
    }
}
