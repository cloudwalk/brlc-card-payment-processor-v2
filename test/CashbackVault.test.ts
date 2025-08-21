import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Result, TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { setUpFixture, maxUintForBits, resultToObject, checkEquality } from "../test-utils/common";
import * as Contracts from "../typechain-types";
import { getTxTimestamp } from "../test-utils/eth";

const ADDRESS_ZERO = ethers.ZeroAddress;
const BALANCE_INITIAL = ethers.MaxUint256 / 2n;

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

  return { cashbackVault, tokenMock };
}
async function configureContracts(cashbackVault: Contracts.CashbackVault, tokenMock: Contracts.ERC20TokenMock) {
  await cashbackVault.grantRole(GRANTOR_ROLE, deployer.address);
  await cashbackVault.grantRole(CASHBACK_OPERATOR_ROLE, operator.address);
  await cashbackVault.grantRole(MANAGER_ROLE, manager.address);
  await cashbackVault.grantRole(PAUSER_ROLE, pauser.address);

  await tokenMock.mint(operator.address, BALANCE_INITIAL);
  await tokenMock.connect(operator).approve(cashbackVault.getAddress(), BALANCE_INITIAL);
}

async function deployAndConfigureContracts() {
  const contracts = await deployContracts();
  await configureContracts(contracts.cashbackVault, contracts.tokenMock);
  return contracts;
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
    const contracts = await setUpFixture(deployAndConfigureContracts);
    cashbackVaultFromOwner = contracts.cashbackVault;
    tokenMock = contracts.tokenMock;
    cashBackVaultAddress = await cashbackVaultFromOwner.getAddress();
    cashbackVaultFromOperator = cashbackVaultFromOwner.connect(operator);
    cashbackVaultFromManager = cashbackVaultFromOwner.connect(manager);
    cashbackVaultFromStranger = cashbackVaultFromOwner.connect(stranger);
    cashbackVaultFromPauser = cashbackVaultFromOwner.connect(pauser);
  });
  describe("Method 'initialize()'", async () => {
    let deployedContract: Contracts.CashbackVault;
    beforeEach(async () => {
      // deploying contract without configuration to test the default state
      const contracts = await setUpFixture(deployContracts);
      deployedContract = contracts.cashbackVault;
    });
    it("should expose correct role hashes", async () => {
      expect(await deployedContract.OWNER_ROLE()).to.equal(OWNER_ROLE);
      expect(await deployedContract.GRANTOR_ROLE()).to.equal(GRANTOR_ROLE);
      expect(await deployedContract.PAUSER_ROLE()).to.equal(PAUSER_ROLE);
      expect(await deployedContract.RESCUER_ROLE()).to.equal(RESCUER_ROLE);
      expect(await deployedContract.MANAGER_ROLE()).to.equal(MANAGER_ROLE);
      expect(await deployedContract.CASHBACK_OPERATOR_ROLE()).to.equal(CASHBACK_OPERATOR_ROLE);
    });

    it("should set correct role admins", async () => {
      expect(await deployedContract.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
      expect(await deployedContract.getRoleAdmin(GRANTOR_ROLE)).to.equal(OWNER_ROLE);
      expect(await deployedContract.getRoleAdmin(PAUSER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await deployedContract.getRoleAdmin(RESCUER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await deployedContract.getRoleAdmin(MANAGER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await deployedContract.getRoleAdmin(CASHBACK_OPERATOR_ROLE)).to.equal(GRANTOR_ROLE);
    });
    it("should set correct roles for the deployer", async () => {
      expect(await deployedContract.hasRole(OWNER_ROLE, deployer.address)).to.be.true;
      expect(await deployedContract.hasRole(GRANTOR_ROLE, deployer.address)).to.be.false;
      expect(await deployedContract.hasRole(PAUSER_ROLE, deployer.address)).to.be.false;
      expect(await deployedContract.hasRole(RESCUER_ROLE, deployer.address)).to.be.false;
      expect(await deployedContract.hasRole(MANAGER_ROLE, deployer.address)).to.be.false;
      expect(await deployedContract.hasRole(CASHBACK_OPERATOR_ROLE, deployer.address)).to.be.false;
    });
    it("should not pause the contract", async () => {
      expect(await deployedContract.paused()).to.equal(false);
    });

    describe("should revert if", async () => {
      it("called a second time", async () => {
        await expect(deployedContract.initialize(await tokenMock.getAddress()))
          .to.be.revertedWithCustomError(deployedContract, "InvalidInitialization");
      });
      it("token address is zero", async () => {
        const tx = upgrades.deployProxy(cashbackVaultFactory, [ADDRESS_ZERO]);
        await expect(tx)
          .to.be.revertedWithCustomError(cashbackVaultFactory, "CashbackVault_TokenAddressZero");
      });
    });
  });
  describe("Method 'upgradeToAndCall()'", async () => {
    it("should upgrade the contract to a new implementation", async () => {
      const newImplementation = await cashbackVaultFactory.deploy();
      await newImplementation.waitForDeployment();

      const tx = cashbackVaultFromOwner.upgradeToAndCall(await newImplementation.getAddress(), "0x");
      await expect(tx).to.emit(cashbackVaultFromOwner, "Upgraded").withArgs(await newImplementation.getAddress());
    });
    describe("should revert if", async () => {
      it("called with a non-CashbackVault implementation", async () => {
        const tx = cashbackVaultFromOwner.upgradeToAndCall(tokenMock.getAddress(), "0x");
        await expect(tx)
          .to.be.revertedWithCustomError(cashbackVaultFromStranger, "CashbackVault_ImplementationAddressInvalid");
      });

      it("called by a non-owner", async () => {
        const tx = cashbackVaultFromStranger.upgradeToAndCall(tokenMock.getAddress(), "0x");
        await expect(tx)
          .to.be.revertedWithCustomError(cashbackVaultFromOperator, "AccessControlUnauthorizedAccount")
          .withArgs(stranger.address, OWNER_ROLE);
      });
    });
  });

  describe("Method 'grantCashback()'", async () => {
    const amountToGrant = maxUintForBits(64);

    describe("caller successfully grants cashback to an account", async () => {
      let initialState: { balance: bigint; lastGrantTimestamp: bigint };
      let tx: TransactionResponse;
      beforeEach(async () => {
        initialState = resultToObject(await cashbackVaultFromOperator.getAccountCashbackState(account.address));
        tx = await cashbackVaultFromOperator.grantCashback(account.address, amountToGrant);
      });

      it("should increase account cashback balance", async () => {
        expect(await cashbackVaultFromOperator.getAccountCashbackBalance(account.address)).to.equal(amountToGrant);
      });

      it("should increase total cashback balance", async () => {
        expect(await cashbackVaultFromOperator.getTotalCashbackBalance()).to.equal(amountToGrant);
      });
      it("should update last grant timestamp", async () => {
        expect((await cashbackVaultFromOperator.getAccountCashbackState(account.address)).lastGrantTimestamp)
          .to.equal(await getTxTimestamp(tx));
      });

      it("should only update relevant state fields", async () => {
        const newState = resultToObject(await cashbackVaultFromOperator.getAccountCashbackState(account.address));
        checkEquality(newState, {
          ...initialState,
          balance: initialState.balance + amountToGrant,
          lastGrantTimestamp: await getTxTimestamp(tx)
        });
      });

      it("should emit event", async () => {
        await expect(tx)
          .to.emit(cashbackVaultFromOperator, "CashbackGranted")
          .withArgs(account.address, operator.address, amountToGrant, amountToGrant);
      });

      it("should move tokens from caller to contract", async () => {
        await expect(tx).to.changeTokenBalances(
          tokenMock,
          [operator.address, cashBackVaultAddress],
          [-amountToGrant, amountToGrant]
        );
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

      it("caller does not have enough tokens", async () => {
        await tokenMock.connect(operator).transfer(stranger.address, BALANCE_INITIAL);
        await expect(cashbackVaultFromOperator.grantCashback(account.address, amountToGrant))
          .to.be.revertedWithCustomError(tokenMock, "ERC20InsufficientBalance");
      });

      it("caller does not have enough allowance", async () => {
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
      it("caller does not have required role", async () => {
        await expect(cashbackVaultFromStranger.grantCashback(account.address, amountToGrant))
          .to.be.revertedWithCustomError(cashbackVaultFromStranger, "AccessControlUnauthorizedAccount")
          .withArgs(stranger.address, CASHBACK_OPERATOR_ROLE);
      });
      it("the caller is owner but does not have the required role", async () => {
        await expect(cashbackVaultFromOwner.grantCashback(account.address, amountToGrant))
          .to.be.revertedWithCustomError(cashbackVaultFromOwner, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, CASHBACK_OPERATOR_ROLE);
      });
    });
  });
  describe("Method 'revokeCashback()'", async () => {
    const initialCashbackBalance = maxUintForBits(64) / 2n;
    const amountToRevoke = initialCashbackBalance / 2n;
    beforeEach(async () => {
      // prepare some existing cashback state
      await cashbackVaultFromOperator.grantCashback(account.address, initialCashbackBalance);
    });

    describe("caller successfully revokes cashback from an account", async () => {
      let tx: TransactionResponse;
      let initialState: { balance: bigint };
      beforeEach(async () => {
        initialState = resultToObject(await cashbackVaultFromOperator.getAccountCashbackState(account.address));
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

      it("should move tokens from contract to caller", async () => {
        await expect(tx).to.changeTokenBalances(
          tokenMock,
          [cashBackVaultAddress, operator.address],
          [-amountToRevoke, amountToRevoke]
        );
      });

      it("should only update relevant state fields", async () => {
        const newState = resultToObject(await cashbackVaultFromOperator.getAccountCashbackState(account.address));
        checkEquality(newState, {
          ...initialState,
          balance: initialState.balance - amountToRevoke
        });
      });

      it("should emit event", async () => {
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

      it("caller does not have required role", async () => {
        await expect(cashbackVaultFromStranger.revokeCashback(account.address, amountToRevoke))
          .to.be.revertedWithCustomError(cashbackVaultFromStranger, "AccessControlUnauthorizedAccount")
          .withArgs(stranger.address, CASHBACK_OPERATOR_ROLE);
      });

      it("the caller is owner but does not have the required role", async () => {
        await expect(cashbackVaultFromOwner.revokeCashback(account.address, amountToRevoke))
          .to.be.revertedWithCustomError(cashbackVaultFromOwner, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, CASHBACK_OPERATOR_ROLE);
      });
    });
  });

  describe("Method 'claim()'", async () => {
    const initialCashbackBalance = maxUintForBits(64) / 2n;
    const amountToClaim = initialCashbackBalance / 2n;
    let initialState: { balance: bigint; lastClaimTimestamp: bigint; totalClaimed: bigint };
    beforeEach(async () => {
      // prepare some existing cashback state
      await cashbackVaultFromOperator.grantCashback(account.address, initialCashbackBalance);
      initialState = resultToObject(await cashbackVaultFromManager.getAccountCashbackState(account.address));
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

      it("should move tokens from contract to account", async () => {
        await expect(tx).to.changeTokenBalances(
          tokenMock,
          [cashBackVaultAddress, account.address],
          [-amountToClaim, amountToClaim]
        );
      });

      it("should only update relevant state fields", async () => {
        const newState = resultToObject(await cashbackVaultFromManager.getAccountCashbackState(account.address));
        checkEquality(newState, {
          ...initialState,
          balance: initialState.balance - amountToClaim,
          lastClaimTimestamp: await getTxTimestamp(tx),
          totalClaimed: initialState.totalClaimed + amountToClaim
        });
      });

      it("should emit event", async () => {
        await expect(tx)
          .to.emit(cashbackVaultFromManager, "CashbackClaimed")
          .withArgs(account.address, manager.address, amountToClaim, initialCashbackBalance - amountToClaim);
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

      it("caller does not have required role", async () => {
        await expect(cashbackVaultFromStranger.claim(account.address, amountToClaim))
          .to.be.revertedWithCustomError(cashbackVaultFromStranger, "AccessControlUnauthorizedAccount")
          .withArgs(stranger.address, MANAGER_ROLE);
      });

      it("the caller is owner but does not have the required role", async () => {
        await expect(cashbackVaultFromOwner.claim(account.address, amountToClaim))
          .to.be.revertedWithCustomError(cashbackVaultFromOwner, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, MANAGER_ROLE);
      });
    });
  });
  describe("Method 'claimAll()'", async () => {
    const initialCashbackBalance = maxUintForBits(64) / 2n;
    let initialState: { balance: bigint; lastClaimTimestamp: bigint; totalClaimed: bigint };
    beforeEach(async () => {
      await cashbackVaultFromOperator.grantCashback(account.address, initialCashbackBalance);
      initialState = resultToObject(await cashbackVaultFromManager.getAccountCashbackState(account.address));
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

      it("should move tokens from contract to account", async () => {
        await expect(tx).to.changeTokenBalances(
          tokenMock,
          [cashBackVaultAddress, account.address],
          [-initialCashbackBalance, initialCashbackBalance]
        );
      });

      it("should only update relevant state fields", async () => {
        const newState = resultToObject(await cashbackVaultFromManager.getAccountCashbackState(account.address));
        checkEquality(newState, {
          ...initialState,
          balance: 0n,
          totalClaimed: initialState.totalClaimed + initialCashbackBalance,
          lastClaimTimestamp: await getTxTimestamp(tx)
        });
      });

      it("should emit event", async () => {
        await expect(tx)
          .to.emit(cashbackVaultFromManager, "CashbackClaimed")
          .withArgs(account.address, manager.address, initialCashbackBalance, 0n);
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

      it("caller does not have required role", async () => {
        await expect(cashbackVaultFromStranger.claimAll(account.address))
          .to.be.revertedWithCustomError(cashbackVaultFromStranger, "AccessControlUnauthorizedAccount")
          .withArgs(stranger.address, MANAGER_ROLE);
      });

      it("the caller is owner but does not have the required role", async () => {
        await expect(cashbackVaultFromOwner.claimAll(account.address))
          .to.be.revertedWithCustomError(cashbackVaultFromOwner, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, MANAGER_ROLE);
      });
    });
  });
  describe("Method '$__VERSION()'", async () => {
    it("should return the expected version", async () => {
      expect(await cashbackVaultFromStranger.$__VERSION()).to.deep.equal([
        EXPECTED_VERSION.major,
        EXPECTED_VERSION.minor,
        EXPECTED_VERSION.patch
      ]);
    });
  });
  describe("Method 'underlyingToken()'", async () => {
    it("should return the underlying token address", async () => {
      expect(await cashbackVaultFromStranger.underlyingToken()).to.equal(await tokenMock.getAddress());
    });
  });
  describe("Method 'proveCashbackVault()'", async () => {
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

      it("should emit event", async () => {
        await expect(tx)
          .to.emit(cashbackVaultFromOperator, "CashbackGranted")
          .withArgs(account.address, operator.address, 1000n, 1000n);
      });

      it("should move tokens from caller to contract", async () => {
        await expect(tx).to.changeTokenBalances(
          tokenMock,
          [operator.address, cashBackVaultAddress],
          [-1000n, 1000n]
        );
      });

      it("should increase contract's tracked total cashback balance", async () => {
        expect(await cashbackVaultFromOperator.getTotalCashbackBalance()).to.equal(1000n);
      });

      it("should increase account cashback balance", async () => {
        expect(await cashbackVaultFromOperator.getAccountCashbackBalance(account.address)).to.equal(1000n);
      });

      it("should not change account total claimed amount in state", async () => {
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

        it("should emit event", async () => {
          await expect(tx)
            .to.emit(cashbackVaultFromOperator, "CashbackRevoked")
            .withArgs(account.address, operator.address, 100n, 900n);
        });

        it("should move tokens from contract to caller", async () => {
          await expect(tx).to.changeTokenBalances(
            tokenMock,
            [cashBackVaultAddress, operator.address],
            [-100n, 100n]
          );
        });

        it("should decrease contract's tracked total cashback balance", async () => {
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

          it("should emit event", async () => {
            await expect(tx)
              .to.emit(cashbackVaultFromOperator, "CashbackClaimed")
              .withArgs(account.address, manager.address, 100n, 800n);
          });

          it("should move tokens from contract to account", async () => {
            await expect(tx).to.changeTokenBalances(
              tokenMock,
              [cashBackVaultAddress, account.address],
              [-100n, 100n]
            );
          });

          it("should decrease contract's tracked total cashback balance", async () => {
            expect(await cashbackVaultFromOperator.getTotalCashbackBalance()).to.equal(800n);
          });

          it("the caller's token balance should not change", async () => {
            await expect(tx).to.changeTokenBalances(
              tokenMock,
              [operator.address],
              [0n]
            );
          });

          it("should decrease account cashback balance", async () => {
            expect(await cashbackVaultFromOperator.getAccountCashbackBalance(account.address)).to.equal(800n);
          });

          it("should increase account total claimed amount in state", async () => {
            expect((await cashbackVaultFromOperator.getAccountCashbackState(account.address)).totalClaimed)
              .to.equal(100n);
          });

          describe("claiming all remaining cashback tokens", async () => {
            let tx: TransactionResponse;
            beforeEach(async () => {
              tx = await cashbackVaultFromManager.claimAll(account.address);
            });

            it("should emit event", async () => {
              await expect(tx)
                .to.emit(cashbackVaultFromOperator, "CashbackClaimed")
                .withArgs(account.address, manager.address, 800n, 0n);
            });

            it("should move tokens from contract to account", async () => {
              await expect(tx).to.changeTokenBalances(
                tokenMock,
                [cashBackVaultAddress, account.address],
                [-800n, 800n]
              );
            });

            it("should decrease contract's tracked total cashback balance", async () => {
              expect(await cashbackVaultFromOperator.getTotalCashbackBalance()).to.equal(0n);
            });

            it("the caller's token balance should not change", async () => {
              await expect(tx).to.changeTokenBalances(
                tokenMock,
                [operator.address],
                [0n]
              );
            });

            it("should decrease account cashback balance", async () => {
              expect(await cashbackVaultFromOperator.getAccountCashbackBalance(account.address)).to.equal(0n);
            });

            it("should increase account total claimed amount in state", async () => {
              expect((await cashbackVaultFromOperator.getAccountCashbackState(account.address)).totalClaimed)
                .to.equal(900n);
            });
          });
        });
      });
    });
  });
});
