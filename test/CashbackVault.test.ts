import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory, TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { checkContractUupsUpgrading, connect, getAddress, proveTx } from "../test-utils/eth";
import { CashbackVault__factory, CashbackVault, ERC20TokenMock, ERC20TokenMock__factory } from "../typechain-types";

const ADDRESS_ZERO = ethers.ZeroAddress;
const ALLOWANCE_MAX = ethers.MaxUint256;
const BALANCE_INITIAL = 1000_000_000_000n;

const OWNER_ROLE: string = ethers.id("OWNER_ROLE");
const GRANTOR_ROLE: string = ethers.id("GRANTOR_ROLE");
const PAUSER_ROLE: string = ethers.id("PAUSER_ROLE");
const RESCUER_ROLE: string = ethers.id("RESCUER_ROLE");
const MANAGER_ROLE: string = ethers.id("MANAGER_ROLE");
const CPP_ROLE: string = ethers.id("CPP_ROLE");

const EXPECTED_VERSION: Version = {
  major: 1n,
  minor: 0n,
  patch: 0n
};

interface Version {
  major: number;
  minor: number;
  patch: number;

  [key: string]: number; // Indexing signature to ensure that fields are iterated over in a key-value style
}

describe("Contracts 'CashbackVault'", async () => {
  let cashbackVaultFactory: CashbackVault__factory;

  let deployer: HardhatEthersSigner;
  let manager: HardhatEthersSigner;
  let cpp: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let users: HardhatEthersSigner[];

  before(async () => {
    let moreUsers: HardhatEthersSigner[];
    [deployer, manager, cpp, user, ...moreUsers] = await ethers.getSigners();
    users = [user, ...moreUsers];

    // The contract factories with the explicitly specified deployer account
    cashbackVaultFactory = await ethers.getContractFactory("CashbackVault");
    cashbackVaultFactory = cashbackVaultFactory.connect(deployer);
  });
  async function deployTokenMock() {
    const name = "ERC20 Test";
    const symbol = "TEST";

    // The token contract factory with the explicitly specified deployer account
    let tokenMockFactory = await ethers.getContractFactory("ERC20TokenMock");
    tokenMockFactory = tokenMockFactory.connect(deployer);

    // The token contract with the explicitly specified initial account
    const tokenMockDeployment = await tokenMockFactory.deploy(name, symbol);
    await tokenMockDeployment.waitForDeployment();

    return tokenMockDeployment.connect(deployer);
  }
  async function deployContracts() {
    const tokenMock = await deployTokenMock();
    const cashbackVault = await upgrades.deployProxy(cashbackVaultFactory, [await tokenMock.getAddress()]);
    await cashbackVault.waitForDeployment();

    return { cashbackVault, tokenMock };
  }
  it("should deploy the contract", async () => {
    const { cashbackVault } = await deployContracts();

    expect(await cashbackVault.$__VERSION()).to.deep.equal([EXPECTED_VERSION.major,
      EXPECTED_VERSION.minor,
      EXPECTED_VERSION.patch]);
  });
});
