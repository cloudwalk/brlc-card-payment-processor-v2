# 2.4

## Highlights

- **Hooks for CardPaymentProcessor (CPP)**: Introduced a flexible hooks architecture via `CardPaymentProcessorHookable` to run external logic at key points in the payment lifecycle.
- **Cashback moved to `CashbackController`**: CPP now only keeps cashback rate logic. All calculation, capping, transfers, and storage moved to `CashbackController` for better modularity.
- **Claimable cashback via `CashbackVault` (CV)**: Optional claimable mode. When configured, granted cashback is credited to the user's vault balance; otherwise tokens are sent directly to the recipient.
- **Configurable claimable mode**: `setCashbackVault(address)` enables claimable mode (non-zero address) or disables it (zero address). Token allowances are updated accordingly.

### Token flows
```
Direct cashback:     CashbackTreasury <=> CashbackController <=> recipient
Claimable cashback:  CashbackTreasury <=> CashbackController <=> CashbackVault <=> recipient
```

## New API

### CPP via `CardPaymentProcessorHookable`
- `registerHook(address hookAddress)` — register a hook for all supported hook methods.
- `unregisterHook(address hookAddress, bytes32 proof)` — unregister a hook with a security proof.

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
  - `getAccountCashbackState(address)`
  - `getPaymentCashbackState(bytes32)`

## Events
- `HookRegistered(address hookAddress, bytes4 hookMethod)`
- `HookUnregistered(address hookAddress, bytes4 hookMethod)`
- `CashbackVaultUpdated(address cashbackVault)`
- `CashbackTreasuryChanged(address oldTreasury, address newTreasury)`
- `CashbackSent(bytes32 indexed paymentId, address indexed recipient, CashbackOperationStatus indexed status, uint256 amount)`
- `CashbackIncreased(bytes32 indexed paymentId, address indexed recipient, CashbackOperationStatus indexed status, uint256 oldCashbackAmount, uint256 newCashbackAmount)`
- `CashbackRevoked(bytes32 indexed paymentId, address indexed recipient, CashbackOperationStatus indexed status, uint256 oldCashbackAmount, uint256 newCashbackAmount)`

## Roles & Permissions
- `HOOK_TRIGGER_ROLE` (admin `GRANTOR_ROLE`): must be granted to CPP so it can invoke controller hooks.
- `OWNER_ROLE`: required for configuration functions.
- `CASHBACK_OPERATOR_ROLE`: required to call `correctCashbackAmount()`.

## Breaking Changes
- Removed `ICardPaymentCashback.*` and all cashback logic from CPP.
- Removed CPP functions: `enableCashback()/disableCashback()`, `setCashbackTreasury()`, `getAccountCashbackState()`.

## Migration
1. If no cashback is needed: upgrade CPP and stop here.
2. If existing cashback payments exist on a CPP: deploy a new CPP and route payments to it.
3. Deploy `CashbackController` (CC) with the same token as the CPP.
4. Call `setCashbackTreasury()` on CC to configure the treasury.
5. Grant `HOOK_TRIGGER_ROLE` on CC to the CPP.
6. Connect CC as a hook on CPP via `registerHook()`.
7. (Optional) Enable claimable mode by calling `setCashbackVault()` on CC.
8. (Optional) Configure default cashback rate on CPP via `setCashbackRate(uint256)`.
9. Execute payments with cashback on CPP.

# 2.3
older changes