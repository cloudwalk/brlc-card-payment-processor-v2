// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import { ICashbackController, ICashbackControllerPrimary } from "./interfaces/ICashbackController.sol";
import { ICashbackControllerConfiguration } from "./interfaces/ICashbackController.sol";
import { ICashbackControllerTypes } from "./interfaces/ICashbackController.sol";
import { ICashbackControllerStorageLayout } from "./CashbackControlllerStorageLayout.sol";

import { AccessControlExtUpgradeable } from "./base/AccessControlExtUpgradeable.sol";
import { RescuableUpgradeable } from "./base/RescuableUpgradeable.sol";
import { UUPSExtUpgradeable } from "./base/UUPSExtUpgradeable.sol";
import { Versionable } from "./base/Versionable.sol";
import { IAfterPaymentMadeHook } from "./hookable/interfaces/ICardPaymentProcessorHooks.sol";
import { IAfterPaymentUpdatedHook } from "./hookable/interfaces/ICardPaymentProcessorHooks.sol";
import { IAfterPaymentCanceledHook } from "./hookable/interfaces/ICardPaymentProcessorHooks.sol";
import { ICardPaymentProcessor } from "./interfaces/ICardPaymentProcessor.sol";
import { ICashbackVault } from "./interfaces/ICashbackVault.sol";
import { ICardPaymentProcessorHook } from "./hookable/interfaces/ICardPaymentProcessorHooks.sol";

