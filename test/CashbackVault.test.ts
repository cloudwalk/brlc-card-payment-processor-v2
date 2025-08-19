import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { maxUintForBits, setUpFixture } from "../test-utils/common";
import * as Contracts from "../typechain-types";

const ADDRESS_ZERO = ethers.ZeroAddress;
const BALANCE_INITIAL = 1000_000_000_000n;

const GRANTOR_ROLE: string = ethers.id("GRANTOR_ROLE");
const MANAGER_ROLE: string = ethers.id("MANAGER_ROLE");
const CASHBACK_OPERATOR_ROLE: string = ethers.id("CASHBACK_OPERATOR_ROLE");

const EXPECTED_VERSION = {
  major: 1n,
  minor: 0n,
  patch: 0n
} as const;

let cashbackVaultFactory: Contracts.CashbackVault__factory;
let tokenMockFactory: Contracts.ERC20TokenMock__factory;

let deployer: HardhatEthersSigner; // has GRANTOR_ROLE AND OWNER_ROLE
let manager: HardhatEthersSigner; // has MANAGER_ROLE
let operator: HardhatEthersSigner; // has CASHBACK_OPERATOR_ROLE
let account: HardhatEthersSigner; // has no roles
let stranger: HardhatEthersSigner; // has no roles

async function deployContracts() {
  const name = "ERC20 Test";
  const symbol = "TEST";

  const tokenMockDeployment = await tokenMockFactory.deploy(name, symbol);
  await tokenMockDeployment.waitForDeployment();

  const tokenMock = tokenMockDeployment.connect(deployer);
  const cashbackVault = await upgrades.deployProxy(cashbackVaultFactory, [await tokenMock.getAddress()]);
  await cashbackVault.waitForDeployment();

  await cashbackVault.grantRole(GRANTOR_ROLE, deployer.address);
  await cashbackVault.grantRole(CASHBACK_OPERATOR_ROLE, operator.address);
  await cashbackVault.grantRole(MANAGER_ROLE, manager.address);

  await tokenMock.mint(operator.address, BALANCE_INITIAL);
  await tokenMock.connect(operator).approve(cashbackVault.getAddress(), BALANCE_INITIAL);
  return { cashbackVault, tokenMock };
}

