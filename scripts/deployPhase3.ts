import { ethers, network } from "hardhat";

/**
 * Phase 3 deploy: a ConfidentialToken (ERC-7984) as the contribution/payout rail,
 * and a redeployed IwaCircle (now with hasContributedThisRound + getRoundTiming views).
 * The existing IwaTrustGate is reused as-is because its evaluate() takes the circle
 * address as a parameter.
 */
const EXISTING_TRUST_GATE = "0x7C494731cCb9bbEE76D60ECee45A08324e0Ca380";

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
  console.log("ConfidentialToken deployed to:", tokenAddr);

  const Circle = await ethers.getContractFactory("IwaCircle");
  const circle = await Circle.deploy();
  await circle.waitForDeployment();
  const circleAddr = await circle.getAddress();
  console.log("IwaCircle (with new views) deployed to:", circleAddr);

  const circleCode = await ethers.provider.getCode(circleAddr);
  const tokenCode = await ethers.provider.getCode(tokenAddr);
  console.log("IwaCircle code size:", (circleCode.length - 2) / 2, "bytes");
  console.log("ConfidentialToken code size:", (tokenCode.length - 2) / 2, "bytes");

  console.log("\n=== ADDRESSES (Sepolia, chainId 11155111) ===");
  console.log("ConfidentialToken:", tokenAddr);
  console.log("IwaCircle:        ", circleAddr);
  console.log("IwaTrustGate:     ", EXISTING_TRUST_GATE, "(reused)");
  console.log("\nEtherscan:");
  console.log("  token:  https://sepolia.etherscan.io/address/" + tokenAddr);
  console.log("  circle: https://sepolia.etherscan.io/address/" + circleAddr);
  console.log("  gate:   https://sepolia.etherscan.io/address/" + EXISTING_TRUST_GATE);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
