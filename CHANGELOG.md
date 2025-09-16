# Unreleased
## Main changes
- **Hooks system for CardPaymentProcessor (CPP)**: Introduced a flexible hooks architecture via the CardPaymentProcessorHookable abstract contract that allows external contracts to execute custom logic at key points in the payment lifecycle.
- **Cashback operations moved to CashbackController**: Most cashback-related logic has been extracted from the CardPaymentProcessor into a separate CashbackController contract for better separation of concerns and modularity. Only cashback rate calculation logic remains in the CPP contract structure.
- **Claimable cashback via Cashback Vault (CV)**: When a CV is configured for a token in the CashbackController, granted cashback is credited to the user's vault balance (claimable) instead of transferring tokens directly. Without a CV, cashback is transferred immediately to the recipient.
  ```
  Token flows:
  * Direct cashback mode:    `CashbackTreasury` <=> `CashbackController` <=> recipient`.
  * Claimable cashback mode: `CashbackTreasury` <=> `CashbackController` <=> CV <=> `recipient`.
  ```
- **Enable/disable claimable mode per token**: Use `setCashbackVault(cashbackVault)` on the CashbackController.
  - Set to a valid CV address to enable claimable mode for that token.
  - Set to `address(0)` to disable claimable mode (reverts to direct transfers).
  - On change, the CashbackController approves the CV for the token with max allowance and revokes allowance from the old CV.
- **CPP keeps cashback rate configuration only**: `setCashbackRate(uint256)` and `cashbackRate()` now live on CPP; treasury and enable/disable moved to `CashbackController`.
##  New Functions in CPP via CardPaymentProcessorHookable

- **Configuration**
  - `registerHook(address hookAddress)`: Registers a hook contract for all supported hook methods
  - `unregisterHook(address hookAddress, bytes32 proof)`: Unregisters a hook contract with security proof requirement
## New Events
- `HookRegistered(address hookAddress, bytes4 hookMethod)`
- `HookUnregistered(address hookAddress, bytes4 hookMethod)`
## New contracts

### CashbackController
#### Functions
- **Configuration**
  - `setCashbackVault(address cashbackVault)`: Sets the cashback vault
  - `setCashbackTreasury(address cashbackTreasury)`: Sets the cashback treasury address
- **View functions**
  - `getCashbackVault()`: Returns the cashback vault address
  - `getCashbackTreasury()`: Returns the current cashback treasury address
  - `underlyingToken()`: Returns the underlying token address
  - `getAccountCashbackState(address)`: Returns per-account cashback state view
  - `getPaymentCashbackState(bytes32)`: Returns cashback state for a payment
#### Events
- `CashbackVaultUpdated(address cashbackVault)`
- `CashbackTreasuryChanged(address oldTreasury, address newTreasury)`
- `CashbackSent(bytes32 indexed paymentId, address indexed recipient, CashbackOperationStatus indexed status, uint256 amount)`
- `CashbackIncreased(bytes32 indexed paymentId, address indexed recipient, CashbackOperationStatus indexed status, uint256 oldCashbackAmount, uint256 newCashbackAmount)`
- `CashbackRevoked(bytes32 indexed paymentId, address indexed recipient, CashbackOperationStatus indexed status, uint256 oldCashbackAmount, uint256 newCashbackAmount)`
#### Roles & permissions
- `HOOK_TRIGGER_ROLE` (admin `GRANTOR_ROLE`): Must be granted to CPP so it can invoke the controller’s hooks.
- `OWNER_ROLE`: Required to call configuration functions (`setCashbackVault`, `setCashbackTreasury`).

## Breaking changes & upgrade notes
- `ICardPaymentCashback.*` removed from CPP. All treasury, cap, and transfer logic moved into `CashbackController`.
- CPP no longer exposes `enableCashback/disableCashback`, `setCashbackTreasury`, or `getAccountCashbackState`.

# 2.3
