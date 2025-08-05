// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title CardPaymentCashback types interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the types used in the wrapper contract for the card payment cashback operations.
 */
interface ICardPaymentCashbackTypes {
    /**
     * @dev Statuses of a cashback operation as an enum.
     *
     * The possible values:
     *
     * - Undefined = 0 -- The operation does not exist (the default value).
     * - Success = 1 ---- The operation has been successfully executed with a full amount transfer.
     * - Partial = 2 ---- The operation has been successfully executed but with a partial amount transfer.
     * - Capped = 3 ----- The operation has been refused because the cap for the period has been reached.
     * - Failed = 4 ----- The operation has been refused because the token transfer has failed.
     */
    enum CashbackOperationStatus {
        Undefined,
        Success,
        Partial,
        Capped,
        Failed
    }

    /**
     * @dev The cashback-related data of a single account.
     *
     * Fields:
     *
     * - totalAmount ----------- The total amount of cashback that has been sent to the account.
     * - capPeriodStartAmount -- The amount of cashback that has been sent to the account during the current cap period.
     * - capPeriodStartTime ---- The timestamp of the start of the current cap period.
     */
    struct AccountCashbackState {
        // Slot 1
        uint72 totalAmount;
        uint72 capPeriodStartAmount;
        uint32 capPeriodStartTime;
        // uint80 __reserved; // Reserved until the end of the storage slot
    }
}

/**
 * @title ICardPaymentCashbackPrimary interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the primary interface of the wrapper contract for the card payment cashback operations.
 */
interface ICardPaymentCashbackPrimary is ICardPaymentCashbackTypes {
    // ------------------ Events ---------------------------------- //
    /**
     * @dev Emitted when a cashback sending request is executed, successfully or not.
     * @param paymentId The associated card transaction payment ID from the off-chain card processing backend.
     * @param recipient The address of the cashback recipient.
     * @param status The status of the cashback operation.
     * @param amount The actual amount of the sent cashback.
     */
    event CashbackSent(
        bytes32 indexed paymentId,
        address indexed recipient,
        CashbackOperationStatus indexed status,
        uint256 amount
    );

    /**
     * @dev Emitted when a cashback revocation request is executed, successfully or not.
     * @param paymentId The associated card transaction payment ID from the off-chain card processing backend.
     * @param recipient The address of the cashback recipient.
     * @param status The status of the cashback operation.
     * @param oldCashbackAmount The cashback amount before the operation.
     * @param newCashbackAmount The cashback amount after the operation.
     *
     */
    event CashbackRevoked(
        bytes32 indexed paymentId,
        address indexed recipient,
        CashbackOperationStatus indexed status,
        uint256 oldCashbackAmount,
        uint256 newCashbackAmount
    );

    /**
     * @dev Emitted when a cashback increase request is executed, successfully or not.
     * @param paymentId The associated card transaction payment ID from the off-chain card processing backend.
     * @param recipient The address of the cashback recipient.
     * @param status The status of the cashback operation.
     * @param oldCashbackAmount The cashback amount before the operation.
     * @param newCashbackAmount The cashback amount after the operation.
     */
    event CashbackIncreased(
        bytes32 indexed paymentId,
        address indexed recipient,
        CashbackOperationStatus indexed status,
        uint256 oldCashbackAmount,
        uint256 newCashbackAmount
    );

    // ------------------ View functions -------------------------- //

    /// @dev Returns the current cashback treasury address.
    function cashbackTreasury() external view returns (address);

    /// @dev Checks if the cashback operations are enabled.
    function cashbackEnabled() external view returns (bool);

    /// @dev Returns the current cashback rate.
    function cashbackRate() external view returns (uint256);

    /**
     * @dev Returns a structure with cashback-related data for a single account.
     * @param account The account address to get the cashback state for.
     */
    function getAccountCashbackState(address account) external view returns (AccountCashbackState memory);
}

/**
 * @title ICardPaymentCashbackConfiguration interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The configuration interface of the wrapper contract for the card payment cashback operations.
 */
interface ICardPaymentCashbackConfiguration {
    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when the cashback rate is changed.
     * @param oldRate The value of the old cashback rate.
     * @param newRate The value of the new cashback rate.
     */
    event CashbackRateChanged(uint256 oldRate, uint256 newRate);

    /**
     * @dev Emitted when the cashback treasury address is changed.
     * @param oldTreasury The address of the old cashback treasury.
     * @param newTreasury The address of the new cashback treasury.
     */
    event CashbackTreasuryChanged(address oldTreasury, address newTreasury);

    /// @dev Emitted when cashback operations for new payments are enabled. Does not affect the existing payments.
    event CashbackEnabled();

    /// @dev Emitted when cashback operations for new payments are disabled. Does not affect the existing payments.
    event CashbackDisabled();

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Sets a new address of the cashback treasury.
     *
     * Emits a {CashbackTreasuryChanged} event.
     *
     * @param newCashbackTreasury The address of the new cashback treasury.
     */
    function setCashbackTreasury(address newCashbackTreasury) external;

    /**
     * @dev Sets a new default cashback rate for new payments.
     *
     * Emits a {CashbackRateChanged} event.
     *
     * @param newCashbackRate The value of the new cashback rate.
     */
    function setCashbackRate(uint256 newCashbackRate) external;

    /**
     * @dev Enables the cashback operations.
     *
     * Emits a {CashbackEnabled} event.
     */
    function enableCashback() external;

    /**
     * @dev Disables the cashback operations.
     *
     * Emits a {CashbackDisabled} event.
     */
    function disableCashback() external;
}

/**
 * @title ICardPaymentCashbackErrors interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The custom errors used in the wrapper contract for the card payment cashback operations.
 */
interface ICardPaymentCashbackErrors {
    /// @dev The cashback operations are already enabled.
    error CashbackAlreadyEnabled();

    /// @dev The cashback operations are already disabled.
    error CashbackAlreadyDisabled();

    /// @dev The cashback treasury address is the same as previously set one.
    error CashbackTreasuryUnchanged();

    /// @dev The cashback treasury address is not configured.
    error CashbackTreasuryNotConfigured();

    /// @dev The zero cashback treasury address has been passed as a function argument.
    error CashbackTreasuryZeroAddress();

    /// @dev The provided cashback rate exceeds the allowed maximum.
    error CashbackRateExcess();

    /// @dev A new cashback rate is the same as previously set one.
    error CashbackRateUnchanged();
}

/**
 * @title ICardPaymentCashback interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The full interface of the wrapper contract for the card payment cashback operations.
 */
interface ICardPaymentCashback is
    ICardPaymentCashbackPrimary,
    ICardPaymentCashbackConfiguration,
    ICardPaymentCashbackErrors
{

}
