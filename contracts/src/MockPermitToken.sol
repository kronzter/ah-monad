// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @notice Testnet-only stablecoin stand-in. Open mint, EIP-2612 permit.
contract MockPermitToken is ERC20, ERC20Permit {
    constructor() ERC20("Shade USD", "sUSD") ERC20Permit("Shade USD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
