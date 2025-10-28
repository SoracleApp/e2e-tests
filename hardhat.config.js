require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.20",
      },
      {
        version: "0.8.22",
      }
    ]
  },
  networks: {
    anvil: {
      url: "127.0.0.1:8545", // Anvil default RPC
      chainId: 31337, // Anvil default chainId
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
};
