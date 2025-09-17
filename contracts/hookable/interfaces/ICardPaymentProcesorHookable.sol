// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import { ICardPaymentProcessorTypes } from "../../interfaces/ICardPaymentProcessor.sol";

interface ICardPaymentProcessorHookTypes {
    struct PaymentHookData {
        ICardPaymentProcessorTypes.PaymentStatus status;
        address payer;
        uint256 cashbackRate;
        uint256 confirmedAmount;
        address sponsor;
        uint256 subsidyLimit;
        uint256 baseAmount;
        uint256 extraAmount;
        uint256 refundAmount;
    }
}

/**
 * @title ICardPaymentProcessorHookable
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The interface for managing payment processor hooks.
 */
interface ICardPaymentProcessorHookable is ICardPaymentProcessorHookTypes {
    // ------------------ Events ---------------------------------- //

    /// @dev Emitted when a hook is registered for a specific capability.
    event HookRegistered(address indexed hook, bytes4 methodSelector);

    /// @dev Emitted when a hook is unregistered from a specific capability.
    event HookUnregistered(address indexed hook, bytes4 methodSelector);

    // ------------------ Management functions -------------------- //

    /**
     * @dev Registers a hook by checking its supported hook methods.
     * @param hookAddress The address of the hook contract to register.
     */
    function registerHook(address hookAddress) external;

    /**
     * @dev Unregisters a hook from all capabilities.
     *
     * Unregistering a hook may lead to problems with payments and any functionality around them.
     * Please be careful and verify that this is what you really want to do.
     * Any ongoing operations may become inconsistent and fail to complete in any way.
     * If you are sure, calculate the proof manually using the addresses of the contracts.
     *  keccak256("unregisterHook") ^ bytes32(uint256(uint160(hookAddress))) ^ bytes32(uint256(uint160(address(this))))
     *
     * @param hookAddress the address of the hook contract to unregister.
     * @param proof The proof of the unregistration.
     */
    function unregisterHook(address hookAddress, bytes32 proof) external;
}
