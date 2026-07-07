import { expect } from "chai";
import hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const { ethers, fhevm } = hre as any;

const OPERATOR_UNTIL = 2_000_000_000; // far-future uint48 timestamp
const MINT = 1_000_000n;
const CONTRIBUTION = 100n;

async function deploy() {
  const signers = await ethers.getSigners();
  const [deployer, m0, m1, m2] = signers;

  const Token = await ethers.getContractFactory("ConfidentialToken");
  const token = await Token.deploy("Iwa Test Token", "IWT", "");
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();

  const Circle = await ethers.getContractFactory("IwaCircle");
  const circle = await Circle.deploy();
  await circle.waitForDeployment();
  const circleAddr = await circle.getAddress();

  // Fund members and authorise the circle as operator on the token.
  for (const m of [m0, m1, m2]) {
    await token.mint(m.address, MINT);
    await token.connect(m).setOperator(circleAddr, OPERATOR_UNTIL);
  }

  return { deployer, m0, m1, m2, token, tokenAddr, circle, circleAddr };
}

async function contribute(circle: any, circleAddr: string, member: any, circleId: bigint, amount: bigint) {
  const input = fhevm.createEncryptedInput(circleAddr, member.address);
  input.add64(amount);
  const enc = await input.encrypt();
  return circle.connect(member).contribute(circleId, enc.handles[0], enc.inputProof);
}

async function decBalance(token: any, tokenAddr: string, holder: any): Promise<bigint> {
  const handle = await token.confidentialBalanceOf(holder.address);
  return fhevm.userDecryptEuint(FhevmType.euint64, handle, tokenAddr, holder);
}

async function decReliability(circle: any, circleAddr: string, circleId: bigint, member: any): Promise<bigint> {
  const handle = await circle.confidentialReliabilityOf(circleId, member.address);
  return fhevm.userDecryptEuint(FhevmType.euint32, handle, circleAddr, member);
}

async function decStreak(circle: any, circleAddr: string, circleId: bigint, member: any): Promise<bigint> {
  const handle = await circle.confidentialStreakOf(circleId, member.address);
  return fhevm.userDecryptEuint(FhevmType.euint32, handle, circleAddr, member);
}

async function decLate(circle: any, circleAddr: string, circleId: bigint, member: any): Promise<bigint> {
  const handle = await circle.confidentialLateCountOf(circleId, member.address);
  return fhevm.userDecryptEuint(FhevmType.euint32, handle, circleAddr, member);
}

