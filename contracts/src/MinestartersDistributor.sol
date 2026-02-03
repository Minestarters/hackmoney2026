// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MinestartersDistributor
/// @notice Distributes profit payouts on destination chains.
contract MinestartersDistributor is Ownable {
    IERC20 public immutable usdc;

    event Payout(address indexed recipient, uint256 amount);

    constructor(address usdcToken, address initialOwner) Ownable(initialOwner) {
        require(usdcToken != address(0), "USDC required");
        usdc = IERC20(usdcToken);
    }

    /// @notice Distributes USDC to multiple recipients.
    /// @dev Requires the sender (owner) to have approved this contract to spend the total amount if using transferFrom.
    /// @param recipients Array of recipient addresses.
    /// @param amounts Array of amounts to send to each recipient.
    function batchPayout(address[] calldata recipients, uint256[] calldata amounts) external onlyOwner {
        require(recipients.length == amounts.length, "Length mismatch");

        for (uint256 i = 0; i < recipients.length; i++) {
            address recipient = recipients[i];
            uint256 amount = amounts[i];
            
            require(recipient != address(0), "Invalid recipient");
            
            if (amount > 0) {
                // Transfer USDC from owner to recipient
                bool success = usdc.transferFrom(msg.sender, recipient, amount);
                require(success, "Transfer failed");
                emit Payout(recipient, amount);
            }
        }
    }
}
