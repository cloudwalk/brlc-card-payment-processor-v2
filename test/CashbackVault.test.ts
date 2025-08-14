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
const CASHBACK_GRANTOR_ROLE: string = ethers.id("CASHBACK_GRANTOR_ROLE");

const EXPECTED_VERSION: Version = {
  major: 1n,
  minor: 0n,
  patch: 0n
};

interface Version {
  major: bigint;
  minor: bigint;
  patch: bigint;
}

describe("Contracts 'CashbackVault'", async () => {
  let cashbackVaultFactory: CashbackVault__factory;
  let tokenMockFactory: ERC20TokenMock__factory;

  let deployer: HardhatEthersSigner;
  let manager: HardhatEthersSigner;
  let cpp: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  before(async () => {
    [deployer, manager, cpp, user] = await ethers.getSigners();

    // The contract factories with the explicitly specified deployer account
    cashbackVaultFactory = await ethers.getContractFactory("CashbackVault");
    cashbackVaultFactory = cashbackVaultFactory.connect(deployer);
    tokenMockFactory = await ethers.getContractFactory("ERC20TokenMock");
    tokenMockFactory = tokenMockFactory.connect(deployer);
  });
  async function deployTokenMock() {
    const name = "ERC20 Test";
    const symbol = "TEST";

    // The token contract factory with the explicitly specified deployer account

    // The token contract with the explicitly specified initial account
    const tokenMockDeployment = await tokenMockFactory.deploy(name, symbol);
    await tokenMockDeployment.waitForDeployment();

    return tokenMockDeployment.connect(deployer);
  }
  async function deployContracts() {
    const tokenMock = await deployTokenMock();
    const cashbackVault = await upgrades.deployProxy(cashbackVaultFactory, [await tokenMock.getAddress()]);
    await cashbackVault.waitForDeployment();

    await cashbackVault.grantRole(GRANTOR_ROLE, deployer.address);
    await cashbackVault.grantRole(CASHBACK_GRANTOR_ROLE, cpp.address);
    await cashbackVault.grantRole(MANAGER_ROLE, manager.address);
    return { cashbackVault, tokenMock };
  }
  it("should deploy the contract and match version", async () => {
    const { cashbackVault } = await deployContracts();

    expect(await cashbackVault.$__VERSION()).to.deep.equal([EXPECTED_VERSION.major,
      EXPECTED_VERSION.minor,
      EXPECTED_VERSION.patch]);
  });
  describe("CPP basic happy path flows", async () => {
    let cashbackVault: CashbackVault;
    let tokenMock: ERC20TokenMock;
    let cashBackVaultAddress: string;
    before(async () => {
      const contracts = await deployContracts();
      cashbackVault = contracts.cashbackVault;
      tokenMock = contracts.tokenMock;
      cashBackVaultAddress = await cashbackVault.getAddress();
      await tokenMock.mint(cpp.address, BALANCE_INITIAL);
      // TODO maybe use some trusted account?
      await tokenMock.connect(cpp).approve(cashbackVault.getAddress(), BALANCE_INITIAL);
    });
    it("increse cashback", async () => {
      const cashbackVaultFromCPP = cashbackVault.connect(cpp);
      await cashbackVaultFromCPP.grantCashback(user.address, 1000n);
      expect(await cashbackVaultFromCPP.getCashbackBalance(user.address)).to.equal(1000n);
      expect(await tokenMock.balanceOf(cashBackVaultAddress)).to.equal(1000n);
      expect(await tokenMock.balanceOf(user.address)).to.equal(0n);
      expect(await tokenMock.balanceOf(cpp.address)).to.equal(BALANCE_INITIAL - 1000n);
      await cashbackVaultFromCPP.grantCashback(user.address, 500n);
      expect(await cashbackVaultFromCPP.getCashbackBalance(user.address)).to.equal(1500n);
      expect(await tokenMock.balanceOf(cashBackVaultAddress)).to.equal(1500n);
      expect(await tokenMock.balanceOf(user.address)).to.equal(0n);
      expect(await tokenMock.balanceOf(cpp.address)).to.equal(BALANCE_INITIAL - 1500n);
    });
    it("dec cashback", async () => {
      const cashbackVaultFromCPP = cashbackVault.connect(cpp);
      await cashbackVaultFromCPP.revokeCashback(user.address, 100n);
      expect(await cashbackVaultFromCPP.getCashbackBalance(user.address)).to.equal(1400n);
      expect(await tokenMock.balanceOf(cashBackVaultAddress)).to.equal(1400n);
      expect(await tokenMock.balanceOf(user.address)).to.equal(0n);
      expect(await tokenMock.balanceOf(cpp.address)).to.equal(BALANCE_INITIAL - 1400n);
      await cashbackVaultFromCPP.revokeCashback(user.address, 500n);
      expect(await cashbackVaultFromCPP.getCashbackBalance(user.address)).to.equal(900n);
      expect(await tokenMock.balanceOf(cashBackVaultAddress)).to.equal(900n);
      expect(await tokenMock.balanceOf(user.address)).to.equal(0n);
      expect(await tokenMock.balanceOf(cpp.address)).to.equal(BALANCE_INITIAL - 900n);
    });
    it("claim cashback", async () => {
      const cashbackVaultFromManager = cashbackVault.connect(manager);
      await cashbackVaultFromManager.claim(user.address, 100n);
      expect(await cashbackVaultFromManager.getCashbackBalance(user.address)).to.equal(800n);
      expect(await tokenMock.balanceOf(cashBackVaultAddress)).to.equal(800n);
      expect(await tokenMock.balanceOf(user.address)).to.equal(100n);
      expect(await tokenMock.balanceOf(cpp.address)).to.equal(BALANCE_INITIAL - 800n);
    });
    it("claim all cashback", async () => {
      const cashbackVaultFromManager = cashbackVault.connect(manager);
      await cashbackVaultFromManager.claimAll(user.address);
      expect(await cashbackVaultFromManager.getCashbackBalance(user.address)).to.equal(0n);
      expect(await tokenMock.balanceOf(cashBackVaultAddress)).to.equal(0n);
      expect(await tokenMock.balanceOf(user.address)).to.equal(1000n);
      expect(await tokenMock.balanceOf(cpp.address)).to.equal(BALANCE_INITIAL - 1000n);
    });
  });
});
