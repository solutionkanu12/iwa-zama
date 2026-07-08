// lib/fhevm.ts — the client-side FHE seam (encryption and user-decryption).
//
// Two primitives power the whole app:
//   - encryptAmount: encrypt a contribution amount on this device into an
//     external euint64 handle + input proof, exactly what IwaCircle.contribute
//     expects. The cleartext amount never leaves the browser.
//   - userDecryptHandle: the EIP-712 user-decrypt flow. The member signs a typed
//     message, and the Relayer/KMS returns the cleartext of a handle the member
//     is FHE-authorized to read (their own reliability, or an approval a lender
//     was granted). No secret is ever revealed to anyone not on the ACL.
//
// We import the SDK's `/web` ESM entry (real named exports, loads its own WASM
// via `new URL(..., import.meta.url)` which Vite serves). The `/bundle` entry is
// only a thin shim over `window.relayerSDK` and requires the UMD script to be
// loaded from a CDN <script> first, so it throws "reading 'initSDK' of undefined"
// under a plain Vite build. It is initialised once against Sepolia using the
// injected wallet as the network provider.

import { initSDK, createInstance, SepoliaConfig, type FhevmInstance } from "@zama-fhe/relayer-sdk/web";
import { bytesToHex, type Hex, type WalletClient } from "viem";
import { getEthereum } from "./wallet";

const ZERO_HANDLE = "0x0000000000000000000000000000000000000000000000000000000000000000";

let instancePromise: Promise<FhevmInstance> | null = null;

/** Initialise (once) and return the Relayer SDK instance bound to Sepolia. */
export async function getFhevmInstance(): Promise<FhevmInstance> {
  if (!instancePromise) {
    instancePromise = (async () => {
      await initSDK(); // loads the TFHE/KMS WASM
      return createInstance({ ...SepoliaConfig, network: getEthereum() });
    })().catch((e) => {
      instancePromise = null; // let a later attempt retry a failed init
      throw e;
    });
  }
  return instancePromise;
}

/**
 * Encrypt `amount` (base units) into the external euint64 handle + input proof
 * that IwaCircle.contribute takes. The input is bound to (contractAddress, user)
 * so only that contract, called by that user, can consume it.
 */
export async function encryptAmount(
  contractAddress: string,
  userAddress: string,
  amount: bigint,
): Promise<{ handle: Hex; inputProof: Hex }> {
  const instance = await getFhevmInstance();
  const input = instance.createEncryptedInput(contractAddress, userAddress);
  input.add64(amount);
  const enc = await input.encrypt();
  return {
    handle: bytesToHex(enc.handles[0]),
    inputProof: bytesToHex(enc.inputProof),
  };
}

/**
 * User-decrypt a single encrypted handle the member is authorized to read.
 * Runs the EIP-712 flow: generate an ephemeral keypair, have the member sign the
 * typed request, and ask the Relayer/KMS to return the cleartext. Returns 0n for
 * an uninitialised (all-zero) handle so brand-new members read as zero.
 */
export async function userDecryptHandle(
  handle: Hex,
  contractAddress: string,
  userAddress: string,
  walletClient: WalletClient,
): Promise<bigint> {
  if (!handle || handle === ZERO_HANDLE) return 0n;

  const instance = await getFhevmInstance();
  const keypair = instance.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 10;
  const contractAddresses = [contractAddress];

  const eip712 = instance.createEIP712(
    keypair.publicKey,
    contractAddresses,
    startTimestamp,
    durationDays,
  );

  const signature = await walletClient.signTypedData({
    account: userAddress as Hex,
    domain: eip712.domain,
    types: {
      UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification,
    },
    primaryType: "UserDecryptRequestVerification",
    message: eip712.message,
  } as never);

  const results = await instance.userDecrypt(
    [{ handle, contractAddress }],
    keypair.privateKey,
    keypair.publicKey,
    signature.replace(/^0x/, ""),
    contractAddresses,
    userAddress,
    startTimestamp,
    durationDays,
  );

  const value = results[handle];
  if (typeof value === "bigint") return value;
  if (typeof value === "boolean") return value ? 1n : 0n;
  return BigInt(value ?? 0);
}

/** Convenience: decrypt an encrypted boolean handle (approval) to a real boolean. */
export async function userDecryptBool(
  handle: Hex,
  contractAddress: string,
  userAddress: string,
  walletClient: WalletClient,
): Promise<boolean> {
  const v = await userDecryptHandle(handle, contractAddress, userAddress, walletClient);
  return v !== 0n;
}
