// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { AccessControlExtUpgradeable } from "./base/AccessControlExtUpgradeable.sol";
import { PausableExtUpgradeable } from "./base/PausableExtUpgradeable.sol";
import { RescuableUpgradeable } from "./base/RescuableUpgradeable.sol";
import { IVersionable } from "./interfaces/IVersionable.sol";
import { UUPSExtUpgradeable } from "./base/UUPSExtUpgradeable.sol";

import { ICashbackVault } from "./interfaces/ICashbackVault.sol";
import { ICashbackVaultPrimary } from "./interfaces/ICashbackVault.sol";
import { ICashbackVaultConfiguration } from "./interfaces/ICashbackVault.sol";

import { CashbackVaultStorageLayout } from "./CashbackVaultStorageLayout.sol";

/**
 * @title CashbackVault contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 */
contract CashbackVault is
    CashbackVaultStorageLayout,
    AccessControlExtUpgradeable,
    PausableExtUpgradeable,
    RescuableUpgradeable,
    UUPSExtUpgradeable,
    IVersionable,
    ICashbackVault
{
    // ------------------ Constants ------------------------------- //

    /// @dev The role of cashback grantors that are allowed to increase and decrease cashback balances.
    bytes32 public constant CASHBACK_OPERATOR_ROLE = keccak256("CASHBACK_OPERATOR_ROLE");

    /// @dev The role of executors that are allowed to claim cashback on behalf of accounts.
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

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
    // --------------------- Modifiers ---------------------------- //

    modifier onlyValidAccount(address account) {
        if (account == address(0)) {
            revert CashbackVault_AccountAddressZero();
        }
        _;
    }

    // ------------------ Initializers ---------------------------- //

    /**
     * @dev Initializer of the upgradeable contract.
     *
     * See details: https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable
     *
     * @param token_ The address of the token to set as the underlying one.
     */
    function initialize(address token_) external initializer {
        __AccessControlExt_init_unchained();
        __PausableExt_init_unchained();
        __Rescuable_init_unchained();
        __UUPSExt_init_unchained(); // This is needed only to avoid errors during coverage assessmen

        if (token_ == address(0)) {
            revert CashbackVault_TokenAddressZero();
        }

        CashbackVaultStorage storage $ = _getCashbackVaultStorage();
        $.token = token_;

        _setRoleAdmin(CASHBACK_OPERATOR_ROLE, GRANTOR_ROLE);
        _setRoleAdmin(MANAGER_ROLE, GRANTOR_ROLE);
        _grantRole(OWNER_ROLE, _msgSender());
    }

    // ------------------ Transactional functions ----------------- //

    /**
     * @inheritdoc ICashbackVaultPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CASHBACK_OPERATOR_ROLE} role.
     * - The provided account address must not be zero.
     * - The provided amount must not be zero.
     */
    function grantCashback(
        address account,
        uint256 amount
    ) external whenNotPaused onlyRole(CASHBACK_OPERATOR_ROLE) onlyValidAccount(account) {
        CashbackVaultStorage storage $ = _getCashbackVaultStorage();
        AccountCashbackState storage accountState = $.accountCashbackStates[account];

        if (amount > type(uint64).max) {
            revert CashbackVault_AmountExcess();
        }

        uint256 accountBalance = accountState.balance;
        uint256 totalBalance = $.totalCashback;

        unchecked{
            accountBalance += amount;
            totalBalance += amount;
        }

        if (accountBalance > type(uint64).max) {
            revert CashbackVault_AccountBalanceExcess();
        }
        if (totalBalance > type(uint64).max) {
            revert CashbackVault_TotalBalanceExcess();
        }

        accountState.balance = uint64(accountBalance);
        $.totalCashback = uint64(totalBalance);

        // Transfer tokens from caller to vault
        IERC20($.token).transferFrom(_msgSender(), address(this), amount);

        emit CashbackGranted(account, _msgSender(), amount, accountBalance);
    }

    /**
     * @inheritdoc ICashbackVaultPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CASHBACK_OPERATOR_ROLE} role.
     * - The provided account address must not be zero.
     * - The provided amount must not be zero.
     * - The account must have sufficient cashback balance.
     */
    function revokeCashback(
        address account,
        uint256 amount
    ) external whenNotPaused onlyRole(CASHBACK_OPERATOR_ROLE) onlyValidAccount(account) {
        CashbackVaultStorage storage $ = _getCashbackVaultStorage();
        AccountCashbackState storage accountState = $.accountCashbackStates[account];

        uint256 accountBalance = accountState.balance;
        uint256 totalBalance = $.totalCashback;
        if (accountBalance < amount) {
            revert CashbackVault_CashbackBalanceInsufficient();
        }

        unchecked {
            accountBalance -= amount;
            totalBalance -= amount; // It is safe due to the contract logic
        }
        accountState.balance = uint64(accountBalance);
        $.totalCashback = uint64(totalBalance);

        // Transfer tokens from vault to caller
        IERC20($.token).transfer(_msgSender(), amount);
        emit CashbackRevoked(account, _msgSender(), amount, accountBalance);
    }

    /**
     * @inheritdoc ICashbackVaultPrimary
     *
     * @dev Requirements:
     *å
     * - The contract must not be paused.
     * - The caller must have the {MANAGER_ROLE} role.
     * - The provided account address must not be zero.
     * - The account must have sufficient cashback balance.
     */
    function claim(
        address account,
        uint256 amount
    ) external whenNotPaused onlyRole(MANAGER_ROLE) onlyValidAccount(account) {
        _claim(account, amount);
    }

    /**
     * @inheritdoc ICashbackVaultPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {EXECUTOR_ROLE} role.
     * - The provided account address must not be zero.
     * - The account must have cashback balance greater than zero.
     */
    function claimAll(address account) external whenNotPaused onlyRole(MANAGER_ROLE) onlyValidAccount(account) {
        AccountCashbackState storage accountState = _getCashbackVaultStorage().accountCashbackStates[account];

        _claim(account, accountState.balance);
    }

    // ------------------ View functions -------------------------- //

    /// @inheritdoc ICashbackVaultPrimary
    function getAccountCashbackBalance(address account) external view returns (uint256) {
        return _getCashbackVaultStorage().accountCashbackStates[account].balance;
    }

    /// @inheritdoc ICashbackVaultPrimary
    function getTotalCashbackBalance() external view returns (uint256) {
        return _getCashbackVaultStorage().totalCashback;
    }

    /// @inheritdoc ICashbackVaultPrimary
    function getAccountCashbackState(address account) external view returns (AccountCashbackStateView memory) {
        AccountCashbackState storage accountState = _getCashbackVaultStorage().accountCashbackStates[account];
        return AccountCashbackStateView({
            balance: accountState.balance,
            totalClaimed: accountState.totalClaimed,
            lastClaimTimestamp: accountState.lastClaimTimestamp
        });
    }

    /// @inheritdoc ICashbackVaultPrimary
    function underlyingToken() external view returns (address) {
        return _getCashbackVaultStorage().token;
    }

    // ------------------ Pure functions -------------------------- //

    /// @inheritdoc ICashbackVault
    function proveCashbackVault() external pure {}

    /// @dev Returns the version of the contract.
    function $__VERSION() external pure returns (IVersionable.Version memory) {
        return IVersionable.Version(1, 0, 0);
    }

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev Claims cashback for a account.
     *
     * @param account The account to claim cashback for.
     * @param amount The amount of cashback to claim.
     */
    function _claim(address account, uint256 amount) internal {
        CashbackVaultStorage storage $ = _getCashbackVaultStorage();
        AccountCashbackState storage accountState = $.accountCashbackStates[account];

        uint256 accountBalance = accountState.balance;
        uint256 totalBalance = $.totalCashback;
        uint256 accountTotalClaimed = accountState.totalClaimed;
        if (accountBalance < amount) {
            revert CashbackVault_CashbackBalanceInsufficient();
        }

        unchecked {
            accountBalance -= amount;
            accountTotalClaimed += amount;
            totalBalance -= amount; // It is safe due to the contract logic
        }

        if (accountTotalClaimed > type(uint64).max) {
            revert CashbackVault_AccountTotalClaimedExcess();
        }

        accountState.balance = uint64(accountBalance);
        accountState.totalClaimed = uint64(accountTotalClaimed);
        accountState.lastClaimTimestamp = uint64(block.timestamp);
        $.totalCashback = uint64(totalBalance);

        // Transfer tokens from vault to account
        IERC20($.token).transfer(account, amount);
        emit CashbackClaimed(account, _msgSender(), amount, accountBalance);
    }

    /**
     * @dev The upgrade validation function for the UUPSExtUpgradeable contract.
     * @param newImplementation The address of the new implementation.
     */
    function _validateUpgrade(address newImplementation) internal view override onlyRole(OWNER_ROLE) {
        try ICashbackVault(newImplementation).proveCashbackVault() {} catch {
            revert CashbackVault_ImplementationAddressInvalid();
        }
    }
}
