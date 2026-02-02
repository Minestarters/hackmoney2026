//// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";

enum Stage {
    Exploration,
    Permits,
    Construction,
    Production
}

struct Project {
    uint256 kPermits;
    uint256 kConstruction;
    uint256 kProduction;
    Stage currentStage;
}

contract NAVEngine {
    uint256 constant WAD = 1e18;

    uint256 public constant DEFAULT_K_PERMITS = 3500; // 35% (mid-range 0.25-0.40)
    uint256 public constant DEFAULT_K_CONSTRUCTION = 7000; // 70% (mid-range 0.60-0.80)
    uint256 public constant DEFAULT_K_PRODUCTION = 9000; // 90% (mid-range 0.85-0.95)

    function _calculateDCF(uint256 numYears, uint256 rateBps) internal pure returns (uint256 dcf) {
        if (numYears == 0) return WAD;
        // rate = 1 + (rateBps / 10000)
        uint256 rate = WAD + (rateBps * 1e14);

        // (1 + r)^t using rpow
        uint256 denominator = FixedPointMathLib.rpow(rate, numYears, WAD);

        // dcf = 1 / (1 + r)^t
        return FixedPointMathLib.divWad(WAD, denominator);
    }

    function getCurrentNAV() external view returns (uint256) {}

    /// @notice Production: mined inventory (spot) + remaining (discounted)
    function _productionNAV(Project memory p) internal view returns (uint256) {}
}
