// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { ICardPaymentProcessorHookable } from "./interfaces/ICardPaymentProcesorHookable.sol";
import { CardPaymentProcessorHookableStorageLayout } from "./CardPaymentProcessorHookableStorageLayout.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { IAfterPaymentMadeHook } from "./interfaces/ICardPaymentProcessorHooks.sol";
import { IAfterPaymentUpdatedHook } from "./interfaces/ICardPaymentProcessorHooks.sol";
import { IAfterPaymentCanceledHook } from "./interfaces/ICardPaymentProcessorHooks.sol";
import { ICardPaymentProcessorHook } from "./interfaces/ICardPaymentProcessorHooks.sol";
import { ICardPaymentProcessorTypes } from "../interfaces/ICardPaymentProcessor.sol";
import { AccessControlExtUpgradeable } from "../base/AccessControlExtUpgradeable.sol";

abstract contract CardPaymentProcessorHookable is
    AccessControlExtUpgradeable,
    ICardPaymentProcessorHookable,
    CardPaymentProcessorHookableStorageLayout
{
    using EnumerableSet for EnumerableSet.AddressSet;

    // ------------------ Transaction functions -------------------- //

    function registerHook(address hookAddress) external onlyRole(OWNER_ROLE) {
        bytes4[] memory hookMethods = _getHookMethods();
        CardPaymentProcessorHookableStorage storage $ = _getCardPaymentProcessorHookableStorage();

        for (uint256 i = 0; i < hookMethods.length; i++) {
            if (
                ICardPaymentProcessorHook(hookAddress).supportsHookMethod(hookMethods[i]) &&
                $.hooks[hookMethods[i]].add(hookAddress) // add returns true if hook was added
            ) {
                emit HookRegistered(
                    hookAddress, // Tools: prevent Prettier one-liner
                    hookMethods[i]
                );
            }
        }
    }

    function unregisterHook(address hookAddress, bytes32 proof) external onlyRole(OWNER_ROLE) {
        // ⚠️ IMPORTANT: This proof verifies the caller is fully conscious and aware of what they are doing.
        // 📖 See interface docs before using.
        require(
            proof ==
                keccak256("unregisterHook") ^
                    bytes32(uint256(uint160(hookAddress))) ^
                    bytes32(uint256(uint160(address(this))))
        );
        bytes4[] memory hookMethods = _getHookMethods();
        CardPaymentProcessorHookableStorage storage $ = _getCardPaymentProcessorHookableStorage();

        for (uint256 i = 0; i < hookMethods.length; i++) {
            if ($.hooks[hookMethods[i]].remove(hookAddress)) {
                emit HookUnregistered(
                    hookAddress, // Tools: prevent Prettier one-liner
                    hookMethods[i]
                );
            }
        }
    }

    // ------------------ Internal functions -------------------- //
    /// @dev Used as replacement for constant array of hook methods
    function _getHookMethods() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = IAfterPaymentMadeHook.afterPaymentMade.selector;
        selectors[1] = IAfterPaymentUpdatedHook.afterPaymentUpdated.selector;
        selectors[2] = IAfterPaymentCanceledHook.afterPaymentCanceled.selector;

        return selectors;
    }

    /**
     * @dev Calls all registered hooks for a given method selector with provided old and new payment data.
     * @param methodSelector The method selector of the hook capability.
     * @param paymentId The ID of the payment.
     * @param oldPayment The old payment.
     * @param newPayment The new payment.
     */
    function _callHooks(
        bytes4 methodSelector,
        bytes32 paymentId,
        PaymentHookData memory oldPayment,
        PaymentHookData memory newPayment
    ) internal {
        CardPaymentProcessorHookableStorage storage $ = _getCardPaymentProcessorHookableStorage();
        uint256 length = $.hooks[methodSelector].length();

        for (uint256 i = 0; i < length; i++) {
            address hook = $.hooks[methodSelector].at(i);
            (bool success, bytes memory returnData) = hook.call(
                abi.encodeWithSelector(methodSelector, paymentId, oldPayment, newPayment)
            );

            if (!success) {
                _revertWithReturnData(returnData);
            }
        }
    }

    /**
     * @dev Reverts with the same error data that was returned from a failed call.
     * If no return data is provided, reverts with a default error.
     * @param returnData The return data from the failed call.
     */
    function _revertWithReturnData(bytes memory returnData) private pure {
        // Bubble up the custom error
        assembly {
            revert(add(returnData, 0x20), mload(returnData))
        }
    }
}
