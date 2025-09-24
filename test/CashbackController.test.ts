/* eslint @typescript-eslint/no-unused-vars: "off" */

import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Typed } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { TransactionResponse } from "ethers";
import * as Contracts from "../typechain-types";

import { checkEquality, resultToObject, setUpFixture } from "../test-utils/common";
import { getTxTimestamp, increaseBlockTimestamp } from "../test-utils/eth";

describe("Contract 'CashbackController'", () => {
  const TOKEN_DECIMALS = 6n;
  const CASHBACK_FACTOR = 1000n;
  const DIGITS_COEF = 10n ** TOKEN_DECIMALS;
  const INITIAL_TREASURY_BALANCE = (10n ** 6n) * DIGITS_COEF;
  const CASHBACK_TREASURY_ADDRESS_STUB1 = "0x0000000000000000000000000000000000000001";
  const CASHBACK_CAP_RESET_PERIOD = 30 * 24 * 60 * 60;
  const MAX_CASHBACK_FOR_CAP_PERIOD = 300n * DIGITS_COEF;
  const EXPECTED_VERSION = {
    major: 2n,
    minor: 4n,
    patch: 0n,
  } as const;

  const OWNER_ROLE: string = ethers.id("OWNER_ROLE");
  const GRANTOR_ROLE: string = ethers.id("GRANTOR_ROLE");
  const HOOK_TRIGGER_ROLE: string = ethers.id("HOOK_TRIGGER_ROLE");
  const CASHBACK_OPERATOR_ROLE = ethers.id("CASHBACK_OPERATOR_ROLE");
  const MANAGER_ROLE = ethers.id("MANAGER_ROLE");

  let cashbackControllerFactory: Contracts.CashbackController__factory;
  let cashbackControllerFactoryWithForcibleRole: Contracts.CashbackControllerWithForcibleRole__factory;
  let tokenMockFactory: Contracts.ERC20TokenMock__factory;
  let cashbackVaultFactory: Contracts.CashbackVault__factory;
  let cardPaymentProcessorFactory: Contracts.CardPaymentProcessor__factory;

  let cashbackController: Contracts.CashbackController;
  let cashbackControllerFromOwner: Contracts.CashbackController;
  let cashbackControllerFromHookTrigger: Contracts.CashbackController;
  let cashbackControllerFromStranger: Contracts.CashbackController;
  let cashbackControllerFromCashbackOperator: Contracts.CashbackController;

  let tokenMock: Contracts.ERC20TokenMock;

  let cashbackControllerAddress: string;

  let deployer: HardhatEthersSigner;
  let hookTrigger: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let payer: HardhatEthersSigner;
  let treasury: HardhatEthersSigner;
  let treasury2: HardhatEthersSigner;
  let sponsor: HardhatEthersSigner;
  let cashbackOperator: HardhatEthersSigner;

  type Payment = Exclude<Parameters<typeof cashbackControllerFromOwner.afterPaymentMade>[1], Typed>;

  const EMPTY_PAYMENT: Payment = {
    baseAmount: 0n,
    subsidyLimit: 0n,
    status: 0n,
    payer: ethers.ZeroAddress,
    cashbackRate: 0n,
    confirmedAmount: 0n,
    sponsor: ethers.ZeroAddress,
    extraAmount: 0n,
    refundAmount: 0n,
  };
  enum CashbackStatus {
    Undefined = 0,
    Success = 1,
    Partial = 2,
    Capped = 3,
    OutOfFunds = 4,
  }

  function paymentId(description: string) {
    return ethers.keccak256(ethers.toUtf8Bytes(description));
  }

  async function deployTokenMock(nameSuffix = "") {
    const name = `ERC20 Test ${nameSuffix}`;
    const symbol = `TEST${nameSuffix}`;
    const tokenMockDeployment = await tokenMockFactory.deploy(name, symbol);
    await tokenMockDeployment.waitForDeployment();
    return tokenMockDeployment;
  }

  async function deployRegularCashbackController(tokenMock: Contracts.ERC20TokenMock) {
    const cashbackController = await upgrades.deployProxy(cashbackControllerFactory, [await tokenMock.getAddress()]);
    await cashbackController.waitForDeployment();
    return cashbackController;
  }

  async function deployCashbackControllerWithForcibleRole(tokenMock: Contracts.ERC20TokenMock) {
    const cashbackController = await upgrades.deployProxy(
      cashbackControllerFactoryWithForcibleRole,
      [await tokenMock.getAddress()],
    );
    await cashbackController.waitForDeployment();
    return cashbackController;
  }

  async function deployCashbackVault(tokenMock: Contracts.ERC20TokenMock) {
    const cashbackVault = await upgrades.deployProxy(cashbackVaultFactory, [await tokenMock.getAddress()]);
    await cashbackVault.waitForDeployment();
    return cashbackVault;
  }

  async function deployTestableContracts() {
    const tokenMock = await deployTokenMock();
    const cashbackController = await deployCashbackControllerWithForcibleRole(tokenMock);

    return { cashbackController, tokenMock };
  }

  async function deployContractsWithRegularCashbackController() {
    const tokenMock = await deployTokenMock();
    const cashbackController = await deployRegularCashbackController(tokenMock);

    return { cashbackController, tokenMock };
  }

  async function configureTestableContracts(
    cashbackController: Contracts.CashbackControllerWithForcibleRole,
    tokenMock: Contracts.ERC20TokenMock,
  ) {
    await cashbackController.grantRole(GRANTOR_ROLE, deployer.address);
    await cashbackController.forceHookTriggerRole(hookTrigger.address);
    await cashbackController.grantRole(CASHBACK_OPERATOR_ROLE, cashbackOperator.address);

    await tokenMock.mint(treasury.address, INITIAL_TREASURY_BALANCE);
    await tokenMock.connect(treasury).approve(await cashbackController.getAddress(), ethers.MaxUint256);
    await tokenMock.connect(payer).approve(await cashbackController.getAddress(), ethers.MaxUint256);
  }

  async function deployAndConfigureContracts() {
    const contracts = await deployTestableContracts();
    await configureTestableContracts(contracts.cashbackController, contracts.tokenMock);
    return contracts;
  }

  before(async () => {
    [deployer, hookTrigger, stranger, treasury, treasury2, payer, sponsor, cashbackOperator] =
      await ethers.getSigners();

    // Contract factories with the explicitly specified deployer account
    cashbackControllerFactory = await ethers.getContractFactory("CashbackController");
    cashbackControllerFactory = cashbackControllerFactory.connect(deployer);
    cashbackControllerFactoryWithForcibleRole = await ethers.getContractFactory("CashbackControllerWithForcibleRole");
    cashbackControllerFactoryWithForcibleRole = cashbackControllerFactoryWithForcibleRole.connect(deployer);
    cardPaymentProcessorFactory = await ethers.getContractFactory("CardPaymentProcessor");
    cardPaymentProcessorFactory = cardPaymentProcessorFactory.connect(deployer);
    tokenMockFactory = await ethers.getContractFactory("ERC20TokenMock");
    tokenMockFactory = tokenMockFactory.connect(deployer);
    cashbackVaultFactory = await ethers.getContractFactory("CashbackVault");
  });

  beforeEach(async () => {
    const contracts = await setUpFixture(deployAndConfigureContracts);
    cashbackController = cashbackControllerFromOwner = contracts.cashbackController;
    tokenMock = contracts.tokenMock;
    cashbackControllerAddress = await cashbackControllerFromOwner.getAddress();
    cashbackControllerFromHookTrigger = cashbackControllerFromOwner.connect(hookTrigger);
    cashbackControllerFromStranger = cashbackControllerFromOwner.connect(stranger);
    cashbackControllerFromCashbackOperator = cashbackControllerFromOwner.connect(cashbackOperator);
  });

  describe("Method 'initialize()'", () => {
    let deployedContract: Contracts.CashbackController;

    beforeEach(async () => {
      // deploying contract without configuration to test the default state
      const contracts = await setUpFixture(deployContractsWithRegularCashbackController);
      deployedContract = contracts.cashbackController;
    });

    describe("Should execute as expected when called properly and", () => {
      it("should expose correct role hashes", async () => {
        expect(await deployedContract.OWNER_ROLE()).to.equal(OWNER_ROLE);
        expect(await deployedContract.GRANTOR_ROLE()).to.equal(GRANTOR_ROLE);
        expect(await deployedContract.HOOK_TRIGGER_ROLE()).to.equal(HOOK_TRIGGER_ROLE);
        expect(await deployedContract.CASHBACK_OPERATOR_ROLE()).to.equal(CASHBACK_OPERATOR_ROLE);
      });

      it("should set correct role admins", async () => {
        expect(await deployedContract.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
        expect(await deployedContract.getRoleAdmin(GRANTOR_ROLE)).to.equal(OWNER_ROLE);
        expect(await deployedContract.getRoleAdmin(HOOK_TRIGGER_ROLE)).to.equal(GRANTOR_ROLE);
        expect(await deployedContract.getRoleAdmin(CASHBACK_OPERATOR_ROLE)).to.equal(GRANTOR_ROLE);
      });

      it("should set correct roles for the deployer", async () => {
        expect(await deployedContract.hasRole(OWNER_ROLE, deployer.address)).to.eq(true);
        expect(await deployedContract.hasRole(GRANTOR_ROLE, deployer.address)).to.eq(false);
        expect(await deployedContract.hasRole(HOOK_TRIGGER_ROLE, deployer.address)).to.eq(false);
        expect(await deployedContract.hasRole(CASHBACK_OPERATOR_ROLE, deployer.address)).to.eq(false);
      });

      it("should set correct underlying token address", async () => {
        expect(await cashbackControllerFromOwner.underlyingToken()).to.equal(await tokenMock.getAddress());
      });

      it("should not set cashback treasury address", async () => {
        expect(await cashbackControllerFromOwner.getCashbackTreasury()).to.equal(ethers.ZeroAddress);
      });

      it("should not set cashback vault address", async () => {
        expect(await cashbackControllerFromOwner.getCashbackVault()).to.equal(ethers.ZeroAddress);
      });
    });

    describe("Should revert if", () => {
      it("called a second time", async () => {
        await expect(deployedContract.initialize(await tokenMock.getAddress()))
          .to.be.revertedWithCustomError(deployedContract, "InvalidInitialization");
      });

      it("the provided token address is zero", async () => {
        const tx = upgrades.deployProxy(cashbackControllerFactory, [ethers.ZeroAddress]);
        await expect(tx)
          .to.be.revertedWithCustomError(cashbackControllerFactory, "CashbackController_TokenAddressZero");
      });
    });
  });

  describe("Method 'grantRole()' with HOOK_TRIGGER_ROLE role", () => {
    let deployedContract: Contracts.CashbackController;
    let specificTokenMock: Contracts.ERC20TokenMock;

    beforeEach(async () => {
      // deploying contract without configuration to test the default state
      const contracts = await setUpFixture(deployContractsWithRegularCashbackController);
      deployedContract = contracts.cashbackController;
      specificTokenMock = contracts.tokenMock;
      await deployedContract.grantRole(GRANTOR_ROLE, deployer.address);
    });

    describe("Should execute as expected when called properly and", () => {
      it("should grant the role to the caller contract with the correct underlying token", async () => {
        const cardPaymentProcessor =
          await upgrades.deployProxy(cardPaymentProcessorFactory, [await specificTokenMock.getAddress()]);

        await expect(deployedContract.grantRole(HOOK_TRIGGER_ROLE, await cardPaymentProcessor.getAddress()))
          .to.emit(deployedContract, "RoleGranted")
          .withArgs(HOOK_TRIGGER_ROLE, await cardPaymentProcessor.getAddress(), deployer.address);
      });
    });

    describe("Should revert if", async () => {
      it("provided account is EOA", async () => {
        await expect(deployedContract.grantRole(HOOK_TRIGGER_ROLE, stranger.address))
          .to.be.revertedWithCustomError(deployedContract, "CashbackController_HookTriggerRoleIncompatible");
      });

      it("provided account is contract but not a CardPaymentProcessor", async () => {
        await expect(deployedContract.grantRole(HOOK_TRIGGER_ROLE, tokenMock.getAddress()))
          .to.be.revertedWithCustomError(deployedContract, "CashbackController_HookTriggerRoleIncompatible");
      });

      it("provided account is CardPaymentProcessor but the underlying token mismatches the controller token",
        async () => {
          const cardPaymentProcessor =
            await upgrades.deployProxy(cardPaymentProcessorFactory, [await tokenMock.getAddress()]);
          await expect(deployedContract.grantRole(HOOK_TRIGGER_ROLE, await cardPaymentProcessor.getAddress()))
            .to.be.revertedWithCustomError(deployedContract, "CashbackController_HookTriggerRoleIncompatible");
        });
    });
  });

  describe("Method 'upgradeToAndCall()'", () => {
    describe("Should execute as expected when called properly and", () => {
      it("should upgrade the contract to a new implementation", async () => {
        const newImplementation = await cashbackControllerFactory.deploy();
        await newImplementation.waitForDeployment();

        const tx = cashbackControllerFromOwner.upgradeToAndCall(await newImplementation.getAddress(), "0x");
        await expect(tx)
          .to.emit(cashbackControllerFromOwner, "Upgraded")
          .withArgs(
            await newImplementation.getAddress(),
          );
      });
    });

    describe("Should revert if", () => {
      it("called with the address of an incompatible implementation", async () => {
        const tx = cashbackControllerFromOwner.upgradeToAndCall(tokenMock.getAddress(), "0x");
        await expect(tx)
          .to.be.revertedWithCustomError(cashbackController, "CashbackController_ImplementationAddressInvalid");
      });

      it("called by a non-owner", async () => {
        const tx = cashbackControllerFromStranger.upgradeToAndCall(tokenMock.getAddress(), "0x");
        await expect(tx)
          .to.be.revertedWithCustomError(cashbackController, "AccessControlUnauthorizedAccount")
          .withArgs(stranger.address, OWNER_ROLE);
      });
    });
  });

  describe("Methods 'setCashbackTreasury()' and 'getCashbackTreasury()'", () => {
    describe("Should execute as expected when called properly and", () => {
      let tx: TransactionResponse;

      beforeEach(async () => {
        await tokenMock.connect(treasury).approve(cashbackControllerAddress, ethers.MaxUint256);
        tx = await cashbackControllerFromOwner.setCashbackTreasury(treasury.address);
      });

      it("should emit the required event", async () => {
        await expect(tx)
          .to.emit(cashbackControllerFromOwner, "CashbackTreasuryUpdated")
          .withArgs(treasury.address, ethers.ZeroAddress);
      });

      it("should change the cashback treasury address", async () => {
        expect(await cashbackControllerFromOwner.getCashbackTreasury()).to.equal(treasury.address);
      });

      it("should emit the required event if the cashback treasury is changed again", async () => {
        await tokenMock.connect(treasury2).approve(cashbackControllerAddress, ethers.MaxUint256);
        tx = await cashbackControllerFromOwner.setCashbackTreasury(treasury2.address);

        await expect(tx)
          .to.emit(cashbackControllerFromOwner, "CashbackTreasuryUpdated")
          .withArgs(treasury2.address, treasury.address);
      });
    });

    describe("Should revert if", () => {
      it("the caller does not have the required role", async () => {
        await expect(cashbackControllerFromStranger.setCashbackTreasury(treasury.address))
          .to.be.revertedWithCustomError(cashbackControllerFromStranger, "AccessControlUnauthorizedAccount")
          .withArgs(stranger.address, OWNER_ROLE);
      });

      it("new cashback treasury address is zero", async () => {
        await expect(cashbackControllerFromOwner.setCashbackTreasury(ethers.ZeroAddress))
          .to.be.revertedWithCustomError(cashbackControllerFromOwner, "CashbackController_TreasuryAddressZero");
      });

      it("if the cashback treasury is not changed", async () => {
        await cashbackControllerFromOwner.setCashbackTreasury(treasury.address);

        await expect(cashbackControllerFromOwner.setCashbackTreasury(treasury.address))
          .to.be.revertedWithCustomError(cashbackControllerFromOwner, "CashbackController_TreasuryUnchanged");
      });

      it("if the cashback treasury has no allowance for the contract", async () => {
        await expect(cashbackControllerFromOwner.setCashbackTreasury(CASHBACK_TREASURY_ADDRESS_STUB1))
          .to.be.revertedWithCustomError(cashbackControllerFromOwner, "CashbackController_TreasuryAllowanceZero");
      });
    });
  });

  describe("Method '$__VERSION()'", () => {
    it("should return the expected version", async () => {
      expect(await cashbackControllerFromStranger.$__VERSION()).to.deep.equal([
        EXPECTED_VERSION.major,
        EXPECTED_VERSION.minor,
        EXPECTED_VERSION.patch,
      ]);
    });
  });

  describe("Method 'supportsHookMethod()'", () => {
    it("should return the expected value for supported hook methods", async () => {
      expect(await cashbackControllerFromHookTrigger.supportsHookMethod(
        cashbackController.afterPaymentMade.fragment.selector,
      )).to.equal(true);
      expect(await cashbackControllerFromHookTrigger.supportsHookMethod(
        cashbackController.afterPaymentUpdated.fragment.selector,
      )).to.equal(true);
      expect(await cashbackControllerFromHookTrigger.supportsHookMethod(
        cashbackController.afterPaymentCanceled.fragment.selector,
      )).to.equal(true);
    });

    it("should revert if the caller does not have the required role", async () => {
      await expect(cashbackControllerFromStranger.supportsHookMethod(
        cashbackController.afterPaymentMade.fragment.selector,
      )).to.be.revertedWithCustomError(cashbackControllerFromStranger, "AccessControlUnauthorizedAccount")
        .withArgs(stranger.address, HOOK_TRIGGER_ROLE);
    });
  });

  describe("Method 'proveCashbackController()'", () => {
    it("should exist and not revert", async () => {
      await expect(cashbackControllerFromStranger.proveCashbackController()).to.be.not.reverted;
    });
  });

  describe("Method 'setCashbackVault()'", () => {
    let defaultTokenCashbackVaults: Contracts.CashbackVault[];

    beforeEach(async () => {
      defaultTokenCashbackVaults = await setUpFixture(async function deployCashbackVaultWithToken() {
        return [await deployCashbackVault(tokenMock), await deployCashbackVault(tokenMock)];
      });
    });

    describe(
      "Should execute as expected when initially setting the cashback vault (enabling the claimable mode) and",
      async () => {
        let tx: TransactionResponse;
        beforeEach(async () => {
          tx = await cashbackControllerFromOwner.setCashbackVault(await defaultTokenCashbackVaults[0].getAddress());
        });

        it("should set maximum allowance for the new CV contract", async () => {
          expect(await tokenMock.allowance(cashbackControllerAddress, await defaultTokenCashbackVaults[0].getAddress()))
            .to.equal(ethers.MaxUint256);
        });

        it("should emit the required event", async () => {
          await expect(tx)
            .to.emit(cashbackController, "CashbackVaultUpdated")
            .withArgs(await defaultTokenCashbackVaults[0].getAddress(), ethers.ZeroAddress);
        });

        it("should update the cashback vault", async () => {
          expect(await cashbackController.getCashbackVault())
            .to.equal(await defaultTokenCashbackVaults[0].getAddress());
        });
      },
    );
    describe("Should execute as expected when updating the cashback vault and", () => {
      let tx: TransactionResponse;
      beforeEach(async () => {
        await cashbackControllerFromOwner.setCashbackVault(await defaultTokenCashbackVaults[0].getAddress());
        tx = await cashbackControllerFromOwner.setCashbackVault(await defaultTokenCashbackVaults[1].getAddress());
      });

      it("should set maximum allowance for the new vault contract", async () => {
        expect(await tokenMock.allowance(cashbackControllerAddress, await defaultTokenCashbackVaults[1].getAddress()))
          .to.equal(ethers.MaxUint256);
      });

      it("should remove allowance from the old CV contract", async () => {
        expect(await tokenMock.allowance(cashbackControllerAddress, await defaultTokenCashbackVaults[0].getAddress()))
          .to.equal(0);
      });

      it("should emit the required event", async () => {
        await expect(tx)
          .to.emit(cashbackController, "CashbackVaultUpdated")
          .withArgs(await defaultTokenCashbackVaults[1].getAddress(), await defaultTokenCashbackVaults[0].getAddress());
      });

      it("should update the cashback vault", async () => {
        expect(await cashbackController.getCashbackVault())
          .to.equal(await defaultTokenCashbackVaults[1].getAddress());
      });
    });

    describe("Should execute as expected when setting the cashback vault to zero (disabling claimable mode) and",
      () => {
        let tx: TransactionResponse;
        beforeEach(async () => {
          await cashbackControllerFromOwner.setCashbackVault(await defaultTokenCashbackVaults[0].getAddress());

          tx = await cashbackControllerFromOwner.setCashbackVault(ethers.ZeroAddress);
        });

        it("should remove allowance from the old CV contract", async () => {
          expect(await tokenMock.allowance(cashbackControllerAddress, await defaultTokenCashbackVaults[0].getAddress()))
            .to.equal(0);
        });

        it("should emit the required event", async () => {
          await expect(tx)
            .to.emit(cashbackController, "CashbackVaultUpdated")
            .withArgs(ethers.ZeroAddress, await defaultTokenCashbackVaults[0].getAddress());
        });

        it("should update the cashback vault", async () => {
          expect(await cashbackController.getCashbackVault())
            .to.equal(ethers.ZeroAddress);
        });
      });

    describe("Should revert if", () => {
      it("the provided cashback vault contract is invalid", async () => {
        await expect(cashbackControllerFromOwner.setCashbackVault(await tokenMock.getAddress()))
          .to.be.revertedWithCustomError(cashbackController, "CashbackController_CashbackVaultInvalid");
      });

      it("the cashback vault underlying token mismatches the controller token", async () => {
        const anotherTokenMock = await deployTokenMock("2");
        const anotherCashbackVault = await deployCashbackVault(anotherTokenMock);
        await expect(cashbackControllerFromOwner.setCashbackVault(await anotherCashbackVault.getAddress()))
          .to.be.revertedWithCustomError(cashbackController, "CashbackController_CashbackVaultTokenMismatch");
      });

      it("the caller does not have the required role", async () => {
        await expect(
          cashbackControllerFromStranger.setCashbackVault(await defaultTokenCashbackVaults[0].getAddress()),
        ).to.be.revertedWithCustomError(cashbackControllerFromStranger, "AccessControlUnauthorizedAccount")
          .withArgs(stranger.address, OWNER_ROLE);
      });

      it("the same cashback vault contract is set again", async () => {
        await cashbackControllerFromOwner.setCashbackVault(await defaultTokenCashbackVaults[0].getAddress());

        await expect(cashbackControllerFromOwner.setCashbackVault(await defaultTokenCashbackVaults[0].getAddress()))
          .to.be.revertedWithCustomError(cashbackController, "CashbackController_CashbackVaultUnchanged");
      });

      it("the provided cashback vault account has no code", async () => {
        await expect(cashbackControllerFromOwner.setCashbackVault(CASHBACK_TREASURY_ADDRESS_STUB1))
          .to.be.revertedWithCustomError(cashbackController, "CashbackController_CashbackVaultInvalid");
      });
    });
  });

  describe("Method 'correctCashbackAmount()'", () => {
    const baseAmount = 100n * DIGITS_COEF;
    const cashbackRate = 100n;
    const cashbackAmount = cashbackRate * baseAmount / CASHBACK_FACTOR;
    beforeEach(async () => {
      await setUpFixture(async function setUpTreasury() {
        await cashbackControllerFromOwner.setCashbackTreasury(treasury.address);
      });
      const paymentHookData: Payment = {
        baseAmount,
        subsidyLimit: 100n,
        status: 1n,
        payer: payer.address,
        cashbackRate,
        confirmedAmount: 0n,
        sponsor: ethers.ZeroAddress,
        extraAmount: 0n,
        refundAmount: 0n,
      };
      await cashbackControllerFromHookTrigger.afterPaymentMade(
        paymentId("id1"),
        EMPTY_PAYMENT,
        paymentHookData,
      );
    });

    describe("Should revert if", () => {
      it("the caller does not have the required role", async () => {
        await expect(cashbackControllerFromStranger.correctCashbackAmount(paymentId("id1"), cashbackAmount))
          .to.be.revertedWithCustomError(cashbackControllerFromStranger, "AccessControlUnauthorizedAccount")
          .withArgs(stranger.address, CASHBACK_OPERATOR_ROLE);
      });

      it("the payment cashback does not exist", async () => {
        await expect(cashbackControllerFromCashbackOperator.correctCashbackAmount(paymentId("nothing"), cashbackAmount))
          .to.be.revertedWithCustomError(cashbackController, "CashbackController_CashbackDoesNotExist");
      });
    });

    describe("Should execute as expected when called properly and if", () => {
      describe("cashback amount is increased", () => {
        let tx: TransactionResponse;
        const newCashbackAmount = cashbackAmount + 10n * DIGITS_COEF;
        const increasedAmount = newCashbackAmount - cashbackAmount;
        beforeEach(async () => {
          tx = await cashbackControllerFromCashbackOperator.correctCashbackAmount(paymentId("id1"), newCashbackAmount);
        });

        it("should emit the required event", async () => {
          await expect(tx).to.emit(cashbackController, "CashbackIncreased")
            .withArgs(paymentId("id1"), payer.address, CashbackStatus.Success, increasedAmount, newCashbackAmount);
        });

        it("should store the cashback state", async () => {
          const operationState = resultToObject(await cashbackController
            .getPaymentCashback(paymentId("id1")));
          checkEquality(operationState, {
            balance: newCashbackAmount,
            recipient: payer.address,
          });
        });
      });

      describe("cashback amount is decreased", () => {
        let tx: TransactionResponse;
        const newCashbackAmount = cashbackAmount - 10n * DIGITS_COEF;
        const decreasedAmount = cashbackAmount - newCashbackAmount;
        beforeEach(async () => {
          tx = await cashbackControllerFromCashbackOperator.correctCashbackAmount(paymentId("id1"), newCashbackAmount);
        });

        it("should emit the required event", async () => {
          await expect(tx).to.emit(cashbackController, "CashbackDecreased")
            .withArgs(paymentId("id1"), payer.address, CashbackStatus.Success, decreasedAmount, newCashbackAmount);
        });

        it("should store the cashback state", async () => {
          const operationState = resultToObject(await cashbackController
            .getPaymentCashback(paymentId("id1")));
          checkEquality(operationState, {
            balance: newCashbackAmount,
            recipient: payer.address,
          });
        });
      });

      describe("cashback amount is set to zero", () => {
        let tx: TransactionResponse;
        const newCashbackAmount = 0n;
        const decreasedAmount = cashbackAmount - newCashbackAmount;
        beforeEach(async () => {
          tx = await cashbackControllerFromCashbackOperator.correctCashbackAmount(paymentId("id1"), newCashbackAmount);
        });

        it("should emit the required event", async () => {
          await expect(tx).to.emit(cashbackController, "CashbackDecreased")
            .withArgs(paymentId("id1"), payer.address, CashbackStatus.Success, decreasedAmount, newCashbackAmount);
        });

        it("should store the cashback state", async () => {
          const operationState = resultToObject(await cashbackController
            .getPaymentCashback(paymentId("id1")));
          checkEquality(operationState, {
            balance: newCashbackAmount,
            recipient: payer.address,
          });
        });
      });

      describe("cashback amount is same as the current amount", () => {
        let tx: TransactionResponse;
        beforeEach(async () => {
          tx = await cashbackControllerFromCashbackOperator.correctCashbackAmount(paymentId("id1"), cashbackAmount);
        });

        it("should not emit the required event", async () => {
          await expect(tx).to.not.emit(cashbackController, "CashbackDecreased");
          await expect(tx).to.not.emit(cashbackController, "CashbackIncreased");
        });

        it("should store the cashback state", async () => {
          const operationState = resultToObject(await cashbackController
            .getPaymentCashback(paymentId("id1")));
          checkEquality(operationState, {
            balance: cashbackAmount,
            recipient: payer.address,
          });
        });
      });
    });
  });

  describe("Hook methods", () => {
    beforeEach(async () => {
      await setUpFixture(async function setUpTreasury() {
        await cashbackControllerFromOwner.setCashbackTreasury(treasury.address);
      });
    });

    describe("CashbackVault is not set", () => {
      describe("Method 'afterPaymentMade()'", () => {
        describe("Should execute as expected when called properly and if", () => {
          describe("cashback rate is not zero", () => {
            let tx: TransactionResponse;
            const baseAmount = 100n * DIGITS_COEF;
            const cashbackRate = 100n;
            const cashbackAmount = cashbackRate * baseAmount / CASHBACK_FACTOR;

            beforeEach(async () => {
              const paymentHookData: Payment = {
                baseAmount,
                subsidyLimit: 100n,
                status: 1n,
                payer: payer.address,
                cashbackRate,
                confirmedAmount: 0n,
                sponsor: ethers.ZeroAddress,
                extraAmount: 0n,
                refundAmount: 0n,
              };
              tx = await cashbackControllerFromHookTrigger.afterPaymentMade(
                paymentId("id1"),
                EMPTY_PAYMENT,
                paymentHookData,
              );
            });

            it("should emit the required event", async () => {
              await expect(tx).to.emit(cashbackController, "CashbackSent")
                .withArgs(paymentId("id1"), payer.address, CashbackStatus.Success, cashbackAmount);
            });

            it("should store the cashback state", async () => {
              const operationState = resultToObject(await cashbackController
                .getPaymentCashback(paymentId("id1")));

              checkEquality(operationState, {
                balance: cashbackAmount,
                recipient: payer.address,
              });
            });

            it("should transfer tokens correctly", async () => {
              await expect(tx).to.changeTokenBalances(tokenMock,
                [treasury.address, payer.address, cashbackControllerAddress],
                [-cashbackAmount, cashbackAmount, 0n],
              );
            });

            it("should store the account cashback state", async () => {
              const accountCashbackState = resultToObject(await cashbackController
                .getAccountCashback(payer.address));
              checkEquality(accountCashbackState, {
                totalAmount: cashbackAmount,
                capPeriodStartAmount: 0n,
                capPeriodStartTime: await getTxTimestamp(tx),
              });
            });
          });

          describe("cashback rate is not zero and treasury does not have enough funds", () => {
            let tx: TransactionResponse;
            const baseAmount = 100n * DIGITS_COEF;
            const cashbackRate = 100n;
            const cashbackAmount = cashbackRate * baseAmount / CASHBACK_FACTOR;

            beforeEach(async () => {
              const paymentHookData: Payment = {
                baseAmount,
                subsidyLimit: 100n,
                status: 1n,
                payer: payer.address,
                cashbackRate,
                confirmedAmount: 0n,
                sponsor: ethers.ZeroAddress,
                extraAmount: 0n,
                refundAmount: 0n,
              };
              await tokenMock.connect(treasury).transfer(
                await stranger.getAddress(),
                await tokenMock.balanceOf(treasury.address) - cashbackAmount + 1n,
              );
              tx = await cashbackControllerFromHookTrigger.afterPaymentMade(
                paymentId("id1"),
                EMPTY_PAYMENT,
                paymentHookData,
              );
            });

            it("should emit the required event", async () => {
              await expect(tx).to.emit(cashbackController, "CashbackSent")
                .withArgs(paymentId("id1"), payer.address, CashbackStatus.OutOfFunds, 0n);
            });

            it("should store the cashback state", async () => {
              const operationState = resultToObject(await cashbackController
                .getPaymentCashback(paymentId("id1")));

              checkEquality(operationState, {
                balance: 0n,
                recipient: payer.address,
              });
            });

            it("should not transfer tokens", async () => {
              await expect(tx).to.changeTokenBalances(tokenMock,
                [treasury.address, payer.address, cashbackControllerAddress],
                [0n, 0n, 0n],
              );
            });

            it("should store the account cashback state", async () => {
              const accountCashbackState = resultToObject(await cashbackController
                .getAccountCashback(payer.address));
              checkEquality(accountCashbackState, {
                totalAmount: 0n,
                capPeriodStartAmount: 0n,
                capPeriodStartTime: 0n,
              });
            });
          });

          describe("cashback rate is zero", () => {
            let tx: TransactionResponse;
            const baseAmount = 100n * DIGITS_COEF;
            const cashbackRate = 0n;

            beforeEach(async () => {
              const paymentHookData: Payment = {
                baseAmount,
                subsidyLimit: 100n,
                status: 1n,
                payer: payer.address,
                cashbackRate,
                confirmedAmount: 0n,
                sponsor: ethers.ZeroAddress,
                extraAmount: 0n,
                refundAmount: 0n,
              };
              tx = await cashbackControllerFromHookTrigger.afterPaymentMade(
                paymentId("id1"),
                EMPTY_PAYMENT,
                paymentHookData,
              );
            });

            it("should not emit the event", async () => {
              await expect(tx).to.not.emit(cashbackController, "CashbackSent");
            });

            it("should not change the cashback state", async () => {
              const operationState = resultToObject(await cashbackController
                .getPaymentCashback(paymentId("id1")));

              checkEquality(operationState, {
                balance: 0n,
                recipient: ethers.ZeroAddress,
              });
            });

            it("should not transfer tokens", async () => {
              await expect(tx).to.changeTokenBalances(tokenMock,
                [treasury.address, payer.address, cashbackControllerAddress],
                [0n, 0n, 0n],
              );
            });
          });

          describe("cashback rate is not zero and sponsor covers all base amount", () => {
            let tx: TransactionResponse;
            const baseAmount = 100n * DIGITS_COEF;
            const cashbackRate = 100n;
            const cashbackAmount = cashbackRate * baseAmount / CASHBACK_FACTOR;

            beforeEach(async () => {
              const paymentHookData: Payment = {
                baseAmount,
                subsidyLimit: baseAmount,
                status: 1n,
                payer: payer.address,
                cashbackRate,
                confirmedAmount: 0n,
                sponsor: sponsor.address,
                extraAmount: 0n,
                refundAmount: 0n,
              };
              tx = await cashbackControllerFromHookTrigger.afterPaymentMade(
                paymentId("id1"),
                EMPTY_PAYMENT,
                paymentHookData,
              );
            });

            it("should emit the required event with zero cashback amount", async () => {
              await expect(tx).to.emit(cashbackController, "CashbackSent")
                .withArgs(paymentId("id1"), payer.address, CashbackStatus.Success, 0n);
            });

            it("should not transfer tokens", async () => {
              await expect(tx).to.changeTokenBalances(tokenMock,
                [treasury.address, payer.address, cashbackControllerAddress],
                [0n, 0n, 0n],
              );
            });

            it("should store the account cashback state", async () => {
              const accountCashbackState = resultToObject(await cashbackController
                .getAccountCashback(payer.address));
              checkEquality(accountCashbackState, {
                totalAmount: 0n,
                capPeriodStartAmount: 0n,
                capPeriodStartTime: await getTxTimestamp(tx),
              });
            });
          });

          describe("cashback rate is not zero and sponsor covers part of base amount", () => {
            let tx: TransactionResponse;
            const baseAmount = 100n * DIGITS_COEF;
            const subsidyLimit = baseAmount / 2n;
            const cashbackRate = 100n;
            const cashbackAmount = cashbackRate * (baseAmount - subsidyLimit) / CASHBACK_FACTOR;

            beforeEach(async () => {
              const paymentHookData: Payment = {
                baseAmount,
                subsidyLimit,
                status: 1n,
                payer: payer.address,
                cashbackRate,
                confirmedAmount: 0n,
                sponsor: sponsor.address,
                extraAmount: 0n,
                refundAmount: 0n,
              };
              tx = await cashbackControllerFromHookTrigger.afterPaymentMade(
                paymentId("id1"),
                EMPTY_PAYMENT,
                paymentHookData,
              );
            });

            it("should emit the required event", async () => {
              await expect(tx).to.emit(cashbackController, "CashbackSent")
                .withArgs(paymentId("id1"), payer.address, CashbackStatus.Success, cashbackAmount);
            });

            it("should transfer tokens correctly", async () => {
              await expect(tx).to.changeTokenBalances(tokenMock,
                [treasury.address, payer.address, cashbackControllerAddress],
                [-cashbackAmount, cashbackAmount, 0n],
              );
            });

            it("should store the account cashback state", async () => {
              const accountCashbackState = resultToObject(await cashbackController
                .getAccountCashback(payer.address));
              checkEquality(accountCashbackState, {
                totalAmount: cashbackAmount,
                capPeriodStartAmount: 0n,
                capPeriodStartTime: await getTxTimestamp(tx),
              });
            });
          });
        });

        it("should revert if called by a non-hook trigger", async () => {
          await expect(cashbackControllerFromStranger.afterPaymentMade(
            paymentId("id1"),
            EMPTY_PAYMENT,
            EMPTY_PAYMENT,
          )).to.be.revertedWithCustomError(cashbackControllerFromStranger, "AccessControlUnauthorizedAccount")
            .withArgs(stranger.address, HOOK_TRIGGER_ROLE);
        });

        it("should revert if the cashback treasury is not configured", async () => {
          const { cashbackController: notConfiguredCashbackController } = await deployAndConfigureContracts();
          const paymentHookData: Payment = {
            baseAmount: 100n * DIGITS_COEF,
            subsidyLimit: 100n,
            status: 1n,
            payer: payer.address,
            cashbackRate: 100n,
            confirmedAmount: 0n,
            sponsor: ethers.ZeroAddress,
            extraAmount: 0n,
            refundAmount: 0n,
          };
          await expect(notConfiguredCashbackController.connect(hookTrigger).afterPaymentMade(
            paymentId("id1"),
            EMPTY_PAYMENT,
            paymentHookData,
          )).to.be.revertedWithCustomError(
            notConfiguredCashbackController,
            "CashbackController_TreasuryNotConfigured",
          );
        });
      });

      describe("Method 'afterPaymentUpdated()'", () => {
        describe("Should execute as expected when called properly and if", () => {
          describe("payment cashback rate is not zero and no sponsor", () => {
            const baseAmount = 100n * DIGITS_COEF;
            const cashbackRate = 100n;
            const cashbackAmount = cashbackRate * baseAmount / CASHBACK_FACTOR;
            let initialPayment: Payment;
            let initialAccountCashbackState: Awaited<ReturnType<typeof cashbackController.getAccountCashback>>;
            let initialOperationState: Awaited<ReturnType<typeof cashbackController.getPaymentCashback>>;

            beforeEach(async () => {
              initialPayment = {
                baseAmount,
                subsidyLimit: 100n,
                status: 1n,
                payer: payer.address,
                cashbackRate,
                confirmedAmount: 0n,
                sponsor: ethers.ZeroAddress,
                extraAmount: 0n,
                refundAmount: 0n,
              };
              await cashbackControllerFromHookTrigger.afterPaymentMade(
                paymentId("id1"),
                EMPTY_PAYMENT,
                initialPayment,
              );
              initialAccountCashbackState = await cashbackController.getAccountCashback(payer.address);
              initialOperationState = await cashbackController.getPaymentCashback(paymentId("id1"));
            });

            describe("base amount is increased", () => {
              const newBaseAmount = baseAmount + 50n * DIGITS_COEF;
              const newCashbackAmount = cashbackRate * newBaseAmount / CASHBACK_FACTOR;
              const increasedAmount = newCashbackAmount - cashbackAmount;

              let tx: TransactionResponse;

              beforeEach(async () => {
                const updatedPayment: Payment = {
                  ...initialPayment,
                  baseAmount: newBaseAmount,
                };
                tx = await cashbackControllerFromHookTrigger.afterPaymentUpdated(
                  paymentId("id1"),
                  initialPayment,
                  updatedPayment,
                );
              });

              it("should emit the required event", async () => {
                await expect(tx).to.emit(cashbackController, "CashbackIncreased")
                  .withArgs(
                    paymentId("id1"),
                    payer.address,
                    CashbackStatus.Success,
                    increasedAmount,
                    newCashbackAmount,
                  );
              });

              it("should store the cashback state", async () => {
                const operationState = resultToObject(await cashbackController
                  .getPaymentCashback(paymentId("id1")));
                checkEquality(operationState, {
                  balance: newCashbackAmount,
                  recipient: payer.address,
                });
              });

              it("should transfer tokens correctly", async () => {
                await expect(tx).to.changeTokenBalances(tokenMock,
                  [treasury.address, payer.address, cashbackControllerAddress],
                  [-increasedAmount, increasedAmount, 0n],
                );
              });

              it("should update the cashback amount in the account cashback state", async () => {
                const accountCashbackState = resultToObject(await cashbackController
                  .getAccountCashback(payer.address));
                checkEquality(accountCashbackState, {
                  totalAmount: newCashbackAmount,
                  capPeriodStartAmount: 0n,
                  capPeriodStartTime: initialAccountCashbackState.capPeriodStartTime,
                });
              });
            });

            describe("refund amount is increased", () => {
              const newRefundAmount = 50n * DIGITS_COEF;
              const newCashbackAmount = cashbackRate * (baseAmount - newRefundAmount) / CASHBACK_FACTOR;
              const decreasedAmount = cashbackAmount - newCashbackAmount;

              let tx: TransactionResponse;

              beforeEach(async () => {
                const updatedPayment: Payment = {
                  ...initialPayment,
                  refundAmount: newRefundAmount,
                };
                tx = await cashbackControllerFromHookTrigger.afterPaymentUpdated(
                  paymentId("id1"),
                  initialPayment,
                  updatedPayment,
                );
              });

              it("should emit the required event", async () => {
                await expect(tx).to.emit(cashbackController, "CashbackDecreased")
                  .withArgs(
                    paymentId("id1"),
                    payer.address,
                    CashbackStatus.Success,
                    decreasedAmount,
                    newCashbackAmount,
                  );
              });

              it("should store the cashback state", async () => {
                const operationState = resultToObject(await cashbackController
                  .getPaymentCashback(paymentId("id1")));
                checkEquality(operationState, {
                  balance: newCashbackAmount,
                  recipient: payer.address,
                });
              });

              it("should transfer tokens correctly", async () => {
                await expect(tx).to.changeTokenBalances(tokenMock,
                  [treasury.address, payer.address, cashbackControllerAddress],
                  [decreasedAmount, -decreasedAmount, 0n],
                );
              });

              it("should update the cashback amount in the account cashback state", async () => {
                const accountCashbackState = resultToObject(await cashbackController
                  .getAccountCashback(payer.address));
                checkEquality(accountCashbackState, {
                  totalAmount: newCashbackAmount,
                  capPeriodStartAmount: 0n,
                  capPeriodStartTime: initialAccountCashbackState.capPeriodStartTime,
                });
              });
            });

            describe("changes are non relevant to cashback calculation", () => {
              let tx: TransactionResponse;

              beforeEach(async () => {
                const updatedPayment: Payment = {
                  ...initialPayment,
                  confirmedAmount: initialPayment.confirmedAmount as bigint + 1n, // just some irrelevant change
                };
                tx = await cashbackControllerFromHookTrigger.afterPaymentUpdated(
                  paymentId("id1"),
                  initialPayment,
                  updatedPayment,
                );
              });

              it("should not emit events", async () => {
                await expect(tx).to.not.emit(cashbackController, "CashbackDecreased");
                await expect(tx).to.not.emit(cashbackController, "CashbackIncreased");
              });

              it("should store the cashback state", async () => {
                const operationState = resultToObject(await cashbackController
                  .getPaymentCashback(paymentId("id1")));
                checkEquality(operationState, {
                  balance: cashbackAmount,
                  recipient: payer.address,
                });
              });

              it("should not transfer tokens", async () => {
                await expect(tx).to.changeTokenBalances(tokenMock,
                  [treasury.address, payer.address, cashbackControllerAddress],
                  [0n, 0n, 0n],
                );
              });

              it("should not update the cashback amount in the account cashback state", async () => {
                const accountCashbackState = resultToObject(await cashbackController
                  .getAccountCashback(payer.address));
                checkEquality(accountCashbackState, {
                  totalAmount: initialAccountCashbackState.totalAmount,
                  capPeriodStartAmount: initialAccountCashbackState.capPeriodStartAmount,
                  capPeriodStartTime: initialAccountCashbackState.capPeriodStartTime,
                });
              });
            });
          });

          describe("payment cashback rate is zero", () => {
            const baseAmount = 100n * DIGITS_COEF;
            const cashbackRate = 0n;
            let initialPayment: Payment;
            let initialAccountCashbackState: Awaited<ReturnType<typeof cashbackController.getAccountCashback>>;
            let initialOperationState: Awaited<ReturnType<typeof cashbackController.getPaymentCashback>>;

            beforeEach(async () => {
              initialPayment = {
                baseAmount,
                subsidyLimit: 100n,
                status: 1n,
                payer: payer.address,
                cashbackRate,
                confirmedAmount: 0n,
                sponsor: ethers.ZeroAddress,
                extraAmount: 0n,
                refundAmount: 0n,
              };
              await cashbackControllerFromHookTrigger.afterPaymentMade(
                paymentId("id1"),
                EMPTY_PAYMENT,
                initialPayment,
              );
              initialAccountCashbackState = await cashbackController.getAccountCashback(payer.address);
              initialOperationState = await cashbackController.getPaymentCashback(paymentId("id1"));
            });

            it("should do nothing", async () => {
              const tx = await cashbackControllerFromHookTrigger.afterPaymentUpdated(
                paymentId("id1"),
                initialPayment,
                {
                  ...initialPayment,
                  baseAmount: initialPayment.baseAmount as bigint + 50n * DIGITS_COEF,
                },
              );
              await expect(tx).to.not.emit(cashbackController, "CashbackDecreased");
              await expect(tx).to.not.emit(cashbackController, "CashbackIncreased");
              await expect(tx).to.changeTokenBalances(tokenMock,
                [treasury.address, payer.address, cashbackControllerAddress],
                [0n, 0n, 0n],
              );
              checkEquality(
                resultToObject(await cashbackController.getAccountCashback(payer.address)),
                resultToObject(initialAccountCashbackState),
              );
              checkEquality(
                resultToObject(await cashbackController.getPaymentCashback(paymentId("id1"))),
                resultToObject(initialOperationState),
              );
            });
          });

          describe("payment cashback rate is not zero and sponsor exists", () => {
            describe("subsidy limit is less than base amount", () => {
              const baseAmount = 100n * DIGITS_COEF;
              const subsidyLimit = baseAmount / 2n;
              const cashbackRate = 100n;
              const cashbackAmount = cashbackRate * (baseAmount - subsidyLimit) / CASHBACK_FACTOR;
              let initialPayment: Payment;
              let initialAccountCashbackState: Awaited<ReturnType<typeof cashbackController.getAccountCashback>>;
              let initialOperationState: Awaited<ReturnType<typeof cashbackController.getPaymentCashback>>;

              beforeEach(async () => {
                initialPayment = {
                  baseAmount,
                  subsidyLimit,
                  status: 1n,
                  payer: payer.address,
                  cashbackRate,
                  confirmedAmount: 0n,
                  sponsor: sponsor.address,
                  extraAmount: 0n,
                  refundAmount: 0n,
                };
                await cashbackControllerFromHookTrigger.afterPaymentMade(
                  paymentId("id1"),
                  EMPTY_PAYMENT,
                  initialPayment,
                );
                initialAccountCashbackState = await cashbackController.getAccountCashback(payer.address);
                initialOperationState = await cashbackController.getPaymentCashback(paymentId("id1"));
              });

              describe("base amount is increased", () => {
                const newBaseAmount = baseAmount + 50n * DIGITS_COEF;
                const newCashbackAmount = cashbackRate * (newBaseAmount - subsidyLimit) / CASHBACK_FACTOR;
                const increasedAmount = newCashbackAmount - cashbackAmount;

                let tx: TransactionResponse;

                beforeEach(async () => {
                  const updatedPayment: Payment = {
                    ...initialPayment,
                    baseAmount: newBaseAmount,
                  };
                  tx = await cashbackControllerFromHookTrigger.afterPaymentUpdated(
                    paymentId("id1"),
                    initialPayment,
                    updatedPayment,
                  );
                });

                it("should emit the required event", async () => {
                  await expect(tx).to.emit(cashbackController, "CashbackIncreased")
                    .withArgs(
                      paymentId("id1"),
                      payer.address,
                      CashbackStatus.Success,
                      increasedAmount,
                      newCashbackAmount,
                    );
                });

                it("should store the cashback state", async () => {
                  const operationState = resultToObject(await cashbackController
                    .getPaymentCashback(paymentId("id1")));
                  checkEquality(operationState, {
                    balance: newCashbackAmount,
                    recipient: payer.address,
                  });
                });

                it("should transfer tokens correctly", async () => {
                  await expect(tx).to.changeTokenBalances(tokenMock,
                    [treasury.address, payer.address, cashbackControllerAddress],
                    [-increasedAmount, increasedAmount, 0n],
                  );
                });

                it("should update the cashback amount in the account cashback state", async () => {
                  const accountCashbackState = resultToObject(await cashbackController
                    .getAccountCashback(payer.address));
                  checkEquality(accountCashbackState, {
                    totalAmount: newCashbackAmount,
                    capPeriodStartAmount: 0n,
                    capPeriodStartTime: initialAccountCashbackState.capPeriodStartTime,
                  });
                });
              });

              describe("refund amount is increased", () => {
                const refundAmount = 10n * DIGITS_COEF;
                // refund is splitted between payer and sponsor according to base amount proportions
                const newCashbackAmount = cashbackRate *
                  ((baseAmount - subsidyLimit) - refundAmount * subsidyLimit / baseAmount) /
                  CASHBACK_FACTOR;
                const decreasedAmount = cashbackAmount - newCashbackAmount;

                let tx: TransactionResponse;

                beforeEach(async () => {
                  const updatedPayment: Payment = {
                    ...initialPayment,
                    refundAmount,
                  };
                  tx = await cashbackControllerFromHookTrigger.afterPaymentUpdated(
                    paymentId("id1"),
                    initialPayment,
                    updatedPayment,
                  );
                });

                it("should emit the required event", async () => {
                  await expect(tx).to.emit(cashbackController, "CashbackDecreased")
                    .withArgs(
                      paymentId("id1"),
                      payer.address,
                      CashbackStatus.Success,
                      decreasedAmount,
                      newCashbackAmount,
                    );
                });

                it("should store the cashback state", async () => {
                  const operationState = resultToObject(await cashbackController
                    .getPaymentCashback(paymentId("id1")));
                  checkEquality(operationState, {
                    balance: newCashbackAmount,
                    recipient: payer.address,
                  });
                });

                it("should transfer tokens correctly", async () => {
                  await expect(tx).to.changeTokenBalances(tokenMock,
                    [treasury.address, payer.address, cashbackControllerAddress],
                    [decreasedAmount, -decreasedAmount, 0n],
                  );
                });

                it("should update the cashback amount in the account cashback state", async () => {
                  const accountCashbackState = resultToObject(await cashbackController
                    .getAccountCashback(payer.address));
                  checkEquality(accountCashbackState, {
                    totalAmount: newCashbackAmount,
                    capPeriodStartAmount: 0n,
                    capPeriodStartTime: initialAccountCashbackState.capPeriodStartTime,
                  });
                });
              });

              describe("refund amount is increased but sponsor refund amount is capped by subsidy limit", () => {
                const additionalRefundThatWillGoToPayer = 10n * DIGITS_COEF;
                const refundAmount =
                  baseAmount + // amount of refund to make sponsor part equal to subsidy limit
                  additionalRefundThatWillGoToPayer; // additional refund that will cap sponsor part and goes to payer
                // but we will not charge cashback for the additional refund that goes to payer
                const newCashbackAmount = 0n;
                const decreasedAmount = cashbackAmount;

                let tx: TransactionResponse;

                beforeEach(async () => {
                  const updatedPayment: Payment = {
                    ...initialPayment,
                    refundAmount,
                  };
                  tx = await cashbackControllerFromHookTrigger.afterPaymentUpdated(
                    paymentId("id1"),
                    initialPayment,
                    updatedPayment,
                  );
                });

                it("should emit the required event", async () => {
                  await expect(tx).to.emit(cashbackController, "CashbackDecreased")
                    .withArgs(
                      paymentId("id1"),
                      payer.address,
                      CashbackStatus.Success,
                      decreasedAmount,
                      newCashbackAmount,
                    );
                });

                it("should store the cashback state", async () => {
                  const operationState = resultToObject(await cashbackController
                    .getPaymentCashback(paymentId("id1")));
                  checkEquality(operationState, {
                    balance: 0n,
                    recipient: payer.address,
                  });
                });

                it("should transfer tokens correctly", async () => {
                  await expect(tx).to.changeTokenBalances(tokenMock,
                    [treasury.address, payer.address, cashbackControllerAddress],
                    [decreasedAmount, -decreasedAmount, 0n],
                  );
                });

                it("should update the cashback amount in the account cashback state", async () => {
                  const accountCashbackState = resultToObject(await cashbackController
                    .getAccountCashback(payer.address));
                  checkEquality(accountCashbackState, {
                    totalAmount: 0n,
                    capPeriodStartAmount: 0n,
                    capPeriodStartTime: initialAccountCashbackState.capPeriodStartTime,
                  });
                });
              });
            });

            describe("subsidy limit is greater than base amount", () => {
              const baseAmount = 100n * DIGITS_COEF;
              const subsidyLimit = baseAmount + 50n * DIGITS_COEF;
              const cashbackRate = 100n;
              let initialPayment: Payment;
              let initialAccountCashbackState: Awaited<ReturnType<typeof cashbackController.getAccountCashback>>;
              let initialOperationState: Awaited<ReturnType<typeof cashbackController.getPaymentCashback>>;

              beforeEach(async () => {
                initialPayment = {
                  baseAmount,
                  subsidyLimit,
                  status: 1n,
                  payer: payer.address,
                  cashbackRate,
                  confirmedAmount: 0n,
                  sponsor: sponsor.address,
                  extraAmount: 0n,
                  refundAmount: 0n,
                };
                await cashbackControllerFromHookTrigger.afterPaymentMade(
                  paymentId("id1"),
                  EMPTY_PAYMENT,
                  initialPayment,
                );
                initialAccountCashbackState = await cashbackController.getAccountCashback(payer.address);
                initialOperationState = await cashbackController.getPaymentCashback(paymentId("id1"));
              });

              describe("base amount is increased but still below subsidy limit", () => {
                const newBaseAmount = baseAmount + 10n * DIGITS_COEF;
                const newCashbackAmount = cashbackRate * (newBaseAmount - subsidyLimit) / CASHBACK_FACTOR;

                let tx: TransactionResponse;

                beforeEach(async () => {
                  const updatedPayment: Payment = {
                    ...initialPayment,
                    baseAmount: newBaseAmount,
                  };
                  tx = await cashbackControllerFromHookTrigger.afterPaymentUpdated(
                    paymentId("id1"),
                    initialPayment,
                    updatedPayment,
                  );
                });

                it("should not emit events", async () => {
                  await expect(tx).to.not.emit(cashbackController, "CashbackIncreased");
                });

                it("should not change the cashback state", async () => {
                  const operationState = resultToObject(await cashbackController
                    .getPaymentCashback(paymentId("id1")));
                  checkEquality(operationState, {
                    balance: 0n,
                    recipient: payer.address,
                  });
                });

                it("should not transfer tokens", async () => {
                  await expect(tx).to.changeTokenBalances(tokenMock,
                    [treasury.address, payer.address, cashbackControllerAddress],
                    [0n, 0n, 0n],
                  );
                });

                it("should not update the cashback amount in the account cashback state", async () => {
                  const accountCashbackState = resultToObject(await cashbackController
                    .getAccountCashback(payer.address));
                  checkEquality(accountCashbackState, {
                    totalAmount: 0n,
                    capPeriodStartAmount: 0n,
                    capPeriodStartTime: initialAccountCashbackState.capPeriodStartTime,
                  });
                });
              });

              describe("base amount is increased above subsidy limit", () => {
                const newBaseAmount = subsidyLimit + 50n * DIGITS_COEF;
                const newCashbackAmount = cashbackRate * (newBaseAmount - subsidyLimit) / CASHBACK_FACTOR;

                let tx: TransactionResponse;

                beforeEach(async () => {
                  const updatedPayment: Payment = {
                    ...initialPayment,
                    baseAmount: newBaseAmount,
                  };
                  tx = await cashbackControllerFromHookTrigger.afterPaymentUpdated(
                    paymentId("id1"),
                    initialPayment,
                    updatedPayment,
                  );
                });

                it("should emit the required event", async () => {
                  await expect(tx).to.emit(cashbackController, "CashbackIncreased")
                    .withArgs(paymentId("id1"),
                      payer.address,
                      CashbackStatus.Success,
                      newCashbackAmount,
                      newCashbackAmount,
                    );
                });

                it("should store the cashback state", async () => {
                  const operationState = resultToObject(await cashbackController
                    .getPaymentCashback(paymentId("id1")));
                  checkEquality(operationState, {
                    balance: newCashbackAmount,
                    recipient: payer.address,
                  });
                });

                it("should transfer tokens correctly", async () => {
                  await expect(tx).to.changeTokenBalances(tokenMock,
                    [treasury.address, payer.address, cashbackControllerAddress],
                    [-newCashbackAmount, newCashbackAmount, 0n],
                  );
                });

                it("should update the cashback amount in the account cashback state", async () => {
                  const accountCashbackState = resultToObject(await cashbackController
                    .getAccountCashback(payer.address));
                  checkEquality(accountCashbackState, {
                    totalAmount: newCashbackAmount,
                    capPeriodStartAmount: 0n,
                    capPeriodStartTime: initialAccountCashbackState.capPeriodStartTime,
                  });
                });
              });
            });
          });
        });

        it("should revert if called by a non-hook trigger", async () => {
          await expect(cashbackControllerFromStranger.afterPaymentUpdated(
            paymentId("id1"),
            EMPTY_PAYMENT,
            EMPTY_PAYMENT,
          )).to.be.revertedWithCustomError(cashbackControllerFromStranger, "AccessControlUnauthorizedAccount")
            .withArgs(stranger.address, HOOK_TRIGGER_ROLE);
        });
      });

      describe("Method 'afterPaymentCanceled()'", () => {
        describe("Should execute as expected when called properly and if", () => {
          describe("cashback rate is not zero", () => {
            const baseAmount = 100n * DIGITS_COEF;
            const cashbackRate = 100n;
            const cashbackAmount = cashbackRate * baseAmount / CASHBACK_FACTOR;
            let initialPayment: Payment;
            let initialAccountCashbackState: Awaited<ReturnType<typeof cashbackController.getAccountCashback>>;
            let initialOperationState: Awaited<ReturnType<typeof cashbackController.getPaymentCashback>>;
            let tx: TransactionResponse;

            beforeEach(async () => {
              initialPayment = {
                baseAmount,
                subsidyLimit: 100n,
                status: 1n,
                payer: payer.address,
                cashbackRate,
                confirmedAmount: 0n,
                sponsor: ethers.ZeroAddress,
                extraAmount: 0n,
                refundAmount: 0n,
              };
              await cashbackControllerFromHookTrigger.afterPaymentMade(
                paymentId("id1"),
                EMPTY_PAYMENT,
                initialPayment,
              );
              initialAccountCashbackState = await cashbackController.getAccountCashback(payer.address);
              initialOperationState = await cashbackController.getPaymentCashback(paymentId("id1"));
              tx = await cashbackControllerFromHookTrigger.afterPaymentCanceled(
                paymentId("id1"),
                initialPayment,
                EMPTY_PAYMENT,
              );
            });

            it("should emit the required event", async () => {
              await expect(tx).to.emit(cashbackController, "CashbackDecreased")
                .withArgs(
                  paymentId("id1"),
                  payer.address,
                  CashbackStatus.Success,
                  cashbackAmount,
                  0n,
                );
            });

            it("should store the cashback state", async () => {
              const operationState = resultToObject(await cashbackController
                .getPaymentCashback(paymentId("id1")));
              checkEquality(operationState, {
                balance: 0n,
                recipient: payer.address,
              });
            });

            it("should transfer tokens correctly", async () => {
              await expect(tx).to.changeTokenBalances(tokenMock,
                [treasury.address, payer.address, cashbackControllerAddress],
                [cashbackAmount, -cashbackAmount, 0n],
              );
            });

            it("should update the cashback amount in the account cashback state", async () => {
              const accountCashbackState = resultToObject(await cashbackController
                .getAccountCashback(payer.address));
              checkEquality(accountCashbackState, {
                totalAmount: 0n,
                capPeriodStartAmount: 0n,
                capPeriodStartTime: initialAccountCashbackState.capPeriodStartTime,
              });
            });
          });

          describe("cashback rate is not zero but payment had no cashback because it was capped", () => {
            const cashbackRate = 100n;
            let initialPayment: Payment;
            let initialAccountCashbackState: Awaited<ReturnType<typeof cashbackController.getAccountCashback>>;
            let initialOperationState: Awaited<ReturnType<typeof cashbackController.getPaymentCashback>>;
            let tx: TransactionResponse;
            beforeEach(async () => {
              const cappingPayment: Payment = {
                baseAmount: MAX_CASHBACK_FOR_CAP_PERIOD * CASHBACK_FACTOR / cashbackRate + 1n * DIGITS_COEF,
                subsidyLimit: 0n,
                status: 1n,
                payer: payer.address,
                cashbackRate,
                confirmedAmount: 0n,
                sponsor: ethers.ZeroAddress,
                extraAmount: 0n,
                refundAmount: 0n,
              };
              // spending cap limit
              await cashbackControllerFromHookTrigger.afterPaymentMade(
                paymentId("capping payment"),
                EMPTY_PAYMENT,
                cappingPayment,
              );

              initialPayment = {
                baseAmount: 100n * DIGITS_COEF,
                subsidyLimit: 0n,
                status: 1n,
                payer: payer.address,
                cashbackRate,
                confirmedAmount: 0n,
                sponsor: ethers.ZeroAddress,
                extraAmount: 0n,
                refundAmount: 0n,
              };
              await cashbackControllerFromHookTrigger.afterPaymentMade(
                paymentId("id1"),
                EMPTY_PAYMENT,
                initialPayment,
              );
              initialAccountCashbackState = await cashbackController.getAccountCashback(payer.address);
              initialOperationState = await cashbackController.getPaymentCashback(paymentId("id1"));
              tx = await cashbackControllerFromHookTrigger.afterPaymentCanceled(
                paymentId("id1"),
                initialPayment,
                EMPTY_PAYMENT,
              );
            });

            it("should not emit the event", async () => {
              await expect(tx).to.not.emit(cashbackController, "CashbackDecreased");
            });

            it("should not change the cashback state", async () => {
              const operationState = resultToObject(await cashbackController
                .getPaymentCashback(paymentId("id1")));
              checkEquality(operationState, {
                balance: initialOperationState.balance,
                recipient: payer.address,
              });
            });

            it("should not transfer tokens", async () => {
              await expect(tx).to.changeTokenBalances(tokenMock,
                [treasury.address, payer.address, cashbackControllerAddress],
                [0n, 0n, 0n],
              );
            });

            it("should not update the cashback amount in the account cashback state", async () => {
              const accountCashbackState = resultToObject(await cashbackController
                .getAccountCashback(payer.address));
              checkEquality(accountCashbackState, {
                capPeriodStartAmount: initialAccountCashbackState.capPeriodStartAmount,
                capPeriodStartTime: initialAccountCashbackState.capPeriodStartTime,
                totalAmount: initialAccountCashbackState.totalAmount,
              });
            });
          });

          describe("cashback rate is zero", () => {
            const baseAmount = 100n * DIGITS_COEF;
            const cashbackRate = 0n;
            let initialPayment: Payment;
            let initialAccountCashbackState: Awaited<ReturnType<typeof cashbackController.getAccountCashback>>;
            let initialOperationState: Awaited<ReturnType<typeof cashbackController.getPaymentCashback>>;
            let tx: TransactionResponse;

            beforeEach(async () => {
              initialPayment = {
                baseAmount,
                subsidyLimit: 100n,
                status: 1n,
                payer: payer.address,
                cashbackRate,
                confirmedAmount: 0n,
                sponsor: ethers.ZeroAddress,
                extraAmount: 0n,
                refundAmount: 0n,
              };
              await cashbackControllerFromHookTrigger.afterPaymentMade(
                paymentId("id1"),
                EMPTY_PAYMENT,
                initialPayment,
              );
              initialAccountCashbackState = await cashbackController.getAccountCashback(payer.address);
              initialOperationState = await cashbackController.getPaymentCashback(paymentId("id1"));
              tx = await cashbackControllerFromHookTrigger.afterPaymentCanceled(
                paymentId("id1"),
                initialPayment,
                EMPTY_PAYMENT,
              );
            });

            it("should do nothing", async () => {
              await expect(tx).to.not.emit(cashbackController, "CashbackDecreased");
              await expect(tx).to.not.emit(cashbackController, "CashbackIncreased");
              await expect(tx).to.changeTokenBalances(tokenMock,
                [treasury.address, payer.address, cashbackControllerAddress],
                [0n, 0n, 0n],
              );
              checkEquality(
                resultToObject(await cashbackController.getAccountCashback(payer.address)),
                resultToObject(initialAccountCashbackState),
              );
              checkEquality(
                resultToObject(await cashbackController.getPaymentCashback(paymentId("id1"))),
                resultToObject(initialOperationState),
              );
            });
          });
        });

        it("should revert if called by a non-hook trigger", async () => {
          await expect(cashbackControllerFromStranger.afterPaymentCanceled(
            paymentId("id1"),
            EMPTY_PAYMENT,
            EMPTY_PAYMENT,
          )).to.be.revertedWithCustomError(cashbackControllerFromStranger, "AccessControlUnauthorizedAccount")
            .withArgs(stranger.address, HOOK_TRIGGER_ROLE);
        });
      });
    });

    describe("CashbackVault is set", () => {
      let cashbackVault: Contracts.CashbackVault;
      beforeEach(async () => {
        await setUpFixture(async function configureCV() {
          cashbackVault = await deployCashbackVault(tokenMock);
          await cashbackVault.grantRole(GRANTOR_ROLE, deployer.address);
          await cashbackVault.grantRole(CASHBACK_OPERATOR_ROLE, await cashbackController.getAddress());
          await cashbackVault.grantRole(MANAGER_ROLE, deployer.address);
          await cashbackControllerFromOwner.setCashbackVault(await cashbackVault.getAddress());
        });
      });

      describe("Method 'afterPaymentMade()'", () => {
        let tx: TransactionResponse;
        const baseAmount = 100n * DIGITS_COEF;
        const cashbackRate = 100n;
        const cashbackAmount = baseAmount * cashbackRate / CASHBACK_FACTOR;

        beforeEach(async () => {
          tx = await cashbackControllerFromHookTrigger.afterPaymentMade(
            paymentId("id1"),
            EMPTY_PAYMENT,
            {
              baseAmount,
              subsidyLimit: 0n,
              status: 1n,
              payer: payer.address,
              cashbackRate,
              confirmedAmount: 0n,
              sponsor: ethers.ZeroAddress,
              extraAmount: 0n,
              refundAmount: 0n,
            },
          );
        });

        it("should transfer tokens from treasury to cashback vault", async () => {
          await expect(tx).to.changeTokenBalances(tokenMock,
            [treasury.address, payer.address, cashbackControllerAddress, cashbackVault],
            [-cashbackAmount, 0n, 0n, cashbackAmount],
          );
        });

        it("should increase the claimable amount in vault for the payer", async () => {
          expect(await cashbackVault.getAccountCashbackBalance(payer.address)).to.equal(cashbackAmount);
        });

        it("should emit the required event", async () => {
          await expect(tx).to.emit(cashbackVault, "CashbackGranted")
            .withArgs(payer.address, cashbackControllerAddress, cashbackAmount, cashbackAmount);
        });
      });

      describe("Method 'afterPaymentCanceled()'", () => {
        let tx: TransactionResponse;
        const baseAmount = 100n * DIGITS_COEF;
        const cashbackRate = 100n;
        const cashbackAmount = baseAmount * cashbackRate / CASHBACK_FACTOR;
        let initialPayment: Payment;
        beforeEach(async () => {
          initialPayment = {
            baseAmount,
            subsidyLimit: 0n,
            status: 1n,
            payer: payer.address,
            cashbackRate,
            confirmedAmount: 0n,
            sponsor: ethers.ZeroAddress,
            extraAmount: 0n,
            refundAmount: 0n,
          };
          await cashbackControllerFromHookTrigger.afterPaymentMade(
            paymentId("id1"),
            EMPTY_PAYMENT,
            initialPayment,
          );
        });

        describe("Revoking the whole cashback from vault", () => {
          let tx: TransactionResponse;
          beforeEach(async () => {
            tx = await cashbackControllerFromHookTrigger.afterPaymentCanceled(
              paymentId("id1"),
              initialPayment,
              EMPTY_PAYMENT,
            );
          });

          it("should transfer tokens from cashback vault to treasury", async () => {
            await expect(tx).to.changeTokenBalances(tokenMock,
              [treasury.address, payer.address, cashbackControllerAddress, cashbackVault],
              [cashbackAmount, 0n, 0n, -cashbackAmount],
            );
          });

          it("should decrease the claimable amount in vault for the payer", async () => {
            expect(await cashbackVault.getAccountCashbackBalance(payer.address)).to.equal(0n);
          });

          it("should emit the required event", async () => {
            await expect(tx).to.emit(cashbackVault, "CashbackRevoked")
              .withArgs(payer.address, cashbackControllerAddress, cashbackAmount, 0n);
          });
        });

        describe("Revoking cashback from vault and from payer if vault cashback balance is not enough", () => {
          let tx: TransactionResponse;
          beforeEach(async () => {
            await cashbackVault.claim(payer.address, cashbackAmount / 2n);
            tx = await cashbackControllerFromHookTrigger.afterPaymentCanceled(
              paymentId("id1"),
              initialPayment,
              EMPTY_PAYMENT,
            );
          });

          it("should transfer tokens from cashback vault and from payer to treasury", async () => {
            await expect(tx).to.changeTokenBalances(tokenMock,
              [treasury.address, payer.address, cashbackControllerAddress, cashbackVault],
              [cashbackAmount, -cashbackAmount / 2n, 0n, -cashbackAmount / 2n],
            );
          });

          it("should decrease the claimable amount in vault for the payer", async () => {
            expect(await cashbackVault.getAccountCashbackBalance(payer.address)).to.equal(0n);
          });

          it("should emit the required event", async () => {
            await expect(tx).to.emit(cashbackVault, "CashbackRevoked")
              .withArgs(payer.address, cashbackControllerAddress, cashbackAmount / 2n, 0n);
          });
        });
      });
    });
  });

  describe("Scenario with cashback cap", () => {
    beforeEach(async () => {
      await setUpFixture(async function setUpTreasury() {
        await cashbackControllerFromOwner.setCashbackTreasury(treasury.address);
      });
    });

    describe("first payment that does not reach the cap", () => {
      const cashbackRate = 100n;
      let firstCashbackAmount: bigint;
      let capPeriodStartTime: number;
      let tx: TransactionResponse;

      beforeEach(async () => {
        const baseAmount = 100n * DIGITS_COEF;
        firstCashbackAmount = cashbackRate * baseAmount / CASHBACK_FACTOR;
        tx = await cashbackControllerFromHookTrigger.afterPaymentMade(
          paymentId("id1"),
          EMPTY_PAYMENT,
          {
            baseAmount,
            subsidyLimit: 0n,
            status: 1n,
            payer: payer.address,
            cashbackRate,
            confirmedAmount: 0n,
            sponsor: ethers.ZeroAddress,
            extraAmount: 0n,
            refundAmount: 0n,
          },
        );
        capPeriodStartTime = await getTxTimestamp(tx);
      });

      it("should increase the cashback amount in the account cashback state", async () => {
        const accountCashbackState = resultToObject(await cashbackController
          .getAccountCashback(payer.address));
        checkEquality(accountCashbackState, {
          capPeriodStartAmount: 0n,
          capPeriodStartTime: capPeriodStartTime,
          totalAmount: firstCashbackAmount,
        });
      });

      it("should emit the required event", async () => {
        await expect(tx).to.emit(cashbackController, "CashbackSent")
          .withArgs(paymentId("id1"), payer.address, CashbackStatus.Success, firstCashbackAmount);
      });

      it("should transfer tokens correctly", async () => {
        await expect(tx).to.changeTokenBalances(tokenMock,
          [treasury.address, payer.address, cashbackControllerAddress],
          [-firstCashbackAmount, firstCashbackAmount, 0n],
        );
      });

      describe("second payment that reaches the cap", () => {
        let secondCashbackAmount: bigint;
        beforeEach(async () => {
          const baseAmount = MAX_CASHBACK_FOR_CAP_PERIOD * CASHBACK_FACTOR / cashbackRate + 1n * DIGITS_COEF;
          secondCashbackAmount = MAX_CASHBACK_FOR_CAP_PERIOD - firstCashbackAmount;
          tx = await cashbackControllerFromHookTrigger.afterPaymentMade(
            paymentId("id2"),
            EMPTY_PAYMENT,
            {
              baseAmount,
              subsidyLimit: 0n,
              status: 1n,
              payer: payer.address,
              cashbackRate,
              confirmedAmount: 0n,
              sponsor: ethers.ZeroAddress,
              extraAmount: 0n,
              refundAmount: 0n,
            },
          );
        });

        it("should cap the cashback amount in the account cashback state", async () => {
          const accountCashbackState = resultToObject(await cashbackController
            .getAccountCashback(payer.address));
          checkEquality(accountCashbackState, {
            capPeriodStartAmount: 0n,
            capPeriodStartTime: capPeriodStartTime,
            totalAmount: MAX_CASHBACK_FOR_CAP_PERIOD,
          });
        });

        it("should emit the required event", async () => {
          await expect(tx).to.emit(cashbackController, "CashbackSent")
            .withArgs(paymentId("id2"),
              payer.address,
              CashbackStatus.Partial,
              secondCashbackAmount,
            );
        });

        it("should transfer tokens correctly", async () => {
          await expect(tx).to.changeTokenBalances(tokenMock,
            [treasury.address, payer.address, cashbackControllerAddress],
            [-secondCashbackAmount, secondCashbackAmount, 0n],
          );
        });

        describe("third payment that capped the cashback amount", () => {
          let tx: TransactionResponse;
          beforeEach(async () => {
            tx = await cashbackControllerFromHookTrigger.afterPaymentMade(
              paymentId("id3"),
              EMPTY_PAYMENT,
              {
                baseAmount: 100n * DIGITS_COEF,
                subsidyLimit: 0n,
                status: 1n,
                payer: payer.address,
                cashbackRate,
                confirmedAmount: 0n,
                sponsor: ethers.ZeroAddress,
                extraAmount: 0n,
                refundAmount: 0n,
              },
            );
          });

          it("should cap the cashback amount in the account cashback state", async () => {
            const accountCashbackState = resultToObject(await cashbackController
              .getAccountCashback(payer.address));
            checkEquality(accountCashbackState, {
              capPeriodStartAmount: 0n,
              capPeriodStartTime: capPeriodStartTime,
              totalAmount: MAX_CASHBACK_FOR_CAP_PERIOD,
            });
          });

          it("should emit the required event", async () => {
            await expect(tx).to.emit(cashbackController, "CashbackSent")
              .withArgs(paymentId("id3"), payer.address, CashbackStatus.Capped, 0n);
          });

          it("should transfer tokens correctly", async () => {
            await expect(tx).to.changeTokenBalances(tokenMock,
              [treasury.address, payer.address, cashbackControllerAddress],
              [0n, 0n, 0n],
            );
          });

          describe("fourth payment after cap period", () => {
            const cashbackAmount = 10n * DIGITS_COEF;
            beforeEach(async () => {
              await increaseBlockTimestamp(CASHBACK_CAP_RESET_PERIOD + 1);
              tx = await cashbackControllerFromHookTrigger.afterPaymentMade(
                paymentId("id4"),
                EMPTY_PAYMENT,
                {
                  baseAmount: 100n * DIGITS_COEF,
                  subsidyLimit: 0n,
                  status: 1n,
                  payer: payer.address,
                  cashbackRate,
                  confirmedAmount: 0n,
                  sponsor: ethers.ZeroAddress,
                  extraAmount: 0n,
                  refundAmount: 0n,
                },
              );
            });

            it("should increase the cashback amount in the account cashback state", async () => {
              const accountCashbackState = resultToObject(await cashbackController
                .getAccountCashback(payer.address));
              checkEquality(accountCashbackState, {
                capPeriodStartAmount: MAX_CASHBACK_FOR_CAP_PERIOD,
                capPeriodStartTime: await getTxTimestamp(tx),
                totalAmount: MAX_CASHBACK_FOR_CAP_PERIOD + cashbackAmount,
              });
            });

            it("should emit the required event", async () => {
              await expect(tx).to.emit(cashbackController, "CashbackSent")
                .withArgs(paymentId("id4"), payer.address, CashbackStatus.Success, cashbackAmount);
            });

            it("should transfer tokens correctly", async () => {
              await expect(tx).to.changeTokenBalances(tokenMock,
                [treasury.address, payer.address, cashbackControllerAddress],
                [-cashbackAmount, cashbackAmount, 0n],
              );
            });
          });
        });
      });
    });
  });
});
