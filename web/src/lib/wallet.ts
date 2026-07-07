// lib/wallet.ts — Ethereum wallet connect (MetaMask) via viem.
//
// connectWallet asks the injected EIP-1193 wallet (MetaMask) for an account and
// makes sure it is on Sepolia. The connected address IS the member identity on
// IwaCircle (reliability and membership are keyed by msg.sender), so there is no
// separate "member commitment" the way the Stellar build had. The Relayer SDK
// (lib/fhevm.ts) uses this same injected provider to encrypt inputs and to run
// the EIP-712 user-decrypt flow.

import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  type WalletClient,
  type PublicClient,
  type Address,
} from "viem";
import { sepolia } from "viem/chains";
import { CHAIN_ID, SEPOLIA_RPC_URL } from "./sepoliaConfig";

// The injected EIP-1193 provider (MetaMask and compatible wallets).
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

/** Thrown when the visitor dismisses the wallet prompt, so the UI can stay on the gate. */
export class WalletCancelledError extends Error {
  constructor() {
    super("wallet connection cancelled");
    this.name = "WalletCancelledError";
  }
}

/** Thrown when no injected Ethereum wallet is available. */
export class NoWalletError extends Error {
  constructor() {
    super("no Ethereum wallet found");
    this.name = "NoWalletError";
  }
}

export function getEthereum(): Eip1193Provider {
  const eth = typeof window !== "undefined" ? window.ethereum : undefined;
  if (!eth) throw new NoWalletError();
  return eth;
}

/** A read-only client over the public Sepolia RPC (no wallet needed). */
let publicClient: PublicClient | null = null;
export function getPublicClient(): PublicClient {
  if (!publicClient) {
    publicClient = createPublicClient({
      chain: sepolia,
      transport: http(SEPOLIA_RPC_URL),
    });
  }
  return publicClient;
}

/** A wallet client bound to the injected provider, for signing writes and typed data. */
export function getWalletClient(): WalletClient {
  return createWalletClient({ chain: sepolia, transport: custom(getEthereum()) });
}

const SEPOLIA_HEX = "0x" + CHAIN_ID.toString(16);

// Make sure the wallet is pointed at Sepolia, adding the network if it is missing.
async function ensureSepolia(eth: Eip1193Provider): Promise<void> {
  const current = (await eth.request({ method: "eth_chainId" })) as string;
  if (current?.toLowerCase() === SEPOLIA_HEX) return;
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_HEX }],
    });
  } catch (err) {
    // 4902 = chain not added to the wallet yet.
    const code = (err as { code?: number }).code;
    if (code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: SEPOLIA_HEX,
            chainName: "Sepolia",
            nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: [SEPOLIA_RPC_URL],
            blockExplorerUrls: ["https://sepolia.etherscan.io"],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

/**
 * Open the wallet, request an account, ensure Sepolia, and return the address.
 * Rejects with WalletCancelledError if the visitor dismisses the prompt.
 */
export async function connectWallet(): Promise<string> {
  const eth = getEthereum();
  let accounts: string[];
  try {
    accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 4001) throw new WalletCancelledError(); // user rejected
    throw err;
  }
  if (!accounts || accounts.length === 0) throw new WalletCancelledError();
  await ensureSepolia(eth);
  return accounts[0] as Address;
}

/**
 * There is no persistent wallet session to tear down with the injected provider,
 * so this is a best-effort no-op kept for API compatibility with the UI.
 */
export async function disconnectWallet(): Promise<void> {
  // MetaMask has no programmatic disconnect; the user manages connection in the
  // extension. Nothing to clean up here.
}

/**
 * The connected wallet address is the member identity on IwaCircle. This helper
 * keeps a thin shape so callers that previously held a "member commitment" can
 * pass an address-shaped identity with minimal change.
 */
export interface MemberIdentity {
  address: string;
}

export function memberIdentity(address: string): MemberIdentity {
  return { address };
}
