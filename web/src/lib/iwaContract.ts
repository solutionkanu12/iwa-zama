// lib/iwaContract.ts — the single seam between the UI and the Zama FHEVM
// contracts on Sepolia.
//
// Reads go through a public Sepolia RPC (viem publicClient). Writes are real
// signed transactions through the connected wallet (viem walletClient), and are
// simulated first so a revert surfaces as a classifiable error. Contribution
// amounts are encrypted on this device (lib/fhevm.ts) before they ever touch the
// chain; each member's reliability is an encrypted counter only they can decrypt.
//
// Kept function names where the concept survives. Notes on the ones that changed
// shape versus the earlier seam:
//   - member identity is the wallet address.
//   - trust-gated joins are gone; trust is a separate IwaTrustGate flow.
//   - collect_pot is gone; payout is automatic when a round completes.
//   - trust checks are an encrypted threshold check (evaluateTrust) on chain.

import { type Hex, type WalletClient } from "viem";
import { getPublicClient, getWalletClient } from "./wallet";
import { encryptAmount, userDecryptHandle } from "./fhevm";
import {
  IWA_CIRCLE_ABI,
  IWA_TRUST_GATE_ABI,
  CONFIDENTIAL_TOKEN_ABI,
} from "./abi";
import {
  IWA_CIRCLE_ADDRESS,
  IWA_TRUST_GATE_ADDRESS,
  CONFIDENTIAL_TOKEN_ADDRESS,
  CIRCLE_EVENTS_FROM_BLOCK,
  DEMO_CONTRIBUTION,
} from "./sepoliaConfig";
import type { Circle, CircleStatus, MemberSlot, Reputation } from "./types";

const CIRCLE = IWA_CIRCLE_ADDRESS as Hex;
const GATE = IWA_TRUST_GATE_ADDRESS as Hex;
const TOKEN = CONFIDENTIAL_TOKEN_ADDRESS as Hex;
const OPERATOR_UNTIL = 4_000_000_000; // far-future uint48 (year 2096)

// A classified reason for a failed write, so callers can show a clear message.
export type ContractErrorKind =
  | "InvalidConfig"
  | "CircleFull"
  | "AlreadyMember"
  | "NotAMember"
  | "CircleNotActive"
  | "AlreadyContributedThisRound"
  | "Declined"
  | "Unknown";

// Thrown by a write when simulation reverts or the submit fails.
export class ContractCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractCallError";
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Classify a failed write. Reads a wallet rejection, then a decoded custom-error name. */
export function classifyContractError(err: unknown): ContractErrorKind {
  const text = describeError(err).toLowerCase();
  if (/(user rejected|declin|denied|4001|cancel)/.test(text)) return "Declined";
  if (/circlefull/.test(text)) return "CircleFull";
  if (/alreadymember/.test(text)) return "AlreadyMember";
  if (/notamember/.test(text)) return "NotAMember";
  if (/circlenotactive/.test(text)) return "CircleNotActive";
  if (/alreadycontributedthisround/.test(text)) return "AlreadyContributedThisRound";
  if (/invalidconfig/.test(text)) return "InvalidConfig";
  return "Unknown";
}

// --- low-level read/write plumbing (viem) ---------------------------------

async function read<T>(
  address: Hex,
  abi: readonly unknown[],
  functionName: string,
  args: readonly unknown[],
): Promise<T> {
  const pub = getPublicClient();
  return (await pub.readContract({ address, abi, functionName, args } as never)) as T;
}

// Simulate (to classify reverts), send through the wallet, then wait for the
// receipt. Returns the confirmed tx hash.
async function write(
  address: Hex,
  abi: readonly unknown[],
  functionName: string,
  args: readonly unknown[],
  account: Hex,
): Promise<Hex> {
  const pub = getPublicClient();
  const wallet: WalletClient = getWalletClient();
  try {
    const { request } = await pub.simulateContract({
      address,
      abi,
      functionName,
      args,
      account,
    } as never);
    const hash = await wallet.writeContract(request as never);
    await pub.waitForTransactionReceipt({ hash });
    return hash;
  } catch (err) {
    throw new ContractCallError(describeError(err));
  }
}

