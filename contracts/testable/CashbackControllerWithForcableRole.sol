// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { CashbackController } from "../CashbackController.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

contract CashbackControllerWithForcableRole is CashbackController {
    function forceHookTriggerRole(address account) public {
        AccessControlUpgradeable._grantRole(HOOK_TRIGGER_ROLE, account);
    }
}
