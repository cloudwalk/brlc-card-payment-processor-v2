// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title ICashbackVaultTypes interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the types used in the cashback vault smart contract.
 */
interface ICashbackVaultTypes {
    /**
     * @dev The cashback state of a single account within the cashback vault contract.
     *
     * Fields:
     *
     * - balance --- The cashback balance of the account.
     * - totalClaimed --- The total amount of cashback claimed by the account.
     * - lastClaimTimestamp --- The timestamp of the last claim operation.
     */
    struct AccountCashbackState {
        // Slot 1
        uint64 balance;
        uint64 totalClaimed;
        // uint64 lastClaimTimestamp;
        // uint64 __reserved; // Reserved until the end of the storage slot
    }
}