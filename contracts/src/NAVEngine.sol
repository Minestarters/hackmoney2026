// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {BasketVault} from "./BasketVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title NAVEngine
/// @notice Tracks NAV for multiple mining projects within a basket vault
contract NAVEngine is Ownable {
    error ProjectNotRegistered();
    error CompanyNotRegistered();
    error AlreadyProduction();
    error NotInProduction();
    error ExceedsResource();
    error Unauthorized();
    error InvalidPrice();

    uint256 public constant OZ_PER_TONNE = 32150;
    uint256 public constant BPS = 10000;
    uint256 public constant WAD = 1e18;

    uint16 public constant DEFAULT_K_PERMITS = 3500;
    uint16 public constant DEFAULT_K_CONSTRUCTION = 7000;
    uint16 public constant DEFAULT_K_PRODUCTION = 9000;

    address public factory;

    enum Stage {
        Exploration,
        Permits,
        Construction,
        Production
    }

    struct Company {
        string name;
        uint128 totalResourceTonnes;
        uint128 inventoryTonnes;
        uint128 floorNavTotalUsd;
        uint64 weight;
        uint32 recoveryRateBps;
        uint32 yearsToProduction;
        uint32 remainingMineLife;
        uint32 discountRateBps;
        uint16 kPermits;
        uint16 kConstruction;
        uint16 kProduction;
        Stage currentStage;
        bool registered;
    }

    struct Vault {
        uint64 companyCount;
        bool registered;
    }

    mapping(address => Vault) public vaults;
    mapping(address => mapping(uint256 => Company)) public companies;
    mapping(address => address) public vaultCreators;

    uint256 public goldPriceUsd;
    address public oracle;

    event VaultRegistered(address indexed vault, uint256 tokenSupply);
    event CompanyRegistered(address indexed vault, uint256 indexed companyIndex, string name);
    event CompanyStageAdvanced(address indexed vault, uint256 indexed companyIndex, Stage newStage);
    event CompanyUpdated(address indexed vault, uint256 indexed companyIndex);
    event PriceUpdated(uint256 newPrice);

    constructor(address _oracle, address _owner) Ownable(_owner) {
        oracle = _oracle == address(0) ? msg.sender : _oracle;
    }

    function getCurrentNAV(address vault) external view returns (uint256 navPerToken) {
        Vault memory v = vaults[vault];
        if (!v.registered) revert ProjectNotRegistered();
        uint256 totalSupply = IERC20(BasketVault(vault).shareToken()).totalSupply();
        if (totalSupply == 0) return 0;

        navPerToken = _calculateBasketNAV(vault, v.companyCount) / totalSupply;
    }

    function getCompany(address vault, uint256 companyIndex)
        external
        view
        returns (
            string memory name,
            uint256 weight,
            uint256 resourceTonnes,
            uint256 inventoryTonnes,
            Stage stage,
            uint256 navUsd
        )
    {
        Company memory c = companies[vault][companyIndex];
        if (!c.registered) revert CompanyNotRegistered();
        return (c.name, c.weight, c.totalResourceTonnes, c.inventoryTonnes, c.currentStage, _calculateCompanyNAV(c));
    }

    function setFactory(address _factory) external onlyOwner {
        factory = _factory;
    }

    function _calculateBasketNAV(address vault, uint256 companyCount) internal view returns (uint256 totalNav) {
        for (uint256 i = 0; i < companyCount; i++) {
            Company memory c = companies[vault][i];
            if (c.registered) {
                totalNav += (_calculateCompanyNAV(c) * c.weight) / 100;
            }
        }
    }

    function _calculateCompanyNAV(Company memory c) internal view returns (uint256) {
        if (c.currentStage == Stage.Production) return _productionNAV(c);
        return _preProductionNAV(c);
    }

    function _preProductionNAV(Company memory c) internal view returns (uint256) {
        if (c.currentStage == Stage.Exploration) return c.floorNavTotalUsd;

        uint256 ozInGround = uint256(c.totalResourceTonnes) * OZ_PER_TONNE * c.recoveryRateBps / BPS;
        uint256 grossValue = ozInGround * goldPriceUsd / 1e6;
        uint256 k = _getRiskMultiplier(c);
        uint256 dcf = _calculateDCF(c.yearsToProduction, c.discountRateBps);
        uint256 nav = grossValue * k * dcf / BPS / WAD;

        return nav > c.floorNavTotalUsd ? nav : c.floorNavTotalUsd;
    }

    function _productionNAV(Company memory c) internal view returns (uint256) {
        uint256 inventoryOz = uint256(c.inventoryTonnes) * OZ_PER_TONNE * c.recoveryRateBps / BPS;
        uint256 inventoryValue = inventoryOz * goldPriceUsd / 1e6;

        uint256 remainingTonnes =
            c.totalResourceTonnes > c.inventoryTonnes ? c.totalResourceTonnes - c.inventoryTonnes : 0;
        uint256 remainingOz = remainingTonnes * OZ_PER_TONNE * c.recoveryRateBps / BPS;
        uint256 remainingGross = remainingOz * goldPriceUsd / 1e6;

        uint256 dcf = _calculateDCF(c.remainingMineLife, c.discountRateBps);
        return inventoryValue + (remainingGross * c.kProduction * dcf / BPS / WAD);
    }

    function _calculateDCF(uint256 numYears, uint256 rateBps) internal pure returns (uint256) {
        if (numYears == 0) return WAD;
        uint256 rate = WAD + (rateBps * 1e14);
        return FixedPointMathLib.divWad(WAD, FixedPointMathLib.rpow(rate, numYears, WAD));
    }

    function _getRiskMultiplier(Company memory c) internal pure returns (uint256) {
        if (c.currentStage == Stage.Permits) return c.kPermits;
        if (c.currentStage == Stage.Construction) return c.kConstruction;
        return c.kProduction;
    }

    function registerVault(address vault, uint256 tokenSupply, address creator) external {
        if (msg.sender != factory && msg.sender != owner()) revert Unauthorized();
        vaults[vault] = Vault({companyCount: 0, registered: true});
        vaultCreators[vault] = creator;
        emit VaultRegistered(vault, tokenSupply);
    }

    function registerCompany(
        address vault,
        string calldata name,
        uint256 weight,
        uint256 resourceTonnes,
        uint256 recoveryBps,
        uint256 yearsToProduction,
        uint256 mineLifeYears,
        uint256 discountRateBps,
        uint256 floorNavUsd
    ) external {
        Vault storage v = vaults[vault];
        if (!v.registered) revert ProjectNotRegistered();

        companies[vault][v.companyCount] = Company({
            name: name,
            totalResourceTonnes: uint128(resourceTonnes),
            inventoryTonnes: 0,
            floorNavTotalUsd: uint128(floorNavUsd),
            weight: uint64(weight),
            recoveryRateBps: uint32(recoveryBps),
            yearsToProduction: uint32(yearsToProduction),
            remainingMineLife: uint32(mineLifeYears),
            discountRateBps: uint32(discountRateBps),
            kPermits: DEFAULT_K_PERMITS,
            kConstruction: DEFAULT_K_CONSTRUCTION,
            kProduction: DEFAULT_K_PRODUCTION,
            currentStage: Stage.Exploration,
            registered: true
        });

        v.companyCount++;
        emit CompanyRegistered(vault, v.companyCount - 1, name);
    }

    function advanceCompanyStage(address vault, uint256 companyIndex) external {
        if (vaultCreators[vault] != msg.sender && msg.sender != owner()) revert Unauthorized();
        Company storage c = companies[vault][companyIndex];
        if (!c.registered) revert CompanyNotRegistered();
        if (uint8(c.currentStage) >= 3) revert AlreadyProduction();

        c.currentStage = Stage(uint8(c.currentStage) + 1);
        emit CompanyStageAdvanced(vault, companyIndex, c.currentStage);
    }

    function updateCompany(
        address vault,
        uint256 companyIndex,
        uint64 weight,
        uint32 yearsToProduction,
        uint32 remainingMineLife,
        uint32 discountRateBps,
        uint128 floorNavUsd,
        uint16 kPermits,
        uint16 kConstruction,
        uint16 kProduction
    ) external {
        if (vaultCreators[vault] != msg.sender && msg.sender != owner()) revert Unauthorized();
        Company storage c = companies[vault][companyIndex];
        if (!c.registered) revert CompanyNotRegistered();

        c.weight = weight;
        c.yearsToProduction = yearsToProduction;
        c.remainingMineLife = remainingMineLife;
        c.discountRateBps = discountRateBps;
        c.floorNavTotalUsd = floorNavUsd;
        c.kPermits = kPermits;
        c.kConstruction = kConstruction;
        c.kProduction = kProduction;

        emit CompanyUpdated(vault, companyIndex);
    }

    function updateInventory(address vault, uint256 companyIndex, uint128 tonnes) external {
        if (vaultCreators[vault] != msg.sender && msg.sender != owner()) revert Unauthorized();
        Company storage c = companies[vault][companyIndex];
        if (!c.registered) revert CompanyNotRegistered();
        if (c.currentStage != Stage.Production) revert NotInProduction();
        if (tonnes > c.totalResourceTonnes) revert ExceedsResource();

        c.inventoryTonnes = tonnes;
        emit CompanyUpdated(vault, companyIndex);
    }

    function updateGoldPrice(uint256 newPrice) external {
        // if (msg.sender != oracle && msg.sender != owner()) revert Unauthorized();
        if (newPrice == 0) revert InvalidPrice();
        goldPriceUsd = newPrice;
        emit PriceUpdated(newPrice);
    }

    function setOracle(address _oracle) external onlyOwner {
        oracle = _oracle;
    }
}
