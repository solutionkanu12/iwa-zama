import hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import * as fs from "fs";

/**
 * Live, end-to-end two-wallet proof on Sepolia (NOT the mock).
 *
 * Deployer (wallet A) and a persisted, deployer-funded wallet B both join a
 * circle on the live IwaCircle, fund + operator-authorise the live
 * ConfidentialToken, and each submit one encrypted contribution. The second
 * contribution completes round 0, so the contract auto-releases the payout in
 * that same transaction (no admin call). We then user-decrypt each member's
 * reliability and prove it is non-zero and decryptable ONLY by that member.
 *
 * Robust against the intermittent WSL undici connect timeouts (every network
 * op is retried) and resumable (wallet B key is persisted, joins/operator are
 * idempotent), so a transient failure does not burn the run.
 *
 * Run with:  NODE_OPTIONS=--dns-result-order=ipv4first npx hardhat run \
 *              scripts/liveTwoWallet.ts --network sepolia
 */
const { ethers, fhevm } = hre as any;

const CIRCLE_ADDR = "0xFd4B38Cf46Cf74841634596153fd9F4c8f1eD362";
const TOKEN_ADDR = "0xEE4335082628Cdfa7C07860e919Ce4b0e4DD77FB";
const CIRCLE_ID = BigInt(process.env.CIRCLE_ID || "7");
const MEMBER_COUNT = 2;
const ROUND_LENGTH = 3600n; // 1h on-time window, so both contributions are on time
const OPERATOR_UNTIL = 2_000_000_000; // far-future uint48
const MINT = 1_000_000n;
const CONTRIBUTION = 1_000_000n;
const KEYFILE = "/tmp/iwa_wallet_b.key";
const ES = "https://sepolia.etherscan.io/tx/";

function line() {
  console.log("-".repeat(72));
}

async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 7): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = String((e as Error)?.message || e);
      const transient = /timeout|ETIMEDOUT|ECONNRESET|ENETUNREACH|EAI_AGAIN|UND_ERR|socket hang up|fetch failed|502|503|504|reset/i.test(msg);
      console.log(`  [retry] ${label} attempt ${i}/${tries} failed: ${msg.slice(0, 90)}`);
      if (!transient || i === tries) throw e;
      await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
  throw last;
}

function getWalletB() {
  let key: string;
  if (fs.existsSync(KEYFILE)) {
    key = fs.readFileSync(KEYFILE, "utf8").trim();
  } else {
    key = ethers.Wallet.createRandom().privateKey;
    fs.writeFileSync(KEYFILE, key, { mode: 0o600 });
  }
  return new ethers.Wallet(key, ethers.provider);
}

async function ensureMember(circle: any, wallet: any, isCreator: boolean) {
  const members: string[] = await withRetry("getMembers", () => circle.getMembers(CIRCLE_ID));
  if (members.map((m) => m.toLowerCase()).includes(wallet.address.toLowerCase())) {
    console.log(`  ${wallet.address} already a member, skipping join`);
    return;
  }
  const p = await withRetry("getCircleProgress", () => circle.getCircleProgress(CIRCLE_ID));
  const creating = Number(p.memberCount) === 0 && isCreator;
  const tx = await withRetry("joinCircle", () =>
    creating
      ? circle.connect(wallet).joinCircle(CIRCLE_ID, MEMBER_COUNT, ROUND_LENGTH, TOKEN_ADDR)
      : circle.connect(wallet).joinCircle(CIRCLE_ID, 0, 0, ethers.ZeroAddress),
  );
  await withRetry("join.wait", () => tx.wait());
  console.log(`  ${wallet.address} join${creating ? " (create)" : ""}: ${ES}${tx.hash}`);
}

async function ensureFunded(token: any, funder: any, wallet: any) {
  const mintTx = await withRetry("mint", () => token.connect(funder).mint(wallet.address, MINT));
  await withRetry("mint.wait", () => mintTx.wait());
  const isOp = await withRetry("isOperator", () => token.isOperator(wallet.address, CIRCLE_ADDR));
  let opHash = "(already operator)";
  if (!isOp) {
    const opTx = await withRetry("setOperator", () => token.connect(wallet).setOperator(CIRCLE_ADDR, OPERATOR_UNTIL));
    await withRetry("op.wait", () => opTx.wait());
    opHash = ES + opTx.hash;
  }
  console.log(`  ${wallet.address}: mint ${ES}${mintTx.hash} | operator ${opHash}`);
}

