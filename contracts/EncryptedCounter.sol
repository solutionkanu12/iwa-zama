// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/// Trivial encrypted counter used to prove out the FHEVM toolchain end to end.
contract EncryptedCounter is ZamaEthereumConfig {
    euint32 private _count;

    function increment(externalEuint32 inputEuint32, bytes calldata inputProof) external {
        euint32 value = FHE.fromExternal(inputEuint32, inputProof);
        _count = FHE.add(_count, value);
        FHE.allowThis(_count);
        FHE.allow(_count, msg.sender);
    }

    function getCount() external view returns (euint32) {
        return _count;
    }
}
