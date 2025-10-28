const hre = require("hardhat");

async function main() {
  console.log("Deploying contracts...");

  // First, deploy the PythagoreanBondingCurve library
  console.log("Deploying PythagoreanBondingCurve library...");
  const PythagoreanBondingCurve = await hre.ethers.deployContract("PythagoreanBondingCurve");
  await PythagoreanBondingCurve.waitForDeployment();
  console.log(`PythagoreanBondingCurve deployed to: ${PythagoreanBondingCurve.target}`);

  // Base URI for ERC1155 token metadata
  const baseURI = "https://api.pnp-protocol.io/metadata/";

  // Deploy PNPFactory contract with the library link
  console.log("Deploying PNPFactory contract...");
  const PNPFactory = await hre.ethers.deployContract("PNPFactory", [baseURI], {
    libraries: {
      PythagoreanBondingCurve: PythagoreanBondingCurve.target
    }
  });
  
  await PNPFactory.waitForDeployment();

  console.log(`PNPFactory deployed to: ${PNPFactory.target}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