// --- circle status mapping -------------------------------------------------

function mapStatus(active: boolean, completed: boolean, memberCount: number, joined: number): CircleStatus {
  if (completed) return "complete";
  if (active) return "active";
  if (joined >= memberCount && memberCount > 0) return "active";
  return "forming";
}

interface Progress {
  memberCount: number;
  currentRound: number;
  roundsCompleted: number;
  contributionsThisRound: number;
  active: boolean;
  completed: boolean;
}

async function getProgress(circleId: number): Promise<Progress> {
  const r = await read<[number, number, number, number, boolean, boolean]>(
    CIRCLE,
    IWA_CIRCLE_ABI,
    "getCircleProgress",
    [BigInt(circleId)],
  );
  return {
    memberCount: Number(r[0]),
    currentRound: Number(r[1]),
    roundsCompleted: Number(r[2]),
    contributionsThisRound: Number(r[3]),
    active: r[4],
    completed: r[5],
  };
}

// --- reads -----------------------------------------------------------------

/** Read the circle roster as wallet addresses, in join order. */
export async function get_members(circleId: number): Promise<string[]> {
  const members = await read<readonly string[]>(CIRCLE, IWA_CIRCLE_ABI, "getMembers", [BigInt(circleId)]);
  return [...members];
}

export interface CircleSummary {
  id: number;
  amount: number;
  token: string;
  trust_required: boolean;
  size: number;
  current_round: number;
  members: number;
  status: CircleStatus;
}

/**
 * Discover circles from CircleCreated events. IwaCircle has no enumeration and
 * circle ids are arbitrary uint256, so we read the event log rather than scan
 * ids. Returns the most recent circles first.
 */
export async function listCircles(): Promise<CircleSummary[]> {
  const pub = getPublicClient();
  let logs: { args: { circleId?: bigint; token?: string; memberCount?: number } }[] = [];
  try {
    logs = (await pub.getContractEvents({
      address: CIRCLE,
      abi: IWA_CIRCLE_ABI,
      eventName: "CircleCreated",
      fromBlock: CIRCLE_EVENTS_FROM_BLOCK,
      toBlock: "latest",
    } as never)) as never;
  } catch (e) {
    console.warn("listCircles: event query failed", e);
    return [];
  }

  const out: CircleSummary[] = [];
  const seen = new Set<string>();
  for (const log of logs) {
    const id = Number(log.args.circleId ?? 0n);
    if (seen.has(String(id))) continue;
    seen.add(String(id));
    try {
      const p = await getProgress(id);
      const joined = (await get_members(id)).length;
      out.push({
        id,
        amount: 0, // no on-chain per-round amount on IwaCircle
        token: log.args.token ?? "",
        trust_required: false,
        size: p.memberCount,
        current_round: p.currentRound,
        members: joined,
        status: mapStatus(p.active, p.completed, p.memberCount, joined),
      });
    } catch (e) {
      console.warn(`listCircles: progress read for ${id} failed`, e);
    }
  }
  return out.reverse();
}

// A circle that does not exist yet: a real zero state, never fake data.
function emptyCircle(circleId: number): Circle {
  return {
    id: circleId,
    token: "",
    trust_required: false,
    amount: 0,
    frequency: 0,
    size: 0,
    current_round: 0,
    status: "forming",
    pot: 0,
    members: [],
    yourStreak: 0,
  };
}

/**
 * Read the current circle state and compose the UI shape. Amounts and the pot
 * are encrypted on chain, so they are not shown as cleartext numbers; the member
 * slots come from the roster (with yours flagged). yourStreak is left at 0 here
 * and fetched on demand by the standing screen (it needs a decrypt signature).
 */
