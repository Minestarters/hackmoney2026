//// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test, console} from "forge-std/Test.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";

contract NAVEngine is Test {
    function _calculateDCF(uint256 numYears, uint256 rateBps) internal pure returns (uint256 dcf) {
        uint256 rate = 1e18 + (rateBps * 1e14);

        uint256 denominator = FixedPointMathLib.rpow(rate, numYears, 1e18);
        // DCF = 1 / (1 + r)^t
        return FixedPointMathLib.divWad(1e18, denominator);
    }

    function test_dcf() external {
        uint256 x = _calculateDCF(4, 2500);
        console.log(x);
    }
}
