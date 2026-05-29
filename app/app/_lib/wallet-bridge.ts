"use client";
/**
 * Wallet bridge.
 *
 * The app is wrapped in `@solana/wallet-adapter-react`'s `WalletProvider`
 * (see `/app/_providers/WalletProviders.tsx`), but our product clients
 * (`deposit-client.ts`, `ppn-client.ts`) expect a lean `WalletSigner`
 * interface with:
 *   - `publicKey` (with a `.toBase58()` method)
 *   - `signAndSendBase64Tx(base64)` → `signature`
 *   - `waitForConfirmation(sig)` → `boolean`
 *
 * This module converts between the two. It also exposes a `useUsdcBalance`
 * hook that polls the connected wallet's Circle-devnet USDC balance
 * directly from the RPC (no `@solana/spl-token` dependency — we derive the
 * ATA manually).
 *
 * All exports are client-only. Importing this file from a server component
 * is a bug; the underlying adapter hooks throw if called outside a
 * `<WalletProvider>`.
 */

import {
  useWallet as useAdapterWallet,
  useConnection,
} from "@solana/wallet-adapter-react";
import {
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WalletSigner as DepositSigner } from "./deposit-client";
import { IS_SUI, SUI_ACTIVE_ADDRESS, suiExplorerTxUrl } from "./chain";
import { fetchSuiStatus, sumSuiCoinBalance } from "./sui-client";

// ---------- SPL constants (no @solana/spl-token dep) ----------

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

/** Circle devnet USDC. Override with NEXT_PUBLIC_USDC_MINT at build time. */
const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT ??
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

function findAta(mint: PublicKey, owner: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

// ---------- WalletSigner adapter ----------

export interface WalletSigner extends DepositSigner {
  /** True while the adapter reports an active connection. */
  connected: boolean;
}

/**
 * Convert the adapter-react `useWallet()` result into the `WalletSigner`
 * shape that `deposit-client` / `ppn-client` accept.
 *
 * The returned object is memoised per (publicKey, connection, connected) so
 * callers can safely stuff it into `useEffect` deps.
 */
export function useWalletSigner(): WalletSigner {
  const { publicKey, sendTransaction, connected } = useAdapterWallet();
  const { connection } = useConnection();

  return useMemo<WalletSigner>(() => {
    if (IS_SUI) {
      return {
        connected: true,
        publicKey: { toBase58: () => SUI_ACTIVE_ADDRESS },
        async signAndSendBase64Tx(): Promise<string> {
          throw new Error("Sui local mode signs through the backend testnet keystore.");
        },
        async waitForConfirmation(): Promise<boolean> {
          return true;
        },
      };
    }

    const pkObj = publicKey ? { toBase58: () => publicKey.toBase58() } : null;

    return {
      connected,
      publicKey: pkObj,
      async signAndSendBase64Tx(txBase64: string): Promise<string> {
        if (!publicKey) throw new Error("No wallet connected.");
        const bytes = Uint8Array.from(atob(txBase64), (c) => c.charCodeAt(0));
        let tx: Transaction | VersionedTransaction;
        try {
          tx = VersionedTransaction.deserialize(bytes);
        } catch {
          tx = Transaction.from(bytes);
        }
        // adapter's sendTransaction signs AND submits and returns the sig.
        const sig = await sendTransaction(tx, connection);
        return sig;
      },
      async waitForConfirmation(
        signature: string,
        timeoutMs: number = 60_000,
      ): Promise<boolean> {
        // Poll via the backend proxy rather than the browser's direct RPC
        // connection. The public testnet RPC rate-limits per-IP, and a
        // browser polling getSignatureStatus every 1.5s was getting
        // `429 Too many requests` that left the UI stuck on "Confirming
        // on Solana…" indefinitely — even when the tx had already landed.
        // Proxying through the backend means every browser shares one IP
        // rate-limit bucket on the server instead of each being throttled
        // individually.
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          try {
            const r = await fetch(
              `${BACKEND_URL}/api/dev/tx-status/${signature}`,
              { cache: "no-store" },
            );
            if (r.ok) {
              const data = (await r.json()) as {
                status: string;
                err?: unknown;
              };
              if (data.status === "failed") {
                throw new Error(
                  `Transaction failed: ${JSON.stringify(data.err)}`,
                );
              }
              if (data.status === "confirmed" || data.status === "finalized") {
                return true;
              }
              // "processed" or "not_found" → keep polling
            }
          } catch (err) {
            // Don't abort the poll loop on a transient backend hiccup —
            // rethrow only if it's an actual tx failure bubbled up from
            // the branch above.
            if (err instanceof Error && /^Transaction failed:/.test(err.message)) {
              throw err;
            }
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
        return false;
      },
    };
  }, [publicKey, sendTransaction, connection, connected]);
}

// ---------- Balance hook ----------

export interface UsdcBalance {
  /** UI units (number). `0` when disconnected or ATA absent. */
  uiAmount: number;
  /** True while the current poll is in flight. */
  loading: boolean;
  /** Last error message (if any) from a poll. */
  error: string | null;
  /** Force a re-fetch immediately. Call this after a tx confirms. */
  refresh: () => Promise<void>;
}

const BALANCE_POLL_MS = 12_000;
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

/**
 * Live on-chain USDC balance for the currently connected adapter wallet.
 *
 * Fetches through the backend proxy (/api/dev/balances) to avoid hitting
 * the public Solana testnet RPC rate limit (429) from the browser.
 */
export function useUsdcBalance(): UsdcBalance {
  const { publicKey, connected } = useAdapterWallet();
  const [uiAmount, setUiAmount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const genRef = useRef(0);

  const refresh = useCallback(async () => {
    const gen = ++genRef.current;
    if (IS_SUI) {
      setLoading(true);
      setError(null);
      try {
        const status = await fetchSuiStatus();
        if (gen !== genRef.current) return;
        setUiAmount(sumSuiCoinBalance(status.balances?.mock_usdc));
      } catch (err: unknown) {
        if (gen !== genRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (gen === genRef.current) setLoading(false);
      }
      return;
    }

    if (!publicKey) {
      setUiAmount(0);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `${BACKEND_URL}/api/dev/balances/${publicKey.toBase58()}`,
        { cache: "no-store" },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (gen !== genRef.current) return;
      setUiAmount(data.usdc ?? 0);
    } catch (err: unknown) {
      if (gen !== genRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    if (IS_SUI) {
      void refresh();
      const id = setInterval(() => {
        void refresh();
      }, BALANCE_POLL_MS);
      return () => clearInterval(id);
    }

    if (!connected || !publicKey) {
      setUiAmount(0);
      return;
    }
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, BALANCE_POLL_MS);
    return () => clearInterval(id);
  }, [connected, publicKey, refresh]);

  return { uiAmount, loading, error, refresh };
}

// ---------- Explorer links ----------

const SOLANA_CLUSTER =
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";

export function explorerTxUrl(signature: string): string {
  if (IS_SUI) return suiExplorerTxUrl(signature);
  const cluster =
    SOLANA_CLUSTER === "mainnet-beta" ? "" : `?cluster=${SOLANA_CLUSTER}`;
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
}
