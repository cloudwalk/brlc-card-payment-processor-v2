import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { CashbackVault__factory, CashbackVault, ERC20TokenMock, ERC20TokenMock__factory } from "../typechain-types";
import { maxUintForBits, setUpFixture } from "../test-utils/common";

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

describe("Contracts 'CashbackVault'", async () => {
  before(async () => {
    [deployer, manager, cpp, account] = await ethers.getSigners();

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
    const contracts = await setUpFixture(deployContracts);
    cashbackVault = contracts.cashbackVault;
    tokenMock = contracts.tokenMock;
    cashBackVaultAddress = await cashbackVault.getAddress();
    cashbackVaultFromCPP = cashbackVault.connect(cpp);
    cashbackVaultFromManager = cashbackVault.connect(manager);
  });
  it("should return version", async () => {
    expect(await cashbackVault.$__VERSION()).to.deep.equal([
      EXPECTED_VERSION.major,
      EXPECTED_VERSION.minor,
      EXPECTED_VERSION.patch
    ]);
  });
  it("should have proveCashbackVault function", async () => {
    await expect(cashbackVault.proveCashbackVault()).to.be.not.reverted;
  });
  it("should give us underlying token address", async () => {
    expect(await cashbackVault.underlyingToken()).to.equal(await tokenMock.getAddress());
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
  describe("CPP basic happy path token flows and events checks", async () => {
    describe("granting 1000 tokens cashback", async () => {
      let tx: TransactionResponse;
      beforeEach(async () => {
        tx = await cashbackVaultFromCPP.grantCashback(account.address, 1000n);
      });
      it("should emit CashbackGranted event", async () => {
        await expect(tx)
          .to.emit(cashbackVaultFromCPP, "CashbackGranted").withArgs(account.address, cpp.address, 1000n, 1000n);
      });
      it("should move tokens from CPP to CashbackVault", async () => {
        await expect(tx).to.changeTokenBalances(
          tokenMock,
          [cpp.address, cashBackVaultAddress],
          [-1000n, 1000n]
        );
      });
      it("should increase CashbackVault tracked totalCashbackBalance", async () => {
        expect(await cashbackVaultFromCPP.getTotalCashbackBalance()).to.equal(1000n);
      });
      it("should increase account cashback balance", async () => {
        expect(await cashbackVaultFromCPP.getAccountCashbackBalance(account.address)).to.equal(1000n);
      });
      it("should not change account totalClaimed in state", async () => {
        expect((await cashbackVaultFromCPP.getAccountCashbackState(account.address)).totalClaimed).to.equal(0n);
      });
      describe("revoking 100 tokens cashback", async () => {
        let tx: TransactionResponse;
        beforeEach(async () => {
          tx = await cashbackVaultFromCPP.revokeCashback(account.address, 100n);
        });
        it("should emit CashbackRevoked event", async () => {
          await expect(tx)
            .to.emit(cashbackVaultFromCPP, "CashbackRevoked").withArgs(account.address, cpp.address, 100n, 900n);
        });
        it("should move tokens from CashbackVault to CPP", async () => {
          await expect(tx).to.changeTokenBalances(
            tokenMock,
            [cashBackVaultAddress, cpp.address],
            [-100n, 100n]
          );
        });
        it("should increase CPP token balance", async () => {
          expect(await tokenMock.balanceOf(cpp.address)).to.equal(BALANCE_INITIAL - 900n);
        });
        it("should decrease CashbackVault tracked totalCashbackBalance", async () => {
          expect(await cashbackVaultFromCPP.getTotalCashbackBalance()).to.equal(900n);
        });
        it("should decrease account cashback balance", async () => {
          expect(await cashbackVaultFromCPP.getAccountCashbackBalance(account.address)).to.equal(900n);
        });
        describe("claiming 100 tokens cashback", async () => {
          let tx: TransactionResponse;
          beforeEach(async () => {
            tx = await cashbackVaultFromManager.claim(account.address, 100n);
          });
          it("should emit CashbackClaimed event", async () => {
            await expect(tx)
              .to.emit(cashbackVaultFromCPP, "CashbackClaimed")
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
            expect(await cashbackVaultFromCPP.getTotalCashbackBalance()).to.equal(800n);
          });
          it("CPP token balance should not change", async () => {
            await expect(tx).to.changeTokenBalances(
              tokenMock,
              [cpp.address],
              [0n]
            );
          });
          it("should decrease account cashback balance", async () => {
            expect(await cashbackVaultFromCPP.getAccountCashbackBalance(account.address)).to.equal(800n);
          });
          it("should increase account totalClaimed in state", async () => {
            expect((await cashbackVaultFromCPP.getAccountCashbackState(account.address)).totalClaimed).to.equal(100n);
          });
          describe("claiming all tokens cashback", async () => {
            let tx: TransactionResponse;
            beforeEach(async () => {
              tx = await cashbackVaultFromManager.claimAll(account.address);
            });
            it("should emit CashbackClaimed event", async () => {
              await expect(tx)
                .to.emit(cashbackVaultFromCPP, "CashbackClaimed")
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
              expect(await cashbackVaultFromCPP.getTotalCashbackBalance()).to.equal(0n);
            });
            it("CPP token balance should not change", async () => {
              await expect(tx).to.changeTokenBalances(
                tokenMock,
                [cpp.address],
                [0n]
              );
            });
            it("should decrease account cashback balance", async () => {
              expect(await cashbackVaultFromCPP.getAccountCashbackBalance(account.address)).to.equal(0n);
            });
            it("should increase account totalClaimed in state", async () => {
              expect((await cashbackVaultFromCPP.getAccountCashbackState(account.address)).totalClaimed)
                .to.equal(900n);
            });
          });
        });
      });
    });
  });
  describe("CPP basic unhappy path token flows and errors checks", async () => {
    it("should revert if we grant cashback for zero address", async () => {
      await expect(cashbackVaultFromCPP.grantCashback(ADDRESS_ZERO, 1000n))
        .to.be.revertedWithCustomError(cashbackVaultFromCPP, "CashbackVault_AccountAddressZero");
    });
    it("should revert if we grant cashback for with amount greater than uint64 max", async () => {
      await expect(cashbackVaultFromCPP.grantCashback(account.address, maxUintForBits(64) + 100n))
        .to.be.revertedWithCustomError(cashbackVaultFromCPP, "CashbackVault_AmountExcess");
    });
    describe("granting 1000 tokens cashback", async () => {
      beforeEach(async () => {
        await cashbackVaultFromCPP.grantCashback(account.address, 1000n);
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