describe("IwaCircle", function () {
  before(function () {
    if (!fhevm || !fhevm.isMock) {
      this.skip(); // these tests require the in-process FHEVM mock coprocessor
    }
  });

  it("lets members create and join a circle, activating it once full", async () => {
    const { m0, m1, m2, tokenAddr, circle, circleAddr } = await deploy();
    const id = 1n;

    await circle.connect(m0).joinCircle(id, 3, 3600, tokenAddr); // create
    await circle.connect(m1).joinCircle(id, 0, 0, ethers.ZeroAddress); // join (config ignored)

    let p = await circle.getCircleProgress(id);
    expect(p.memberCount).to.eq(3);
    expect(p.active).to.eq(false); // not full yet

    await circle.connect(m2).joinCircle(id, 0, 0, ethers.ZeroAddress); // join -> full
    p = await circle.getCircleProgress(id);
    expect(p.active).to.eq(true);

    const members = await circle.getMembers(id);
    expect(members).to.deep.eq([m0.address, m1.address, m2.address]);
  });

  it("rejects double-join and joining a full circle", async () => {
    const { m0, m1, m2, deployer, tokenAddr, circle } = await deploy();
    const id = 10n;
    await circle.connect(m0).joinCircle(id, 3, 3600, tokenAddr);
    await expect(circle.connect(m0).joinCircle(id, 0, 0, ethers.ZeroAddress)).to.be.reverted; // already member
    await circle.connect(m1).joinCircle(id, 0, 0, ethers.ZeroAddress);
    await circle.connect(m2).joinCircle(id, 0, 0, ethers.ZeroAddress); // full
    await expect(circle.connect(deployer).joinCircle(id, 0, 0, ethers.ZeroAddress)).to.be.reverted; // full
  });

  it("full lifecycle: on-time contributions, automatic rotating payouts, and member-only reliability", async () => {
    const { m0, m1, m2, token, tokenAddr, circle, circleAddr } = await deploy();
    const id = 3n;
    const members = [m0, m1, m2];

    await circle.connect(m0).joinCircle(id, 3, 3600, tokenAddr);
    await circle.connect(m1).joinCircle(id, 0, 0, ethers.ZeroAddress);
    await circle.connect(m2).joinCircle(id, 0, 0, ethers.ZeroAddress);

    for (let round = 0; round < 3; round++) {
      // First N-1 contributions do not trigger payout.
      await contribute(circle, circleAddr, members[0], id, CONTRIBUTION);
      await contribute(circle, circleAddr, members[1], id, CONTRIBUTION);
      // Final contribution completes the round and MUST auto-release payout in the same tx.
      const tx = await contribute(circle, circleAddr, members[2], id, CONTRIBUTION);
      const receipt = await tx.wait();
      const payoutLog = receipt!.logs
        .map((l: any) => {
          try {
            return circle.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((p: any) => p && p.name === "PayoutReleased");
      expect(payoutLog, "payout must fire automatically inside contribute()").to.not.eq(undefined);
      expect(payoutLog.args.recipient).to.eq(members[round].address); // rotating recipient
    }

    const p = await circle.getCircleProgress(id);
    expect(p.roundsCompleted).to.eq(3);
    expect(p.completed).to.eq(true);
    expect(p.active).to.eq(false);

    // Net token flow is zero for everyone (each paid 300, received 300).
    for (const m of members) {
      expect(await decBalance(token, tokenAddr, m)).to.eq(MINT);
    }

    // Every member contributed on time in all 3 rounds.
    for (const m of members) {
      expect(await decReliability(circle, circleAddr, id, m)).to.eq(3n);
      expect(await decStreak(circle, circleAddr, id, m)).to.eq(3n);
      expect(await decLate(circle, circleAddr, id, m)).to.eq(0n);
    }
  });

  it("keeps each member's reliability decryptable ONLY by that member (not by others)", async () => {
    const { deployer, m0, m1, m2, tokenAddr, circle, circleAddr } = await deploy();
    const id = 4n;
    const members = [m0, m1, m2];

    await circle.connect(m0).joinCircle(id, 3, 3600, tokenAddr);
    await circle.connect(m1).joinCircle(id, 0, 0, ethers.ZeroAddress);
    await circle.connect(m2).joinCircle(id, 0, 0, ethers.ZeroAddress);

    await contribute(circle, circleAddr, members[0], id, CONTRIBUTION);
    await contribute(circle, circleAddr, members[1], id, CONTRIBUTION);
    await contribute(circle, circleAddr, members[2], id, CONTRIBUTION);

    // m0 can decrypt their own reliability.
    expect(await decReliability(circle, circleAddr, id, m0)).to.eq(1n);

    // On-chain ACL: only the member is permitted to decrypt their own reliability.
    expect(await circle.isReliabilityDecryptableBy(id, m0.address, m0.address)).to.eq(true);
    expect(await circle.isReliabilityDecryptableBy(id, m0.address, m1.address)).to.eq(false);
    expect(await circle.isReliabilityDecryptableBy(id, m0.address, m2.address)).to.eq(false);
    expect(await circle.isReliabilityDecryptableBy(id, m0.address, deployer.address)).to.eq(false);

    // And an actual user-decryption attempt by a non-owner is rejected by the coprocessor ACL.
    const m0Handle = await circle.confidentialReliabilityOf(id, m0.address);
    let denied = false;
    try {
      await fhevm.userDecryptEuint(FhevmType.euint32, m0Handle, circleAddr, m1);
    } catch {
      denied = true;
    }
    expect(denied, "a non-owner must not be able to decrypt another member's reliability").to.eq(true);
  });

  it("still auto-pays when a member contributes LATE, and does not credit them an on-time point", async () => {
    const { m0, m1, token, tokenAddr, circle, circleAddr } = await deploy();
    const id = 5n;

    await circle.connect(m0).joinCircle(id, 2, 3600, tokenAddr); // 2-member circle
    await circle.connect(m1).joinCircle(id, 0, 0, ethers.ZeroAddress);

    // m0 contributes on time.
    await contribute(circle, circleAddr, m0, id, CONTRIBUTION);

    // Move past the round deadline, then m1 contributes late (this completes the round).
    await time.increase(3601);
    const tx = await contribute(circle, circleAddr, m1, id, CONTRIBUTION);
    const receipt = await tx.wait();
    const paid = receipt!.logs
      .map((l: any) => {
        try {
          return circle.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .some((p: any) => p && p.name === "PayoutReleased");
    expect(paid, "payout still auto-releases even when the completing contribution is late").to.eq(true);

    // m0 was on time -> reliability 1, late 0. m1 was late -> reliability 0, late 1, streak 0.
    expect(await decReliability(circle, circleAddr, id, m0)).to.eq(1n);
    expect(await decLate(circle, circleAddr, id, m0)).to.eq(0n);
    expect(await decReliability(circle, circleAddr, id, m1)).to.eq(0n);
    expect(await decLate(circle, circleAddr, id, m1)).to.eq(1n);
    expect(await decStreak(circle, circleAddr, id, m1)).to.eq(0n);

    // Round 0 recipient is members[0] = m0; pot was 200.
    expect(await decBalance(token, tokenAddr, m0)).to.eq(MINT - CONTRIBUTION + 2n * CONTRIBUTION);
  });
});
