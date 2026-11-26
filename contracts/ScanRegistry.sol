// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title  ScanRegistry
/// @notice On-chain registry of AI risk-scan attestations for smart contracts on GIWA.
/// @dev    Aegis scans a contract off-chain, then writes a compact, verifiable attestation
///         here: a 0-100 risk score, a category bitmap, and a hash of the full report.
///         The full human-readable report lives off-chain (e.g. IPFS); `reportHash` binds it.
///         No ETH is handled and there are no external calls, so the contract has no
///         reentrancy or value-transfer surface - it is a pure storage + events registry.
contract ScanRegistry {
    string public constant VERSION = "1.1.0";

    // ---------------------------------------------------------------------
    // Risk category bitmap - bit positions used inside `Attestation.flags`
    // ---------------------------------------------------------------------
    uint16 public constant FLAG_REENTRANCY         = uint16(1) << 0; // 1
    uint16 public constant FLAG_ACCESS_CONTROL     = uint16(1) << 1; // 2
    uint16 public constant FLAG_DANGEROUS_APPROVAL = uint16(1) << 2; // 4
    uint16 public constant FLAG_HONEYPOT_RUG       = uint16(1) << 3; // 8
    uint16 public constant FLAG_ORACLE_MANIPULATION= uint16(1) << 4; // 16
    uint16 public constant FLAG_UNSAFE_UPGRADE     = uint16(1) << 5; // 32

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------
    struct Attestation {
        uint8   riskScore;     // 0-100
        uint16  flags;         // OR of the FLAG_* bits detected
        bytes32 reportHash;    // keccak256 / IPFS digest of the full off-chain report
        uint64  timestamp;     // block time the attestation was written
        address attester;      // address that submitted it
        uint32  schemaVersion; // report schema version (off-chain format)
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------
    address public owner;
    address public pendingOwner;                      // proposed owner, must call acceptOwnership()
    uint256 public totalAttestations;                 // running count - a live KPI
    mapping(address => bool) public isAttester;       // who may write attestations
    mapping(address => bool) public hasAttestation;   // has `target` ever been scanned
    mapping(address => Attestation) private _latest;  // latest attestation per target

    // ---------------------------------------------------------------------
    // Events (indexers reconstruct full scan history from these)
    // ---------------------------------------------------------------------
    event Attested(
        address indexed target,
        address indexed attester,
        uint8   riskScore,
        uint16  flags,
        bytes32 reportHash,
        uint32  schemaVersion,
        uint64  timestamp
    );
    event AttesterSet(address indexed attester, bool enabled);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------
    error NotOwner();
    error NotAttester();
    error ZeroAddress();
    error InvalidScore(uint8 score);
    error LengthMismatch();
    error NotPendingOwner();

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }
    modifier onlyAttester() {
        if (!isAttester[msg.sender]) revert NotAttester();
        _;
    }

    constructor() {
        owner = msg.sender;
        isAttester[msg.sender] = true;
        emit OwnershipTransferred(address(0), msg.sender);
        emit AttesterSet(msg.sender, true);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice Grant or revoke an address's ability to write attestations.
    function setAttester(address attester, bool enabled) external onlyOwner {
        if (attester == address(0)) revert ZeroAddress();
        isAttester[attester] = enabled;
        emit AttesterSet(attester, enabled);
    }

    /// @notice Propose a new owner. Ownership only moves when that address calls `acceptOwnership()`,
    ///         so a mistyped address can never lock the registry. Proposing again replaces the proposal.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Called by the proposed owner to take ownership.
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ---------------------------------------------------------------------
    // Write
    // ---------------------------------------------------------------------

    /// @notice Record (or overwrite) the latest risk attestation for `target`.
    /// @param target        contract that was scanned
    /// @param riskScore     0-100 risk score (higher = riskier)
    /// @param flags         OR of the FLAG_* category bits detected
    /// @param reportHash    hash of the full off-chain report
    /// @param schemaVersion off-chain report schema version
    function attest(
        address target,
        uint8   riskScore,
        uint16  flags,
        bytes32 reportHash,
        uint32  schemaVersion
    ) public onlyAttester {
        if (target == address(0)) revert ZeroAddress();
        if (riskScore > 100) revert InvalidScore(riskScore);

        if (!hasAttestation[target]) {
            hasAttestation[target] = true;
        }

        _latest[target] = Attestation({
            riskScore: riskScore,
            flags: flags,
            reportHash: reportHash,
            timestamp: uint64(block.timestamp),
            attester: msg.sender,
            schemaVersion: schemaVersion
        });

        unchecked {
            ++totalAttestations;
        }

        emit Attested(target, msg.sender, riskScore, flags, reportHash, schemaVersion, uint64(block.timestamp));
    }

    /// @notice Batch version of `attest` - one schema version, many targets.
    function attestBatch(
        address[] calldata targets,
        uint8[]   calldata riskScores,
        uint16[]  calldata flagsArr,
        bytes32[] calldata reportHashes,
        uint32             schemaVersion
    ) external onlyAttester {
        uint256 n = targets.length;
        if (n != riskScores.length || n != flagsArr.length || n != reportHashes.length) {
            revert LengthMismatch();
        }
        for (uint256 i; i < n; ++i) {
            attest(targets[i], riskScores[i], flagsArr[i], reportHashes[i], schemaVersion);
        }
    }

    // ---------------------------------------------------------------------
    // Read
    // ---------------------------------------------------------------------

    /// @notice Full latest attestation for `target` (zero-valued if never scanned).
    function getAttestation(address target) external view returns (Attestation memory) {
        return _latest[target];
    }

    /// @notice Convenience: latest risk score for `target`.
    function riskOf(address target) external view returns (uint8) {
        return _latest[target].riskScore;
    }

    /// @notice True if `target`'s latest attestation has `flag` set.
    /// @param flag one of the FLAG_* constants.
    function isFlagged(address target, uint16 flag) external view returns (bool) {
        return (_latest[target].flags & flag) != 0;
    }
}