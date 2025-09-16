// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import { ICardPaymentProcessorHookTypes } from "./ICardPaymentProcesorHookable.sol";

interface ICardPaymentProcessorHook is ICardPaymentProcessorHookTypes {
    function supportsHookMethod(bytes4 methodSelector) external pure returns (bool);
}

/**
 * @title IAfterPaymentMadeHook
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The interface for the afterPaymentMade hook.
 */
interface IAfterPaymentMadeHook is ICardPaymentProcessorHook {
    function afterPaymentMade(
        bytes32 paymentId,
        PaymentHookData calldata oldPayment,
        PaymentHookData calldata newPayment
    ) external;
}

/**
 * @title IAfterPaymentUpdatedHook
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The interface for the afterPaymentUpdated hook.
 */
interface IAfterPaymentUpdatedHook is ICardPaymentProcessorHook {
    function afterPaymentUpdated(
        bytes32 paymentId,
        PaymentHookData calldata oldPayment,
        PaymentHookData calldata newPayment
    ) external;
}

/**
 * @title IAfterPaymentCanceledHook
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The interface for the afterPaymentCanceled hook.
 */
interface IAfterPaymentCanceledHook is ICardPaymentProcessorHook {
    function afterPaymentCanceled(
        bytes32 paymentId,
        PaymentHookData calldata oldPayment,
        PaymentHookData calldata newPayment
    ) external;
}
