// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import { BlocklistableUpgradeable } from "../../base/BlocklistableUpgradeable.sol";

/**
 * @title BlocklistableUpgradeableMock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev An implementation of the {BlocklistableUpgradeable} contract for test purposes.
 */
contract BlocklistableUpgradeableMock is BlocklistableUpgradeable, UUPSUpgradeable {
    // ------------------ Events ---------------------------------- //

    /// @dev Emitted when a test function of the `notBlocklisted` modifier executes successfully.
    event TestNotBlocklistedModifierSucceeded();

    // ------------------ Initializers ---------------------------- //

    /**
     * @dev The initialize function of the upgradable contract.
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
     */
    function initialize() public initializer {
        __AccessControlExt_init_unchained();
        __Blocklistable_init_unchained();
        _grantRole(OWNER_ROLE, _msgSender());

        // Only to provide the 100 % test coverage
        _authorizeUpgrade(address(0));
    }

    // ------------------ Transactional functions ----------------- //

    /// @dev Calls the parent internal unchained initializing function to verify the 'onlyInitializing' modifier.
    function callParentInitializeUnchained() public {
        __Blocklistable_init_unchained();
    }

    /**
     * @dev Checks the execution of the {notBlocklisted} modifier.
     *
     * If that modifier executed without reverting emits an event {TestNotBlocklistedModifierSucceeded}.
     */
    function testNotBlocklistedModifier() external notBlocklisted(_msgSender()) {
        emit TestNotBlocklistedModifierSucceeded();
    }

    // ------------------ Internal functions ---------------------- //

    /// @dev The upgrade authorization function for UUPSProxy.
    function _authorizeUpgrade(address newImplementation) internal pure override {
        newImplementation; // Suppresses a compiler warning about the unused variable
    }
}
