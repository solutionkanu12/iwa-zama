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

/**
 * Discover installed wallets via EIP-6963. Wallets answer the request event
 * asynchronously, so we (re)issue the request and wait briefly for the
 * announcements. Returns every wallet found. Callers handle the empty case: a
 * legacy injected window.ethereum can still be connected directly.
 */
export async function discoverWallets(waitMs = 350): Promise<DiscoveredWallet[]> {
  startWalletDiscovery();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  }
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  return [...announcedWallets.values()];
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
