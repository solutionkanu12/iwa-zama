// Minimal viem ABIs for the deployed Iwa contracts. Encrypted handles
// (euint32/euint64/ebool/externalEuint64) are bytes32 at the ABI boundary.

export const IWA_CIRCLE_ABI = [
  {
    type: "function",
    name: "joinCircle",
    stateMutability: "nonpayable",
    inputs: [
      { name: "circleId", type: "uint256" },
      { name: "memberCount", type: "uint8" },
      { name: "roundLength", type: "uint64" },
      { name: "token", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "contribute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "circleId", type: "uint256" },
      { name: "encryptedAmount", type: "bytes32" },
      { name: "inputProof", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "grantReliabilityAccess",
    stateMutability: "nonpayable",
    inputs: [
      { name: "circleId", type: "uint256" },
      { name: "reader", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getCircleProgress",
    stateMutability: "view",
    inputs: [{ name: "circleId", type: "uint256" }],
    outputs: [
      { name: "memberCount", type: "uint8" },
      { name: "currentRound", type: "uint32" },
      { name: "roundsCompleted", type: "uint32" },
      { name: "contributionsThisRound", type: "uint8" },
      { name: "active", type: "bool" },
      { name: "completed", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "getMembers",
    stateMutability: "view",
    inputs: [{ name: "circleId", type: "uint256" }],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function",
    name: "hasContributedThisRound",
    stateMutability: "view",
    inputs: [
      { name: "circleId", type: "uint256" },
      { name: "member", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "getRoundTiming",
    stateMutability: "view",
    inputs: [{ name: "circleId", type: "uint256" }],
    outputs: [
      { name: "roundStart", type: "uint64" },
      { name: "roundLength", type: "uint64" },
      { name: "deadline", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "confidentialReliabilityOf",
    stateMutability: "view",
    inputs: [
      { name: "circleId", type: "uint256" },
      { name: "member", type: "address" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "confidentialStreakOf",
    stateMutability: "view",
    inputs: [
      { name: "circleId", type: "uint256" },
      { name: "member", type: "address" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "confidentialLateCountOf",
    stateMutability: "view",
    inputs: [
      { name: "circleId", type: "uint256" },
      { name: "member", type: "address" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "isReliabilityDecryptableBy",
    stateMutability: "view",
    inputs: [
      { name: "circleId", type: "uint256" },
      { name: "member", type: "address" },
      { name: "viewer", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "CircleCreated",
    inputs: [
      { name: "circleId", type: "uint256", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "memberCount", type: "uint8", indexed: false },
      { name: "roundLength", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PayoutReleased",
    inputs: [
      { name: "circleId", type: "uint256", indexed: true },
      { name: "round", type: "uint32", indexed: true },
      { name: "recipient", type: "address", indexed: true },
    ],
  },
  // Custom errors (so viem can decode reverts into names).
  { type: "error", name: "CircleFull", inputs: [] },
  { type: "error", name: "AlreadyMember", inputs: [] },
  { type: "error", name: "NotAMember", inputs: [] },
  { type: "error", name: "CircleNotActive", inputs: [] },
  { type: "error", name: "AlreadyContributedThisRound", inputs: [] },
  { type: "error", name: "InvalidConfig", inputs: [] },
] as const;

export const IWA_TRUST_GATE_ABI = [
  {
    type: "function",
    name: "evaluate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "circle", type: "address" },
      { name: "circleId", type: "uint256" },
      { name: "threshold", type: "uint32" },
      { name: "grantee", type: "address" },
    ],
    outputs: [{ name: "approved", type: "bytes32" }],
  },
  {
    type: "function",
    name: "confidentialApprovalOf",
    stateMutability: "view",
    inputs: [{ name: "subject", type: "address" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "isApprovalDecryptableBy",
    stateMutability: "view",
    inputs: [
      { name: "subject", type: "address" },
      { name: "viewer", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const CONFIDENTIAL_TOKEN_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint64" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "setOperator",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "until", type: "uint48" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isOperator",
    stateMutability: "view",
    inputs: [
      { name: "holder", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "confidentialBalanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;
