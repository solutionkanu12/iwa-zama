import { ethers, network } from "hardhat";

/**
 * Deploys a fresh ConfidentialToken (ERC-7984 test fixture, the same contract
 * IwaCircle's tests use) to Sepolia and reports its address. Also probes a few
 * circle ids on the deployed IwaCircle so we can point the demo at a circle id
 * that is still free, then create it against this token from the frontend.
 */
const IWA_CIRCLE = "0xFd4B38Cf46Cf74841634596153fd9F4c8f1eD362";

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  console.log("Network:", network.name, "chainId:", net.chainId.toString());
  console.log("Deployer:", deployer.address);
  console.log("Balance (ETH):", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  const Token = await ethers.getContractFactory("ConfidentialToken");
  const token = await Token.deploy("Iwa Demo Token", "IWA", "");
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log("\nConfidentialToken deployed to:", tokenAddr);
  console.log("  deploy tx:", token.deploymentTransaction()?.hash);

  const code = await ethers.provider.getCode(tokenAddr);
  console.log("  on-chain code size (bytes):", (code.length - 2) / 2);

  // Probe which demo circle ids are still free on the live IwaCircle.
  const circle = await ethers.getContractAt("IwaCircle", IWA_CIRCLE);
  console.log("\nCircle id occupancy on live IwaCircle:");
  for (const id of [1, 2, 3, 4]) {
    try {
      const p = await circle.getCircleProgress(id);
      const memberCount = Number(p[0]);
      console.log(`  circle ${id}: memberCount=${memberCount} ${memberCount === 0 ? "(FREE)" : "(exists)"}`);
    } catch (e) {
      console.log(`  circle ${id}: read failed`, (e as Error).message);
    }
  }

  console.log("\n=== RESULT (Sepolia, chainId 11155111) ===");
  console.log("ConfidentialToken:", tokenAddr);
  console.log("Etherscan: https://sepolia.etherscan.io/address/" + tokenAddr);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
