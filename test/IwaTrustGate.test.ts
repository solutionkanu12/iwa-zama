import { expect } from "chai";
import hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const { ethers, fhevm } = hre as any;

const OPERATOR_UNTIL = 2_000_000_000;
const MINT = 1_000_000n;
const CONTRIBUTION = 100n;
const ROUND_LENGTH = 3600;

async function setup() {
  const [deployer, m0, m1, outsider, lender] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("ConfidentialToken");
  const token = await Token.deploy("Iwa Test Token", "IWT", "");
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();

  const Circle = await ethers.getContractFactory("IwaCircle");
  const circle = await Circle.deploy();
  await circle.waitForDeployment();
  const circleAddr = await circle.getAddress();

  const Gate = await ethers.getContractFactory("IwaTrustGate");
  const gate = await Gate.deploy();
  await gate.waitForDeployment();
  const gateAddr = await gate.getAddress();

  for (const m of [m0, m1]) {
    await token.mint(m.address, MINT);
    await token.connect(m).setOperator(circleAddr, OPERATOR_UNTIL);
  }

  return { deployer, m0, m1, outsider, lender, token, tokenAddr, circle, circleAddr, gate, gateAddr };
}

async function contribute(circle: any, circleAddr: string, member: any, id: bigint, amount: bigint) {
  const input = fhevm.createEncryptedInput(circleAddr, member.address);
  input.add64(amount);
  const enc = await input.encrypt();
  return circle.connect(member).contribute(id, enc.handles[0], enc.inputProof);
}

async function decReliability(circle: any, circleAddr: string, id: bigint, member: any): Promise<bigint> {
  const handle = await circle.confidentialReliabilityOf(id, member.address);
  return fhevm.userDecryptEuint(FhevmType.euint32, handle, circleAddr, member);
}

async function decApproval(gate: any, gateAddr: string, subject: any, viewer: any): Promise<boolean> {
  const handle = await gate.confidentialApprovalOf(subject.address);
  return fhevm.userDecryptEbool(handle, gateAddr, viewer);
}

/**
 * Drive a 2-member circle so that m0 finishes with reliability 2 and m1 with reliability 1.
 * Round 0: both on time. Round 1: m0 on time, m1 late (no on-time credit).
 */
async function buildReliabilityState(ctx: any, id: bigint) {
  const { circle, circleAddr, m0, m1, tokenAddr } = ctx;
  await circle.connect(m0).joinCircle(id, 2, ROUND_LENGTH, tokenAddr);
  await circle.connect(m1).joinCircle(id, 0, 0, ethers.ZeroAddress); // full -> active

  // Round 0 - both on time.
  await contribute(circle, circleAddr, m0, id, CONTRIBUTION); // relm0 = 1
  await contribute(circle, circleAddr, m1, id, CONTRIBUTION); // relm1 = 1, round completes

  // Round 1 - m0 on time, m1 late.
  await contribute(circle, circleAddr, m0, id, CONTRIBUTION); // relm0 = 2
  await time.increase(ROUND_LENGTH + 1);
  await contribute(circle, circleAddr, m1, id, CONTRIBUTION); // relm1 stays 1 (late), round completes
}

describe("IwaTrustGate", function () {
  before(function () {
    if (!fhevm || !fhevm.isMock) this.skip();
  });

  it("sanity: the circle produces the expected encrypted reliability scores", async () => {
    const ctx = await setup();
    const id = 1n;
    await buildReliabilityState(ctx, id);

    expect(await decReliability(ctx.circle, ctx.circleAddr, id, ctx.m0)).to.eq(2n);
    expect(await decReliability(ctx.circle, ctx.circleAddr, id, ctx.m1)).to.eq(1n);
  });

  it("performs a cross-contract encrypted read gated by the FHE ACL (no manual value submission)", async () => {
    const ctx = await setup();
    const { circle, circleAddr, gate, gateAddr, m0 } = ctx;
    const id = 2n;
    await buildReliabilityState(ctx, id);

    // Before authorization, the gate contract is NOT permitted to touch m0's reliability handle.
    expect(await circle.isReliabilityDecryptableBy(id, m0.address, gateAddr)).to.eq(false);

    // The member authorizes the gate via the ACL (this is a permission grant, not a decryption).
    await circle.connect(m0).grantReliabilityAccess(id, gateAddr);
    expect(await circle.isReliabilityDecryptableBy(id, m0.address, gateAddr)).to.eq(true);

    // The gate reads IwaCircle's real on-chain ciphertext and evaluates it — m0 never re-submits a value.
    await gate.connect(m0).evaluate(circleAddr, id, 2, ctx.lender.address);
    expect(await gate.isApprovalDecryptableBy(m0.address, m0.address)).to.eq(true);
  });

  it("compares against the threshold entirely in encrypted space (member ABOVE threshold => true)", async () => {
    const ctx = await setup();
    const { circle, circleAddr, gate, gateAddr, m0, lender } = ctx;
    const id = 3n;
    await buildReliabilityState(ctx, id); // relm0 = 2

    await circle.connect(m0).grantReliabilityAccess(id, gateAddr);
    await gate.connect(m0).evaluate(circleAddr, id, 2, lender.address); // 2 >= 2

    expect(await decApproval(gate, gateAddr, m0, lender)).to.eq(true); // lender decrypts
    expect(await decApproval(gate, gateAddr, m0, m0)).to.eq(true); // member decrypts
  });

  it("compares against the threshold entirely in encrypted space (member BELOW threshold => false)", async () => {
    const ctx = await setup();
    const { circle, circleAddr, gate, gateAddr, m1, lender } = ctx;
    const id = 4n;
    await buildReliabilityState(ctx, id); // relm1 = 1

    await circle.connect(m1).grantReliabilityAccess(id, gateAddr);
    await gate.connect(m1).evaluate(circleAddr, id, 2, lender.address); // 1 >= 2 -> false

    expect(await decApproval(gate, gateAddr, m1, lender)).to.eq(false);
  });

  it("keeps the encrypted approval inaccessible to anyone not explicitly granted", async () => {
    const ctx = await setup();
    const { circle, circleAddr, gate, gateAddr, m0, lender, outsider, deployer } = ctx;
    const id = 5n;
    await buildReliabilityState(ctx, id);

    await circle.connect(m0).grantReliabilityAccess(id, gateAddr);
    await gate.connect(m0).evaluate(circleAddr, id, 2, lender.address);

    // ACL: only the member and the designated lender may decrypt the approval.
    expect(await gate.isApprovalDecryptableBy(m0.address, m0.address)).to.eq(true);
    expect(await gate.isApprovalDecryptableBy(m0.address, lender.address)).to.eq(true);
    expect(await gate.isApprovalDecryptableBy(m0.address, outsider.address)).to.eq(false);
    expect(await gate.isApprovalDecryptableBy(m0.address, deployer.address)).to.eq(false);

    // A non-granted party cannot user-decrypt the approval.
    const handle = await gate.confidentialApprovalOf(m0.address);
    let denied = false;
    try {
      await fhevm.userDecryptEbool(handle, gateAddr, outsider);
    } catch {
      denied = true;
    }
    expect(denied, "an ungranted party must not be able to decrypt the approval").to.eq(true);
  });
});
