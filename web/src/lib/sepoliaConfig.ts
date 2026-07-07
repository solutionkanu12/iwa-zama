// Sepolia (Zama FHEVM) configuration for the deployed Iwa contracts.
//
// Everything that talks to the chain, the Relayer SDK, or the wallet imports
// from here. Do not hardcode these values anywhere else.

/** Ethereum Sepolia chain id. */
export const CHAIN_ID = 11155111;

/** Public Sepolia JSON-RPC endpoint used for read-only contract calls. */
export const SEPOLIA_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";

/** IwaCircle: the rotating savings circle (encrypted reliability + auto payout). */
export const IWA_CIRCLE_ADDRESS = "0xFd4B38Cf46Cf74841634596153fd9F4c8f1eD362";

/** IwaTrustGate: composability contract, encrypted threshold check over reliability. */
export const IWA_TRUST_GATE_ADDRESS = "0x7C494731cCb9bbEE76D60ECee45A08324e0Ca380";

/** ConfidentialToken (ERC-7984): the confidential rail for contributions and payouts. */
export const CONFIDENTIAL_TOKEN_ADDRESS = "0xEE4335082628Cdfa7C07860e919Ce4b0e4DD77FB";

/** The confidential token uses 6 decimals (ERC-7984 default). */
export const TOKEN_DECIMALS_DEFAULT = 6;

/**
 * Fixed per-round contribution used by the demo, in token base units (50 IWA).
 * IwaCircle does not store a per-round amount on chain (contributions are
 * arbitrary encrypted euint64), so this is a client-side convention.
 */
export const DEMO_CONTRIBUTION = 50_000_000;

/**
 * The circle the app reads by default. Circle ids on IwaCircle are client-chosen
 * uint256 values (creation happens on the first join). This points at circle 7,
 * a real two-member circle that ran a full round live on Sepolia (see
 * LIVE_PROOF.md): it shows a populated circle with on-chain history.
 */
export const DEMO_CIRCLE_ID = 7;

/** Block from which to scan CircleCreated events (the IwaCircle deploy block region). */
export const CIRCLE_EVENTS_FROM_BLOCK = 0n;

// --- token display helpers (kept API-compatible with the old stellarConfig) ---

export const TOKEN_SYMBOLS: Record<string, string> = {
  [CONFIDENTIAL_TOKEN_ADDRESS.toLowerCase()]: "IWA",
};

/** Resolve a token address to its display symbol, never guessing an unknown asset. */
export function tokenSymbol(address: string): string {
  if (!address) return "token";
  const known = TOKEN_SYMBOLS[address.toLowerCase()];
  if (known) return known;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const TOKEN_DECIMALS: Record<string, number> = {
  [CONFIDENTIAL_TOKEN_ADDRESS.toLowerCase()]: TOKEN_DECIMALS_DEFAULT,
};

/** Resolve a token address to its decimals, defaulting to the ERC-7984 default (6). */
export function tokenDecimals(address: string): number {
  if (!address) return TOKEN_DECIMALS_DEFAULT;
  return TOKEN_DECIMALS[address.toLowerCase()] ?? TOKEN_DECIMALS_DEFAULT;
}

/** A token the circle-creation picker offers. */
export interface TokenOption {
  id: string;
  symbol: string;
  decimals: number;
  enabled: boolean;
}

export const TOKEN_OPTIONS: TokenOption[] = [
  { id: CONFIDENTIAL_TOKEN_ADDRESS, symbol: "IWA", decimals: TOKEN_DECIMALS_DEFAULT, enabled: true },
];