/*
    q remove cashback sent event in favor to increase 
    q correct cashback has no validaton on paymentid and account

    CasbackSent -> remove
    CashbackIncreaased -> CashbackGranted
*/
contract CashbackController is
    ICashbackControllerStorageLayout,
    AccessControlExtUpgradeable,
    RescuableUpgradeable,
    UUPSExtUpgradeable,
    Versionable,
    ICashbackController
{
    // ------------------ Constants ------------------------------- //

    /// @dev The role for hook trigger who are allowed to trigger the hook.
    bytes32 public constant HOOK_TRIGGER_ROLE = keccak256("HOOK_TRIGGER_ROLE");

    /// @dev The role for cashback operators who are allowed to correct the cashback amount for a payment.
    bytes32 public constant CASHBACK_OPERATOR_ROLE = keccak256("CASHBACK_OPERATOR_ROLE");

    /// @dev The number of decimals that is used in the underlying token contract.
    uint256 public constant TOKEN_DECIMALS = 6;

    /**
     * @dev The factor to represent the cashback rates in the contract, e.g. number 15 means 1.5% cashback rate.
     *
     * The formula to calculate cashback by an amount: `cashbackAmount = cashbackRate * amount / CASHBACK_FACTOR`.
     */
    uint256 public constant CASHBACK_FACTOR = 1000;

    /**
     * @dev The coefficient used to round the cashback according to the formula:
     *      `roundedCashback = ((cashback + coef / 2) / coef) * coef`.
     *
     * Currently, it can only be changed by deploying a new implementation of the contract.
     */
    uint256 public constant CASHBACK_ROUNDING_COEF = 10 ** (TOKEN_DECIMALS - 2);

    /// @dev The cashback cap reset period.
    uint256 public constant CASHBACK_CAP_RESET_PERIOD = 30 days;

    /// @dev The maximum cashback for a cap period.
    uint256 public constant MAX_CASHBACK_FOR_CAP_PERIOD = 300 * 10 ** TOKEN_DECIMALS;

    // ------------------ Constructor ----------------------------- //

    /**
     * @dev Constructor that prohibits the initialization of the implementation of the upgradeable contract.
     *
     * See details:
     * https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable#initializing_the_implementation_contract
     *
     * @custom:oz-upgrades-unsafe-allow constructor
     */
    constructor() {
        _disableInitializers();
    }

    // ------------------ Initializers ---------------------------- //

    /**
     * @dev Initializer of the upgradeable contract.
     *
     * See details: https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable
     *
     * @param token_ The address of the token to set as the underlying one.
     */
    function initialize(address token_) external virtual initializer {
        __AccessControlExt_init_unchained();
        __Rescuable_init_unchained();
        __UUPSExt_init_unchained(); // This is needed only to avoid errors during coverage assessment

        if (token_ == address(0)) {
            revert CashbackController_TokenAddressZero();
        }

        CashbackControllerStorage storage $ = _getCashbackControllerStorage();
        $.token = token_;

        _setRoleAdmin(HOOK_TRIGGER_ROLE, GRANTOR_ROLE);
        _setRoleAdmin(CASHBACK_OPERATOR_ROLE, OWNER_ROLE);
        _grantRole(OWNER_ROLE, _msgSender());
    }

    // ------------------ Hooks ----------------------------------- //

    /**
     * @dev The hook function for the afterPaymentMade event in the CardPaymentProcessor contract.
     *
     * Creates cashback operation and increases cashback.
     */
    function afterPaymentMade(
        bytes32 paymentId,
        PaymentHookData calldata,
        PaymentHookData calldata payment
    ) external onlyRole(HOOK_TRIGGER_ROLE) {
        if (payment.cashbackRate == 0) {
            return;
        }

        CashbackControllerStorage storage $ = _getCashbackControllerStorage();

        uint256 basePaymentAmount = _definePayerBaseAmount(payment.baseAmount, payment.subsidyLimit);
        uint256 desiredCashbackAmount = _calculateCashback(basePaymentAmount, payment.cashbackRate);
        PaymentCashback storage paymentCashback = $.paymentCashbacks[paymentId];
        paymentCashback.account = payment.payer;

        PaymentCashbackStatus status;
        (status, ) = _increaseCashback(paymentCashback, desiredCashbackAmount);
        emit CashbackSent(
            paymentId, // Tools: prevent Prettier one-liner
            payment.payer,
            PaymentCashbackStatus(status),
            paymentCashback.sentAmount
        );
    }

    /**
     * @dev The hook function for the afterPaymentUpdated event in the CardPaymentProcessor contract.
     *
     * Updates cashback operation and increases or revokes cashback.
     */
    function afterPaymentUpdated(
        bytes32 paymentId,
        PaymentHookData calldata,
        PaymentHookData calldata payment
    ) external onlyRole(HOOK_TRIGGER_ROLE) {
        if (payment.cashbackRate == 0) {
            return;
        }
        uint256 payerBaseAmount = _definePayerBaseAmount(payment.baseAmount, payment.subsidyLimit);
        uint256 assumedSponsorRefundAmount = (payment.baseAmount > payment.subsidyLimit)
            ? ((payment.refundAmount * payment.subsidyLimit) / payment.baseAmount)
            : payment.refundAmount;
        uint256 sponsorRefundAmount = (assumedSponsorRefundAmount < payment.subsidyLimit)
            ? assumedSponsorRefundAmount
            : payment.subsidyLimit;
        uint256 payerRefundAmount = payment.refundAmount - sponsorRefundAmount;
        uint256 desiredCashbackAmount = (payerBaseAmount > payerRefundAmount)
            ? _calculateCashback(payerBaseAmount - payerRefundAmount, payment.cashbackRate)
            : 0;

        _updateCashbackAmount(paymentId, desiredCashbackAmount);
    }

    /**
     * @dev The hook function for the afterPaymentCanceled event in the CardPaymentProcessor contract.
     *
     * Revokes cashback.
     */
    function afterPaymentCanceled(
        bytes32 paymentId,
        PaymentHookData calldata oldPayment,
        PaymentHookData calldata
    ) external onlyRole(HOOK_TRIGGER_ROLE) {
        if (oldPayment.cashbackRate == 0) {
            return;
        }

        _updateCashbackAmount(paymentId, 0);
    }

    // ------------------ Transactional functions ----------------- //

    /**
     * @inheritdoc ICashbackControllerPrimary
     *
     * @dev Requirements:
     *
     * - The caller must have the {CASHBACK_OPERATOR_ROLE} role.
     */
    function correctCashbackAmount(
        bytes32 paymentId,
        uint64 newCashbackAmount
    ) external onlyRole(CASHBACK_OPERATOR_ROLE) {
        _updateCashbackAmount(paymentId, newCashbackAmount);
    }

    /**
     * @inheritdoc ICashbackControllerConfiguration
     *
     * @dev Requirements:
     *
     * - The caller must have the {OWNER_ROLE} role.
     * - The new cashback treasury address must not be zero.
     * - The new cashback treasury address must not be equal to the current set one.
     */
    function setCashbackTreasury(address newCashbackTreasury) external onlyRole(OWNER_ROLE) {
        CashbackControllerStorage storage $ = _getCashbackControllerStorage();
        address oldCashbackTreasury = $.cashbackTreasury;

        // This is needed to allow cashback changes for any existing active payments.
        if (newCashbackTreasury == address(0)) {
            revert CashbackController_TreasuryZeroAddress();
        }
        if (oldCashbackTreasury == newCashbackTreasury) {
            revert CashbackController_TreasuryUnchanged();
        }

        $.cashbackTreasury = newCashbackTreasury;

        emit CashbackTreasuryChanged(oldCashbackTreasury, newCashbackTreasury);
    }

    /**
     * @inheritdoc ICashbackControllerConfiguration
     *
     * @dev Requirements:
     *
     * - The caller must have the {OWNER_ROLE} role.
     */
    function setCashbackVault(address cashbackVault) external onlyRole(OWNER_ROLE) {
        CashbackControllerStorage storage $ = _getCashbackControllerStorage();

        address oldCashbackVault = $.cashbackVault;

        if (oldCashbackVault == cashbackVault) {
            revert CashbackController_CashbackVaultUnchanged();
        }
        if (cashbackVault != address(0)) {
            try ICashbackVault(cashbackVault).proveCashbackVault() {} catch {
                revert CashbackController_CashbackVaultInvalid();
            }
            if (ICashbackVault(cashbackVault).underlyingToken() != $.token) {
                revert CashbackController_CashbackVaultTokenMismatch();
            }

            IERC20($.token).approve(cashbackVault, type(uint256).max);
        }

        if (oldCashbackVault != address(0)) {
            IERC20($.token).approve(oldCashbackVault, 0);
        }
        $.cashbackVault = cashbackVault;

        emit CashbackVaultUpdated(cashbackVault);
    }

    // ------------------ View functions -------------------------- //

    /**
     * @inheritdoc ICardPaymentProcessorHook
     * @dev Restricted to {HOOK_TRIGGER_ROLE} so only validated CPP contracts can register this hook.
     */
    function supportsHookMethod(bytes4 methodSelector) external view onlyRole(HOOK_TRIGGER_ROLE) returns (bool) {
        return
            methodSelector == IAfterPaymentMadeHook.afterPaymentMade.selector ||
            methodSelector == IAfterPaymentUpdatedHook.afterPaymentUpdated.selector ||
            methodSelector == IAfterPaymentCanceledHook.afterPaymentCanceled.selector;
    }

    /// @inheritdoc ICashbackControllerConfiguration
    function getCashbackTreasury() external view returns (address) {
        return _getCashbackControllerStorage().cashbackTreasury;
    }

    /// @inheritdoc ICashbackControllerConfiguration
    function underlyingToken() external view returns (address) {
        return _getCashbackControllerStorage().token;
    }

    /// @inheritdoc ICashbackControllerConfiguration
    function getCashbackVault() external view returns (address) {
        return _getCashbackControllerStorage().cashbackVault;
    }

    /// @inheritdoc ICashbackControllerPrimary
    function getAccountCashbackState(address account) external view returns (AccountCashbackStateView memory) {
        AccountCashbackState storage accountState = _getCashbackControllerStorage().accountCashbackStates[account];
        return
            AccountCashbackStateView({
                totalAmount: accountState.totalAmount,
                capPeriodStartAmount: accountState.capPeriodStartAmount,
                capPeriodStartTime: accountState.capPeriodStartTime
            });
    }

    /// @inheritdoc ICashbackControllerPrimary
    function getPaymentCashbackState(bytes32 paymentId) external view returns (PaymentCashbackView memory) {
        PaymentCashback storage paymentCashback = _getCashbackControllerStorage().paymentCashbacks[paymentId];
        return PaymentCashbackView({ sentAmount: paymentCashback.sentAmount, account: paymentCashback.account });
    }

    // ------------------ Pure functions -------------------------- //

    /// @inheritdoc ICashbackController
    function proveCashbackController() external pure {}

    /// @dev Defines the payer part of a payment base amount according to a subsidy limit.
    function _definePayerBaseAmount(uint256 paymentBaseAmount, uint256 subsidyLimit) internal pure returns (uint256) {
        if (paymentBaseAmount > subsidyLimit) {
            return paymentBaseAmount - subsidyLimit;
        } else {
            return 0;
        }
    }

    /// @dev Calculates cashback according to the amount and the rate.
    function _calculateCashback(uint256 amount, uint256 cashbackRate_) internal pure returns (uint256) {
        uint256 cashback = (amount * cashbackRate_) / CASHBACK_FACTOR;
        return ((cashback + CASHBACK_ROUNDING_COEF / 2) / CASHBACK_ROUNDING_COEF) * CASHBACK_ROUNDING_COEF;
    }

    // ------------------ Internal functions ---------------------- //

    function _updateCashbackAmount(bytes32 paymentId, uint256 desiredCashbackAmount) internal {
        CashbackControllerStorage storage $ = _getCashbackControllerStorage();
        PaymentCashback storage paymentCashback = $.paymentCashbacks[paymentId];
        PaymentCashbackStatus status;
        uint256 oldCashbackAmount = paymentCashback.sentAmount;
        address account = paymentCashback.account;

        if (account == address(0)) {
            revert CashbackController_CashbackDoesNotExist();
        }

        if (desiredCashbackAmount > oldCashbackAmount) {
            uint256 amount = desiredCashbackAmount - oldCashbackAmount;
            (status, amount) = _increaseCashback(paymentCashback, amount);
            emit CashbackIncreased(paymentId, account, status, oldCashbackAmount, paymentCashback.sentAmount);
        } else if (desiredCashbackAmount < oldCashbackAmount) {
            uint256 amount = oldCashbackAmount - desiredCashbackAmount;
            (status, amount) = _revokeCashback(paymentCashback, amount);
            emit CashbackRevoked(paymentId, account, status, oldCashbackAmount, paymentCashback.sentAmount);
        }
    }

    /**
     * @dev Increases cashback related to a payment and stores current state of operation
     *
     * It may increase cashback to amount lower then desiredAmount if cashback cap is reached.
     * After the operation, paymentCashback.cashbackAmount will be equal to the actual increased amount.
     *
     * @param paymentCashback The cashback to increase.
     * @param desiredAmount The desired amount of cashback to increase.
     *
     * @return status The new status of the cashback operation.
     * @return increasedAmount The actual amount of cashback that was increased.
     */
    function _increaseCashback(
        PaymentCashback storage paymentCashback,
        uint256 desiredAmount
    ) internal returns (PaymentCashbackStatus status, uint256 increasedAmount) {
        CashbackControllerStorage storage $ = _getCashbackControllerStorage();
        AccountCashbackState memory oldAccountCashbackState = $.accountCashbackStates[paymentCashback.account];
        (status, increasedAmount) = _processAccountCashbackWithCap(paymentCashback.account, desiredAmount);

        // if it is not capped, we can try to transfer funds
        if (status != PaymentCashbackStatus.Capped) {
            if (IERC20($.token).balanceOf($.cashbackTreasury) < increasedAmount) {
                status = PaymentCashbackStatus.OutOfFunds;
                increasedAmount = 0;
                // restore account cashback state to previous state if we failed to increase cashback
                $.accountCashbackStates[paymentCashback.account] = oldAccountCashbackState;
            } else {
                IERC20($.token).transferFrom($.cashbackTreasury, address(this), increasedAmount);

                if ($.cashbackVault != address(0)) {
                    ICashbackVault($.cashbackVault).grantCashback(paymentCashback.account, uint64(increasedAmount));
                } else {
                    IERC20($.token).transfer(paymentCashback.account, increasedAmount);
                }
            }
        }
        paymentCashback.sentAmount += uint64(increasedAmount);
    }

    /// @dev Revokes partially or fully cashback related to a payment.
    function _revokeCashback(
        PaymentCashback storage paymentCashback,
        uint256 desiredAmount
    ) internal returns (PaymentCashbackStatus status, uint256 revokedAmount) {
        CashbackControllerStorage storage $ = _getCashbackControllerStorage();
        status = PaymentCashbackStatus.Success;

        (uint256 vaultRevocationAmount, uint256 accountRevocationAmount) = _calculateRevokationAmounts(
            paymentCashback.account,
            desiredAmount
        );

        if (vaultRevocationAmount > 0) {
            ICashbackVault($.cashbackVault).revokeCashback(paymentCashback.account, uint64(vaultRevocationAmount));
        }
        if (accountRevocationAmount > 0) {
            IERC20($.token).transferFrom(paymentCashback.account, address(this), accountRevocationAmount);
        }

        IERC20($.token).transfer($.cashbackTreasury, vaultRevocationAmount + accountRevocationAmount);
        _reduceTotalCashback(paymentCashback.account, desiredAmount);
        revokedAmount = desiredAmount;

        paymentCashback.sentAmount -= uint64(revokedAmount);
    }

    /**
     * @dev Calculates the amounts to revoke from the cashback vault and the account.
     *
     * Uses the vault balance first, then the account balance.
     *
     * @param recipient The recipient address.
     * @param amount The cashback amount to revoke.
     */
    function _calculateRevokationAmounts(
        address recipient,
        uint256 amount
    ) internal view returns (uint256 vaultRevocationAmount, uint256 accountRevocationAmount) {
        CashbackControllerStorage storage $ = _getCashbackControllerStorage();
        accountRevocationAmount = amount;
        if ($.cashbackVault != address(0)) {
            uint256 vaultAccountBalance = ICashbackVault($.cashbackVault).getAccountCashbackBalance(recipient);
            vaultRevocationAmount = vaultAccountBalance >= amount ? amount : vaultAccountBalance;
            accountRevocationAmount -= vaultRevocationAmount;
        }
    }

    /// @dev Processes account cashback with cap enforcement, updating state and bounding amount.
    function _processAccountCashbackWithCap(
        address account,
        uint256 amount
    ) internal returns (PaymentCashbackStatus cashbackStatus, uint256 acceptedAmount) {
        CashbackControllerStorage storage $ = _getCashbackControllerStorage();
        AccountCashbackState storage state = $.accountCashbackStates[account];

        uint256 totalAmount = state.totalAmount;
        uint256 capPeriodStartTime = state.capPeriodStartTime;
        uint256 capPeriodStartAmount = state.capPeriodStartAmount;
        uint256 capPeriodCollectedCashback = 0;

        unchecked {
            uint256 blockTimestamp = uint32(block.timestamp); // take only last 32 bits of the block timestamp
            if (uint32(blockTimestamp - capPeriodStartTime) > CASHBACK_CAP_RESET_PERIOD) {
                capPeriodStartTime = blockTimestamp;
            } else {
                capPeriodCollectedCashback = totalAmount - capPeriodStartAmount;
            }

            if (capPeriodCollectedCashback < MAX_CASHBACK_FOR_CAP_PERIOD) {
                uint256 leftAmount = MAX_CASHBACK_FOR_CAP_PERIOD - capPeriodCollectedCashback;
                if (leftAmount >= amount) {
                    acceptedAmount = amount;
                    cashbackStatus = PaymentCashbackStatus.Success;
                } else {
                    acceptedAmount = leftAmount;
                    cashbackStatus = PaymentCashbackStatus.Partial;
                }
            } else {
                cashbackStatus = PaymentCashbackStatus.Capped;
            }
        }

        if (capPeriodCollectedCashback == 0) {
            capPeriodStartAmount = totalAmount;
        }

        state.totalAmount = uint72(totalAmount) + uint72(acceptedAmount);
        state.capPeriodStartAmount = uint72(capPeriodStartAmount);
        state.capPeriodStartTime = uint32(capPeriodStartTime);
    }

    /// @dev Reduces the total cashback amount for an account.
    function _reduceTotalCashback(address account, uint256 amount) internal {
        CashbackControllerStorage storage $ = _getCashbackControllerStorage();
        AccountCashbackState storage state = $.accountCashbackStates[account];
        state.totalAmount = uint72(uint256(state.totalAmount) - amount);
    }

    /**
     * @dev Adds extra validation for {HOOK_TRIGGER_ROLE}; only compatible CPP contracts with the same token are allowed.
     */
    function _grantRole(bytes32 role, address account) internal virtual override returns (bool) {
        if (role == HOOK_TRIGGER_ROLE) {
            CashbackControllerStorage storage $ = _getCashbackControllerStorage();
            if (account.code.length == 0) {
                revert CashbackController_HookTriggerRoleIncompatible();
            }
            try ICardPaymentProcessor(account).proveCardPaymentProcessor() {} catch {
                revert CashbackController_HookTriggerRoleIncompatible();
            }
            if (ICardPaymentProcessor(account).token() != $.token) {
                revert CashbackController_HookTriggerRoleIncompatible();
            }
        }
        return super._grantRole(role, account);
    }

    /**
     * @dev The upgrade validation function for the UUPSExtUpgradeable contract.
     * @param newImplementation The address of the new implementation.
     */
    function _validateUpgrade(address newImplementation) internal view override onlyRole(OWNER_ROLE) {
        try ICashbackController(newImplementation).proveCashbackController() {} catch {
            revert CashbackController_ImplementationAddressInvalid();
        }
    }
}