async function contribute(circle: any, wallet: any) {
  return withRetry("contribute", async () => {
    const input = fhevm.createEncryptedInput(CIRCLE_ADDR, wallet.address);
    input.add64(CONTRIBUTION);
    const enc = await input.encrypt();
    const tx = await circle.connect(wallet).contribute(CIRCLE_ID, enc.handles[0], enc.inputProof);
    const receipt = await tx.wait();
    return { hash: tx.hash, receipt };
  });
}

async function decReliability(circle: any, wallet: any): Promise<bigint> {
  const handle = await withRetry("relHandle", () => circle.confidentialReliabilityOf(CIRCLE_ID, wallet.address));
  return withRetry("userDecrypt", () => fhevm.userDecryptEuint(FhevmType.euint32, handle, CIRCLE_ADDR, wallet));
}

async function main() {
  await withRetry("initializeCLIApi", () => fhevm.initializeCLIApi());
  const net = await withRetry("getNetwork", () => ethers.provider.getNetwork());
  console.log("Network:", hre.network.name, "chainId:", net.chainId.toString(), "| fhevm.isMock:", fhevm.isMock);
  if (fhevm.isMock) throw new Error("Refusing to run: must run against the real Sepolia coprocessor, not the mock.");
  console.log("Circle id:", CIRCLE_ID.toString());

  const [walletA] = await ethers.getSigners();
  const walletB = getWalletB();
  console.log("Wallet A (deployer):", walletA.address);
  console.log("Wallet B (persisted:", KEYFILE + "):", walletB.address);

  const circle = await ethers.getContractAt("IwaCircle", CIRCLE_ADDR);
  const token = await ethers.getContractAt("ConfidentialToken", TOKEN_ADDR);

  line();
  console.log("STEP 1 — ensure wallet B has gas ETH");
  const bBal = await withRetry("balanceB", () => ethers.provider.getBalance(walletB.address));
  if (bBal < ethers.parseEther("0.02")) {
    const fundTx = await withRetry("fundB", () => walletA.sendTransaction({ to: walletB.address, value: ethers.parseEther("0.08") }));
    await withRetry("fundB.wait", () => fundTx.wait());
    console.log("  fund tx:", ES + fundTx.hash);
  }
  console.log("  wallet B balance:", ethers.formatEther(await withRetry("balB2", () => ethers.provider.getBalance(walletB.address))), "ETH");

  line();
  console.log("STEP 2 — both wallets join the circle (A creates, B fills -> active)");
  await ensureMember(circle, walletA, true);
  await ensureMember(circle, walletB, false);
  const afterJoin = await withRetry("progress", () => circle.getCircleProgress(CIRCLE_ID));
  const members: string[] = await withRetry("members", () => circle.getMembers(CIRCLE_ID));
  console.log("  progress -> memberCount:", Number(afterJoin.memberCount), "active:", afterJoin.active);
  console.log("  roster:", members);

  line();
  console.log("STEP 3 — fund both on the ConfidentialToken and authorise the circle as operator");
  await ensureFunded(token, walletA, walletA);
  await ensureFunded(token, walletA, walletB);

  line();
  console.log("STEP 4 — each member submits ONE encrypted contribution");
  const roundBefore = Number((await withRetry("p", () => circle.getCircleProgress(CIRCLE_ID))).currentRound);
  let cA: any = { hash: "(already contributed)" };
  let cB: any = { hash: "(already contributed)", receipt: null };
  if (!(await withRetry("hasA", () => circle.hasContributedThisRound(CIRCLE_ID, walletA.address)))) {
    cA = await contribute(circle, walletA);
  }
  console.log("  A contribute:", typeof cA.hash === "string" && cA.hash.startsWith("0x") ? ES + cA.hash : cA.hash);
  if (!(await withRetry("hasB", () => circle.hasContributedThisRound(CIRCLE_ID, walletB.address)))) {
    cB = await contribute(circle, walletB);
  }
  console.log("  B contribute (completes round " + roundBefore + "):", typeof cB.hash === "string" && cB.hash.startsWith("0x") ? ES + cB.hash : cB.hash);

  line();
  console.log("STEP 5 — prove the payout auto-released inside B's contribute tx (no admin call)");
  let payoutRecipient = "(not captured)";
  if (cB.receipt) {
    const payoutLogs = cB.receipt.logs
      .map((l: any) => {
        try {
          return circle.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .filter((p: any) => p && p.name === "PayoutReleased");
    for (const p of payoutLogs) {
      payoutRecipient = p.args.recipient;
      console.log(
        `  PayoutReleased inside tx ${cB.hash}: round ${p.args.round} -> recipient ${p.args.recipient}` +
          (p.args.recipient.toLowerCase() === members[0].toLowerCase() ? "  (== members[0], the round-0 recipient)" : ""),
      );
    }
    if (payoutLogs.length === 0) console.log("  WARNING: no PayoutReleased log found in B's contribute receipt");
  }
  const afterPay = await withRetry("afterPay", () => circle.getCircleProgress(CIRCLE_ID));
  console.log(
    "  progress -> currentRound:",
    Number(afterPay.currentRound),
    "roundsCompleted:",
    Number(afterPay.roundsCompleted),
    "contributionsThisRound:",
    Number(afterPay.contributionsThisRound),
    "active:",
    afterPay.active,
  );

  line();
  console.log("STEP 6 — each member decrypts their OWN reliability (must be non-zero)");
  const relA = await decReliability(circle, walletA);
  const relB = await decReliability(circle, walletB);
  console.log("  wallet A reliability (decrypted by A):", relA.toString());
  console.log("  wallet B reliability (decrypted by B):", relB.toString());

  line();
  console.log("STEP 7 — prove member-only privacy: the OTHER member cannot decrypt it");
  const aclAA = await withRetry("aclAA", () => circle.isReliabilityDecryptableBy(CIRCLE_ID, walletA.address, walletA.address));
  const aclAB = await withRetry("aclAB", () => circle.isReliabilityDecryptableBy(CIRCLE_ID, walletA.address, walletB.address));
  console.log("  on-chain ACL isReliabilityDecryptableBy(A, byA):", aclAA, "(expect true)");
  console.log("  on-chain ACL isReliabilityDecryptableBy(A, byB):", aclAB, "(expect false)");

  let denied = false;
  let errMsg = "";
  try {
    const aHandle = await circle.confidentialReliabilityOf(CIRCLE_ID, walletA.address);
    // Wallet B attempts to decrypt wallet A's reliability. This is an ACL denial,
    // not a transient error, so it is NOT retried.
    await fhevm.userDecryptEuint(FhevmType.euint32, aHandle, CIRCLE_ADDR, walletB);
  } catch (e) {
    denied = true;
    errMsg = String((e as Error).message).split("\n")[0].slice(0, 140);
  }
  console.log("  wallet B attempt to decrypt wallet A's reliability -> denied:", denied);
  if (denied) console.log("    (rejected with:", errMsg, ")");

  line();
  console.log("RESULT SUMMARY");
  console.log(
    JSON.stringify(
      {
        network: "sepolia",
        circle: CIRCLE_ADDR,
        token: TOKEN_ADDR,
        circleId: Number(CIRCLE_ID),
        walletA: walletA.address,
        walletB: walletB.address,
        txns: {
          joinRoster: members,
          contributeA: cA.hash,
          contributeB_withAutoPayout: cB.hash,
        },
        autoPayoutRecipient: payoutRecipient,
        roundsCompleted: Number(afterPay.roundsCompleted),
        reliability: { walletA_byA: relA.toString(), walletB_byB: relB.toString() },
        aclA_memberOnly: { decryptableByA: aclAA, decryptableByB: aclAB },
        crossMemberDecryptDenied: denied,
      },
      null,
      2,
    ),
  );

  if (relA === 0n || relB === 0n) throw new Error("reliability must be non-zero for on-time members");
  if (aclAA !== true || aclAB !== false) throw new Error("ACL must permit only the member");
  if (!denied) throw new Error("cross-member decryption must be denied");
  if (Number(afterPay.roundsCompleted) < 1) throw new Error("round must have completed");
  console.log("\nAll live assertions passed on Sepolia.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
