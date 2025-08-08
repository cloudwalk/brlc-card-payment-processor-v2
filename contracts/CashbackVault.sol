// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

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
 * @dev The smart contract manages cashback balances for users.
 * It allows CPP contracts to increase/decrease cashback balances and executors to claim cashback on behalf of users.
 *
 * See details about the contract in the comments of the {ICashbackVault} interface.
 */
contract CashbackVault is
    CashbackVaultStorageLayout,
    AccessControlExtUpgradeable,
    PausableExtUpgradeable,
    RescuableUpgradeable,
    UUPSExtUpgradeable,
    ReentrancyGuardUpgradeable,
    IVersionable,
    ICashbackVault
{
    // --- Constants ---- //

    /// @dev The role of CPP contracts that are allowed to increase and decrease cashback balances.
    bytes32 public constant CPP_ROLE = keccak256("CPP_ROLE");

    /// @dev The role of executors that are allowed to claim cashback on behalf of users.
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    // --- Types ----- //

    using SafeERC20 for IERC20;

    // --- Constructor ----- //

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

    // --- Initializers ---- //

    /**
     * @dev Initializer of the upgradeable contract.
     *
     * See details: https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable
     *
     * @param token_ The address of the token to set as the underlying one.
     * @param maxCashbackPerUser_ The maximum cashback amount allowed per user.
     */
    function initialize(address token_, uint256 maxCashbackPerUser_) external initializer {
        __AccessControlExt_init_unchained();
        __PausableExt_init_unchained();
        __Rescuable_init_unchained();
        __UUPSExt_init_unchained(); // This is needed only to avoid errors during coverage assessment
        __ReentrancyGuard_init_unchained();

        if (token_ == address(0)) {
            revert CashbackVault_TokenAddressZero();
        }

        CashbackVaultStorage storage $ = _getCashbackVaultStorage();
        $.token = token_;
        $.maxCashbackPerUser = maxCashbackPerUser_;

        _setRoleAdmin(CPP_ROLE, GRANTOR_ROLE);
        _setRoleAdmin(EXECUTOR_ROLE, GRANTOR_ROLE);
        _grantRole(OWNER_ROLE, _msgSender());
    }

    // --- Transactional functions ----- //

    /**
     * @inheritdoc ICashbackVaultConfiguration
     *
     * @dev Requirements:
     *
     * - The caller must have the {OWNER_ROLE} role.
     */
    function setMaxCashbackPerUser(uint256 newMaxCashback) external onlyRole(OWNER_ROLE) {
        CashbackVaultStorage storage $ = _getCashbackVaultStorage();
        uint256 oldMaxCashback = $.maxCashbackPerUser;

        $.maxCashbackPerUser = newMaxCashback;

        emit MaxCashbackPerUserChanged(newMaxCashback, oldMaxCashback);
    }

    /**
     * @inheritdoc ICashbackVaultPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CPP_ROLE} role.
     * - The provided user address must not be zero.
     * - The provided amount must not be zero.
     * - The user's new balance must not exceed the maximum allowed per user.
     */
    function incCashback(address user, uint256 amount) external whenNotPaused onlyRole(CPP_ROLE) nonReentrant {
        _validateUserAndAmount(user, amount);

        CashbackVaultStorage storage $ = _getCashbackVaultStorage();
        UserCashbackState storage userState = $.userCashbackStates[user];

        uint256 oldBalance = userState.balance;
        uint256 newBalance = oldBalance + amount;

        // Check maximum cashback per user limit
        if ($.maxCashbackPerUser > 0 && newBalance > $.maxCashbackPerUser) {
            revert CashbackVault_CashbackBalanceExcess();
        }

        // Check for overflow
        if (newBalance > type(uint64).max) {
            revert CashbackVault_AmountExcess();
        }

        userState.balance = uint64(newBalance);
        $.totalCashback += amount;

        emit CashbackIncreased(user, amount, newBalance);

        // Transfer tokens from caller to vault
        IERC20($.token).safeTransferFrom(_msgSender(), address(this), amount);
    }

    /**
     * @inheritdoc ICashbackVaultPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CPP_ROLE} role.
     * - The provided user address must not be zero.
     * - The provided amount must not be zero.
     * - The user must have sufficient cashback balance.
     */
    function decCashback(address user, uint256 amount) external whenNotPaused onlyRole(CPP_ROLE) nonReentrant {
        _validateUserAndAmount(user, amount);

        CashbackVaultStorage storage $ = _getCashbackVaultStorage();
        UserCashbackState storage userState = $.userCashbackStates[user];

        uint256 oldBalance = userState.balance;
        if (oldBalance < amount) {
            revert CashbackVault_InsufficientCashbackBalance();
        }

        uint256 newBalance = oldBalance - amount;
        userState.balance = uint64(newBalance);
        $.totalCashback -= amount;

        emit CashbackDecreased(user, amount, newBalance);

        // Transfer tokens from vault to caller
        IERC20($.token).safeTransfer(_msgSender(), amount);
    }

    /**
     * @inheritdoc ICashbackVaultPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {EXECUTOR_ROLE} role.
     * - The provided user address must not be zero.
     * - The provided amount must not be zero.
     * - The user must have sufficient cashback balance.
     */
    function claimFor(address user, uint256 amount) external whenNotPaused onlyRole(EXECUTOR_ROLE) nonReentrant {
        _validateUserAndAmount(user, amount);

        CashbackVaultStorage storage $ = _getCashbackVaultStorage();
        UserCashbackState storage userState = $.userCashbackStates[user];

        uint256 oldBalance = userState.balance;
        if (oldBalance < amount) {
            revert CashbackVault_InsufficientCashbackBalance();
        }

        uint256 newBalance = oldBalance - amount;
        userState.balance = uint64(newBalance);
        userState.totalClaimed += uint64(amount);
        userState.lastClaimTimestamp = uint64(block.timestamp);
        $.totalCashback -= amount;

        emit CashbackClaimed(user, _msgSender(), amount, newBalance);

        // Transfer tokens from vault to user
        IERC20($.token).safeTransfer(user, amount);
    }

    /**
     * @inheritdoc ICashbackVaultPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {EXECUTOR_ROLE} role.
     * - The provided user address must not be zero.
     * - The user must have cashback balance greater than zero.
     */
    function claimAll(address user) external whenNotPaused onlyRole(EXECUTOR_ROLE) nonReentrant {
        if (user == address(0)) {
            revert CashbackVault_UserAddressZero();
        }

        CashbackVaultStorage storage $ = _getCashbackVaultStorage();
        UserCashbackState storage userState = $.userCashbackStates[user];

        uint256 amount = userState.balance;
        if (amount == 0) {
            revert CashbackVault_AmountZero();
        }

        userState.balance = 0;
        userState.totalClaimed += uint64(amount);
        userState.lastClaimTimestamp = uint64(block.timestamp);
        $.totalCashback -= amount;

        emit CashbackClaimed(user, _msgSender(), amount, 0);

        // Transfer tokens from vault to user
        IERC20($.token).safeTransfer(user, amount);
    }

    // --- View functions ----- //

    /// @inheritdoc ICashbackVaultPrimary
    function getMyCashback() external view returns (uint256) {
        return _getCashbackVaultStorage().userCashbackStates[_msgSender()].balance;
    }

    /// @inheritdoc ICashbackVaultPrimary
    function getCashbackBalance(address user) external view returns (uint256) {
        return _getCashbackVaultStorage().userCashbackStates[user].balance;
    }

    /// @inheritdoc ICashbackVaultPrimary
    function getUserCashbackState(address user) external view returns (UserCashbackState memory) {
        return _getCashbackVaultStorage().userCashbackStates[user];
    }

    /// @inheritdoc ICashbackVaultPrimary
    function getTotalCashback() external view returns (uint256) {
        return _getCashbackVaultStorage().totalCashback;
    }

    /// @inheritdoc ICashbackVaultPrimary
    function underlyingToken() external view returns (address) {
        return _getCashbackVaultStorage().token;
    }

    /// @inheritdoc ICashbackVaultConfiguration
    function maxCashbackPerUser() external view returns (uint256) {
        return _getCashbackVaultStorage().maxCashbackPerUser;
    }

    // --- Pure functions ----- //

    /// @inheritdoc ICashbackVault
    function proveCashbackVault() external pure {}

    /// @inheritdoc IVersionable
    function $__VERSION() external pure returns (Version memory) {
        return Version(1, 0, 0);
    }

    // --- Internal functions ---- //

    /**
     * @dev Validates user address and amount parameters.
     * @param user The user address to validate.
     * @param amount The amount to validate.
     */
    function _validateUserAndAmount(address user, uint256 amount) internal pure {
        if (user == address(0)) {
            revert CashbackVault_UserAddressZero();
        }
        if (amount == 0) {
            revert CashbackVault_AmountZero();
        }
        if (amount > type(uint64).max) {
            revert CashbackVault_AmountExcess();
        }
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
