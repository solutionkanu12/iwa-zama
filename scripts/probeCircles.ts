import { ethers } from "hardhat";

// Compare the two IwaCircle addresses in play: which one exposes the phase-3
// views (getRoundTiming, hasContributedThisRound) that the frontend calls.
const CANDIDATES: Record<string, string> = {
  "doc/README (0x6873)": "0x6873600208829a7AF5df198b6Bf51433A266baB8",
  "frontend config (0xFd4B)": "0xFd4B38Cf46Cf74841634596153fd9F4c8f1eD362",
};

async function main() {
  const [me] = await ethers.getSigners();
  for (const [label, addr] of Object.entries(CANDIDATES)) {
    console.log(`\n${label}  ${addr}`);
    const code = await ethers.provider.getCode(addr);
    console.log("  code bytes:", (code.length - 2) / 2);
    const c = await ethers.getContractAt("IwaCircle", addr);
    try {
      const p = await c.getCircleProgress(1);
      console.log("  getCircleProgress(1): memberCount", Number(p[0]), "active", p[4]);
    } catch (e) {
      console.log("  getCircleProgress reverted:", (e as Error).message.slice(0, 60));
    }
    try {
      const t = await c.getRoundTiming(1);
      console.log("  getRoundTiming(1): OK ->", t.map((x: bigint) => x.toString()).join(","));
    } catch {
      console.log("  getRoundTiming: NOT PRESENT (older deploy)");
    }
    try {
      const h = await c.hasContributedThisRound(1, me.address);
      console.log("  hasContributedThisRound(1, me): OK ->", h);
    } catch {
      console.log("  hasContributedThisRound: NOT PRESENT (older deploy)");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
