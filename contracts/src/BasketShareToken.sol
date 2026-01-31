// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IBasketVault {
    function beforeShareTransfer(address user) external;

    function afterShareTransfer(address user) external;
}

/// @title BasketShareToken
/// @notice Transferable ERC20 representing basket shares, with callbacks to the vault for profit accounting.
contract BasketShareToken is ERC20 {
    address public immutable vault;

    modifier onlyVault() {
        require(msg.sender == vault, "Only vault");
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        address vault_
    ) ERC20(name_, symbol_) {
        require(vault_ != address(0), "Vault address required");
        vault = vault_;
    }

    function decimals() public pure override returns (uint8) {
        // Match USDC-style decimals for intuitive share math.
        return 6;
    }

    function mint(address to, uint256 amount) external onlyVault {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyVault {
        _burn(from, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0)) {
            IBasketVault(vault).beforeShareTransfer(from);
        }
        if (to != address(0)) {
            IBasketVault(vault).beforeShareTransfer(to);
        }

        super._update(from, to, value);

        if (from != address(0)) {
            IBasketVault(vault).afterShareTransfer(from);
        }
        if (to != address(0)) {
            IBasketVault(vault).afterShareTransfer(to);
        }
    }
}
