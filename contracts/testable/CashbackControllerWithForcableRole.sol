// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { CashbackController } from "../CashbackController.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

/**
 * @title CashbackControllerWithForcableRole test contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Test helper that exposes role force-grant and initializes parent contracts.
 */
contract CashbackControllerWithForcableRole is CashbackController {
    function initialize(address token_) external override initializer {
        __AccessControlExt_init_unchained();
        __Rescuable_init_unchained();
        __UUPSExt_init_unchained(); // This is needed only to avoid errors during coverage assessment

        CashbackControllerStorage storage $ = _getCashbackControllerStorage();
        $.token = token_;

        _setRoleAdmin(HOOK_TRIGGER_ROLE, GRANTOR_ROLE);
        _setRoleAdmin(CASHBACK_OPERATOR_ROLE, OWNER_ROLE);
        _grantRole(OWNER_ROLE, _msgSender());
    }
    function forceHookTriggerRole(address account) public {
        AccessControlUpgradeable._grantRole(HOOK_TRIGGER_ROLE, account);
    }
}
