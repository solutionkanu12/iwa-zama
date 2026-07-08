// lib/wallet.ts — Ethereum wallet connect via viem, with EIP-6963 discovery.
//
// discoverWallets enumerates the installed wallets (MetaMask, OKX, Rabby, ...)
// via the EIP-6963 announce/request handshake, so the member can pick one rather
// than being sent to whichever extension happened to win the window.ethereum
// injection race. connectWallet then requests an account from the chosen
// provider and makes sure it is on Sepolia. The chosen provider is remembered and
// used by everything that talks to the wallet: chain switching, the viem wallet
// client, and the Relayer SDK (lib/fhevm.ts) for encryption and the EIP-712
// user-decrypt flow. The connected address IS the member identity on IwaCircle
// (reliability and membership are keyed by msg.sender).

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

// --- EIP-6963 multi-wallet discovery -------------------------------------

/** Wallet metadata a provider announces via EIP-6963 (name, icon, rdns, uuid). */
export interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string; // data URI
  rdns: string;
}

/** A discovered wallet: its announced info plus its EIP-1193 provider handle. */
export interface DiscoveredWallet {
  info: EIP6963ProviderInfo;
  provider: Eip1193Provider;
}

const announcedWallets = new Map<string, DiscoveredWallet>();
let discoveryListening = false;

function startWalletDiscovery(): void {
  if (discoveryListening || typeof window === "undefined") return;
  discoveryListening = true;
  window.addEventListener("eip6963:announceProvider", (event: Event) => {
    const detail = (event as CustomEvent).detail as DiscoveredWallet | undefined;
    if (detail?.info?.uuid && detail.provider) {
      announcedWallets.set(detail.info.uuid, detail);
    }
  });
}

// Known non-EVM (Cosmos/Solana-first) wallets that also announce over EIP-6963.
// Matched by name substring or reverse-DNS so they never appear in the picker,
// even if they expose an EVM-shaped provider handle.
const NON_EVM_NAME_HINTS = ["keplr", "leap", "cosmostation", "compass", "terra station", "station wallet"];
const NON_EVM_RDNS = new Set([
  "app.keplr",
  "io.keplr",
  "app.leapwallet",
  "io.leapwallet.leap",
  "io.cosmostation",
  "org.cosmostation",
  "io.leapwallet",
]);

function isNonEvmWallet(info: EIP6963ProviderInfo): boolean {
  const name = (info.name ?? "").toLowerCase();
  const rdns = (info.rdns ?? "").toLowerCase();
  return NON_EVM_NAME_HINTS.some((h) => name.includes(h)) || NON_EVM_RDNS.has(rdns);
}

// An EVM provider answers eth_chainId (a passive read, no wallet prompt) with a
// 0x-prefixed hex chain id. Non-EVM providers reject or return something else.
async function isEvmProvider(provider: Eip1193Provider): Promise<boolean> {
  try {
    const chainId = await Promise.race([
      provider.request({ method: "eth_chainId" }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1200)),
    ]);
    return typeof chainId === "string" && chainId.startsWith("0x");
  } catch {
    return false;
  }
}

/**
 * Discover installed EVM wallets via EIP-6963. Wallets answer the request event
 * asynchronously, so we (re)issue the request and wait briefly for the
 * announcements. Non-EVM wallets (Keplr and friends) are filtered out by
 * name/rdns and by an eth_chainId probe. Callers handle the empty case: a legacy
 * injected window.ethereum can still be connected directly.
 */
export async function discoverWallets(waitMs = 350): Promise<DiscoveredWallet[]> {
  startWalletDiscovery();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  }
  await new Promise((resolve) => setTimeout(resolve, waitMs));

  const candidates = [...announcedWallets.values()].filter((w) => !isNonEvmWallet(w.info));
  // Keep only providers that actually speak EVM (respond to eth_chainId).
  const evmFlags = await Promise.all(candidates.map((w) => isEvmProvider(w.provider)));
  return candidates.filter((_, i) => evmFlags[i]);
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

// The provider the member chose to connect with. Everything that talks to the
// wallet routes through this exact provider once set, so the app never falls
// back to whichever extension won the window.ethereum injection race.
let selectedProvider: Eip1193Provider | null = null;

export function getEthereum(): Eip1193Provider {
  const eth =
    selectedProvider ?? (typeof window !== "undefined" ? window.ethereum : undefined);
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
 * Connect the given wallet (from discoverWallets) or, when none is passed, the
 * default injected provider. Requests an account, ensures Sepolia, remembers the
 * chosen provider for all later wallet calls, and returns the address. Rejects
 * with WalletCancelledError if the visitor dismisses the prompt.
 */
export async function connectWallet(wallet?: DiscoveredWallet): Promise<string> {
  const eth = wallet?.provider ?? getEthereum();
  let accounts: string[];
  try {
    accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 4001) throw new WalletCancelledError(); // user rejected
    throw err;
  }
  if (!accounts || accounts.length === 0) throw new WalletCancelledError();
  // Route fhevm + the viem wallet client through the exact wallet the member
  // chose, from this point on.
  selectedProvider = eth;
  await ensureSepolia(eth);
  return accounts[0] as Address;
}

/**
 * There is no persistent wallet session to tear down with the injected provider,
 * so this is a best-effort no-op kept for API compatibility with the UI.
 */
export async function disconnectWallet(): Promise<void> {
  // Injected wallets have no programmatic disconnect; the user manages the
  // connection in the extension. Forget the chosen provider so a fresh connect
  // can pick a different wallet.
  selectedProvider = null;
}

/**
 * Subscribe to a wallet event on the currently connected provider:
 *   - "accountsChanged" fires (with a string[] of accounts) when the member
 *     switches the active account in their extension. The app must follow it so
 *     every later signature and transaction uses the account now selected, not
 *     the one captured at connect time.
 *   - "chainChanged" fires (with a hex chain id) when they switch networks.
 * Returns an unsubscribe function. No-op if nothing is connected or the provider
 * does not emit events.
 */
export function onWalletEvent(
  event: "accountsChanged" | "chainChanged",
  handler: (payload: unknown) => void,
): () => void {
  const eth = selectedProvider;
  if (!eth?.on) return () => {};
  eth.on(event, handler);
  return () => eth.removeListener?.(event, handler);
}

/**
 * Best-effort: make sure the connected wallet is back on Sepolia. Called after a
 * chainChanged so writes never go out on the wrong network. Idempotent; returns
 * immediately if already on Sepolia.
 */
export async function ensureSepoliaNetwork(): Promise<void> {
  if (!selectedProvider) return;
  await ensureSepolia(selectedProvider);
}