export async function get_circle(circleId: number, address?: string): Promise<Circle> {
  let p: Progress;
  try {
    p = await getProgress(circleId);
  } catch {
    return emptyCircle(circleId);
  }
  if (p.memberCount === 0) return emptyCircle(circleId);

  const memberAddrs = await get_members(circleId);
  const you = address?.toLowerCase() ?? null;

  const members: MemberSlot[] = Array.from({ length: p.memberCount }, (_, slot) => {
    const filled = slot < memberAddrs.length;
    const isYou = filled && you !== null && memberAddrs[slot].toLowerCase() === you;
    return { slot, filled, isYou };
  });

  let frequency = 0;
  try {
    const t = await read<[bigint, bigint, bigint]>(CIRCLE, IWA_CIRCLE_ABI, "getRoundTiming", [BigInt(circleId)]);
    frequency = Number(t[1]);
  } catch {
    frequency = 0;
  }

  return {
    id: circleId,
    token: TOKEN,
    trust_required: false,
    // The per-round amount is a client-side convention (not stored on chain);
    // the actual pot is an encrypted euint64 and is never a cleartext number.
    amount: DEMO_CONTRIBUTION,
    frequency,
    size: p.memberCount,
    current_round: p.currentRound,
    status: mapStatus(p.active, p.completed, p.memberCount, memberAddrs.length),
    pot: DEMO_CONTRIBUTION * p.memberCount,
    members,
    yourStreak: 0,
  };
}

/** Has this member already contributed for the current round? */
export async function has_contributed(circleId: number, address: string): Promise<boolean> {
  try {
    return await read<boolean>(CIRCLE, IWA_CIRCLE_ABI, "hasContributedThisRound", [
      BigInt(circleId),
      address as Hex,
    ]);
  } catch {
    return false;
  }
}

/**
 * Read the member's own reliability record, decrypted on this device via the
 * EIP-712 user-decrypt flow. Only the member can do this for themselves. Maps
 * the encrypted reliability (on-time count) and lateCount counters into the UI
 * shape. Requires a wallet signature.
 */
export async function get_reputation(
  circleId: number,
  address: string,
  walletClient: WalletClient,
): Promise<Reputation> {
  const relHandle = await read<Hex>(CIRCLE, IWA_CIRCLE_ABI, "confidentialReliabilityOf", [
    BigInt(circleId),
    address as Hex,
  ]);
  const lateHandle = await read<Hex>(CIRCLE, IWA_CIRCLE_ABI, "confidentialLateCountOf", [
    BigInt(circleId),
    address as Hex,
  ]);

  const reliability = Number(await userDecryptHandle(relHandle, CIRCLE, address, walletClient));
  const late = Number(await userDecryptHandle(lateHandle, CIRCLE, address, walletClient));
  const completed = reliability + late;
  const onTimeRate = completed > 0 ? Math.round((reliability / completed) * 100) : 0;
  return { completedCycles: completed, onTimeRate, lateCount: late };
}

// --- writes ----------------------------------------------------------------

/**
 * Create a circle: the first join creates it with the given member count and
 * round length. The circle id is chosen by the caller (uint256). Returns the id
 * and the confirmed tx hash. `amount` from the UI has no on-chain home on
 * IwaCircle; it is a client-side convention only.
 */
export async function create_circle(
  circleId: number,
  memberCount: number,
  roundLength: number,
  address: string,
): Promise<{ circleId: number; txHash: string }> {
  const txHash = await write(
    CIRCLE,
    IWA_CIRCLE_ABI,
    "joinCircle",
    [BigInt(circleId), memberCount, BigInt(roundLength), TOKEN],
    address as Hex,
  );
  return { circleId, txHash };
}

/**
 * Join an existing circle. Config args are ignored on join. Returns the assigned
 * slot (roster index) and the confirmed tx hash.
 */
export async function join_circle(
  circleId: number,
  address: string,
): Promise<{ ok: boolean; slot: number; txHash: string }> {
  const txHash = await write(
    CIRCLE,
    IWA_CIRCLE_ABI,
    "joinCircle",
    [BigInt(circleId), 0, 0n, "0x0000000000000000000000000000000000000000"],
    address as Hex,
  );
  const members = await get_members(circleId);
  const slot = members.findIndex((m) => m.toLowerCase() === address.toLowerCase());
  return { ok: true, slot: slot >= 0 ? slot : members.length - 1, txHash };
}

