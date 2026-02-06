// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MinestartersDistributor
/// @notice Distributes profit payouts on destination chains.
contract MinestartersDistributor {
    event Payout(address indexed recipient, uint256 amount);

    /// @notice Distributes tokens to multiple recipients.
    /// @dev Requires the caller to have approved this contract to spend the total amount.
    /// @param token Address of the token to distribute.
    /// @param recipients Array of recipient addresses.
    /// @param amounts Array of amounts to send to each recipient.
    function batchPayout(address token, address[] calldata recipients, uint256[] calldata amounts) external {
        require(token != address(0), "Invalid token");
        require(recipients.length == amounts.length, "Length mismatch");

        for (uint256 i = 0; i < recipients.length; i++) {
            address recipient = recipients[i];
            uint256 amount = amounts[i];
            
            require(recipient != address(0), "Invalid recipient");
            
            if (amount > 0) {
                // Transfer token from caller to recipient
                bool success = IERC20(token).transferFrom(msg.sender, recipient, amount);
                require(success, "Transfer failed");
                emit Payout(recipient, amount);
            }
        }
    }
}
