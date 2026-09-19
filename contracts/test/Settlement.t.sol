// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {MockPermitToken} from "../src/MockPermitToken.sol";
import {StealthAnnouncer} from "../src/StealthAnnouncer.sol";
import {Settlement} from "../src/Settlement.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SettlementTest is Test {
    MockPermitToken token;
    StealthAnnouncer announcer;
    Settlement settlement;

    uint256 vaultPk = 0xA11CE;
    address vaultKey;
    address relayer = address(0xBEEF);
    address stealth = address(0x5717);

    event Announcement(
        uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata
    );

    function setUp() public {
        token = new MockPermitToken();
        announcer = new StealthAnnouncer();
        settlement = new Settlement(IERC20(address(token)), announcer);
        vaultKey = vm.addr(vaultPk);
        token.mint(address(settlement), 0); // touch
        _deposit(1_000e18);
    }

    function _deposit(uint256 amt) internal {
        uint256 ownerPk = 0xB0B;
        address owner = vm.addr(ownerPk);
        token.mint(owner, amt);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner,
                address(settlement),
                amt,
                token.nonces(owner),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, digest);
        vm.prank(relayer);
        settlement.depositWithPermit(vaultKey, owner, amt, deadline, v, r, s);
    }

    function _intent(uint256 amount, bytes32 invoice, uint256 nonce, uint256 deadline)
        internal
        view
        returns (Settlement.Intent memory)
    {
        return Settlement.Intent({
            stealthAddr: stealth,
            amount: amount,
            invoiceHash: invoice,
            ephemeralPubKey: hex"02aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
            viewTag: 0xab,
            nonce: nonce,
            deadline: deadline
        });
    }

    function _sign(Settlement.Intent memory i, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                settlement.INTENT_TYPEHASH(),
                i.stealthAddr,
                i.amount,
                i.invoiceHash,
                keccak256(i.ephemeralPubKey),
                i.viewTag,
                i.nonce,
                i.deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _domainSeparator() internal view returns (bytes32) {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = settlement.eip712Domain();
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                verifying
            )
        );
    }

    function test_pay_movesFundsAnnouncesAndRecordsInvoice() public {
        Settlement.Intent memory i = _intent(200e18, keccak256("inv-1"), 1, block.timestamp + 1 hours);
        bytes memory sig = _sign(i, vaultPk);

        vm.expectEmit(true, true, true, true, address(announcer));
        emit Announcement(1, stealth, address(settlement), i.ephemeralPubKey, abi.encodePacked(bytes1(0xab)));

        vm.prank(relayer);
        settlement.payWithInvoice(i, sig);

        assertEq(token.balanceOf(stealth), 200e18);
        assertEq(settlement.vault(vaultKey), 800e18);
        assertGt(settlement.invoices(keccak256("inv-1")), 0);
    }

    function test_revert_replayedNonce() public {
        Settlement.Intent memory i = _intent(1e18, keccak256("a"), 7, block.timestamp + 1 hours);
        settlement.payWithInvoice(i, _sign(i, vaultPk));
        Settlement.Intent memory j = _intent(1e18, keccak256("b"), 7, block.timestamp + 1 hours);
        bytes memory sig = _sign(j, vaultPk);
        vm.expectRevert(Settlement.NonceUsed.selector);
        settlement.payWithInvoice(j, sig);
    }

    function test_revert_expired() public {
        Settlement.Intent memory i = _intent(1e18, keccak256("a"), 1, block.timestamp + 10);
        bytes memory sig = _sign(i, vaultPk);
        vm.warp(block.timestamp + 11);
        vm.expectRevert(Settlement.Expired.selector);
        settlement.payWithInvoice(i, sig);
    }

    function test_revert_signerWithoutVaultBalance() public {
        Settlement.Intent memory i = _intent(1e18, keccak256("a"), 1, block.timestamp + 1 hours);
        bytes memory sig = _sign(i, 0xDEAD); // unknown key, empty vault
        vm.expectRevert(Settlement.InsufficientVault.selector);
        settlement.payWithInvoice(i, sig);
    }

    function test_revert_overspend() public {
        Settlement.Intent memory i = _intent(1_001e18, keccak256("a"), 1, block.timestamp + 1 hours);
        bytes memory sig = _sign(i, vaultPk);
        vm.expectRevert(Settlement.InsufficientVault.selector);
        settlement.payWithInvoice(i, sig);
    }

    function test_revert_invoiceAlreadyPaid() public {
        Settlement.Intent memory i = _intent(1e18, keccak256("dup"), 1, block.timestamp + 1 hours);
        settlement.payWithInvoice(i, _sign(i, vaultPk));
        Settlement.Intent memory j = _intent(1e18, keccak256("dup"), 2, block.timestamp + 1 hours);
        bytes memory sig = _sign(j, vaultPk);
        vm.expectRevert(Settlement.InvoiceAlreadyPaid.selector);
        settlement.payWithInvoice(j, sig);
    }

    function test_payerNotInTransferLog() public {
        Settlement.Intent memory i = _intent(5e18, keccak256("x"), 1, block.timestamp + 1 hours);
        bytes memory sig = _sign(i, vaultPk);
        vm.recordLogs();
        vm.prank(relayer);
        settlement.payWithInvoice(i, sig);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 transferSig = keccak256("Transfer(address,address,uint256)");
        for (uint256 k; k < logs.length; k++) {
            if (logs[k].topics[0] == transferSig) {
                assertEq(address(uint160(uint256(logs[k].topics[1]))), address(settlement));
                assertEq(address(uint160(uint256(logs[k].topics[2]))), stealth);
            }
        }
    }

    function test_sweepAsDeposit_fromStealthOwner() public {
        // supplier sweeps stealth balance back into a supplier vault key via permit signed by stealth key
        uint256 stealthPk = 0x57EA17;
        address stealthOwner = vm.addr(stealthPk);
        token.mint(stealthOwner, 50e18);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                stealthOwner,
                address(settlement),
                50e18,
                token.nonces(stealthOwner),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(stealthPk, digest);
        address supplierVaultKey = address(0x5011);
        vm.prank(relayer);
        settlement.depositWithPermit(supplierVaultKey, stealthOwner, 50e18, deadline, v, r, s);
        assertEq(settlement.vault(supplierVaultKey), 50e18);
        assertEq(token.balanceOf(stealthOwner), 0);
    }
}
