// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { ERC7984 } from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";

/**
 * @title ConfidentialToken
 * @dev Minimal concrete ERC-7984 confidential fungible token used as the value rail
 *      for IwaCircle in local/dev testing. The `mint` entrypoint is intentionally
 *      permissionless and takes a plaintext amount for test convenience only; it is
 *      NOT intended for production deployment.
 */
contract ConfidentialToken is ERC7984, ZamaEthereumConfig {
    constructor(
        string memory name_,
        string memory symbol_,
        string memory uri_
    ) ERC7984(name_, symbol_, uri_) {}

    /// @dev Test/dev helper: mint `amount` (plaintext) confidential units to `to`.
    function mint(address to, uint64 amount) external returns (euint64) {
        euint64 encAmount = FHE.asEuint64(amount);
        FHE.allowThis(encAmount);
        return _mint(to, encAmount);
    }
}
