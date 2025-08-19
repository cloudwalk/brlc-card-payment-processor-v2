import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { setUpFixture } from "../test-utils/common";
import * as Contracts from "../typechain-types";
import { getTxTimestamp } from "../test-utils/eth";

const ADDRESS_ZERO = ethers.ZeroAddress;
const BALANCE_INITIAL = 1000_000_000_000n;

const OWNER_ROLE = ethers.id("OWNER_ROLE");
const GRANTOR_ROLE = ethers.id("GRANTOR_ROLE");
const MANAGER_ROLE = ethers.id("MANAGER_ROLE");
const CASHBACK_OPERATOR_ROLE = ethers.id("CASHBACK_OPERATOR_ROLE");
const PAUSER_ROLE = ethers.id("PAUSER_ROLE");
const RESCUER_ROLE = ethers.id("RESCUER_ROLE");

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
let pauser: HardhatEthersSigner; // has PAUSER_ROLE

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
  await cashbackVault.grantRole(PAUSER_ROLE, pauser.address);

  await tokenMock.mint(operator.address, BALANCE_INITIAL);
  await tokenMock.connect(operator).approve(cashbackVault.getAddress(), BALANCE_INITIAL);
  return { cashbackVault, tokenMock };
}

describe("CashbackVault contract", async () => {
  before(async () => {
    [deployer, manager, operator, account, stranger, pauser] = await ethers.getSigners();

    cashbackVaultFactory = await ethers.getContractFactory("CashbackVault");
    cashbackVaultFactory = cashbackVaultFactory.connect(deployer);
    tokenMockFactory = await ethers.getContractFactory("ERC20TokenMock");
    tokenMockFactory = tokenMockFactory.connect(deployer);
  });
  let cashbackVaultFromOwner: Contracts.CashbackVault;
  let tokenMock: Contracts.ERC20TokenMock;
  let cashbackVaultFromOperator: Contracts.CashbackVault;
  let cashbackVaultFromManager: Contracts.CashbackVault;
  let cashbackVaultFromStranger: Contracts.CashbackVault;
  let cashbackVaultFromPauser: Contracts.CashbackVault;

  let cashBackVaultAddress: string;
  beforeEach(async () => {
    const contracts = await setUpFixture(deployContracts);
    cashbackVaultFromOwner = contracts.cashbackVault;
    tokenMock = contracts.tokenMock;
    cashBackVaultAddress = await cashbackVaultFromOwner.getAddress();
    cashbackVaultFromOperator = cashbackVaultFromOwner.connect(operator);
    cashbackVaultFromManager = cashbackVaultFromOwner.connect(manager);
    cashbackVaultFromStranger = cashbackVaultFromOwner.connect(stranger);
    cashbackVaultFromPauser = cashbackVaultFromOwner.connect(pauser);
  });

  describe("deployment and upgrade error scenarios", async () => {
    it("should revert when upgrading to a non-CashbackVault implementation", async () => {
      const tx = cashbackVaultFromOwner.upgradeToAndCall(tokenMock.getAddress(), "0x");
      await expect(tx)
        .to.be.revertedWithCustomError(cashbackVaultFromStranger, "CashbackVault_ImplementationAddressInvalid");
    });

    it("should revert when deploying with a zero token address", async () => {
      const tx = upgrades.deployProxy(cashbackVaultFactory, [ADDRESS_ZERO]);
      await expect(tx)
        .to.be.revertedWithCustomError(cashbackVaultFactory, "CashbackVault_TokenAddressZero");
    });
    it("should revert when upgrading from a non-owner", async () => {
      const tx = cashbackVaultFromStranger.upgradeToAndCall(tokenMock.getAddress(), "0x");
      await expect(tx)
        .to.be.revertedWithCustomError(cashbackVaultFromOperator, "AccessControlUnauthorizedAccount")
        .withArgs(stranger.address, OWNER_ROLE);
    });
  });

  describe("method initialize()", async () => {
    it("should expose correct role hashes", async () => {
      expect(await cashbackVaultFromOwner.OWNER_ROLE()).to.equal(OWNER_ROLE);
      expect(await cashbackVaultFromOwner.GRANTOR_ROLE()).to.equal(GRANTOR_ROLE);
      expect(await cashbackVaultFromOwner.PAUSER_ROLE()).to.equal(PAUSER_ROLE);
      expect(await cashbackVaultFromOwner.RESCUER_ROLE()).to.equal(RESCUER_ROLE);
      expect(await cashbackVaultFromOwner.MANAGER_ROLE()).to.equal(MANAGER_ROLE);
      expect(await cashbackVaultFromOwner.CASHBACK_OPERATOR_ROLE()).to.equal(CASHBACK_OPERATOR_ROLE);
    });

    it("should set correct role admins", async () => {
      expect(await cashbackVaultFromOwner.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
      expect(await cashbackVaultFromOwner.getRoleAdmin(GRANTOR_ROLE)).to.equal(OWNER_ROLE);
      expect(await cashbackVaultFromOwner.getRoleAdmin(PAUSER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await cashbackVaultFromOwner.getRoleAdmin(RESCUER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await cashbackVaultFromOwner.getRoleAdmin(MANAGER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await cashbackVaultFromOwner.getRoleAdmin(CASHBACK_OPERATOR_ROLE)).to.equal(GRANTOR_ROLE);
    });

    it("should not be paused after initialization", async () => {
      expect(await cashbackVaultFromOwner.paused()).to.equal(false);
    });

    it("should revert if it is called a second time", async () => {
      await expect(cashbackVaultFromOwner.initialize(await tokenMock.getAddress()))
        .to.be.revertedWithCustomError(cashbackVaultFromOwner, "InvalidInitialization");
    });
  });

  describe("method grantCashback()", async () => {
    const amountToGrant = 1000n;
    describe("operator successfully grants cashback to an account", async () => {
      let tx: TransactionResponse;
      beforeEach(async () => {
        tx = await cashbackVaultFromOperator.grantCashback(account.address, amountToGrant);
      });

      it("should increase account cashback balance", async () => {
        expect(await cashbackVaultFromOperator.getAccountCashbackBalance(account.address)).to.equal(amountToGrant);
      });

      it("should increase total cashback balance", async () => {
        expect(await cashbackVaultFromOperator.getTotalCashbackBalance()).to.equal(amountToGrant);
      });

      it("should emit CashbackGranted event", async () => {
        await expect(tx)
          .to.emit(cashbackVaultFromOperator, "CashbackGranted")
          .withArgs(account.address, operator.address, amountToGrant, amountToGrant);
      });

      it("should move tokens from Operator to CashbackVault", async () => {
        await expect(tx).to.changeTokenBalances(
          tokenMock,
          [operator.address, cashBackVaultAddress],
          [-amountToGrant, amountToGrant]
        );
      });

      it("should store lastGrantTimestamp in state", async () => {
        expect((await cashbackVaultFromOperator.getAccountCashbackState(account.address)).lastGrantTimestamp)
          .to.equal(await getTxTimestamp(Promise.resolve(tx)));
      });
    });
    describe("should revert if", async () => {
      it("account is zero address", async () => {
        await expect(cashbackVaultFromOperator.grantCashback(ADDRESS_ZERO, 1000n))
          .to.be.revertedWithCustomError(cashbackVaultFromOperator, "CashbackVault_AccountAddressZero");
      });

      it("amount is zero", async () => {
        await expect(cashbackVaultFromOperator.grantCashback(account.address, 0n))
          .to.be.revertedWithCustomError(cashbackVaultFromOperator, "CashbackVault_AmountZero");
      });

      it("operator does not have enough tokens", async () => {
        await tokenMock.connect(operator).transfer(stranger.address, BALANCE_INITIAL);
        await expect(cashbackVaultFromOperator.grantCashback(account.address, amountToGrant))
          .to.be.revertedWithCustomError(tokenMock, "ERC20InsufficientBalance");
      });

      it("operator does not have enough allowance", async () => {
        await tokenMock.connect(operator).approve(cashBackVaultAddress, 0n);
        await expect(cashbackVaultFromOperator.grantCashback(account.address, amountToGrant))
          .to.be.revertedWithCustomError(tokenMock, "ERC20InsufficientAllowance");
      });
    });

    describe("guards: should revert if", async () => {
      it("contract is paused", async () => {
        await cashbackVaultFromPauser.pause();
        await expect(cashbackVaultFromOperator.grantCashback(account.address, amountToGrant))
          .to.be.revertedWithCustomError(cashbackVaultFromOperator, "EnforcedPause");
      });
      it("caller does not have CASHBACK_OPERATOR_ROLE", async () => {
        await expect(cashbackVaultFromStranger.grantCashback(account.address, amountToGrant))
          .to.be.revertedWithCustomError(cashbackVaultFromStranger, "AccessControlUnauthorizedAccount")
          .withArgs(stranger.address, CASHBACK_OPERATOR_ROLE);
      });
      it("even if the caller is the owner", async () => {
        await expect(cashbackVaultFromOwner.grantCashback(account.address, amountToGrant))
          .to.be.revertedWithCustomError(cashbackVaultFromOwner, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, CASHBACK_OPERATOR_ROLE);
      });
    });
  });
  describe("method revokeCashback()", async () => {
    const initialCashbackBalance = 1000n;
    const amountToRevoke = 100n;
    beforeEach(async () => {
      // prepare some existing cashback state
      await cashbackVaultFromOperator.grantCashback(account.address, initialCashbackBalance);
    });

    describe("operator successfully revokes cashback from an account", async () => {
      let tx: TransactionResponse;
      beforeEach(async () => {
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
    describe("should revert if", async () => {
      it("account is zero address", async () => {
        await expect(cashbackVaultFromOperator.revokeCashback(ADDRESS_ZERO, amountToRevoke))
          .to.be.revertedWithCustomError(cashbackVaultFromOperator, "CashbackVault_AccountAddressZero");
      });

      it("amount is zero", async () => {
        await expect(cashbackVaultFromOperator.revokeCashback(account.address, 0n))
          .to.be.revertedWithCustomError(cashbackVaultFromOperator, "CashbackVault_AmountZero");
      });

      it("revokes more cashback than the account has", async () => {
        await expect(cashbackVaultFromOperator.revokeCashback(account.address, initialCashbackBalance + 1n))
          .to.be.revertedWithCustomError(cashbackVaultFromOperator, "CashbackVault_CashbackBalanceInsufficient");
      });
    });
    describe("guards: should revert if", async () => {
      it("contract is paused", async () => {
        await cashbackVaultFromPauser.pause();
        await expect(cashbackVaultFromOperator.revokeCashback(account.address, amountToRevoke))
          .to.be.revertedWithCustomError(cashbackVaultFromOperator, "EnforcedPause");
      });

      it("caller does not have CASHBACK_OPERATOR_ROLE", async () => {
        await expect(cashbackVaultFromStranger.revokeCashback(account.address, amountToRevoke))
          .to.be.revertedWithCustomError(cashbackVaultFromStranger, "AccessControlUnauthorizedAccount")
          .withArgs(stranger.address, CASHBACK_OPERATOR_ROLE);
      });

      it("even if the caller is the owner", async () => {
        await expect(cashbackVaultFromOwner.revokeCashback(account.address, amountToRevoke))
          .to.be.revertedWithCustomError(cashbackVaultFromOwner, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, CASHBACK_OPERATOR_ROLE);
      });
    });
  });

  describe("method claim(address account, uint64 amount)", async () => {
    const initialCashbackBalance = 1000n;
    const amountToClaim = 100n;
    beforeEach(async () => {
      // prepare some existing cashback state
      await cashbackVaultFromOperator.grantCashback(account.address, initialCashbackBalance);
    });
    describe("manager successfully claims cashback for an account", async () => {
      let tx: TransactionResponse;
      beforeEach(async () => {
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

      it("should store lastClaimTimestamp in state", async () => {
        expect((await cashbackVaultFromManager.getAccountCashbackState(account.address)).lastClaimTimestamp)
          .to.equal(await getTxTimestamp(tx));
      });
    });
    describe("should revert if", async () => {
      it("account is zero address", async () => {
        await expect(cashbackVaultFromManager.claim(ADDRESS_ZERO, 1000n))
          .to.be.revertedWithCustomError(cashbackVaultFromManager, "CashbackVault_AccountAddressZero");
      });

      it("amount is zero", async () => {
        await expect(cashbackVaultFromManager.claim(account.address, 0n))
          .to.be.revertedWithCustomError(cashbackVaultFromManager, "CashbackVault_AmountZero");
      });

      it("account does not have enough cashback balance", async () => {
        await expect(cashbackVaultFromManager.claim(account.address, initialCashbackBalance + 1n))
          .to.be.revertedWithCustomError(cashbackVaultFromManager, "CashbackVault_CashbackBalanceInsufficient");
      });
    });
    describe("guards: should revert if", async () => {
      it("contract is paused", async () => {
        await cashbackVaultFromPauser.pause();
        await expect(cashbackVaultFromManager.claim(account.address, amountToClaim))
          .to.be.revertedWithCustomError(cashbackVaultFromManager, "EnforcedPause");
      });

      it("caller does not have MANAGER_ROLE", async () => {
        await expect(cashbackVaultFromStranger.claim(account.address, amountToClaim))
          .to.be.revertedWithCustomError(cashbackVaultFromStranger, "AccessControlUnauthorizedAccount")
          .withArgs(stranger.address, MANAGER_ROLE);
      });

      it("even if the caller is the owner", async () => {
        await expect(cashbackVaultFromOwner.claim(account.address, amountToClaim))
          .to.be.revertedWithCustomError(cashbackVaultFromOwner, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, MANAGER_ROLE);
      });
    });
  });
  describe("method claimAll(address account)", async () => {
    const initialCashbackBalance = 1000n;
    beforeEach(async () => {
      await cashbackVaultFromOperator.grantCashback(account.address, initialCashbackBalance);
    });

    describe("manager successfully claims all cashback for an account", async () => {
      let tx: TransactionResponse;
      beforeEach(async () => {
        tx = await cashbackVaultFromManager.claimAll(account.address);
      });

      it("should empty account cashback balance", async () => {
        expect(await cashbackVaultFromManager.getAccountCashbackBalance(account.address))
          .to.equal(0n);
      });

      it("should set total cashback balance to zero", async () => {
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

      it("should store lastClaimTimestamp in state", async () => {
        expect((await cashbackVaultFromManager.getAccountCashbackState(account.address)).lastClaimTimestamp)
          .to.equal(await getTxTimestamp(tx));
      });
    });
    describe("should revert if", async () => {
      it("account has no cashback balance", async () => {
      // first revoke all cashback
        await cashbackVaultFromOperator.revokeCashback(account.address, initialCashbackBalance);

        await expect(cashbackVaultFromManager.claimAll(account.address))
          .to.be.revertedWithCustomError(cashbackVaultFromManager, "CashbackVault_AmountZero");
      });

      it("account is zero address", async () => {
        await expect(cashbackVaultFromManager.claimAll(ADDRESS_ZERO))
          .to.be.revertedWithCustomError(cashbackVaultFromManager, "CashbackVault_AccountAddressZero");
      });
    });
    describe("guards: should revert if", async () => {
      it("contract is paused", async () => {
        await cashbackVaultFromPauser.pause();
        await expect(cashbackVaultFromManager.claimAll(account.address))
          .to.be.revertedWithCustomError(cashbackVaultFromManager, "EnforcedPause");
      });

      it("caller does not have MANAGER_ROLE", async () => {
        await expect(cashbackVaultFromStranger.claimAll(account.address))
          .to.be.revertedWithCustomError(cashbackVaultFromStranger, "AccessControlUnauthorizedAccount")
          .withArgs(stranger.address, MANAGER_ROLE);
      });

      it("even if the caller is the owner", async () => {
        await expect(cashbackVaultFromOwner.claimAll(account.address))
          .to.be.revertedWithCustomError(cashbackVaultFromOwner, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, MANAGER_ROLE);
      });
    });
  });
  describe("method $__VERSION()", async () => {
    it("should return version", async () => {
      expect(await cashbackVaultFromStranger.$__VERSION()).to.deep.equal([
        EXPECTED_VERSION.major,
        EXPECTED_VERSION.minor,
        EXPECTED_VERSION.patch
      ]);
    });
  });
  describe("method underlyingToken()", async () => {
    it("should return the underlying token address", async () => {
      expect(await cashbackVaultFromStranger.underlyingToken()).to.equal(await tokenMock.getAddress());
    });
  });
  describe("method proveCashbackVault()", async () => {
    it("should exist and not revert", async () => {
      await expect(cashbackVaultFromStranger.proveCashbackVault()).to.be.not.reverted;
    });
  });

  describe("BDD scenarios", async () => {
    describe("granting 1000 tokens as cashback", async () => {
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

      describe("revoking more than the account has", async () => {
        let tx: Promise<TransactionResponse>;
        beforeEach(async () => {
          tx = cashbackVaultFromOperator.revokeCashback(account.address, 1001n);
        });

        it("should revert", async () => {
          await expect(tx)
            .to.be.revertedWithCustomError(cashbackVaultFromOperator, "CashbackVault_CashbackBalanceInsufficient");
        });
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

        describe("claiming more than the account has", async () => {
          let tx: Promise<TransactionResponse>;
          beforeEach(async () => {
            tx = cashbackVaultFromManager.claim(account.address, 901n);
          });

          it("should revert", async () => {
            await expect(tx)
              .to.be.revertedWithCustomError(cashbackVaultFromManager, "CashbackVault_CashbackBalanceInsufficient");
          });
        });
        describe("claiming 100 tokens of cashback", async () => {
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

          it("the operator's token balance should not change", async () => {
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

          describe("claiming all remaining cashback tokens", async () => {
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

            it("the operator's token balance should not change", async () => {
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
});
