// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title ICashbackVaultTypes interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice Defines the types used in the cashback vault smart contract.
 */
interface ICashbackVaultTypes {
    /**
     * @notice The cashback state of a single account within the cashback vault contract.
     *
     * Fields:
     *
     * - balance --- The cashback balance of the account.
     * - totalClaimed --- The total amount of cashback claimed by the account.
     * - lastClaimTimestamp --- The timestamp of the last claim operation.
     */
    struct AccountCashbackState {
        // Slot 1
        uint64 balance;
        uint64 totalClaimed;
        uint64 lastClaimTimestamp;
        // uint64 __reserved; // Reserved until the end of the storage slot
    }

    /**
     * @notice The result of the getAccountCashbackState function.
     *
     * Fields:
     *
     * - balance --- The cashback balance of the account.
     * - totalClaimed --- The total amount of cashback claimed by the account.
     * - lastClaimTimestamp --- The timestamp of the last claim operation.
     */
    struct GetAccountCashbackStateResult {
        uint64 balance;
        uint64 totalClaimed;
        uint64 lastClaimTimestamp;
    }
}

/**
 * @title ICashbackVaultPrimary interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice The primary part of the cashback vault smart contract interface.
 */
interface ICashbackVaultPrimary is ICashbackVaultTypes {
    // --- Events ---- //

    /**
     * @notice Emitted when cashback balance has been increased for a account.
     *
     * @param account The account whose cashback balance was granted.
     * @param executor The executor who performed the grant.
     * @param amount The amount of cashback granted.
     * @param newBalance The new cashback balance of the account.
     */
    event CashbackGranted(
        address indexed account,
        address indexed executor,
        uint256 amount,
        uint256 newBalance
    );

    /**
     * @notice Emitted when cashback balance has been decreased for a account.
     *
     * @param account The account whose cashback balance was decreased.
     * @param executor The executor who performed the revocation.
     * @param amount The amount of cashback revoked.
     * @param newBalance The new cashback balance of the account.
     */
    event CashbackRevoked(
        address indexed account,
        address indexed executor,
        uint256 amount,
        uint256 newBalance
    );

    /**
     * @notice Emitted when cashback has been claimed for a account.
     *
     * @param account The account for whom cashback was claimed.
     * @param executor The executor who performed the claim.
     * @param amount The amount of cashback claimed.
     * @param newBalance The new cashback balance of the account.
     */
    event CashbackClaimed(
        address indexed account,
        address indexed executor,
        uint256 amount,
        uint256 newBalance
    );

    // ------------------ Transactional functions ----------------- //

    /**
     * @notice Increases the cashback balance for a account.
     *
     * Transfers tokens from the caller to the vault and increases the account's cashback balance.
     * This function can be called only by an account with the CASHBACK_OPERATOR_ROLE.
     *
     * Emits a {CashbackIncreased} event.
     *
     * @param account The account to increase cashback balance for.
     * @param amount The amount to increase the balance by.
     */
    function grantCashback(address account, uint256 amount) external;

    /**
     * @notice Decreases the cashback balance for a account.
     *
     * Transfers tokens from the vault to the caller and decreases the account's cashback balance.
     * This function can be called only by an account with the CASHBACK_OPERATOR_ROLE.
     *
     * Emits a {CashbackDecreased} event.
     *
     * @param account The account to decrease cashback balance for.
     * @param amount The amount to decrease the balance by.
     */
    function revokeCashback(address account, uint256 amount) external;

    /**
     * @notice Claims a specific amount of cashback for a account.
     *
     * Transfers the specified amount of tokens from the vault to the account.
     * This function can be called only by an account with the MANAGER_ROLE.
     *
     * Emits a {CashbackClaimed} event.
     *
     * @param account The account to claim cashback for.
     * @param amount The amount of cashback to claim.
     */
    function claim(address account, uint256 amount) external;

    /**
     * @notice Claims all available cashback for a account.
     *
     * Transfers all available cashback tokens from the vault to the account.
     * This function can be called only by an account with the MANAGER_ROLE.
     *
     * Emits a {CashbackClaimed} event.
     *
     * @param account The account to claim all cashback for.
     */
    function claimAll(address account) external;

    // ------------------ View functions -------------------------- //

    /**
     * @notice Returns the cashback balance of a specific account.
     * @param account The account to check the cashback balance of.
     * @return The current cashback balance of the account.
     */
    function getAccountCashbackBalance(address account) external view returns (uint256);

    /**
     * @notice Returns the complete cashback state of a account.
     * @param account The account to get the cashback state of.
     * @return result The complete cashback state of the account.
     */
    function getAccountCashbackState(address account) external view returns (GetAccountCashbackStateResult memory);

    /// @notice Returns the address of the underlying token contract.
    function underlyingToken() external view returns (address);

    /**
     * @notice Returns the balance of the vault.
     * @return The balance of the vault.
     */
    function getTotalCashbackBalance() external view returns (uint256);
}

/**
 * @title ICashbackVaultConfiguration interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice The configuration part of the cashback vault smart contract interface.
 */
interface ICashbackVaultConfiguration {

}

/**
 * @title ICashbackVaultErrors interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice Defines the custom errors used in the cashback vault contract.
 */
interface ICashbackVaultErrors {
    /// @notice Thrown if the provided account address is zero.
    error CashbackVault_AccountAddressZero();

    /// @notice Thrown if the provided amount exceeds the maximum allowed.
    error CashbackVault_AmountExcess();

    /// @notice Thrown if the account's cashback balance is insufficient for the operation.
    error CashbackVault_InsufficientCashbackBalance();

    /// @notice Thrown if the vault's token balance is insufficient for the operation.
    error CashbackVault_InsufficientVaultBalance();

    /// @notice Thrown if the provided token address is zero during initialization.
    error CashbackVault_TokenAddressZero();

    /// @notice Thrown if the provided new implementation address is not of a cashback vault contract.
    error CashbackVault_ImplementationAddressInvalid();
}

/**
 * @title ICashbackVault interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice The full interface of the cashback vault smart contract.
 *
 * The smart contract manages cashback balances for accounts and allows:
 * - CPP contracts to increase/decrease cashback balances
 * - Executors to claim cashback on behalf of accounts
 * - Accounts to view their cashback balances
 * 
 * The contract stores both the tokens and the corresponding balance mappings,
 * providing a centralized cashback management system.
 */
interface ICashbackVault is ICashbackVaultPrimary, ICashbackVaultConfiguration, ICashbackVaultErrors {
    /**
     * @notice Proves the contract is the cashback vault one. A marker function.
     *
     * It is used for simple contract compliance checks, e.g. during an upgrade.
     * This avoids situations where a wrong contract address is specified by mistake.
     */
    function proveCashbackVault() external pure;
}