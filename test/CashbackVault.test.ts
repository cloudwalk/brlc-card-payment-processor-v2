import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { CashbackVault__factory, CashbackVault, ERC20TokenMock, ERC20TokenMock__factory } from "../typechain-types";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { maxUintForBits } from "../test-utils/common";

// TODO: All custom errors must be tested for all possible functions
// TODO: Check tests with the linter
// TODO: Check roles for each function.
// TODO: Check roles of the contract after initialization (hashes, role admins, granted roles).

const ADDRESS_ZERO = ethers.ZeroAddress;
const BALANCE_INITIAL = 1000_000_000_000n;

const GRANTOR_ROLE: string = ethers.id("GRANTOR_ROLE");
const MANAGER_ROLE: string = ethers.id("MANAGER_ROLE");
const CASHBACK_OPERATOR_ROLE: string = ethers.id("CASHBACK_OPERATOR_ROLE");

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

let cashbackVaultFactory: CashbackVault__factory;
let tokenMockFactory: ERC20TokenMock__factory;

let deployer: HardhatEthersSigner;
let manager: HardhatEthersSigner;
let cpp: HardhatEthersSigner;
let account: HardhatEthersSigner;

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
  await cashbackVault.grantRole(CASHBACK_OPERATOR_ROLE, cpp.address);
  await cashbackVault.grantRole(MANAGER_ROLE, manager.address);

  await tokenMock.mint(cpp.address, BALANCE_INITIAL);
  await tokenMock.connect(cpp).approve(cashbackVault.getAddress(), BALANCE_INITIAL);
  return { cashbackVault, tokenMock };
}

