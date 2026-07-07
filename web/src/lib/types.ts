// Shared seam types. The UI imports these and the seam modules only.
// Shapes match what the screens render; the FHEVM backend sits behind
// lib/iwaContract.ts and lib/fhevm.ts.

export interface CircleConfig {
  amount: number; // contribution per round, in the circle's token base units
  frequency: number; // seconds per round
  size: number; // number of members
}

export type CircleStatus = "forming" | "active" | "complete";

export interface MemberSlot {
  slot: number; // 0-indexed position in the circle
  filled: boolean; // taken by a member
  isYou: boolean; // this slot is the connected member
}

// The circle screen shape. Membership is pseudonymous (wallet addresses), while
// the amounts and each member's reliability stay encrypted on chain.
export interface Circle {
  id: number; // circle id (uint256 on chain, small in the demo)
  token: string; // the circle's ERC-7984 confidential token address
  trust_required: boolean; // always false on IwaCircle (open joins)
  amount: number; // per-round contribution convention (not stored on chain)
  frequency: number; // round length in seconds
  size: number; // member count
  current_round: number;
  status: CircleStatus;
  pot: number; // encrypted on chain; not shown as a cleartext number
  members: MemberSlot[];
  yourStreak: number; // decrypted on demand by the member
}

// A reliability claim the member chooses to check against a threshold.
export interface Claim {
  threshold: number;
  statement: string;
}

// The saver's own reliability record, decrypted on demand (member-only).
// On IwaCircle these come from the encrypted reliability (on-time count) and
// lateCount counters. "late" is what the contract tracks; there is no separate
// default concept.
export interface Reputation {
  completedCycles: number; // reliability + late (total contributions)
  onTimeRate: number; // percent, 0 to 100
  lateCount: number;
}
