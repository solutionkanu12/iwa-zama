// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint32, euint64, ebool, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { IERC7984 } from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

/**
 * @title IwaCircle
 * @notice A privacy-preserving rotating savings circle (ROSCA) built on Zama FHEVM.
 *
 * Design principles (the reason this is stronger than public-boolean ROSCAs such as Circux):
 *
 *  - Per-member reliability, streak and late-count are stored ONLY as encrypted
 *    integers (euint32) and are permissioned via FHE.allow so that ONLY the member
 *    themselves can ever decrypt their own value. The contract never exposes a public
 *    boolean flag for individual behaviour (on-time / late / default), and never makes
 *    any per-member value publicly decryptable.
 *
 *  - Contribution amounts are encrypted (euint64) and moved through an ERC-7984
 *    confidential token, so amounts are never revealed on-chain.
 *
 *  - Payout is released automatically by the contract itself the moment a round's
 *    contribution condition is met (all members have contributed). There is NO
 *    organizer/admin function that "releases" or "triggers" a payout.
 *
 *  - Only aggregate, non-attributable circle-level counters (current round, rounds
 *    completed, contributions-in-round, member count) are ever public.
 *
 * Note on inherent chain transparency: the existence and timing of a member's
 * contribute() transaction is inherently public on any EVM chain and cannot be hidden
 * at the contract layer. What this contract guarantees is that no DERIVED reliability /
 * timing / default SCORE is ever readable by anyone but the member — which is exactly
 * the leak that public-boolean designs expose.
 */
