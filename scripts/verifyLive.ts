import { ethers } from "hardhat";

const TARGETS: Record<string, string> = {
  IwaCircle: "0x6873600208829a7AF5df198b6Bf51433A266baB8",
  IwaTrustGate: "0x7C494731cCb9bbEE76D60ECee45A08324e0Ca380",
};

async function main() {
  for (const [name, addr] of Object.entries(TARGETS)) {
    const code = await ethers.provider.getCode(addr);
    const live = code !== "0x";
    console.log(`${name} @ ${addr}`);
    console.log(`  live on-chain: ${live}  (code size: ${(code.length - 2) / 2} bytes)`);
    console.log(`  etherscan: https://sepolia.etherscan.io/address/${addr}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