describe("Contracts 'CashbackVault'", async () => {
  before(async () => {
    [deployer, manager, operator, account, stranger] = await ethers.getSigners();

    cashbackVaultFactory = await ethers.getContractFactory("CashbackVault");
    cashbackVaultFactory = cashbackVaultFactory.connect(deployer);
    tokenMockFactory = await ethers.getContractFactory("ERC20TokenMock");
    tokenMockFactory = tokenMockFactory.connect(deployer);
  });
  let cashbackVault: Contracts.CashbackVault;
  let tokenMock: Contracts.ERC20TokenMock;
  let cashbackVaultFromOperator: Contracts.CashbackVault;
  let cashbackVaultFromManager: Contracts.CashbackVault;
  let cashbackVaultFromStranger: Contracts.CashbackVault;

  let cashBackVaultAddress: string;
  beforeEach(async () => {
    const contracts = await setUpFixture(deployContracts);
    cashbackVault = contracts.cashbackVault;
    tokenMock = contracts.tokenMock;
    cashBackVaultAddress = await cashbackVault.getAddress();
    cashbackVaultFromOperator = cashbackVault.connect(operator);
    cashbackVaultFromManager = cashbackVault.connect(manager);
    cashbackVaultFromStranger = cashbackVault.connect(stranger);
  });
  async function setupAccountWithCashback(account: HardhatEthersSigner, amount: bigint) {
    await cashbackVaultFromOperator.grantCashback(account.address, amount);
  }
  describe("method grantCashback(address account, uint64 amount)", async () => {
    describe("operator grants cashback to account", async () => {
      let tx: TransactionResponse;
      beforeEach(async () => {
        tx = await cashbackVaultFromOperator.grantCashback(account.address, 1000n);
      });
      it("should increase account cashback balance", async () => {
        expect(await cashbackVaultFromOperator.getAccountCashbackBalance(account.address)).to.equal(1000n);
      });
      it("should increase total cashback balance", async () => {
        expect(await cashbackVaultFromOperator.getTotalCashbackBalance()).to.equal(1000n);
      });
      it("should emit CashbackGranted event", async () => {
        await expect(tx)
          .to.emit(cashbackVaultFromOperator, "CashbackGranted")
          .withArgs(account.address, operator.address, 1000n, 1000n);
      });
      it("should move tokens from Operator to CashbackVault", async () => {
        await expect(tx).to.changeTokenBalances(
          tokenMock,
          [operator.address, cashBackVaultAddress],
          [-1000n, 1000n]
        );
      });
    });
  });
  describe("method revokeCashback(address account, uint64 amount)", async () => {
    describe("operator revokes cashback from account", async () => {
      let tx: TransactionResponse;
      const initialCashbackBalance = 1000n;
      const amountToRevoke = 100n;
      beforeEach(async () => {
        await setupAccountWithCashback(account, initialCashbackBalance);

        tx = await cashbackVaultFromOperator.revokeCashback(account.address, amountToRevoke);
      });
      it("should decrease account cashback balance", async () => {
        expect(await cashbackVaultFromOperator.getAccountCashbackBalance(account.address))
          .to.equal(initialCashbackBalance - amountToRevoke);
      });
      it("should decrease total cashback balance", async () => {
        expect(await cashbackVaultFromOperator.getTotalCashbackBalance())
          .to.equal(initialCashbackBalance - amountToRevoke);
      });
      it("should move tokens from CashbackVault to Operator", async () => {
        await expect(tx).to.changeTokenBalances(
          tokenMock,
          [cashBackVaultAddress, operator.address],
          [-100n, 100n]
        );
      });
      it("should emit CashbackRevoked event", async () => {
        await expect(tx)
          .to.emit(cashbackVaultFromOperator, "CashbackRevoked")
          .withArgs(account.address, operator.address, amountToRevoke, initialCashbackBalance - amountToRevoke);
      });
    });
  });

  describe("method claim(address account, uint64 amount)", async () => {
    describe("manager claims cashback from account", async () => {
      let tx: TransactionResponse;
      const initialCashbackBalance = 1000n;
      const amountToClaim = 100n;
      beforeEach(async () => {
        await setupAccountWithCashback(account, initialCashbackBalance);

        tx = await cashbackVaultFromManager.claim(account.address, amountToClaim);
      });
      it("should decrease account cashback balance", async () => {
        expect(await cashbackVaultFromManager.getAccountCashbackBalance(account.address))
          .to.equal(initialCashbackBalance - amountToClaim);
      });
      it("should decrease total cashback balance", async () => {
        expect(await cashbackVaultFromManager.getTotalCashbackBalance())
          .to.equal(initialCashbackBalance - amountToClaim);
      });
      it("should move tokens from CashbackVault to account", async () => {
        await expect(tx).to.changeTokenBalances(
          tokenMock,
          [cashBackVaultAddress, account.address],
          [-amountToClaim, amountToClaim]
        );
      });
      it("should emit CashbackClaimed event", async () => {
        await expect(tx)
          .to.emit(cashbackVaultFromManager, "CashbackClaimed")
          .withArgs(account.address, manager.address, amountToClaim, initialCashbackBalance - amountToClaim);
      });
    });
  });
  describe("method claimAll(address account)", async () => {
    describe("manager claims all cashback from account", async () => {
      let tx: TransactionResponse;
      const initialCashbackBalance = 1000n;
      beforeEach(async () => {
        await setupAccountWithCashback(account, initialCashbackBalance);

        tx = await cashbackVaultFromManager.claimAll(account.address);
      });
      it("should empty account cashback balance", async () => {
        expect(await cashbackVaultFromManager.getAccountCashbackBalance(account.address))
          .to.equal(0n);
      });
      it("should empty total cashback balance", async () => {
        expect(await cashbackVaultFromManager.getTotalCashbackBalance())
          .to.equal(0n);
      });
      it("should move tokens from CashbackVault to account", async () => {
        await expect(tx).to.changeTokenBalances(
          tokenMock,
          [cashBackVaultAddress, account.address],
          [-initialCashbackBalance, initialCashbackBalance]
        );
      });
      it("should emit CashbackClaimed event", async () => {
        await expect(tx)
          .to.emit(cashbackVaultFromManager, "CashbackClaimed")
          .withArgs(account.address, manager.address, initialCashbackBalance, 0n);
      });
    });
  });
  describe("method $__VERSION()", async () => {
    it("should return version", async () => {
      expect(await cashbackVault.$__VERSION()).to.deep.equal([
        EXPECTED_VERSION.major,
        EXPECTED_VERSION.minor,
        EXPECTED_VERSION.patch
      ]);
    });
  });
  describe("method underlyingToken()", async () => {
    it("should give us underlying token address", async () => {
      expect(await cashbackVault.underlyingToken()).to.equal(await tokenMock.getAddress());
    });
  });
  it("should have proveCashbackVault() method", async () => {
    await expect(cashbackVault.proveCashbackVault()).to.be.not.reverted;
  });
  describe("upgrade and deploy scenarios", async () => {
    describe("upgrade to not cashback vault", async () => {
      let tx: Promise<TransactionResponse>;
      beforeEach(async () => {
        tx = cashbackVault.upgradeToAndCall(tokenMock.getAddress(), "0x");
      });
      it("should revert with CashbackVault_ImplementationAddressInvalid", async () => {
        await expect(tx)
          .to.be.revertedWithCustomError(cashbackVault, "CashbackVault_ImplementationAddressInvalid");
      });
    });
    describe("deploy with zero token address", async () => {
      let tx: ReturnType<typeof upgrades.deployProxy>;
      beforeEach(async () => {
        tx = upgrades.deployProxy(cashbackVaultFactory, [ADDRESS_ZERO]);
      });
      it("should revert with CashbackVault_TokenAddressZero", async () => {
        await expect(tx)
          .to.be.revertedWithCustomError(cashbackVaultFactory, "CashbackVault_TokenAddressZero");
      });
    });
  });
  describe("BDD complex path with token flow and events checks", async () => {
    describe("granting 1000 tokens cashback", async () => {
      let tx: TransactionResponse;
      beforeEach(async () => {
        tx = await cashbackVaultFromOperator.grantCashback(account.address, 1000n);
      });
      it("should emit CashbackGranted event", async () => {
        await expect(tx)
          .to.emit(cashbackVaultFromOperator, "CashbackGranted")
          .withArgs(account.address, operator.address, 1000n, 1000n);
      });
      it("should move tokens from Operator to CashbackVault", async () => {
        await expect(tx).to.changeTokenBalances(
          tokenMock,
          [operator.address, cashBackVaultAddress],
          [-1000n, 1000n]
        );
      });
      it("should increase CashbackVault tracked totalCashbackBalance", async () => {
        expect(await cashbackVaultFromOperator.getTotalCashbackBalance()).to.equal(1000n);
      });
      it("should increase account cashback balance", async () => {
        expect(await cashbackVaultFromOperator.getAccountCashbackBalance(account.address)).to.equal(1000n);
      });
      it("should not change account totalClaimed in state", async () => {
        expect((await cashbackVaultFromOperator.getAccountCashbackState(account.address)).totalClaimed).to.equal(0n);
      });
      describe("revoking 100 tokens cashback", async () => {
        let tx: TransactionResponse;
        beforeEach(async () => {
          tx = await cashbackVaultFromOperator.revokeCashback(account.address, 100n);
        });
        it("should emit CashbackRevoked event", async () => {
          await expect(tx)
            .to.emit(cashbackVaultFromOperator, "CashbackRevoked")
            .withArgs(account.address, operator.address, 100n, 900n);
        });
        it("should move tokens from CashbackVault to Operator", async () => {
          await expect(tx).to.changeTokenBalances(
            tokenMock,
            [cashBackVaultAddress, operator.address],
            [-100n, 100n]
          );
        });
        it("should decrease CashbackVault tracked totalCashbackBalance", async () => {
          expect(await cashbackVaultFromOperator.getTotalCashbackBalance()).to.equal(900n);
        });
        it("should decrease account cashback balance", async () => {
          expect(await cashbackVaultFromOperator.getAccountCashbackBalance(account.address)).to.equal(900n);
        });
        describe("claiming 100 tokens cashback", async () => {
          let tx: TransactionResponse;
          beforeEach(async () => {
            tx = await cashbackVaultFromManager.claim(account.address, 100n);
          });
          it("should emit CashbackClaimed event", async () => {
            await expect(tx)
              .to.emit(cashbackVaultFromOperator, "CashbackClaimed")
              .withArgs(account.address, manager.address, 100n, 800n);
          });
          it("should move tokens from CashbackVault to account", async () => {
            await expect(tx).to.changeTokenBalances(
              tokenMock,
              [cashBackVaultAddress, account.address],
              [-100n, 100n]
            );
          });
          it("should decrease CashbackVault tracked totalCashbackBalance", async () => {
            expect(await cashbackVaultFromOperator.getTotalCashbackBalance()).to.equal(800n);
          });
          it("Operator token balance should not change", async () => {
            await expect(tx).to.changeTokenBalances(
              tokenMock,
              [operator.address],
              [0n]
            );
          });
          it("should decrease account cashback balance", async () => {
            expect(await cashbackVaultFromOperator.getAccountCashbackBalance(account.address)).to.equal(800n);
          });
          it("should increase account totalClaimed in state", async () => {
            expect((await cashbackVaultFromOperator.getAccountCashbackState(account.address)).totalClaimed)
              .to.equal(100n);
          });
          describe("claiming all tokens cashback", async () => {
            let tx: TransactionResponse;
            beforeEach(async () => {
              tx = await cashbackVaultFromManager.claimAll(account.address);
            });
            it("should emit CashbackClaimed event", async () => {
              await expect(tx)
                .to.emit(cashbackVaultFromOperator, "CashbackClaimed")
                .withArgs(account.address, manager.address, 800n, 0n);
            });
            it("should move tokens from CashbackVault to account", async () => {
              await expect(tx).to.changeTokenBalances(
                tokenMock,
                [cashBackVaultAddress, account.address],
                [-800n, 800n]
              );
            });
            it("should decrease CashbackVault tracked totalCashbackBalance", async () => {
              expect(await cashbackVaultFromOperator.getTotalCashbackBalance()).to.equal(0n);
            });
            it("Operator token balance should not change", async () => {
              await expect(tx).to.changeTokenBalances(
                tokenMock,
                [operator.address],
                [0n]
              );
            });
            it("should decrease account cashback balance", async () => {
              expect(await cashbackVaultFromOperator.getAccountCashbackBalance(account.address)).to.equal(0n);
            });
            it("should increase account totalClaimed in state", async () => {
              expect((await cashbackVaultFromOperator.getAccountCashbackState(account.address)).totalClaimed)
                .to.equal(900n);
            });
          });
        });
      });
    });
  });
  describe("CV basic unhappy path token flows and errors checks", async () => {
    it("should revert if we grant cashback for zero address", async () => {
      await expect(cashbackVaultFromOperator.grantCashback(ADDRESS_ZERO, 1000n))
        .to.be.revertedWithCustomError(cashbackVaultFromOperator, "CashbackVault_AccountAddressZero");
    });
    it("should revert if we grant cashback for with amount greater than uint64 max", async () => {
      await expect(cashbackVaultFromOperator.grantCashback(account.address, maxUintForBits(64) + 100n))
        .to.be.rejectedWith(Error, "value out-of-bounds");
    });
    describe("granting 1000 tokens cashback", async () => {
      beforeEach(async () => {
        await cashbackVaultFromOperator.grantCashback(account.address, 1000n);
      });
      it("should revert if we revoke more cashback than account have", async () => {
        await expect(cashbackVaultFromOperator.revokeCashback(account.address, 1001n))
          .to.be.revertedWithCustomError(cashbackVaultFromOperator, "CashbackVault_CashbackBalanceInsufficient");
      });
      it("should revert if we claim more cashback than account have", async () => {
        await expect(cashbackVaultFromManager.claim(account.address, 1001n))
          .to.be.revertedWithCustomError(cashbackVaultFromManager, "CashbackVault_CashbackBalanceInsufficient");
      });
    });
  });
});