// Make sure the member can fund a contribution: authorize the circle as an
// ERC-7984 operator (once) and mint the amount into their confidential balance.
// The mint is a dev/demo convenience of ConfidentialToken.
async function ensureFunded(circleId: number, amount: bigint, address: Hex): Promise<void> {
  const isOp = await read<boolean>(TOKEN, CONFIDENTIAL_TOKEN_ABI, "isOperator", [address, CIRCLE]).catch(
    () => false,
  );
  if (!isOp) {
    await write(TOKEN, CONFIDENTIAL_TOKEN_ABI, "setOperator", [CIRCLE, OPERATOR_UNTIL], address);
  }
  await write(TOKEN, CONFIDENTIAL_TOKEN_ABI, "mint", [address, amount], address);
  void circleId;
}

/**
 * Contribute an encrypted amount for the current round. Ensures the member is
 * funded and has authorized the circle as an operator, encrypts the amount on
 * this device, then calls IwaCircle.contribute. Returns whether it was on time
 * (computed from the round deadline) and the confirmed tx hash.
 */
export async function contribute(
  circleId: number,
  amount: bigint,
  address: string,
): Promise<{ ok: boolean; onTime: boolean; txHash: string }> {
  const acct = address as Hex;

  // Determine on-time before we send (the round may advance on the completing tx).
  let onTime = true;
  try {
    const t = await read<[bigint, bigint, bigint]>(CIRCLE, IWA_CIRCLE_ABI, "getRoundTiming", [BigInt(circleId)]);
    const deadline = Number(t[2]);
    onTime = Math.floor(Date.now() / 1000) <= deadline;
  } catch {
    onTime = true;
  }

  await ensureFunded(circleId, amount, acct);

  const { handle, inputProof } = await encryptAmount(CIRCLE, address, amount);
  const txHash = await write(
    CIRCLE,
    IWA_CIRCLE_ABI,
    "contribute",
    [BigInt(circleId), handle, inputProof],
    acct,
  );
  return { ok: true, onTime, txHash };
}

// --- trust gate (composability, replaces verify_proof) ---------------------

/**
 * Authorize a reader contract (the trust gate) to use the caller's encrypted
 * reliability handle in FHE computations. A permission grant, not a decryption.
 */
export async function grantReliabilityAccess(circleId: number, reader: string, address: string): Promise<string> {
  return write(CIRCLE, IWA_CIRCLE_ABI, "grantReliabilityAccess", [BigInt(circleId), reader as Hex], address as Hex);
}

/**
 * Prove good standing to a lender without revealing the score. Grants the gate
 * access, runs the encrypted threshold comparison (FHE.ge) on chain, then
 * user-decrypts the encrypted approval for the caller. `grantee` (a lender) is
 * also permissioned to decrypt the result. Nothing about the score is revealed.
 * The whole check runs on the encrypted score, with no decryption in the path.
 */
export async function evaluateTrust(
  circleId: number,
  threshold: number,
  grantee: string,
  address: string,
  walletClient: WalletClient,
): Promise<{ verified: boolean; reference: string; txHash: string }> {
  // 1. Authorize the gate to read the caller's reliability (once per snapshot).
  await grantReliabilityAccess(circleId, GATE, address);

  // 2. Encrypted threshold comparison on chain (no decryption in this step).
  const txHash = await write(
    GATE,
    IWA_TRUST_GATE_ABI,
    "evaluate",
    [CIRCLE, BigInt(circleId), threshold, grantee as Hex],
    address as Hex,
  );

  // 3. User-decrypt the encrypted approval for the caller.
  const approvalHandle = await read<Hex>(GATE, IWA_TRUST_GATE_ABI, "confidentialApprovalOf", [address as Hex]);
  const value = await userDecryptHandle(approvalHandle, GATE, address, walletClient);

  return { verified: value !== 0n, reference: GATE, txHash };
}
