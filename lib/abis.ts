import { parseAbi } from "viem";

export const settlementAbi = parseAbi([
  "struct Intent { address stealthAddr; uint256 amount; bytes32 invoiceHash; bytes ephemeralPubKey; bytes1 viewTag; uint256 nonce; uint256 deadline; }",
  "function depositWithPermit(address vaultKey, address owner, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function payWithInvoice(Intent i, bytes sig)",
  "function vault(address) view returns (uint256)",
  "function invoices(bytes32) view returns (uint256)",
  "event Deposited(address indexed vaultKey, uint256 amount)",
  "event InvoicePaid(bytes32 indexed invoiceHash)",
]);

export const announcerAbi = parseAbi([
  "event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)",
]);

export const tokenAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function balanceOf(address) view returns (uint256)",
  "function nonces(address) view returns (uint256)",
  "function name() view returns (string)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);
