// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/**
 * @dev Minimal view into IwaCircle needed to read a member's encrypted reliability handle.
 *      Returning the euint32 handle does not decrypt anything — it is an opaque ciphertext
 *      reference that is only usable by an address the FHE ACL has authorized.
 */
interface IIwaCircle {
    function confidentialReliabilityOf(uint256 circleId, address member) external view returns (euint32);
}

/**
 * @title IwaTrustGate
 * @notice A SEPARATE, composable contract that acts on Iwa's encrypted reliability score with
 *         NO decryption anywhere in the path.
 *
 * The flow this contract proves:
 *
 *   1. It performs a cross-contract encrypted READ: it fetches the member's encrypted
 *      reliability ciphertext handle straight from the deployed IwaCircle contract. The member
 *      never re-submits their score; this gate reads the real on-chain handle. To be able to
 *      compute on that handle, the member must first authorize this gate via IwaCircle's
 *      `grantReliabilityAccess`, which extends an FHE ACL allowance (not a decryption).
 *
 *   2. It compares that ciphertext against a plaintext threshold ENTIRELY in encrypted space
 *      using FHE.ge. The reliability value is never revealed to reach the decision.
 *
 *   3. The result is an encrypted approval boolean (ebool). It stays encrypted and is only
 *      decryptable by parties the member explicitly designates (this contract grants ACL access
 *      to the member and to a single named `grantee`, e.g. a lender). It is never made public.
 *
 * There is no FHE.decrypt / oracle / relayer call anywhere in this contract — the entire
 * eligibility decision is computed and stored as ciphertext.
 */
contract IwaTrustGate is ZamaEthereumConfig {
    /// @dev Latest encrypted approval decision computed for each subject member.
    mapping(address subject => ebool) private _approval;

    event ApprovalEvaluated(
        address indexed circle,
        uint256 indexed circleId,
        address indexed subject,
        uint32 threshold,
        address grantee
    );

    /**
     * @notice Evaluate whether the caller's encrypted reliability score in `circle`/`circleId`
     *         is at least `threshold`, and grant the encrypted result to `grantee`.
     * @dev The caller must have first called `IwaCircle.grantReliabilityAccess(circleId, thisGate)`
     *      so the FHE ACL permits this contract to operate on their reliability ciphertext.
     *      The comparison is done fully in encrypted space; nothing is decrypted here.
     * @param circle    Address of the deployed IwaCircle.
     * @param circleId  The circle the caller belongs to.
     * @param threshold Plaintext minimum reliability required for approval.
     * @param grantee   The single party (e.g. a lender) allowed to decrypt the encrypted result.
     * @return approved The encrypted approval boolean handle.
     */
    function evaluate(
        address circle,
        uint256 circleId,
        uint32 threshold,
        address grantee
    ) external returns (ebool approved) {
        // Cross-contract encrypted read: fetch the real on-chain reliability ciphertext.
        euint32 reliability = IIwaCircle(circle).confidentialReliabilityOf(circleId, msg.sender);

        // Threshold comparison performed entirely in encrypted space (no decryption).
        approved = FHE.ge(reliability, FHE.asEuint32(threshold));

        // Keep the result usable by this contract, and disclose ONLY to the caller and the
        // explicitly designated grantee. It is never made publicly decryptable.
        FHE.allowThis(approved);
        FHE.allow(approved, msg.sender);
        FHE.allow(approved, grantee);

        _approval[msg.sender] = approved;
        emit ApprovalEvaluated(circle, circleId, msg.sender, threshold, grantee);
    }

    /// @notice The latest encrypted approval handle computed for `subject` (opaque ciphertext).
    function confidentialApprovalOf(address subject) external view returns (ebool) {
        return _approval[subject];
    }

    /// @notice Whether `viewer` is FHE-permitted to decrypt `subject`'s approval result.
    function isApprovalDecryptableBy(address subject, address viewer) external view returns (bool) {
        return FHE.isAllowed(_approval[subject], viewer);
    }
}
