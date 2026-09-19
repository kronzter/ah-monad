// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {StealthAnnouncer} from "./StealthAnnouncer.sol";

/// @notice Vault-based private settlement. Funds are deposited once under a pseudonymous
/// vault key. Payments are EIP-712 intents signed by that key and submitted by a relayer,
/// so the payer never appears as tx.from or in the token Transfer log
/// (Transfer is vault -> one-time stealth address).
///
/// Known limits (documented in plan): the intent signature is in calldata, so the
/// vault key is recoverable. It must be a pseudonym, not the company treasury.
contract Settlement is EIP712 {
    using SafeERC20 for IERC20;

    struct Intent {
        address stealthAddr;
        uint256 amount;
        bytes32 invoiceHash;
        bytes ephemeralPubKey;
        bytes1 viewTag;
        uint256 nonce;
        uint256 deadline;
    }

    bytes32 public constant INTENT_TYPEHASH = keccak256(
        "Intent(address stealthAddr,uint256 amount,bytes32 invoiceHash,bytes ephemeralPubKey,bytes1 viewTag,uint256 nonce,uint256 deadline)"
    );

    uint256 public constant SCHEME_ID = 1; // ERC-5564 secp256k1 with view tags

    IERC20 public immutable token;
    StealthAnnouncer public immutable announcer;

    mapping(address vaultKey => uint256) public vault;
    /// unordered nonces so concurrent submissions (decoy burst) never collide
    mapping(address vaultKey => mapping(uint256 nonce => bool)) public nonceUsed;
    mapping(bytes32 invoiceHash => uint256 paidAt) public invoices;

    event Deposited(address indexed vaultKey, uint256 amount);
    event InvoicePaid(bytes32 indexed invoiceHash);

    error Expired();
    error NonceUsed();
    error InvoiceAlreadyPaid();
    error InsufficientVault();

    constructor(IERC20 token_, StealthAnnouncer announcer_) EIP712("Shade Settlement", "1") {
        token = token_;
        announcer = announcer_;
    }

    /// @notice Pull `amount` from `owner` via EIP-2612 permit and credit `vaultKey`.
    /// Used both for the initial funding and for supplier sweeps (owner = stealth address).
    function depositWithPermit(
        address vaultKey,
        address owner,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        // permit may have been front-run; only the allowance matters
        try IERC20Permit(address(token)).permit(owner, address(this), amount, deadline, v, r, s) {} catch {}
        token.safeTransferFrom(owner, address(this), amount);
        vault[vaultKey] += amount;
        emit Deposited(vaultKey, amount);
    }

    function payWithInvoice(Intent calldata i, bytes calldata sig) external {
        if (block.timestamp > i.deadline) revert Expired();
        address signer = ECDSA.recover(_hashIntent(i), sig);
        if (nonceUsed[signer][i.nonce]) revert NonceUsed();
        if (invoices[i.invoiceHash] != 0) revert InvoiceAlreadyPaid();
        if (vault[signer] < i.amount) revert InsufficientVault();

        nonceUsed[signer][i.nonce] = true;
        invoices[i.invoiceHash] = block.timestamp;
        vault[signer] -= i.amount;

        token.safeTransfer(i.stealthAddr, i.amount);
        announcer.announce(SCHEME_ID, i.stealthAddr, i.ephemeralPubKey, abi.encodePacked(i.viewTag));
        emit InvoicePaid(i.invoiceHash);
    }

    function hashIntent(Intent calldata i) external view returns (bytes32) {
        return _hashIntent(i);
    }

    function _hashIntent(Intent calldata i) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    INTENT_TYPEHASH,
                    i.stealthAddr,
                    i.amount,
                    i.invoiceHash,
                    keccak256(i.ephemeralPubKey),
                    i.viewTag,
                    i.nonce,
                    i.deadline
                )
            )
        );
    }
}