describe("Contract 'CashbackVault'", async () => {
  before(async () => {
    [deployer, manager, cpp, account] = await ethers.getSigners();

    // The contract factories with the explicitly specified deployer account
    cashbackVaultFactory = await ethers.getContractFactory("CashbackVault");
    cashbackVaultFactory = cashbackVaultFactory.connect(deployer);
    tokenMockFactory = await ethers.getContractFactory("ERC20TokenMock");
    tokenMockFactory = tokenMockFactory.connect(deployer);
  });

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

  it("Returns version", async () => {
    expect(await cashbackVault.$__VERSION()).to.deep.equal([
      EXPECTED_VERSION.major,
      EXPECTED_VERSION.minor,
      EXPECTED_VERSION.patch,
    ]);
  });

  it("Has proveCashbackVault function", async () => {
    await expect(await cashbackVault.proveCashbackVault()).to.be.not.reverted;
  });

  it("Gives us underlying token address", async () => {
    expect(await cashbackVault.underlyingToken()).to.equal(await tokenMock.getAddress());
  });

  describe("Upgrade and deploy errors", async () => {
    describe("Upgrade to not cashback vault", async () => {
      let tx: Promise<TransactionResponse>;
      beforeEach(async () => {
        tx = cashbackVault.upgradeToAndCall(tokenMock.getAddress(), "0x");
      });

      it("Reverts with the proper custom error", async () => {
        await expect(tx)
          .to.be.revertedWithCustomError(cashbackVault, "CashbackVault_ImplementationAddressInvalid");
      });
    });

    describe("Deploy with zero token address", async () => {
      let tx: ReturnType<typeof upgrades.deployProxy>;

      beforeEach(async () => {
        tx = upgrades.deployProxy(cashbackVaultFactory, [ADDRESS_ZERO]);
      });

      it("Reverts with the proper custom error", async () => {
        await expect(tx)
          .to.be.revertedWithCustomError(cashbackVaultFactory, "CashbackVault_TokenAddressZero");
      });
    });
  });

  describe("Basic happy path token flows and events checks", async () => {
    describe("Granting 1000 tokens cashback", async () => {
      let tx: TransactionResponse;

      beforeEach(async () => {
        tx = await loadFixture(async function grantCashback1000() {
          return cashbackVaultFromCPP.grantCashback(account.address, 1000n);
        });
      });

      it("Emits the expected event", async () => {
        await expect(tx)
          .to.emit(cashbackVaultFromCPP, "CashbackGranted").withArgs(account.address, cpp.address, 1000n, 1000n);
      });

      it("Increases the vault token balance", async () => {
        expect(await tokenMock.balanceOf(cashBackVaultAddress)).to.equal(1000n);
      });

      it("Increases the vault total balance variable", async () => {
        expect(await cashbackVaultFromCPP.getTotalCashbackBalance()).to.equal(1000n);
      });
      it("Decrease the caller token balance", async () => {
        expect(await tokenMock.balanceOf(cpp.address)).to.equal(BALANCE_INITIAL - 1000n);
      });
      it("Increases the account cashback balance on the vault", async () => {
        expect(await cashbackVaultFromCPP.getAccountCashbackBalance(account.address)).to.equal(1000n);
      });
      it("Does not change the account total claimed variable", async () => {
        expect((await cashbackVaultFromCPP.getAccountCashbackState(account.address)).totalClaimed).to.equal(0n);
      });
      describe("Revoking 100 tokens cashback", async () => {
        let tx: TransactionResponse;
        beforeEach(async () => {
          tx = await loadFixture(async function revokeCashback100() {
            return cashbackVaultFromCPP.revokeCashback(account.address, 100n);
          });
        });
        it("Emits the expected event", async () => {
          await expect(tx)
            .to.emit(cashbackVaultFromCPP, "CashbackRevoked").withArgs(account.address, cpp.address, 100n, 900n);
        });
        it("Decreases 'CashbackVault' real token balance", async () => {
          expect(await tokenMock.balanceOf(cashBackVaultAddress)).to.equal(900n);
        });
        it("should decrease CashbackVault tracked totalCashbackBalance", async () => {
          expect(await cashbackVaultFromCPP.getTotalCashbackBalance()).to.equal(900n);
        });
        it("should increase CPP token balance", async () => {
          expect(await tokenMock.balanceOf(cpp.address)).to.equal(BALANCE_INITIAL - 900n);
        });
        it("should decrease account cashback balance", async () => {
          expect(await cashbackVaultFromCPP.getAccountCashbackBalance(account.address)).to.equal(900n);
        });
        describe("grant more 500 tokens cashback", async () => {
          let tx: TransactionResponse;
          beforeEach(async () => {
            tx = await loadFixture(async function grantCashback500() {
              return cashbackVaultFromCPP.grantCashback(account.address, 500n);
            });
          });
          it("should emit CashbackGranted event", async () => {
            await expect(tx)
              .to.emit(cashbackVaultFromCPP, "CashbackGranted").withArgs(account.address, cpp.address, 500n, 1400n);
          });
          it("should increase CashbackVault real token balance", async () => {
            expect(await tokenMock.balanceOf(cashBackVaultAddress)).to.equal(1400n);
          });
          it("should increase CashbackVault tracked totalCashbackBalance", async () => {
            expect(await cashbackVaultFromCPP.getTotalCashbackBalance()).to.equal(1400n);
          });
          it("should decrease CPP token balance", async () => {
            expect(await tokenMock.balanceOf(cpp.address)).to.equal(BALANCE_INITIAL - 1400n);
          });
          it("should increase account cashback balance", async () => {
            expect(await cashbackVaultFromCPP.getAccountCashbackBalance(account.address)).to.equal(1400n);
          });
          it("should not change account totalClaimed in state", async () => {
            expect((await cashbackVaultFromCPP.getAccountCashbackState(account.address)).totalClaimed).to.equal(0n);
          });
          describe("claiming 100 tokens cashback", async () => {
            let tx: TransactionResponse;
            beforeEach(async () => {
              tx = await loadFixture(async function claimCashback100() {
                return cashbackVaultFromManager.claim(account.address, 100n);
              });
            });
            it("should emit CashbackClaimed event", async () => {
              await expect(tx)
                .to.emit(cashbackVaultFromCPP, "CashbackClaimed")
                .withArgs(account.address, manager.address, 100n, 1300n);
            });
            it("should decrease CashbackVault real token balance", async () => {
              expect(await tokenMock.balanceOf(cashBackVaultAddress)).to.equal(1300n);
            });
            it("should decrease CashbackVault tracked totalCashbackBalance", async () => {
              expect(await cashbackVaultFromCPP.getTotalCashbackBalance()).to.equal(1300n);
            });
            it("CPP token balance should not change", async () => {
              expect(await tokenMock.balanceOf(cpp.address)).to.equal(BALANCE_INITIAL - 1400n);
            });
            it("should decrease account cashback balance", async () => {
              expect(await cashbackVaultFromCPP.getAccountCashbackBalance(account.address)).to.equal(1300n);
            });
            it("should increase account totalClaimed in state", async () => {
              expect((await cashbackVaultFromCPP.getAccountCashbackState(account.address)).totalClaimed).to.equal(100n);
            });
            it("should increase account balance", async () => {
              expect(await tokenMock.balanceOf(account.address)).to.equal(100n);
            });
            describe("claiming all tokens cashback", async () => {
              let tx: TransactionResponse;
              beforeEach(async () => {
                tx = await loadFixture(async function claimCashbackAll() {
                  return cashbackVaultFromManager.claimAll(account.address);
                });
              });
              it("should emit CashbackClaimed event", async () => {
                await expect(tx)
                  .to.emit(cashbackVaultFromCPP, "CashbackClaimed")
                  .withArgs(account.address, manager.address, 1300n, 0n);
              });
              it("should decrease CashbackVault real token balance", async () => {
                expect(await tokenMock.balanceOf(cashBackVaultAddress)).to.equal(0n);
              });
              it("should decrease CashbackVault tracked totalCashbackBalance", async () => {
                expect(await cashbackVaultFromCPP.getTotalCashbackBalance()).to.equal(0n);
              });
              it("CPP token balance should not change", async () => {
                expect(await tokenMock.balanceOf(cpp.address)).to.equal(BALANCE_INITIAL - 1400n);
              });
              it("should decrease account cashback balance", async () => {
                expect(await cashbackVaultFromCPP.getAccountCashbackBalance(account.address)).to.equal(0n);
              });
              it("should increase account totalClaimed in state", async () => {
                expect((await cashbackVaultFromCPP.getAccountCashbackState(account.address)).totalClaimed)
                  .to.equal(1400n);
              });
              it("should increase account balance", async () => {
                expect(await tokenMock.balanceOf(account.address)).to.equal(1400n);
              });
            });
          });
        });
      });
    });
  });
  describe("Basic unhappy path token flows and errors checks", async () => {
    it("should revert if we grant cashback for zero address", async () => {
      await expect(cashbackVaultFromCPP.grantCashback(ADDRESS_ZERO, 1000n))
        .to.be.revertedWithCustomError(cashbackVaultFromCPP, "CashbackVault_AccountAddressZero");
    });
    it("should revert if we grant cashback for with amount greater than uint64 max", async () => {
      await expect(cashbackVaultFromCPP.grantCashback(account.address, maxUintForBits(64) + 1n))
        .to.be.revertedWithCustomError(cashbackVaultFromCPP, "CashbackVault_AmountExcess");
    });
    describe("granting 1000 tokens cashback", async () => {
      let tx: TransactionResponse;
      beforeEach(async () => {
        tx = await loadFixture(async function grantCashback1000() {
          return cashbackVaultFromCPP.grantCashback(account.address, 1000n);
        });
      });
      it("should revert if we revoke more cashback than account have", async () => {
        await expect(cashbackVaultFromCPP.revokeCashback(account.address, 1001n))
          .to.be.revertedWithCustomError(cashbackVaultFromCPP, "CashbackVault_CashbackBalanceInsufficient");
      });
      it("should revert if we claim more cashback than account have", async () => {
        await expect(cashbackVaultFromManager.claim(account.address, 1001n))
          .to.be.revertedWithCustomError(cashbackVaultFromManager, "CashbackVault_CashbackBalanceInsufficient");
      });
    });
  });
});
