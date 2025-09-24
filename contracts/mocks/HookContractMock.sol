// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { IAfterPaymentMadeHook } from "../hookable/interfaces/ICardPaymentProcessorHooks.sol";

/**
 * @title HookContract mock
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Test hook that implements afterPaymentMade and emits LogAfterPaymentMade.
 */
contract HookContractMock is IAfterPaymentMadeHook {
    event LogAfterPaymentMade(bytes32 paymentId, PaymentHookData oldPayment, PaymentHookData newPayment);
    error RevertFromAfterPaymentMade();

    function supportsHookMethod(bytes4 methodSelector) external pure override returns (bool) {
        return methodSelector == IAfterPaymentMadeHook.afterPaymentMade.selector;
    }

    function afterPaymentMade(
        bytes32 paymentId,
        PaymentHookData calldata oldPayment,
        PaymentHookData calldata newPayment
    ) external {
        if (paymentId == keccak256("please fail")) {
            revert RevertFromAfterPaymentMade();
        }
        emit LogAfterPaymentMade(paymentId, oldPayment, newPayment);
    }
}
