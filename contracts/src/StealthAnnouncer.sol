// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice ERC-5564 announcer. Recipients scan `Announcement` events, filter by
/// view tag (metadata[0]) and recover the stealth key for matches.
contract StealthAnnouncer {
    event Announcement(
        uint256 indexed schemeId,
        address indexed stealthAddress,
        address indexed caller,
        bytes ephemeralPubKey,
        bytes metadata
    );

    function announce(
        uint256 schemeId,
        address stealthAddress,
        bytes calldata ephemeralPubKey,
        bytes calldata metadata
    ) external {
        emit Announcement(schemeId, stealthAddress, msg.sender, ephemeralPubKey, metadata);
    }
}
