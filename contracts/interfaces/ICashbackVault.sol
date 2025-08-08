// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title ICashbackVaultTypes interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the types used in the cashback vault smart contract.
 */
interface ICashbackVaultTypes {
    /**
     * @dev The cashback state of a single user within the cashback vault contract.
     *
     * Fields:
     *
     * - balance --- The cashback balance of the user.
     */
    struct UserCashbackState {
        // Slot 1
        uint64 balance;
        // uint96 __reserved1; // Reserved until the end of the storage slot
    }
}

/**
 * @title ICashbackVaultPrimary interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The primary part of the cashback vault smart contract interface.
 */
interface ICashbackVaultPrimary is ICashbackVaultTypes {
    // --- Events ---- //

    /**
     * @dev Emitted when cashback balance has been increased for a user.
     *
     * @param user The user whose cashback balance was increased.
     * @param amount The amount by which the balance was increased.
     * @param newCashbackBalance The new cashback balance of the user.
     */
    event CashbackIncreased(
        address indexed token,
        address indexed user,
        uint256 amount,
        uint256 newCashbackBalance
    );

    /**
     * @dev Emitted when cashback balance has been decreased for a user.
     *
     * @param user The user whose cashback balance was decreased.
     * @param amount The amount by which the balance was decreased.
     * @param newCashbackBalance The new cashback balance of the user.
     */
    event CashbackDecreased(
        address indexed token,
        address indexed user,
        uint256 amount,
        uint256 newCashbackBalance
    );

    /**
     * @dev Emitted when cashback has been claimed for a user.
     *
     * @param user The user for whom cashback was claimed.
     * @param executor The executor who performed the claim.
     * @param amount The amount of cashback claimed.
     * @param newCashbackBalance The new cashback balance of the user.
     */
    event CashbackClaimed(
        address indexed token,
        address indexed user,
        address indexed executor,
        uint256 amount,
        uint256 newCashbackBalance
    );

    // --- Transactional functions ----- //

    /**
     * @dev Increases the cashback balance for a user.
     *
     * Transfers tokens from the caller to the vault and increases the user's cashback balance.
     * This function can be called only by an account with the CPP_ROLE.
     *
     * Emits a {CashbackIncreased} event.
     *
     * @param user The user to increase cashback balance for.
     * @param amount The amount to increase the balance by.
     */
    function incCashback(address user, uint256 amount) external;

    /**
     * @dev Decreases the cashback balance for a user.
     *
     * Transfers tokens from the vault to the caller and decreases the user's cashback balance.
     * This function can be called only by an account with the CPP_ROLE.
     *
     * Emits a {CashbackDecreased} event.
     *
     * @param user The user to decrease cashback balance for.
     * @param amount The amount to decrease the balance by.
     */
    function decCashback(address user, uint256 amount) external;

    /**
     * @dev Claims a specific amount of cashback for a user.
     *
     * Transfers the specified amount of tokens from the vault to the user.
     * This function can be called only by an account with the MANAGER_ROLE.
     *
     * Emits a {CashbackClaimed} event.
     *
     * @param user The user to claim cashback for.
     * @param amount The amount of cashback to claim.
     */
    function claimFor(address user, uint256 amount) external;

    /**
     * @dev Claims all available cashback for a user.
     *
     * Transfers all available cashback tokens from the vault to the user.
     * This function can be called only by an account with the MANAGER_ROLE.
     *
     * Emits a {CashbackClaimed} event.
     *
     * @param user The user to claim all cashback for.
     */
    function claimAll(address user) external;

    // --- View functions ----- //

    /**
     * @dev Returns the cashback balance of a specific user.
     * @param user The user to check the cashback balance of.
     * @return The current cashback balance of the user.
     */
    function getCashbackBalance(address user) external view returns (uint256);

    /**
     * @dev Returns the complete cashback state of a user.
     * @param user The user to get the cashback state of.
     * @return state The complete cashback state of the user.
     */
    function getUserCashbackState(address user) external view returns (UserCashbackState memory state);

    /// @dev Returns the address of the underlying token contract.
    function underlyingToken() external view returns (address);

    /**
     * @dev Returns the balance of the vault.
     * @return The balance of the vault.
     */
    function getVaultBalance() external view returns (uint256);
}

/**
 * @title ICashbackVaultConfiguration interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The configuration part of the cashback vault smart contract interface.
 */
interface ICashbackVaultConfiguration {

}

/**
 * @title ICashbackVaultErrors interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the custom errors used in the cashback vault contract.
 */
interface ICashbackVaultErrors {
    /// @dev Thrown if the provided user address is zero.
    error CashbackVault_UserAddressZero();

    /// @dev Thrown if the provided amount exceeds the maximum allowed.
    error CashbackVault_AmountExcess();

    /// @dev Thrown if the user's cashback balance is insufficient for the operation.
    error CashbackVault_InsufficientCashbackBalance();

    /// @dev Thrown if the vault's token balance is insufficient for the operation.
    error CashbackVault_InsufficientVaultBalance();

    /// @dev Thrown if the provided token address is zero during initialization.
    error CashbackVault_TokenAddressZero();

    /// @dev Thrown if the provided new implementation address is not of a cashback vault contract.
    error CashbackVault_ImplementationAddressInvalid();
}

/**
 * @title ICashbackVault interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The full interface of the cashback vault smart contract.
 *
 * The smart contract manages cashback balances for users and allows:
 * - CPP contracts to increase/decrease cashback balances
 * - Executors to claim cashback on behalf of users
 * - Users to view their cashback balances
 * 
 * The contract stores both the tokens and the corresponding balance mappings,
 * providing a centralized cashback management system.
 */
interface ICashbackVault is ICashbackVaultPrimary, ICashbackVaultConfiguration, ICashbackVaultErrors {
    /**
     * @dev Proves the contract is the cashback vault one. A marker function.
     *
     * It is used for simple contract compliance checks, e.g. during an upgrade.
     * This avoids situations where a wrong contract address is specified by mistake.
     */
    function proveCashbackVault() external pure;
}