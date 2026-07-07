import { ethers, network } from "hardhat";

/**
 * Deploys IwaCircle and IwaTrustGate to the configured network (Sepolia).
 * Both use ZamaEthereumConfig, which selects the correct coprocessor addresses
 * automatically from the chain id.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  console.log("Network:", network.name, "chainId:", net.chainId.toString());
  console.log("Deployer:", deployer.address);
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance (ETH):", ethers.formatEther(bal));

  const Circle = await ethers.getContractFactory("IwaCircle");
  const circle = await Circle.deploy();
  await circle.waitForDeployment();
  const circleAddr = await circle.getAddress();
  console.log("IwaCircle deployed to:", circleAddr);
  console.log("  deploy tx:", circle.deploymentTransaction()?.hash);

  const Gate = await ethers.getContractFactory("IwaTrustGate");
  const gate = await Gate.deploy();
  await gate.waitForDeployment();
  const gateAddr = await gate.getAddress();
  console.log("IwaTrustGate deployed to:", gateAddr);
  console.log("  deploy tx:", gate.deploymentTransaction()?.hash);

  // On-chain liveness check: confirm bytecode is present at each address.
  const circleCode = await ethers.provider.getCode(circleAddr);
  const gateCode = await ethers.provider.getCode(gateAddr);
  console.log("IwaCircle on-chain code size (bytes):", (circleCode.length - 2) / 2);
  console.log("IwaTrustGate on-chain code size (bytes):", (gateCode.length - 2) / 2);

  console.log("\nEtherscan:");
  console.log("  IwaCircle:    https://sepolia.etherscan.io/address/" + circleAddr);
  console.log("  IwaTrustGate: https://sepolia.etherscan.io/address/" + gateAddr);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