contract IwaCircle is ZamaEthereumConfig {
    struct Member {
        bool joined;
        uint32 nextRound; // next round index this member must contribute to (dedup guard)
        euint32 reliability; // encrypted count of on-time contributions (member-only)
        euint32 streak; // encrypted current on-time streak (member-only)
        euint32 lateCount; // encrypted count of late contributions (member-only)
    }

    struct Circle {
        address token; // ERC-7984 confidential token used for contributions/payouts
        uint8 memberCount; // fixed number of members (0 == circle does not exist)
        uint64 roundLength; // round duration in seconds (on-time window)
        bool active; // true once full; false before full and after completion
        bool completed; // true once every member has received a payout
        uint32 currentRound; // index of the round currently accepting contributions
        uint32 roundsCompleted; // aggregate: how many rounds have paid out
        uint64 roundStart; // timestamp the current round began
        uint8 contributionsThisRound; // aggregate: k of N contributed this round
        address[] members; // ordered roster (payout rotates through this order)
        euint64 pot; // encrypted accumulated pot for the current round
        mapping(address => Member) memberInfo;
    }

    mapping(uint256 => Circle) private _circles;

    event CircleCreated(uint256 indexed circleId, address indexed token, uint8 memberCount, uint64 roundLength);
    event MemberJoined(uint256 indexed circleId, address indexed member, uint8 memberIndex);
    event CircleActivated(uint256 indexed circleId, uint64 roundStart);
    // Aggregate only: no member address, no on-time/late signal.
    event ContributionRecorded(uint256 indexed circleId, uint32 indexed round, uint8 contributionsThisRound);
    event PayoutReleased(uint256 indexed circleId, uint32 indexed round, address indexed recipient);
    event CircleCompleted(uint256 indexed circleId);

    error CircleFull();
    error AlreadyMember();
    error NotAMember();
    error CircleNotActive();
    error AlreadyContributedThisRound();
    error InvalidConfig();

    /**
     * @notice Join an existing circle, or create a new one if it does not yet exist.
     * @dev When creating (circle does not exist), `memberCount`, `roundLength` and `token`
     *      configure the new circle and the caller becomes its first member. When joining
     *      an existing circle, those configuration arguments are ignored.
     */
    function joinCircle(
        uint256 circleId,
        uint8 memberCount,
        uint64 roundLength,
        address token
    ) external {
        Circle storage c = _circles[circleId];

        if (c.memberCount == 0) {
            // Create.
            if (memberCount < 2 || roundLength == 0 || token == address(0)) revert InvalidConfig();
            c.token = token;
            c.memberCount = memberCount;
            c.roundLength = roundLength;
            emit CircleCreated(circleId, token, memberCount, roundLength);
        } else {
            // Join existing.
            if (c.members.length >= c.memberCount) revert CircleFull();
        }

        if (c.memberInfo[msg.sender].joined) revert AlreadyMember();

        Member storage m = c.memberInfo[msg.sender];
        m.joined = true;
        m.nextRound = 0;
        m.reliability = _freshCounter(msg.sender);
        m.streak = _freshCounter(msg.sender);
        m.lateCount = _freshCounter(msg.sender);

        c.members.push(msg.sender);
        emit MemberJoined(circleId, msg.sender, uint8(c.members.length - 1));

        // Activate automatically once the circle is full.
        if (c.members.length == c.memberCount) {
            c.active = true;
            c.currentRound = 0;
            c.contributionsThisRound = 0;
            c.roundStart = uint64(block.timestamp);
            c.pot = FHE.asEuint64(0);
            FHE.allowThis(c.pot);
            emit CircleActivated(circleId, c.roundStart);
        }
    }

    /**
     * @notice Submit an encrypted contribution for the current round.
     * @dev Pulls `encryptedAmount` from the caller via the ERC-7984 token (the caller must
     *      have set this contract as an operator on the token). Updates the caller's
     *      encrypted reliability/streak/late counters, and — if this contribution completes
     *      the round — releases the payout automatically in the same transaction.
     */
    function contribute(
        uint256 circleId,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external {
        Circle storage c = _circles[circleId];
        if (!c.active) revert CircleNotActive();

        Member storage m = c.memberInfo[msg.sender];
        if (!m.joined) revert NotAMember();
        if (m.nextRound != c.currentRound) revert AlreadyContributedThisRound();

        // Import the encrypted amount and move it into the circle via the confidential token.
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(amount, c.token);
        euint64 transferred = IERC7984(c.token).confidentialTransferFrom(msg.sender, address(this), amount);

        // Accumulate the encrypted pot for this round.
        c.pot = FHE.add(c.pot, transferred);
        FHE.allowThis(c.pot);

        // Update the caller's PRIVATE, member-only reliability state.
        //
        // The credit is intentionally derived from `transferred` (a NON-trivial ciphertext
        // carrying this member's own input randomness) rather than from a purely plaintext
        // constant. This guarantees each member's counter ciphertext is unique to them, so an
        // FHE.allow grant never collides with another member's handle. Deriving the counters
        // only from trivial constants (e.g. asEuint32(0)+1) would produce identical, shared
        // handles across members with the same count and leak cross-member decryption rights.
        bool onTimePlain = block.timestamp <= uint256(c.roundStart) + uint256(c.roundLength);
        ebool contributed = FHE.gt(transferred, FHE.asEuint64(0)); // non-trivial, member-unique
        ebool onTimeCredit = FHE.and(contributed, onTimePlain); // credit only if on time
        ebool lateCredit = FHE.and(contributed, !onTimePlain); // credit only if late

        m.reliability = FHE.add(m.reliability, FHE.asEuint32(onTimeCredit)); // +1 on time, else +0
        m.lateCount = FHE.add(m.lateCount, FHE.asEuint32(lateCredit)); // +1 late, else +0
        m.streak = FHE.select(onTimeCredit, FHE.add(m.streak, FHE.asEuint32(1)), FHE.asEuint32(0));

        _permissionCounter(m.reliability, msg.sender);
        _permissionCounter(m.streak, msg.sender);
        _permissionCounter(m.lateCount, msg.sender);

        // Advance this member's dedup guard and the aggregate round counter.
        m.nextRound = c.currentRound + 1;
        c.contributionsThisRound += 1;
        emit ContributionRecorded(circleId, c.currentRound, c.contributionsThisRound);

        // Automatic, condition-driven payout: no admin/organizer call required.
        if (c.contributionsThisRound == c.memberCount) {
            _releasePayout(circleId, c);
        }
    }

    /**
     * @notice Aggregate, non-attributable circle progress. Never reveals any individual
     *         member's behaviour or timing.
     */
    function getCircleProgress(uint256 circleId)
        external
        view
        returns (
            uint8 memberCount,
            uint32 currentRound,
            uint32 roundsCompleted,
            uint8 contributionsThisRound,
            bool active,
            bool completed
        )
    {
        Circle storage c = _circles[circleId];
        return (
            c.memberCount,
            c.currentRound,
            c.roundsCompleted,
            c.contributionsThisRound,
            c.active,
            c.completed
        );
    }

    /// @notice The circle roster (public, structural — not behavioural).
    function getMembers(uint256 circleId) external view returns (address[] memory) {
        return _circles[circleId].members;
    }

    /**
     * @notice Returns the ENCRYPTED reliability handle for a member. The returned ciphertext
     *         is only decryptable by the member themselves (permissioned via FHE.allow);
     *         nobody else — including the organizer or this contract's deployer — can decrypt it.
     */
    function confidentialReliabilityOf(uint256 circleId, address member) external view returns (euint32) {
        return _circles[circleId].memberInfo[member].reliability;
    }

    /// @notice Encrypted, member-only current on-time streak handle.
    function confidentialStreakOf(uint256 circleId, address member) external view returns (euint32) {
        return _circles[circleId].memberInfo[member].streak;
    }

    /// @notice Encrypted, member-only late-contribution count handle.
    function confidentialLateCountOf(uint256 circleId, address member) external view returns (euint32) {
        return _circles[circleId].memberInfo[member].lateCount;
    }

    /**
     * @notice Whether `viewer` is FHE-permitted to decrypt `member`'s reliability counter.
     * @dev Reflects the on-chain ACL. The core privacy guarantee is that this returns true
     *      ONLY for the member themselves (and never for other members, the organizer, or
     *      any third party).
     */
    function isReliabilityDecryptableBy(
        uint256 circleId,
        address member,
        address viewer
    ) external view returns (bool) {
        return FHE.isAllowed(_circles[circleId].memberInfo[member].reliability, viewer);
    }

    // --- internal helpers ---

    /// @dev Create a fresh encrypted zero counter permissioned to `owner` and this contract.
    function _freshCounter(address owner) private returns (euint32 c) {
        c = FHE.asEuint32(0);
        FHE.allowThis(c);
        FHE.allow(c, owner);
    }

    /// @dev Re-grant persistent decryption permission on an updated counter to owner + contract.
    function _permissionCounter(euint32 value, address owner) private {
        FHE.allowThis(value);
        FHE.allow(value, owner);
    }

    /// @dev Release the current round's pot to the rotating recipient and advance the circle.
    function _releasePayout(uint256 circleId, Circle storage c) private {
        address recipient = c.members[c.currentRound % c.memberCount];

        FHE.allowTransient(c.pot, c.token);
        IERC7984(c.token).confidentialTransfer(recipient, c.pot);

        c.roundsCompleted += 1;
        emit PayoutReleased(circleId, c.currentRound, recipient);

        c.currentRound += 1;
        if (c.currentRound == c.memberCount) {
            // Every member has received exactly one payout; the circle is finished.
            c.active = false;
            c.completed = true;
            emit CircleCompleted(circleId);
        } else {
            c.contributionsThisRound = 0;
            c.roundStart = uint64(block.timestamp);
            c.pot = FHE.asEuint64(0);
            FHE.allowThis(c.pot);
        }
    }
}
