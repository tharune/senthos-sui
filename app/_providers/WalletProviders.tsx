"use client";

import React, { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  LedgerWalletAdapter,
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";

// Wallet adapter base styles + our override theme.
import "@solana/wallet-adapter-react-ui/styles.css";
import "./wallet-theme.css";

/**
 * Root wallet / RPC provider.
 *
 * Devnet by default; override with NEXT_PUBLIC_SOLANA_RPC_URL if you need a
 * different endpoint (e.g. a Helius mainnet-beta URL).
 */
export function WalletProviders({ children }: { children: React.ReactNode }) {
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL
    ?? clusterApiUrl(WalletAdapterNetwork.Devnet);

  // Phantom / Solflare normally announce themselves via the Solana Wallet
  // Standard, but on a fresh page load there's a detection delay — the
  // extension has to register before `useStandardWalletAdapters` picks it
  // up. If the user clicks "Connect" during that window, the modal either
  // shows no wallets or only routes them to an install link, and the whole
  // connect flow silently fails. Registering the legacy adapters here gives
  // us a fallback that uses `scopePollingDetectionStrategy` (polls
  // `window.phantom.solana` / `window.solflare`) so the wallet is in the
  // list from first render.
  //
  // `useStandardWalletAdapters` dedupes by adapter `name`, so once the
  // Wallet Standard announcement fires Phantom's standard-wrapped adapter
  // is preferred and the explicit one is filtered out (with a console
  // warning). No double-listing.
  //
  // Ledger is included because it's hardware-only and doesn't speak Wallet
  // Standard at all.
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new LedgerWalletAdapter(),
    ],
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
