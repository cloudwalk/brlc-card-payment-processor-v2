import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory, TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { checkContractUupsUpgrading, connect, getAddress, proveTx } from "../test-utils/eth";
import { CashbackVault__factory, CashbackVault, ERC20TokenMock, ERC20TokenMock__factory } from "../typechain-types";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

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

    await tokenMock.mint(cpp.address, BALANCE_INITIAL);
    // TODO maybe use some trusted account?
    await tokenMock.connect(cpp).approve(cashbackVault.getAddress(), BALANCE_INITIAL);
    return { cashbackVault, tokenMock };
  }
  it("should deploy the contract and match version", async () => {
    const { cashbackVault } = await deployContracts();

    expect(await cashbackVault.$__VERSION()).to.deep.equal([EXPECTED_VERSION.major,
      EXPECTED_VERSION.minor,
      EXPECTED_VERSION.patch]);
  });
  describe("CPP basic happy path token flows and events checks", async () => {
    let cashbackVault: CashbackVault;
    let tokenMock: ERC20TokenMock;
    let cashbackVaultFromCPP: CashbackVault;
    let cashbackVaultFromManager: CashbackVault;
    let cashBackVaultAddress: string;
    beforeEach(async () => {
      const contracts = await loadFixture(deployContracts);
      cashbackVault = contracts.cashbackVault;
      tokenMock = contracts.tokenMock;
      cashBackVaultAddress = await cashbackVault.getAddress();
      cashbackVaultFromCPP = cashbackVault.connect(cpp);
      cashbackVaultFromManager = cashbackVault.connect(manager);
    });
    describe("granting 1000 tokens cashback", async () => {
      let tx: TransactionResponse;
      beforeEach(async () => {
        tx = await loadFixture(async function grantCashback1000() {
          return cashbackVaultFromCPP.grantCashback(user.address, 1000n);
        });
      });
      it("should emit CashbackGranted event", async () => {
        await expect(tx)
          .to.emit(cashbackVaultFromCPP, "CashbackGranted").withArgs(user.address, cpp.address, 1000n, 1000n);
      });
      it("should increase CashbackVault real token balance", async () => {
        expect(await tokenMock.balanceOf(cashBackVaultAddress)).to.equal(1000n);
      });
      it("should increase CashbackVault tracked totalCashbackBalance", async () => {
        expect(await cashbackVaultFromCPP.getTotalCashback()).to.equal(1000n);
      });
      it("should decrease CPP token balance", async () => {
        expect(await tokenMock.balanceOf(cpp.address)).to.equal(BALANCE_INITIAL - 1000n);
      });
      it("should increase user cashback balance", async () => {
        expect(await cashbackVaultFromCPP.getCashbackBalance(user.address)).to.equal(1000n);
      });
      it("should not change user totalClaimed in state", async () => {
        expect((await cashbackVaultFromCPP.getUserCashbackState(user.address)).totalClaimed).to.equal(0n);
      });
      describe("revoking 100 tokens cashback", async () => {
        let tx: TransactionResponse;
        beforeEach(async () => {
          tx = await loadFixture(async function revokeCashback100() {
            return cashbackVaultFromCPP.revokeCashback(user.address, 100n);
          });
        });
        it("should emit CashbackRevoked event", async () => {
          await expect(tx)
            .to.emit(cashbackVaultFromCPP, "CashbackRevoked").withArgs(user.address, cpp.address, 100n, 900n);
        });
        it("should decrease CashbackVault real token balance", async () => {
          expect(await tokenMock.balanceOf(cashBackVaultAddress)).to.equal(900n);
        });
        it("should decrease CashbackVault tracked totalCashbackBalance", async () => {
          expect(await cashbackVaultFromCPP.getTotalCashback()).to.equal(900n);
        });
        it("should increase CPP token balance", async () => {
          expect(await tokenMock.balanceOf(cpp.address)).to.equal(BALANCE_INITIAL - 900n);
        });
        it("should decrease user cashback balance", async () => {
          expect(await cashbackVaultFromCPP.getCashbackBalance(user.address)).to.equal(900n);
        });
        describe("grant more 500 tokens cashback", async () => {
          let tx: TransactionResponse;
          beforeEach(async () => {
            tx = await loadFixture(async function grantCashback500() {
              return cashbackVaultFromCPP.grantCashback(user.address, 500n);
            });
          });
          it("should emit CashbackGranted event", async () => {
            await expect(tx)
              .to.emit(cashbackVaultFromCPP, "CashbackGranted").withArgs(user.address, cpp.address, 500n, 1400n);
          });
          it("should increase CashbackVault real token balance", async () => {
            expect(await tokenMock.balanceOf(cashBackVaultAddress)).to.equal(1400n);
          });
          it("should increase CashbackVault tracked totalCashbackBalance", async () => {
            expect(await cashbackVaultFromCPP.getTotalCashback()).to.equal(1400n);
          });
          it("should decrease CPP token balance", async () => {
            expect(await tokenMock.balanceOf(cpp.address)).to.equal(BALANCE_INITIAL - 1400n);
          });
          it("should increase user cashback balance", async () => {
            expect(await cashbackVaultFromCPP.getCashbackBalance(user.address)).to.equal(1400n);
          });
          it("should not change user totalClaimed in state", async () => {
            expect((await cashbackVaultFromCPP.getUserCashbackState(user.address)).totalClaimed).to.equal(0n);
          });
          describe("claiming 100 tokens cashback", async () => {
            let tx: TransactionResponse;
            beforeEach(async () => {
              tx = await loadFixture(async function claimCashback100() {
                return cashbackVaultFromManager.claim(user.address, 100n);
              });
            });
            it("should emit CashbackClaimed event", async () => {
              await expect(tx)
                .to.emit(cashbackVaultFromCPP, "CashbackClaimed").withArgs(user.address, manager.address, 100n, 1300n);
            });
            it("should decrease CashbackVault real token balance", async () => {
              expect(await tokenMock.balanceOf(cashBackVaultAddress)).to.equal(1300n);
            });
            it("should decrease CashbackVault tracked totalCashbackBalance", async () => {
              expect(await cashbackVaultFromCPP.getTotalCashback()).to.equal(1300n);
            });
            it("CPP token balance should not change", async () => {
              expect(await tokenMock.balanceOf(cpp.address)).to.equal(BALANCE_INITIAL - 1400n);
            });
            it("should decrease user cashback balance", async () => {
              expect(await cashbackVaultFromCPP.getCashbackBalance(user.address)).to.equal(1300n);
            });
            it("should increase user totalClaimed in state", async () => {
              expect((await cashbackVaultFromCPP.getUserCashbackState(user.address)).totalClaimed).to.equal(100n);
            });
            it("should increase user balance", async () => {
              expect(await tokenMock.balanceOf(user.address)).to.equal(100n);
            });
          });
        });
      });
    });
  });
});
