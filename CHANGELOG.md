## Main Changes

- **Hooks for CardPaymentProcessor (CPP)**: Introduced a flexible hooks architecture via `CardPaymentProcessorHookable` to run external logic at key points in the payment lifecycle.
- **Cashback moved to `CashbackController`**: CPP now only keeps cashback rate logic. All calculation, capping, transfers, and storage moved to `CashbackController` for better modularity.
- **Claimable cashback via `CashbackVault` (CV)**: Optional claimable mode. When configured, granted cashback is credited to the user's vault balance; otherwise tokens are sent directly to the recipient.
- **Configurable claimable mode**: `setCashbackVault(address)` enables claimable mode (non-zero address) or disables it (zero address). Token allowances are updated accordingly.
- Removed Blocklistable functionality
### Token Flows

```
Direct cashback:     CashbackTreasury <=> CashbackController <=> recipient
Claimable cashback:  CashbackTreasury <=> CashbackController <=> CashbackVault <=> recipient
```

## New API

### CPP via `CardPaymentProcessorHookable`

- Configuration
  - `registerHook(address hookAddress)` — attaches hook to all supported methods and detaches from unsupported ones.
  - `unregisterHook(address hookAddress, bytes32 proof)` — detaches a hook from all methods with a security proof.
- Events
  - `HookRegistered(address hookAddress, bytes4 hookMethod)`
  - `HookUnregistered(address hookAddress, bytes4 hookMethod)`

### CashbackController

- Operations
  - `correctCashbackAmount(bytes32 paymentId, uint64 newCashbackAmount)` — manual correction per payment.
- Configuration
  - `setCashbackVault(address cashbackVault)`
  - `setCashbackTreasury(address cashbackTreasury)`
- Views
  - `getCashbackVault()`
  - `getCashbackTreasury()`
  - `underlyingToken()`
  - `getAccountCashback(address)`
  - `getPaymentCashback(bytes32)`
- Events
  - `CashbackVaultUpdated(address newCashbackVault, address oldCashbackVault)`
  - `CashbackTreasuryUpdated(address newTreasury, address oldTreasury)`
  - `CashbackSent(bytes32 indexed paymentId, address indexed recipient, PaymentCashbackStatus indexed status, uint256 amount)`
  - `CashbackIncreased(bytes32 indexed paymentId, address indexed recipient, PaymentCashbackStatus indexed status, uint256 delta, uint256 balance)`
  - `CashbackDecreased(bytes32 indexed paymentId, address indexed recipient, PaymentCashbackStatus indexed status, uint256 delta, uint256 balance)`

## Roles & Permissions

- `HOOK_TRIGGER_ROLE` (admin `GRANTOR_ROLE`): must be granted to CPP so it can invoke controller hooks.
- `OWNER_ROLE`: required for configuration functions.
- `CASHBACK_OPERATOR_ROLE`: required to call `correctCashbackAmount()`.
- CashbackVault roles when claimable mode is enabled:
  - `CASHBACK_OPERATOR_ROLE` on CV: grant to `CashbackController` so it can `grantCashback`/`revokeCashback`.
  - `MANAGER_ROLE` on CV: grant to the account/service that will call `claim`/`claimAll`.

## Breaking Changes

- Removed `ICardPaymentCashback.*` and all cashback logic from CPP.
- Removed CPP functions: `enableCashback()/disableCashback()`, `setCashbackTreasury()`, `getAccountCashbackState()`.
- Removed Blocklistable functionality and related roles.

## Migration

1. If no cashback is needed: upgrade CPP and stop here.
2. If existing cashback payments exist on a CPP: deploy a new CPP and route payments to it.
3. Deploy `CashbackController` (CC) with the same token as the CPP.
4. Call `setCashbackTreasury()` on CC to configure the treasury.
5. From the treasury account, approve CC to spend the token (max allowance recommended).
6. Grant `HOOK_TRIGGER_ROLE` on CC to the CPP.
7. Connect CC as a hook on CPP via `registerHook()`.
8. (Claimable mode) On CV, grant `CASHBACK_OPERATOR_ROLE` to CC and `MANAGER_ROLE` to your manager.
9. (Optional) Enable claimable mode by calling `setCashbackVault()` on CC.
10. (Optional) Configure default cashback rate on CPP via `setDefaultCashbackRate(uint256)`.
11. Execute payments with cashback on CPP.

# 2.3

older changes
