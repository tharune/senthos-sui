# Wiring Guide — for Luka

All the on-chain plumbing is done. When your UI is ready, you connect each
button to one of the helpers below and it works end-to-end on Solana devnet.
No backend or program work is required from your side. This doc is the map.

## TL;DR: one-liners

```tsx
import { useWallet } from "../_lib/wallet";
import { depositIntoBundle, redeemFromBundle } from "../_lib/deposit-client";
import { ppnDeposit, ppnRedeem } from "../_lib/ppn-client";
import { lend, borrow, repay, withdrawLending, quoteLoan } from "../_lib/lending-client";

const wallet = useWallet();

// Basket deposit button
await depositIntoBundle({ wallet, bundleId: "LK-90-0430", amountUsdc: 500 });

// Basket redeem (sell) button — active vaults early-exit, finalized vaults redeem
await redeemFromBundle({ wallet, bundleId: "LK-90-0430" });

// PPN open-note button
await ppnDeposit({ wallet, bundleId: "LK-70-0501", amountUsdc: 1000, maturityDays: 30 });

// PPN redeem-at-maturity button
await ppnRedeem({ wallet, bundleId: "LK-70-0501" });

// Lending (currently in-memory; on-chain drop-in later)
await lend(100);
await borrow(50);
await repay(50);
await withdrawLending(100);
const quote = await quoteLoan({ kind: "basket", tier: 90, collateralValueUsd: 1000 });
```

Each of those calls does prepare → Phantom sign → wait-for-confirmation →
persist. Returns `{ signature, prepare, confirm }` for basket/PPN flows so
you can link the user to Solana Explorer.

## Connecting the wallet

The wallet is already wired globally — `app/app/layout.tsx` wraps everything
in `<WalletProvider>`. The header button (`<WalletConnectButton />`) handles
picker + connect + disconnect UX for Phantom, Solflare, and Backpack.

Inside any client component:

```tsx
const { status, publicKey, connect, disconnect } = useWallet();
if (status !== "connected") return <button onClick={connect}>Connect</button>;
```

Gating a button on the wallet is one line:

```tsx
<button disabled={wallet.status !== "connected"} onClick={handleClick}>
  Deposit
</button>
```

## Reading balances live

USDC in the header (already wired) — reads directly from the chain:

```ts
import { useUsdcBalance } from "../_lib/wallet";
const { uiAmount: usdc } = useUsdcBalance();
```

STHS holdings across every bundle (for Portfolio):

```ts
import { useStshBalances } from "../_lib/portfolio-client";
const { balances, totalValueUsd, loading, refresh } = useStshBalances();
// balances: [{ bundleId, bundleName, uiAmount, valueAtNavUsd, nav, status }, ...]
```

Poll is 12–15s; call `refresh()` right after a deposit/redeem confirms and
the UI updates immediately.

## Transaction history

```ts
import { fetchTransactionHistory } from "../_lib/portfolio-client";
const txs = await fetchTransactionHistory(walletAddress);
// Rows with `onchain_tx_signature` are real on-chain txs.
```

## End-to-end button flows

### Basket: Deposit

```tsx
const { depositIntoBundle } = await import("../_lib/deposit-client");
try {
  const { signature, confirm } = await depositIntoBundle({
    wallet,                              // from useWallet()
    bundleId: bundle.id,                 // "LK-90-0430" style name OR UUID
    amountUsdc: parseFloat(input),
  });
  console.log("Deposit confirmed:", signature);
  // confirm.tokens_minted is the exact STHS minted
} catch (err) {
  // err is DepositError with .status + .payload if the backend rejected it
}
```

If the user's wallet cancels the sign or the RPC times out, `err.message`
is a human-readable string you can show in a toast.

### Basket: Redeem (sell)

Preconditions (enforced by the backend):

- The wallet must hold STHS tokens for the bundle.
- Vault state must not be `closed`.
  - `active` -> prepare builds on-chain `exit_active` (pool pro-rata payout).
  - `finalized` -> prepare builds on-chain `redeem` (final payout per token).

```tsx
const { redeemFromBundle } = await import("../_lib/deposit-client");
const { signature, prepare } = await redeemFromBundle({
  wallet,
  bundleId: bundle.id,
});
// prepare.expected_usdc is what the user receives
```

Partial redemption is supported via `amountTokens` in `redeemFromBundle`.

### PPN: Open note

```tsx
const { ppnDeposit } = await import("../_lib/ppn-client");
const { signature, prepare, confirm } = await ppnDeposit({
  wallet,
  bundleId: bundle.id,
  amountUsdc: 1000,
  maturityDays: 30,   // 1..365, default 30
});
// prepare.maturity_ts is the exact on-chain maturity (seconds)
// prepare.note_pda is the note address in Explorer
```

