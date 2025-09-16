import { HardhatUserConfig } from "hardhat/config";
import { expect } from "chai";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-contract-sizer";
import "hardhat-gas-reporter";
import "@typechain/hardhat";
import dotenv from "dotenv";

dotenv.config();

(function safeInitChaiShot() {
  // we need that function because "@cloudwalk/chainshot" is an optional dependency
  // and we want to avoid errors if it's not installed
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { chainShotHardhatPlugin } = require("@cloudwalk/chainshot") as typeof import("@cloudwalk/chainshot");
    chainShotHardhatPlugin();
  } catch {
    async function noop() {
      return;
    }
    expect.startScenario = noop;
    expect.endScenario = noop;
  }
})();

const config: HardhatUserConfig = {
  solidity: {
    version: process.env.SOLIDITY_VERSION ?? "",
    settings: {
      optimizer: {
        enabled: process.env.OPTIMIZER_ENABLED === "true",
        runs: Number(process.env.OPTIMIZER_RUNS),
      },
    },
  },
  networks: {
    hardhat: {
      accounts: {
        mnemonic: process.env.HARDHAT_MNEMONIC,
      },
    },
    ganache: {
      url: process.env.GANACHE_RPC,
      accounts: {
        mnemonic: process.env.GANACHE_MNEMONIC,
      },
    },
    cw_testnet: {
      url: process.env.CW_TESTNET_RPC,
      accounts: process.env.CW_TESTNET_PK
        ? [process.env.CW_TESTNET_PK]
        : {
            mnemonic: process.env.CW_TESTNET_MNEMONIC ?? "",
          },
    },
    cw_mainnet: {
      url: process.env.CW_MAINNET_RPC,
      accounts: process.env.CW_MAINNET_PK
        ? [process.env.CW_MAINNET_PK]
        : {
            mnemonic: process.env.CW_MAINNET_MNEMONIC ?? "",
          },
    },
  },
  gasReporter: {
    enabled: process.env.GAS_REPORTER_ENABLED === "true",
  },
  contractSizer: {
    runOnCompile: process.env.CONTRACT_SIZER_ENABLED === "true",
  },
};

export default config;