On first use only, the admin must have run `POST /api/admin/init-mock-adapter`
once. If not, prepare returns 409 with a helpful error and you can surface
that to the user or admin.

### PPN: Redeem at maturity

```tsx
const { ppnRedeem } = await import("../_lib/ppn-client");
// Option A: you already have the vault_id from the portfolio list
await ppnRedeem({ wallet, vaultId });
// Option B: you only have the bundle — backend looks up the active note
await ppnRedeem({ wallet, bundleId: "LK-70-0501" });
```

Returns 400 `"Note has not matured yet"` if called early.

### PPN: Portfolio

```tsx
import { fetchPpnPortfolio } from "../_lib/ppn-client";
const p = await fetchPpnPortfolio(walletAddress);
// p.vaults — per-note rows with accrued_yield, days_remaining, status
// p.summary — aggregate numbers
```

### Lending

Currently hits the in-memory backend pool (off-chain). The `traxis_lending`
Anchor program is scaffolded at `programs/traxis_lending/` but not deployed
yet — once it lands these client calls grow a `prepare*` companion and gain
wallet signing, no changes required in your UI code.

```tsx
const snap = await fetchLendingSnapshot();           // pool APYs, LTVs, utilization
const q = await quoteLoan({ kind: "basket", tier: 90, collateralValueUsd: 1000 });
await lend(100);
await borrow(50);
await repay(50);
await withdrawLending(100);
```

Live hook:

```tsx
import { useLendingSnapshot } from "../_lib/lending-client";
const { snapshot, loading, refresh } = useLendingSnapshot();
```

## Linking to Explorer

```ts
import { explorerTxUrl, explorerAccountUrl } from "../_lib/wallet";
<a href={explorerTxUrl(signature)}>View on Explorer</a>;
<a href={explorerAccountUrl(notePda)}>Note on Explorer</a>;
```

Both default to devnet. When you flip to mainnet set `NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta`.

## One-time backend prep

Before the first user deposit lands for a given bundle, **Victor** must run
these on his Mac (once per bundle, once per adapter):

1. Apply `backend/src/db/schema_ppn_onchain.sql` in the Supabase SQL editor.
2. Init the mock Meteora adapter: `POST /api/admin/init-mock-adapter`
3. Init the vault for each bundle: `POST /api/admin/bundles/:id/init-onchain`

None of this is your concern — if a prepare call 409s with one of these
instructions you can just tell Victor.

## Status of each surface

| Product     | Backend         | Anchor program       | Client helpers                  |
|-------------|-----------------|----------------------|---------------------------------|
| Basket      | on-chain ✅     | `traxis_vault` ✅    | `deposit-client.ts` ✅          |
| PPN         | on-chain ✅     | `traxis_ppn` ✅      | `ppn-client.ts` ✅              |
| Lending     | in-memory ⚠️    | scaffolded (`traxis_lending`), not deployed | `lending-client.ts` ✅ |
| Tranches    | your scope      | (n/a; derived from basket state) | n/a                   |
| Hedge       | your scope      | n/a                  | n/a                             |

## Files you'll import from

```
app/app/_lib/wallet.tsx            useWallet, WalletConnectButton, useUsdcBalance, useTokenBalance, explorerTxUrl
app/app/_lib/deposit-client.ts     depositIntoBundle, redeemFromBundle (+ piecewise prepareDeposit/confirmDeposit)
app/app/_lib/ppn-client.ts         ppnDeposit, ppnRedeem, fetchPpnPortfolio (+ prepare/confirm pieces)
app/app/_lib/portfolio-client.ts   useStshBalances, listBundlesOnchain, fetchTransactionHistory
app/app/_lib/lending-client.ts     lend/borrow/repay/withdrawLending, quoteLoan, useLendingSnapshot
app/app/_lib/tokens.ts             BACKEND_URL, USDC_MINT, USDC_DECIMALS
```

## Testing your buttons before the real wallet flow

Every `*Client.ts` module exports the low-level `prepare*` and `confirm*`
functions separately, so you can stub `wallet.signAndSendBase64Tx` and
`wallet.waitForConfirmation` in Storybook/tests if you want to exercise the
UI without a real signer. For the hackathon demo you can also just use a
Phantom devnet wallet with airdropped devnet USDC — the helpers will just
work.

## Questions / breakage

If any prepare call returns a 5xx or an error that mentions "Account does
not exist", it's almost always one of the one-time backend prep steps
above. Everything else should be a normal UI-level toast.
