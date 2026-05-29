"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { Header, PageFrame } from "../_components/Header";
import { SvgDonut } from "../_components/charts";
import { C, FS, FD, FM, EASE, tc, trancheColor, fmtUsd } from "../_lib/tokens";
import { useLiveBaskets } from "../_lib/use-live-baskets";
import { bundleById } from "../_lib/bundles";
import { useSandbox, type BasketPosition } from "../_lib/demo-state";
import { useUsdcBalance, useWalletSigner } from "../_lib/wallet-bridge";
import { IS_SUI, SUI_ACTIVE_ADDRESS } from "../_lib/chain";
import { fetchBasketPortfolio, useStshBalances } from "../_lib/portfolio-client";
import { fetchPpnPortfolio, ppnRedeem, PpnError } from "../_lib/ppn-client";
import { mergePpnVaults, mergeTranches } from "../_lib/ppn-hydrate";
import { redeemFromBundle, DepositError } from "../_lib/deposit-client";
import {
  groupVirtualByUiBundle,
  clearVirtualPositionsByUiBundleId,
  type GroupedVirtualPosition,
} from "../_lib/virtual-positions";
import { Personalization } from "./_personalization";
import { History } from "./_history";
import { useTheme } from "../_lib/theme";

type View = "positions" | "personalization" | "history";

export default function PortfolioPage() {
  const { state, totals, dispatch } = useSandbox();
  const { theme } = useTheme();
  const isLight = theme === "light";
  const { connected, publicKey } = useWallet();
  const appWalletAddress = IS_SUI ? SUI_ACTIVE_ADDRESS : publicKey?.toBase58() ?? null;
  const usdc = useUsdcBalance();
  const walletSigner = useWalletSigner();
  const [redeemBusy, setRedeemBusy] = useState<string | null>(null);
  const [redeemError, setRedeemError] = useState<Record<string, string>>({});
  const basketState = useLiveBaskets();
  // Authoritative on-chain STHS token balances per bundle. Polls the Solana
  // RPC every 15s and zeroes out to empty entries when the wallet is
  // disconnected. This is the ONLY source we trust for "how many basket
  // tokens does this wallet actually own" — any cancelled deposit never
  // mints STHS so it contributes $0 here regardless of what optimistic UI
  // state or stale Supabase rows claim.
  const stshBalances = useStshBalances();
  // Authoritative on-chain STHS qty per bundle UUID. Computed once here and
  // reused by every gating path below (tranches, PPNs, virtual groups,
  // residuals). Bundles without a positive balance are absent from the map.
  // Hoisted out of the render block so the headline / donut / breakdown
  // totals can share the same filter as the card list — previously the
  // totals used reducer state directly and leaked cancelled-tx rows into
  // the top-of-page numbers even though the cards below filtered them out.
  const solanaOnchainTokensByUuid = React.useMemo(() => {
    const out: Record<string, number> = {};
    for (const entry of stshBalances.balances) {
      if (entry.uiAmount > 0) out[entry.bundleId] = entry.uiAmount;
    }
    return out;
  }, [stshBalances.balances]);
  // Single source of truth for "is there a wallet we can attribute balances
  // to". Every aggregate downstream (donut, PnL, totals, position rows) is
  // gated on this so a disconnected session can never show a stale balance
  // leftover from a previous connection. Fixes portfolio reporting non-zero
  // numbers both on fresh load (before wallet connect) and after disconnect.
  const walletReady = IS_SUI || (connected && publicKey != null);
  const virtualGroupsForWallet: GroupedVirtualPosition[] =
    walletReady && appWalletAddress
      ? groupVirtualByUiBundle(appWalletAddress)
      : [];
  const suiTokensByUuid = virtualGroupsForWallet.reduce<Record<string, number>>(
    (acc, g) => {
      acc[g.uuid] = (acc[g.uuid] ?? 0) + g.tokens;
      return acc;
    },
    {},
  );
  const onchainTokensByUuid = IS_SUI ? suiTokensByUuid : solanaOnchainTokensByUuid;
  // Cash line is the real on-chain USDC in the connected wallet. When
  // disconnected we fall back to 0 so the donut + positions list simply
  // omit the cash slice instead of flashing a stale sandbox counter.
  const liveUsdc = walletReady ? usdc.uiAmount : 0;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [renderNow, setRenderNow] = useState<number>(() => Date.now());
  const [view, setView] = useState<View>("positions");
  useEffect(() => {
    const t = setInterval(() => setRenderNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Position buckets are independent on the three product rails:
  //   - Baskets are the user's STHS token balance × live NAV. STHS only
  //     lands in the user's wallet via a basket deposit (PPN / tranche
  //     deposits swap USDC into a program-owned note vault and hand back
  //     a note PDA, not SPL tokens), so on-chain STHS presence IS the
  //     source of truth for basket exposure.
  //   - Tranche / PPN rows come from the backend, which we've taught
  //     to filter by `onchain_tx_signature IS NOT NULL` — i.e. only
  //     rows where the user's note-initialize tx actually landed.
  //     Cancelled-in-wallet deposits therefore never reach the reducer,
  //     so we can trust reducer state directly here.
  // There is no double-counting between the buckets: a user's STHS
  // balance and a note vault's principal are different assets.
  const effectiveTranches = walletReady ? state.tranchePositions : [];
  const effectivePpnVaults = walletReady ? state.ppnVaults : [];
  // PPN accrued yield, ticking with renderNow so the top-of-page P&L moves
  // in real time. Matches the per-vault card math (`principal * apy% / 365`
  // capped at maturity). This is what makes PPN positions contribute to
  // unrealized P&L — the demo-state totals only know about basket drift.
  const ppnAccruedYield = effectivePpnVaults.reduce((sum, v) => {
    const elapsedDays = Math.max(0, (renderNow - v.createdAt) / 86_400_000);
    const accrued =
      v.principal * (v.apy / 100 / 365) * Math.min(elapsedDays, v.maturityDays);
    return sum + accrued;
  }, 0);
  // Tranche accrued yield. Principal is qty*avgCost (frozen at entry) because
  // the backend doesn't mark tranches to market — so without this term the
  // Tranches row and the headline P&L would never move, no matter how long
  // the position had been held. Straight-line accrual against `estimated_apy`
  // is the same approximation used for PPNs, capped at maturity.
  const trancheAccruedYield = effectiveTranches.reduce((sum, p) => {
    if (p.apy == null || p.createdAt == null || p.maturityDays == null) return sum;
    const principal = p.qty * p.avgCost;
    const elapsedDays = Math.max(0, (renderNow - p.createdAt) / 86_400_000);
    const accrued =
      principal * (p.apy / 100 / 365) * Math.min(elapsedDays, p.maturityDays);
    return sum + accrued;
  }, 0);
  // Principal sums for the filtered (on-chain-backed) rows. Replace
  // `totals.trancheValue` / `totals.ppnValue` everywhere below so the
  // headline, donut, and breakdown all agree with the card list.
  const effectiveTrancheValue = effectiveTranches.reduce(
    (sum, p) => sum + p.qty * p.avgCost,
    0,
  );
  const effectivePpnValue = effectivePpnVaults.reduce(
    (sum, v) => sum + v.principal,
    0,
  );
  // On-chain NAV lookup for a backend bundle id (UUID). We key `stshBalances`
  // off the same UUIDs the backend returns, and the live feed is keyed off
  // the STHS-TIER-WINDOW name, so we cross-reference via `bundleName`. The
  // live feed wins when available — falling through to the balance's own
  // cached NAV and then to the hydrated entry price means a single stale
  // cell never produces a $0 position.
  const navForOnchainBundle = React.useCallback(
    (entry: { bundleId: string; bundleName: string; nav: number }): number => {
      if (basketState.status === "ok") {
        const live =
          basketState.baskets.find((b) => b.id === entry.bundleName) ??
          basketState.baskets.find((b) => b.id === entry.bundleId);
        if (live) return live.nav;
      }
      const seed = bundleById(entry.bundleName) ?? bundleById(entry.bundleId);
      if (seed) return seed.nav;
      return entry.nav;
    },
    [basketState],
  );

  // On-chain basket value used in the top-line total. We value each
  // bundle at the wallet's **cost basis** (avgCost × qty) whenever the
  // reducer has a hydrated position for that bundleId, and only fall
  // back to live NAV when we don't know what the user paid. Reasoning:
  // the vault mints tokens at a fixed `issue_price_bps`, which is
  // typically below live NAV, so valuing at NAV right after a deposit
  // makes the orbit appear to grow by the issue-vs-NAV differential
  // (user-reported bug: spend $100, see total go up $4). The NAV delta
  // still shows up in the separate `displayPnl` line below.
  const onchainBasketValue = walletReady
    ? IS_SUI
      ? virtualGroupsForWallet.reduce((sum, g) => sum + g.depositedUsdc, 0)
      : stshBalances.balances.reduce((sum, entry) => {
        if (entry.uiAmount <= 0) return sum;
        const backendPos = state.basketPositions.find(
          (p) => p.bundleId === entry.bundleId,
        );
        const perTokenValue =
          backendPos && backendPos.avgCost > 0
            ? backendPos.avgCost
            : navForOnchainBundle(entry);
        return sum + entry.uiAmount * perTokenValue;
      }, 0)
    : 0;

  // Basket unrealized P&L is intentionally zero for active positions.
  //
  // The old computation (qty × (nav - avgCost)) is a NAV-based fantasy:
  //   - the on-chain vault mints TRAX at a fixed `issue_price_bps` (set at
  //     bundle init), so depositing at a moment when live NAV > issue
  //     price immediately produces a "gain" that didn't exist,
  //   - early exit via `exit_active` pays the user's pro-rata share of
  //     the USDC pool (which ≈ what was deposited, net of fees), NOT
  //     qty × NAV — so any NAV drift doesn't actually materialize until
  //     the vault is finalized and redeemed at resolution.
  //
  // Showing a positive "Unrealized P&L" on a fresh deposit + then a small
  // loss on sell (because fees were real, the NAV gain wasn't) confused
  // every tester. We now return 0 for active baskets; real P&L surfaces
  // through (a) USDC credit after sell/redeem, and (b) PPN + tranche
  // yield accrual below, which are real on-chain/adapter accruals.
  const onchainBasketPnl = 0;

  // Top-line value: USDC + basket value (STHS × NAV) + tranche / PPN
  // principal + accrued yield + lend/loan. Tranche/PPN rows come from
  // the reducer, which is hydrated from the backend; the backend only
  // returns rows with `onchain_tx_signature IS NOT NULL`, so phantom
  // cancelled-tx rows never get here. lend/loan are pure reducer (no SPL
  // token behind them) and unaffected by this pass.
  //
  // When disconnected every term is already zero (via walletReady gating
  // above), so the headline collapses to 0 without a separate guard.
  const displayTotal = walletReady
    ? liveUsdc +
      onchainBasketValue +
      effectiveTrancheValue +
      effectivePpnValue +
      ppnAccruedYield +
      trancheAccruedYield +
      totals.lendValue -
      totals.loanDebt
    : 0;
  const displayPnl = walletReady
    ? onchainBasketPnl + ppnAccruedYield + trancheAccruedYield
    : 0;

  // Hydrate basket positions from Supabase whenever the wallet connects
  // or changes. The reducer is in-memory only, so without this the portfolio
  // tab would look empty after any browser reload even when the user has
  // on-chain deposits in the DB.
  const hydratePortfolio = React.useCallback(async () => {
    if (IS_SUI) return;
    if (!connected || !publicKey) return;
    const wallet = publicKey.toBase58();
    await Promise.allSettled([
      fetchBasketPortfolio(wallet).then((positions) =>
        dispatch({ type: "basket/hydrate", positions }),
      ),
      fetchPpnPortfolio(wallet).then((portfolio) => {
        // Merge policy (dupe `bundle_id` → one card, dupe
        // `(bundle_id, tranche_kind)` → one card) lives in _lib/ppn-hydrate
        // so the PPN page sees the same merged shape on standalone visits.
        dispatch({ type: "ppn/hydrate", vaults: mergePpnVaults(portfolio) });
        dispatch({
          type: "tranche/hydrate",
          positions: mergeTranches(portfolio),
        });
      }),
    ]);
  }, [connected, publicKey, dispatch]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await hydratePortfolio();
    })();
    return () => {
      cancelled = true;
    };
  }, [hydratePortfolio]);

  // Disconnect sweep — flush the sandbox reducer so a fresh wallet (or an
  // unconnected session) can never inherit the previous account's positions.
  // The reducer is in-memory only, so without this the header would keep
  // showing last-hydrated basket / tranche / PPN rows after the user clicks
  // "Disconnect" in Phantom. Empty payloads reuse the hydrate actions the
  // reducer already handles, so no new reducer cases required.
  useEffect(() => {
    if (IS_SUI) return;
    if (walletReady) return;
    dispatch({ type: "basket/hydrate", positions: [] });
    dispatch({ type: "ppn/hydrate", vaults: [] });
    dispatch({ type: "tranche/hydrate", positions: [] });
  }, [walletReady, dispatch]);

  async function handleRedeem(bundleId: string, uiBundleId: string, tokens: number) {
    if (!walletReady || !appWalletAddress) return;
    setRedeemError((prev) => {
      const next = { ...prev };
      delete next[bundleId];
      return next;
    });
    setRedeemBusy(bundleId);
    try {
      await redeemFromBundle({ wallet: walletSigner, bundleId, amountTokens: tokens });
      clearVirtualPositionsByUiBundleId(appWalletAddress, bundleId, uiBundleId);
      await hydratePortfolio();
      void usdc.refresh();
    } catch (err) {
      const msg =
        err instanceof DepositError
          ? err.message
          : err instanceof Error
            ? /user rejected/i.test(err.message)
              ? "Transaction was rejected in your wallet."
              : err.message
            : String(err);
      setRedeemError((prev) => ({ ...prev, [bundleId]: msg }));
    } finally {
      setRedeemBusy(null);
    }
  }

  /**
   * Redeem a PPN or tranche position. Both ride the `initialize_note` rail so
   * a single `ppnRedeem` call handles both. When `vaultIds` has more than
   * one id, the merged card stands for multiple on-chain notes (same
   * bundle_id, two deposits) and we redeem each in sequence. Falls back to
   * (bundleId, wallet) when no explicit vault ids are provided so the
   * backend can resolve via `getActivePPNVault`.
   */
  async function handleRedeemPpn(rowKey: string, opts: { vaultIds?: string[]; bundleId?: string }) {
    if (!connected || !publicKey) return;
    setRedeemError((prev) => {
      const next = { ...prev };
      delete next[rowKey];
      return next;
    });
    setRedeemBusy(rowKey);
    try {
      const ids = opts.vaultIds?.filter(Boolean) ?? [];
      if (ids.length > 0) {
        // Redeem every underlying vault sequentially. Sequential keeps the
        // wallet popup flow deterministic (one approval at a time) and lets
        // us bail on the first failure without leaving a partial state on
        // subsequent vaults.
        for (const vaultId of ids) {
          await ppnRedeem({ wallet: walletSigner, vaultId });
        }
      } else {
        await ppnRedeem({
          wallet: walletSigner,
          bundleId: opts.bundleId,
        });
      }
      await hydratePortfolio();
      void usdc.refresh();
    } catch (err) {
      const msg =
        err instanceof PpnError
          ? err.message
          : err instanceof Error
            ? /user rejected/i.test(err.message)
              ? "Transaction was rejected in your wallet."
              : err.message
            : String(err);
      setRedeemError((prev) => ({ ...prev, [rowKey]: msg }));
    } finally {
      setRedeemBusy(null);
    }
  }

  // Live-first basket metadata lookup: if the live pipeline has this
  // id we use the live NAV so open positions track the real feed, and
  // fall back to the seed Bundle only when the live feed doesn't have
  // coverage for that id (offline mode, missing live row, etc.).
  const resolveBasket = (id: string) => {
    if (basketState.status === "ok") {
      const live = basketState.baskets.find((b) => b.id === id);
      if (live) {
        return {
          id: live.id,
          tier: live.tier,
          nav: live.nav,
        };
      }
    }
    const seed = bundleById(id);
    return seed
      ? { id: seed.id, tier: seed.tier, nav: seed.nav }
      : null;
  };

  // Live row values — match the breakdown rows below so the donut slices,
  // the percentages, and the headline all add up. Basket slice is now the
  // on-chain value (same source as displayTotal) so donut + header stay in
  // lockstep with the wallet's real STHS balance.
  const donutBasketValue = onchainBasketValue;
  const donutTrancheValue = effectiveTrancheValue + trancheAccruedYield;
  const donutPpnValue = effectivePpnValue + ppnAccruedYield;
  const donutData: Array<{ id: string; value: number; color: string }> = [
    ...(liveUsdc > 0 ? [{ id: "cash", value: liveUsdc, color: "#4a5a6a" }] : []),
    ...(donutBasketValue > 0 ? [{ id: "baskets", value: donutBasketValue, color: C.teal }] : []),
    ...(donutTrancheValue > 0 ? [{ id: "tranches", value: donutTrancheValue, color: C.amber }] : []),
    ...(donutPpnValue > 0 ? [{ id: "ppn", value: donutPpnValue, color: C.violet }] : []),
    ...(totals.lendValue > 0 ? [{ id: "lending", value: totals.lendValue, color: C.blue }] : []),
  ];
  const empty = donutData.length === 0;

  // Match active slice color for corona glow
  const activeColor = activeId ? donutData.find(d => d.id === activeId)?.color : null;

  const donutSize = 300;
  const systemSize = 600;

  return (
    <>
      <style>{`
        @keyframes senthosOrbitSlow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes senthosOrbitRev  { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
        .senthos-orbit-slow { animation: senthosOrbitSlow 80s linear infinite; }
        .senthos-orbit-med  { animation: senthosOrbitRev 120s linear infinite; }
        .senthos-orbit-fast { animation: senthosOrbitSlow 160s linear infinite; }
      `}</style>
      <Header />
      <PageFrame>
        <div style={{ marginBottom: 10, position: "relative", paddingBottom: 12, borderBottom: "0.5px solid rgba(45, 212, 191, 0.1)" }}>
          <div style={{ position: "absolute", top: 0, right: 0, width: 220, height: 140, background: "radial-gradient(ellipse at top right, rgba(45, 212, 191, 0.1) 0%, transparent 70%)", pointerEvents: "none" }} />
          {/* Segmented Positions / Personalization tab — top-right of the header */}
          <div style={{
            position: "absolute",
            top: 0,
            right: 0,
            zIndex: 3,
            display: "flex",
            gap: 2,
            padding: 3,
            background: isLight ? "rgba(255, 255, 255, 0.9)" : "rgba(8, 12, 20, 0.7)",
            border: isLight ? "1px solid rgba(13, 148, 136, 0.22)" : "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: 10,
            backdropFilter: "blur(10px)",
            boxShadow: isLight ? "0 2px 8px rgba(13, 14, 20, 0.04)" : "none",
          }}>
            {([
              { id: "positions",       label: "Positions" },
              { id: "personalization", label: "Personalization" },
              { id: "history",         label: "History" },
            ] as const).map((t) => {
              const active = view === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setView(t.id)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "8px 14px",
                    borderRadius: 7,
                    border: "none",
                    cursor: "pointer",
                    fontFamily: FD,
                    fontSize: 12,
                    fontWeight: active ? 500 : 400,
                    letterSpacing: "0.02em",
                    background: active ? "rgba(45, 212, 191, 0.12)" : "transparent",
                    color: active ? C.tealLight : C.textSecondary,
                    transition: `color 0.15s ${EASE}, background 0.15s ${EASE}`,
                  }}
                  onMouseEnter={(e) => {
                    if (active) return;
                    (e.currentTarget as HTMLElement).style.color = C.textPrimary;
                  }}
                  onMouseLeave={(e) => {
                    if (active) return;
                    (e.currentTarget as HTMLElement).style.color = C.textSecondary;
                  }}
                >
                  {t.id === "personalization" && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M12 3 L13.5 9.5 L20 11 L13.5 12.5 L12 19 L10.5 12.5 L4 11 L10.5 9.5 Z" />
                    </svg>
                  )}
                  {t.label}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, position: "relative" }}>
            <span style={{ width: 18, height: 1, background: C.teal, opacity: 0.8 }} />
            <span style={{ fontFamily: FM, fontSize: 11, letterSpacing: "0.14em", color: C.teal, fontWeight: 600 }}>
              {view === "positions"
                ? "PORTFOLIO"
                : view === "personalization"
                  ? "PORTFOLIO · AI"
                  : "PORTFOLIO · LEDGER"}
            </span>
            <span style={{ width: 18, height: 1, background: C.teal, opacity: 0.8 }} />
          </div>
          <div style={{ fontSize: 32, fontWeight: 400, color: C.textPrimary, fontFamily: FD, marginBottom: 6, letterSpacing: "-0.024em", position: "relative" }}>
            {view === "positions" ? (
              <>Your <span style={{ fontWeight: 500, color: C.teal }}>orbit</span></>
            ) : view === "personalization" ? (
              <>A portfolio, <span style={{ fontWeight: 500, color: C.teal }}>tailored</span></>
            ) : (
              <>Every <span style={{ fontWeight: 500, color: C.teal }}>move</span>, on record</>
            )}
          </div>
          <div style={{ fontSize: 13, color: C.textSecondary, fontFamily: FS, position: "relative" }}>
            {view === "positions"
              ? "Unified view across cash, constellations, tranches, and PPN vaults"
              : view === "personalization"
                ? "Build an allocation shaped by your risk tolerance, capital, and objective"
                : "Chronological ledger of every buy, sell, and divestment"}
          </div>
        </div>

        {view === "personalization" ? (
          <Personalization />
        ) : view === "history" ? (
          <History
            walletAddress={appWalletAddress}
            connected={walletReady}
          />
        ) : (
        <>
        {/* ORBITAL DONUT CARD — centrepiece, sized to fit above the fold */}
        <div style={{
          background: C.panelGradient,
          border: isLight ? "0.5px solid rgba(13, 148, 136, 0.2)" : "0.5px solid rgba(45, 212, 191, 0.1)",
          borderRadius: 24,
          marginBottom: 14,
          overflow: "hidden",
          position: "relative",
          boxShadow: isLight
            ? "0 1px 0 rgba(13, 14, 20, 0.03) inset, 0 8px 24px rgba(13, 14, 20, 0.06)"
            : "0 1px 0 rgba(255,255,255,0.03) inset, 0 20px 60px rgba(0,0,0,0.2)",
        }}>
          {/* Deep space gradient wash — dark mode only; light mode keeps the
              card centre blank per the design call */}
          {!isLight && (
            <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(45, 212, 191, 0.04) 0%, transparent 70%)", pointerEvents: "none" }} />
          )}
          {/* Top accent ribbon */}
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1.5, background: "linear-gradient(90deg, transparent 0%, rgba(45, 212, 191, 0.4) 20%, #2dd4bf 50%, rgba(45, 212, 191, 0.4) 80%, transparent 100%)", opacity: 0.6 }} />
          {/* Active color wash — dark mode only */}
          {!isLight && (
            <div style={{ position: "absolute", inset: 0, background: activeId && activeColor ? `radial-gradient(ellipse 60% 50% at 50% 45%, ${activeColor}22 0%, transparent 70%)` : "transparent", transition: "background 0.6s cubic-bezier(0.32, 0.72, 0, 1)", pointerEvents: "none" }} />
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 56, padding: "14px 40px", position: "relative", flexWrap: "wrap" }}>

            {/* Left-side stats panel — totals + per-bucket breakdown. */}
            <div style={{ width: 300, flexShrink: 0, alignSelf: "center", position: "relative", zIndex: 5 }}>
              <div style={{ paddingBottom: 16, marginBottom: 14, borderBottom: `0.5px solid ${C.border}` }}>
                <div style={{ fontSize: 10, color: C.textMuted, fontFamily: FM, letterSpacing: "0.18em", marginBottom: 6 }}>
                  TOTAL VALUE
                </div>
                <div style={{ fontSize: 24, color: C.textPrimary, fontFamily: FD, fontWeight: 500, letterSpacing: "-0.015em", lineHeight: 1 }}>
                  {fmtUsd(displayTotal, 2)}
                </div>
              </div>
              <div style={{ paddingBottom: 16, marginBottom: 14, borderBottom: `0.5px solid ${C.border}` }}>
                <div style={{ fontSize: 10, color: C.textMuted, fontFamily: FM, letterSpacing: "0.18em", marginBottom: 6 }}>
                  UNREALIZED P&L
                </div>
                <div style={{ fontSize: 24, color: displayPnl >= 0 ? C.green : C.red, fontFamily: FD, fontWeight: 500, letterSpacing: "-0.015em", lineHeight: 1 }}>
                  {displayPnl >= 0 ? "+" : ""}{fmtUsd(displayPnl, 2)}
                </div>
              </div>
              {(() => {
                // Breakdown rows now source basket value from on-chain STHS
                // balances (same as displayTotal), so rows + headline agree
                // with the wallet's real position. Tranche and PPN rows
                // still include straight-line accrual so the card totals
                // match the donut and headline to the penny.
                const basketRowValue = onchainBasketValue;
                const trancheRowValue = effectiveTrancheValue + trancheAccruedYield;
                const ppnRowValue = effectivePpnValue + ppnAccruedYield;
                const rows = [
                  { id: "cash",     label: "USDC",           color: "#4a5a6a", value: liveUsdc },
                  { id: "baskets",  label: "Constellations", color: C.teal,    value: basketRowValue },
                  { id: "tranches", label: "Tranches",       color: C.amber,   value: trancheRowValue },
                  { id: "ppn",      label: "PPNs",           color: C.violet,  value: ppnRowValue },
                ];
                const breakdownTotal = rows.reduce((s, r) => s + r.value, 0);
                return rows.map((r) => {
                  const pct = breakdownTotal > 0 ? (r.value / breakdownTotal) * 100 : 0;
                  const dim = r.value <= 0;
                  const isActive = activeId === r.id;
                  return (
                    <div
                      key={r.id}
                      onMouseEnter={() => !dim && setActiveId(r.id)}
                      onMouseLeave={() => setActiveId(null)}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "14px 1fr auto",
                        gap: 12,
                        alignItems: "center",
                        padding: "12px 8px",
                        borderRadius: 6,
                        opacity: dim ? 0.42 : 1,
                        cursor: dim ? "default" : "pointer",
                        transition: `opacity 0.15s ${EASE}, background 0.15s ${EASE}`,
                        background: isActive ? `${r.color}12` : "transparent",
                      }}
                    >
                      <span style={{
                        width: 9, height: 9, borderRadius: "50%",
                        background: r.color,
                        boxShadow: isActive ? `0 0 12px ${r.color}80` : "none",
                        transition: `box-shadow 0.2s ${EASE}`,
                        justifySelf: "center",
                      }} />
                      <div style={{ fontSize: 14, color: C.textPrimary, fontFamily: FD, fontWeight: 500, letterSpacing: "-0.005em" }}>
                        {r.label}
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontSize: 14, color: C.textPrimary, fontFamily: FD, fontWeight: 500 }}>
                          {fmtUsd(r.value, 2)}
                        </span>
                        <span style={{ fontSize: 11, color: C.textMuted, fontFamily: FM, marginLeft: 8, letterSpacing: "0.02em" }}>
                          {pct.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            {/* Orbital system - rings + corona around donut */}
            <div style={{ position: "relative", width: systemSize, height: systemSize, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>

              {/* Corona glow — dark mode only; light mode keeps centre blank */}
              {!isLight && (
                <div style={{
                  position: "absolute",
                  width: donutSize * 1.15,
                  height: donutSize * 1.15,
                  borderRadius: "50%",
                  background: `radial-gradient(circle, ${activeColor || "#2dd4bf"}18 0%, ${activeColor || "#2dd4bf"}08 40%, transparent 70%)`,
                  filter: "blur(20px)",
                  transition: "background 0.6s cubic-bezier(0.32, 0.72, 0, 1)",
                  pointerEvents: "none",
                }} />
              )}

              {/* Ring 1 - innermost, teal */}
              <div className="senthos-orbit-slow" style={{
                position: "absolute",
                width: donutSize * 1.28,
                height: donutSize * 1.28,
                borderRadius: "50%",
                border: "1px solid rgba(45, 212, 191, 0.18)",
                boxShadow: "0 0 30px rgba(45, 212, 191, 0.08) inset",
                pointerEvents: "none",
              }}>
                <div style={{ position: "absolute", top: "50%", left: 0, transform: "translate(-50%, -50%)", width: 6, height: 6, borderRadius: "50%", background: "#2dd4bf", boxShadow: "0 0 10px #2dd4bf" }} />
              </div>

              {/* Ring 2 - middle, amber */}
              <div className="senthos-orbit-med" style={{
                position: "absolute",
                width: donutSize * 1.55,
                height: donutSize * 1.55,
                borderRadius: "50%",
                border: "1px solid rgba(217, 119, 6, 0.14)",
                pointerEvents: "none",
              }}>
                <div style={{ position: "absolute", top: 0, left: "50%", transform: "translate(-50%, -50%)", width: 5, height: 5, borderRadius: "50%", background: "#fbbf24", boxShadow: "0 0 10px #fbbf24" }} />
              </div>

              {/* Ring 3 - outermost, coral */}
              <div className="senthos-orbit-fast" style={{
                position: "absolute",
                width: donutSize * 1.82,
                height: donutSize * 1.82,
                borderRadius: "50%",
                border: "1px solid rgba(234, 88, 12, 0.1)",
                pointerEvents: "none",
              }}>
                <div style={{ position: "absolute", top: "50%", right: 0, transform: "translate(50%, -50%)", width: 4, height: 4, borderRadius: "50%", background: "#fb923c", boxShadow: "0 0 8px #fb923c" }} />
              </div>

              {/* Donut - mechanics untouched */}
              <div style={{ position: "relative", zIndex: 3 }}>
                <SvgDonut data={donutData} size={donutSize} activeId={activeId} onHover={setActiveId} isEmpty={empty} lightMode={isLight} />
                <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", textAlign: "center", pointerEvents: "none", width: 200 }}>
                  {(() => {
                    if (empty) {
                      return (
                        <>
                          <div style={{ fontSize: 11, color: C.textMuted, fontFamily: FM, letterSpacing: "0.14em", marginBottom: 10 }}>NO POSITIONS</div>
                          <div style={{ fontSize: 13, color: C.textSecondary, fontFamily: FS }}>Your orbit is empty</div>
                        </>
                      );
                    }
                    const donutTotal = donutData.reduce((s, d) => s + d.value, 0);
                    const hovered = activeId
                      ? donutData.find((d) => d.id === activeId)
                      : null;
                    if (hovered) {
                      const labelMap: Record<string, string> = {
                        cash: "USDC",
                        baskets: "CONSTELLATIONS",
                        tranches: "TRANCHES",
                        ppn: "PPNs",
                        lending: "LENDING",
                      };
                      const label = labelMap[hovered.id] ?? hovered.id.toUpperCase();
                      const hoverPct = donutTotal > 0 ? (hovered.value / donutTotal) * 100 : 0;
                      return (
                        <>
                          <div style={{ fontSize: 10, color: C.textMuted, fontFamily: FM, letterSpacing: "0.14em", marginBottom: 10 }}>{label}</div>
                          <div style={{ fontSize: 34, fontWeight: 600, color: C.textPrimary, fontFamily: FS, lineHeight: 1, marginBottom: 10, letterSpacing: "-0.03em" }}>
                            {fmtUsd(hovered.value, 2)}
                          </div>
                          <div style={{ fontSize: 13, color: hovered.color, fontFamily: FM, letterSpacing: "0.06em", fontWeight: 500 }}>
                            {hoverPct.toFixed(2)}%
                          </div>
                        </>
                      );
                    }
                    return (
                      <>
                        <div style={{ fontSize: 10, color: C.textMuted, fontFamily: FM, letterSpacing: "0.14em", marginBottom: 10 }}>TOTAL VALUE</div>
                        <div style={{ fontSize: 34, fontWeight: 600, color: C.textPrimary, fontFamily: FS, lineHeight: 1, marginBottom: 10, letterSpacing: "-0.03em" }}>
                          {fmtUsd(displayTotal, 2)}
                        </div>
                        <div style={{ fontSize: 11, color: C.textMuted, fontFamily: FM, letterSpacing: "0.08em" }}>
                          {donutData.length} POSITION{donutData.length !== 1 ? "S" : ""}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Positions - sorted by value descending, USDC included */}
        {(() => {
          // No wallet → no position cards. The disconnect-sweep useEffect
          // above clears the reducer, but until React re-runs this pass
          // we could still iterate stale state.basketPositions for one
          // tick; hard-gating here closes that race so no card ever flashes
          // on a disconnected portfolio.
          if (!walletReady) return null;
          // Build all position rows with value for sorting
          const rows: { value: number; el: React.ReactNode; key: string }[] = [];

          // Pull every virtual-position group the user has deposited. Each
          // group corresponds to a distinct synthetic id (e.g. STHS-HIGH-
          // SHORT) and becomes its own card, even when multiple synthetic
          // ids share a single on-chain UUID.
          const virtualGroups: GroupedVirtualPosition[] = virtualGroupsForWallet;
          // `onchainTokensByUuid` is hoisted to component scope (shared with
          // the headline/donut totals). Basket cards gate on positive
          // on-chain STHS balance so phantom / stale reducer rows can't
          // produce ghost cards that don't match the wallet.
          const virtualTokensByUuid = virtualGroups.reduce<Record<string, number>>(
            (acc, g) => {
              acc[g.uuid] = (acc[g.uuid] ?? 0) + g.tokens;
              return acc;
            },
            {},
          );
          // Map uuid → a representative uiBundleId from any virtual group.
          // When a residual position exists for a UUID the user has ALSO
          // deposited into via a synthetic id, borrowing that id gives us
          // the user's intent (they picked STHS-MID-SHORT, so the residual
          // card should label + route the same way). Picking the largest
          // group by token count stays stable under duplicate ids.
          const uiBundleIdByUuid = virtualGroups.reduce<Record<string, { id: string; tokens: number }>>(
            (acc, g) => {
              const prev = acc[g.uuid];
              if (!prev || g.tokens > prev.tokens) {
                acc[g.uuid] = { id: g.uiBundleId, tokens: g.tokens };
              }
              return acc;
            },
            {},
          );

          // Derive a frontend STHS- label for a residual on-chain position
          // whose bundleId is a backend UUID (so resolveBasket misses).
          // Preference order:
          //   1. Use p.displayName if the backend already stored a
          //      STHS-TIER-WINDOW name (new seed) — that's the authoritative
          //      basket identity and it routes directly to /app/basket/[id].
          //   2. Borrow the user's own uiBundleId if they have any virtual
          //      group for this UUID — that's their actual intent.
          //   3. Match the live grid by tier + closest daysLeft to the
          //      backend's maturityAt. Keeps (tier, window) semantics even
          //      for pre-ledger deposits.
          //   4. Match any seed bundle with the same tier (window unknown,
          //      but at least the tier + STHS- format is correct).
          // Returns null when even the tier is unknown — caller falls back
          // to whatever p.displayName was.
          const deriveResidualLabel = (p: BasketPosition): {
            labelId: string;
            tier: 90 | 70 | 50;
            nav: number;
          } | null => {
            if (p.displayName && /^STHS-(HIGH|MID|LOW)-(SHORT|MED|LONG)$/.test(p.displayName)) {
              const live = basketState.status === "ok"
                ? basketState.baskets.find((b) => b.id === p.displayName)
                : null;
              const tier = live?.tier ?? p.tier;
              const nav = live?.nav ?? p.navHint;
              if (tier != null && nav != null) {
                return { labelId: p.displayName, tier, nav };
              }
            }
            const borrowed = uiBundleIdByUuid[p.bundleId];
            if (borrowed) {
              const live = basketState.status === "ok"
                ? basketState.baskets.find((b) => b.id === borrowed.id)
                : null;
              const tier = live?.tier ?? p.tier;
              const nav = live?.nav ?? p.navHint;
              if (tier != null && nav != null) {
                return { labelId: borrowed.id, tier, nav };
              }
            }
            const tierGuess = p.tier;
            if (tierGuess == null) return null;
            if (basketState.status === "ok") {
              const candidates = basketState.baskets.filter((b) => b.tier === tierGuess);
              if (candidates.length) {
                const target = p.maturityAt;
                const pick = target == null
                  ? candidates[0]
                  : candidates
                      .map((b) => {
                        const bMaturity = b.daysLeft != null
                          ? Date.now() + b.daysLeft * 86_400_000
                          : null;
                        const diff = bMaturity == null
                          ? Number.POSITIVE_INFINITY
                          : Math.abs(bMaturity - target);
                        return { b, diff };
                      })
                      .sort((a, z) => a.diff - z.diff)[0].b;
                return { labelId: pick.id, tier: pick.tier, nav: pick.nav };
              }
            }
            const seed = bundleById(`STHS-${tierGuess === 90 ? "HIGH" : tierGuess === 70 ? "MID" : "LOW"}-SHORT`);
            if (seed) {
              return { labelId: seed.id, tier: seed.tier, nav: p.navHint ?? seed.nav };
            }
            return null;
          };

          const renderBasketCard = (opts: {
            cardKey: string;
            uuid: string;
            labelId: string;
            qty: number;
            avgCost: number;
            nav: number;
            tier: 90 | 70 | 50;
            maturityAt?: number | null;
            status?: string;
          }) => {
            const { cardKey, uuid, labelId, qty, avgCost, nav, tier, maturityAt, status } = opts;
            // Cost basis for the card value — matches the top-line Total,
            // donut slice, and breakdown row. We intentionally do NOT
            // show a NAV-based unrealized P&L badge here: early-exit
            // uses `exit_active`'s pool-ratio payout (≈ cost), so the
            // NAV drift isn't realizable until the vault is finalized
            // at resolution. Keeping pnl=0 on the card (and in the
            // top-line onchainBasketPnl above) prevents the confusing
            // "appears +$4 right after buying → evaporates on sell"
            // sequence; real gains/losses still land on the USDC line
            // when the user actually transacts.
            const value = qty * avgCost;
            const pnl = 0;
            // Reference: `nav` is left unused on purpose. If we ever
            // resurface a NAV-vs-cost indicator it should be labelled
            // "Forward payout at resolution" (or similar) rather than
            // "Unrealized P&L", and plumbed through a separate field
            // so the top-line sums stay clean.
            void nav;
            const liveMatchById =
              basketState.status === "ok"
                ? basketState.baskets.find((b) => b.id === labelId)
                : null;
            const liveMaturityMs =
              liveMatchById?.daysLeft != null
                ? Date.now() + liveMatchById.daysLeft * 86_400_000
                : null;
            const effectiveMaturityMs = liveMaturityMs ?? maturityAt ?? null;
            const matured =
              status === "resolved" ||
              (effectiveMaturityMs != null && effectiveMaturityMs <= renderNow);
            const maturityDate = liveMatchById?.date
              ? liveMatchById.date
              : maturityAt
                ? (() => {
                    const d = new Date(maturityAt);
                    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
                  })()
                : null;
            const maturityLabel =
              typeof maturityDate === "string"
                ? maturityDate
                : maturityDate
                  ? maturityDate.toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : null;
            const isBusy = redeemBusy === uuid;
            const errMsg = redeemError[uuid];
            // Human-readable conviction tag. Matches the wording on /basket
            // where each card shows "high/mid/low probability" under the id.
            const tierLabel = tier === 90 ? "High" : tier === 70 ? "Mid" : "Low";
            // Days-to-close: prefer the live feed, fall back to maturityAt
            // from the DB hydrate. Mirrors `formatDaysLeft` on /basket so the
            // wording is consistent between the index card and portfolio card.
            const daysLeftMs =
              liveMatchById?.daysLeft != null
                ? liveMatchById.daysLeft * 86_400_000
                : maturityAt != null
                  ? Math.max(0, maturityAt - renderNow)
                  : null;
            const closesInLabel =
              daysLeftMs == null
                ? null
                : daysLeftMs <= 0
                  ? "Resolving now"
                  : (() => {
                      const d = Math.round(daysLeftMs / 86_400_000);
                      if (d === 0) return "Closes today";
                      if (d === 1) return "Closes in 1 day";
                      return `Closes in ${d} days`;
                    })();
            const contextLine = closesInLabel
              ? `${tierLabel}-conviction · ${closesInLabel}`
              : `${tierLabel}-conviction basket`;
            rows.push({
              key: cardKey,
              value,
              el: (
                <div key={cardKey} style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 14, padding: 20, marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
                    <div style={{ fontSize: 11, color: C.textMuted, fontFamily: FS, letterSpacing: "0.08em" }}>CONSTELLATION</div>
                    <Link href="/app/basket" style={{ fontSize: 11, color: C.teal, fontFamily: FS, textDecoration: "none" }}>View all →</Link>
                  </div>
                  <Link href={`/app/basket/${labelId}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", textDecoration: "none" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div style={{ width: 4, height: 24, borderRadius: 2, background: tc(tier) }} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, fontFamily: FD }}>{labelId}</div>
                        <div style={{ fontSize: 11, color: C.textSecondary, fontFamily: FS, marginTop: 2 }}>{contextLine}</div>
                        <div style={{ fontSize: 11, color: C.textMuted, fontFamily: FS, marginTop: 2 }}>{qty.toFixed(2)} tokens · avg ${avgCost.toFixed(3)}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, color: C.textPrimary, fontFamily: FD }}>{fmtUsd(value, 2)}</div>
                      <div style={{ fontSize: 11, color: pnl >= 0 ? C.green : C.red, fontFamily: FS, marginTop: 2 }}>{pnl >= 0 ? "+" : ""}{fmtUsd(pnl, 2)}</div>
                    </div>
                  </Link>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 14, paddingTop: 14, borderTop: `0.5px solid ${C.border}` }}>
                    <div style={{ fontSize: 11, color: matured ? C.green : C.textMuted, fontFamily: FM, letterSpacing: "0.06em" }}>
                      {matured ? "MATURED" : maturityLabel ? `MATURES ${maturityLabel.toUpperCase()}` : "MATURITY UNKNOWN"}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        handleRedeem(uuid, labelId, qty);
                      }}
                      disabled={!matured || isBusy || !walletReady}
                      style={{
                        padding: "7px 16px",
                        fontSize: 12,
                        fontFamily: FD,
                        fontWeight: 500,
                        letterSpacing: "0.02em",
                        borderRadius: 8,
                        cursor: matured && !isBusy ? "pointer" : "not-allowed",
                        border: `0.5px solid ${matured ? C.teal : "rgba(255,255,255,0.08)"}`,
                        background: matured ? "rgba(45, 212, 191, 0.12)" : "transparent",
                        color: matured ? C.tealLight : C.textMuted,
                        opacity: isBusy ? 0.6 : 1,
                        transition: `all 0.15s ${EASE}`,
                      }}
                    >
                      {isBusy ? "Redeeming…" : "Redeem"}
                    </button>
                  </div>
                  {errMsg && (
                    <div style={{ marginTop: 10, fontSize: 11, fontFamily: FS, color: C.red }}>
                      {errMsg}
                    </div>
                  )}
                </div>
              ),
            });
          };

          // Render one card per virtual group, using the NAV at deposit
          // time as the cost basis so PnL starts at zero. Crucially, we
          // cap qty at the wallet's on-chain STHS balance: if the user
          // redeemed / burned / transferred the tokens the virtual ledger
          // can't catch up on its own, so the chain is the final word.
          virtualGroups.forEach((g) => {
            const liveMatch =
              basketState.status === "ok"
                ? basketState.baskets.find((b) => b.id === g.uiBundleId)
                : null;
            const dbMatch = state.basketPositions.find((p) => p.bundleId === g.uuid);
            const tier = liveMatch?.tier ?? dbMatch?.tier;
            const nav = liveMatch?.nav ?? dbMatch?.navHint;
            if (tier == null || nav == null) return;
            // Gate every card on the authoritative on-chain balance. If
            // the wallet holds nothing for this bundle UUID, the card
            // disappears regardless of what the virtual ledger remembers.
            const onchainForUuid = onchainTokensByUuid[g.uuid] ?? 0;
            if (onchainForUuid <= 0.000001) return;
            const totalVirtualForUuid = virtualTokensByUuid[g.uuid] ?? 0;
            const share =
              totalVirtualForUuid > 0 ? g.tokens / totalVirtualForUuid : 1;
            const effectiveQty = Math.min(g.tokens, onchainForUuid * share);
            if (effectiveQty <= 0.000001) return;
            renderBasketCard({
              cardKey: `${g.uuid}::${g.uiBundleId}`,
              uuid: g.uuid,
              labelId: g.uiBundleId,
              qty: effectiveQty,
              // Actual USDC-per-token the user paid at deposit, not the
              // live Polymarket NAV snapshot (avgNavAtDeposit). The chain
              // mints at a fixed issue_price_bps, so NAV-at-deposit drifts
              // off the true cost basis whenever NAV != issue price.
              // Using the real cost keeps card PnL aligned with the
              // headline Unrealized P&L (which sums qty × (nav - avgCost)
              // against the hydrated position, also keyed on cost basis).
              avgCost:
                g.tokens > 1e-9 && g.depositedUsdc > 0
                  ? g.depositedUsdc / g.tokens
                  : g.avgNavAtDeposit,
              nav,
              tier,
              maturityAt: dbMatch?.maturityAt,
              status: dbMatch?.status,
            });
          });

          // For each on-chain position, render a residual card covering
          // any tokens the virtual ledger hasn't explained (pre-ledger
          // deposits, localStorage wipes, etc.).
          // Dedupe by bundleId before rendering residuals: the backend has
          // historically returned multiple rows for the same bundle (e.g. one
          // per on-chain deposit event), which would give us two cards with
          // identical `${bundleId}::residual` keys and the "Encountered two
          // children with the same key" React warning. Sum their qty so the
          // user sees one merged residual instead of duplicates.
          const residualByBundle = new Map<string, BasketPosition>();
          state.basketPositions.forEach((p) => {
            const existing = residualByBundle.get(p.bundleId);
            if (existing) {
              residualByBundle.set(p.bundleId, {
                ...existing,
                qty: existing.qty + p.qty,
              });
            } else {
              residualByBundle.set(p.bundleId, p);
            }
          });
          residualByBundle.forEach((p) => {
            // Residual = on-chain tokens the virtual ledger hasn't already
            // accounted for. Drive the subtraction off the on-chain balance
            // (not the backend qty) so a stale DB row with ghost tokens the
            // wallet no longer holds doesn't produce a phantom card.
            const onchainForUuid = onchainTokensByUuid[p.bundleId] ?? 0;
            if (onchainForUuid <= 0.000001) return;
            const virtualQty = virtualTokensByUuid[p.bundleId] ?? 0;
            const coveredByVirtual = Math.min(virtualQty, onchainForUuid);
            const residual = onchainForUuid - coveredByVirtual;
            if (residual <= 0.001) return;
            // First try the catalog (works when bundleId is already a
            // STHS- id), then fall through to deriveResidualLabel which
            // maps a backend UUID → the best-guess STHS-TIER-WINDOW id.
            // Using p.displayName as a label leaks "LK-70-0515" into the
            // UI and breaks the basket-detail route.
            const catalogMatch = resolveBasket(p.bundleId);
            let tier: 90 | 70 | 50 | undefined;
            let nav: number | undefined;
            let labelId: string;
            if (catalogMatch) {
              tier = catalogMatch.tier;
              nav = catalogMatch.nav;
              labelId = catalogMatch.id;
            } else {
              const derived = deriveResidualLabel(p);
              if (!derived) return;
              tier = derived.tier;
              nav = derived.nav;
              labelId = derived.labelId;
            }
            if (tier == null || nav == null) return;
            renderBasketCard({
              cardKey: `${p.bundleId}::residual`,
              uuid: p.bundleId,
              labelId,
              qty: residual,
              // Use the DB-hydrated entry price as the cost basis. Pegging
              // to current NAV forced card PnL = $0 regardless of drift,
              // which disagreed with the headline (basketDriftLive uses
              // p.avgCost). Falling back to nav only when the hydrate
              // produced no avgCost (pre-migration rows) keeps the card
              // honest without crashing on missing data.
              avgCost: p.avgCost && p.avgCost > 0 ? p.avgCost : nav,
              nav,
              tier,
              maturityAt: p.maturityAt,
              status: p.status,
            });
          });


          // `effectiveTranches` is the reducer's tranchePositions filtered to
          // rows backed by on-chain STHS. Phantom rows from cancelled
          // transactions (backend creates the row before the wallet signs)
          // never appear here because the wallet holds no matching STHS.
          effectiveTranches.forEach((p, i) => {
            const principal = p.qty * p.avgCost;
            // Per-card accrued yield — same formula as trancheAccruedYield, so
            // summing cards matches the headline P&L contribution.
            const trancheAccrued =
              p.apy != null && p.createdAt != null && p.maturityDays != null
                ? principal *
                  (p.apy / 100 / 365) *
                  Math.min(
                    Math.max(0, (renderNow - p.createdAt) / 86_400_000),
                    p.maturityDays,
                  )
                : 0;
            const value = principal + trancheAccrued;
            const rowKey = `tranche-${p.vaultId ?? `${p.bundleId}-${p.kind}-${i}`}`;
            const matured = p.maturityAt != null ? p.maturityAt <= renderNow : false;
            const isBusy = redeemBusy === rowKey;
            const errMsg = redeemError[rowKey];
            const maturityLabel = p.maturityAt
              ? new Date(p.maturityAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : null;
            rows.push({
              key: rowKey,
              value,
              el: (
                <div key={rowKey} style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 14, padding: 20, marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
                    <div style={{ fontSize: 11, color: C.textMuted, fontFamily: FS, letterSpacing: "0.08em" }}>TRANCHE</div>
                    <Link href="/app/tranche" style={{ fontSize: 11, color: C.teal, fontFamily: FS, textDecoration: "none" }}>View all →</Link>
                  </div>
                  <Link href={`/app/tranche/${p.bundleName ?? p.bundleId}?tier=${p.kind}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", textDecoration: "none" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div style={{ width: 4, height: 24, borderRadius: 2, background: trancheColor(p.kind) }} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, fontFamily: FD, textTransform: "capitalize" }}>{p.bundleName ?? p.bundleId} · {p.kind}</div>
                        <div style={{ fontSize: 11, color: C.textMuted, fontFamily: FS, marginTop: 2 }}>{p.qty.toFixed(2)} tokens · issued ${p.avgCost.toFixed(2)}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, color: C.textPrimary, fontFamily: FD }}>{fmtUsd(value, 2)}</div>
                      {trancheAccrued > 0 && (
                        <div style={{ fontSize: 11, color: C.green, fontFamily: FS, marginTop: 2 }}>+{fmtUsd(trancheAccrued, 2)}</div>
                      )}
                    </div>
                  </Link>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 14, paddingTop: 14, borderTop: `0.5px solid ${C.border}` }}>
                    <div style={{ fontSize: 11, color: matured ? C.green : C.textMuted, fontFamily: FM, letterSpacing: "0.06em" }}>
                      {matured ? "MATURED" : maturityLabel ? `MATURES ${maturityLabel.toUpperCase()}` : "MATURITY UNKNOWN"}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        handleRedeemPpn(rowKey, {
                          vaultIds: p.allVaultIds?.length
                            ? p.allVaultIds
                            : p.vaultId
                              ? [p.vaultId]
                              : undefined,
                          bundleId:
                            p.allVaultIds?.length || p.vaultId ? undefined : p.bundleId,
                        })
                      }
                      disabled={!matured || isBusy || !walletReady}
                      style={{
                        padding: "7px 16px",
                        fontSize: 12,
                        fontFamily: FD,
                        fontWeight: 500,
                        letterSpacing: "0.02em",
                        borderRadius: 8,
                        cursor: matured && !isBusy ? "pointer" : "not-allowed",
                        border: `0.5px solid ${matured ? C.amber : "rgba(255,255,255,0.08)"}`,
                        background: matured ? "rgba(217, 119, 6, 0.14)" : "transparent",
                        color: matured ? C.amber : C.textMuted,
                        opacity: isBusy ? 0.6 : 1,
                        transition: `all 0.15s ${EASE}`,
                      }}
                    >
                      {isBusy ? "Redeeming…" : "Redeem"}
                    </button>
                  </div>
                  {errMsg && (
                    <div style={{ marginTop: 10, fontSize: 11, fontFamily: FS, color: C.red }}>
                      {errMsg}
                    </div>
                  )}
                </div>
              ),
            });
          });

          // Same on-chain gate as the tranche loop above — cancelled-tx rows
          // never reach this list, so the card count matches the wallet.
          effectivePpnVaults.forEach((v) => {
            const elapsed = Math.max(0, (renderNow - v.createdAt) / 86_400_000);
            const accrued = v.principal * (v.apy / 100 / 365) * Math.min(elapsed, v.maturityDays);
            const value = v.principal + accrued;
            const rowKey = `ppn-${v.id}`;
            const maturityMs = v.createdAt + v.maturityDays * 86_400_000;
            const matured = maturityMs <= renderNow;
            const isBusy = redeemBusy === rowKey;
            const errMsg = redeemError[rowKey];
            const maturityLabel = new Date(maturityMs).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            rows.push({
              key: rowKey,
              value,
              el: (
                <div key={rowKey} style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 14, padding: 20, marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
                    <div style={{ fontSize: 11, color: C.textMuted, fontFamily: FS, letterSpacing: "0.08em" }}>PPN VAULT</div>
                    <Link href="/app/ppn" style={{ fontSize: 11, color: C.violet, fontFamily: FS, textDecoration: "none" }}>View all →</Link>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div style={{ width: 4, height: 24, borderRadius: 2, background: C.violet }} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, fontFamily: FD }}>{v.bundleId}</div>
                        <div style={{ fontSize: 11, color: C.textMuted, fontFamily: FS, marginTop: 2 }}>{v.apy.toFixed(2)}% APY · {v.maturityDays}d maturity</div>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {/* Card big-number matches the tranche card convention
                          (value = principal + accrued yield) and the top-line
                          roll-up (effectivePpnValue + ppnAccruedYield). Using
                          v.principal here made the PPN card appear frozen at
                          the deposit amount while every other surface on the
                          page moved with accrual. */}
                      <div style={{ fontSize: 13, color: C.textPrimary, fontFamily: FD }}>{fmtUsd(value, 2)}</div>
                      {accrued > 0 && (
                        <div style={{ fontSize: 11, color: C.green, fontFamily: FS, marginTop: 2 }}>+{fmtUsd(accrued, 2)}</div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 14, paddingTop: 14, borderTop: `0.5px solid ${C.border}` }}>
                    <div style={{ fontSize: 11, color: matured ? C.green : C.textMuted, fontFamily: FM, letterSpacing: "0.06em" }}>
                      {matured ? "MATURED" : `MATURES ${maturityLabel.toUpperCase()}`}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRedeemPpn(rowKey, { vaultIds: v.allVaultIds ?? [v.id] })}
                      disabled={!matured || isBusy || !walletReady}
                      style={{
                        padding: "7px 16px",
                        fontSize: 12,
                        fontFamily: FD,
                        fontWeight: 500,
                        letterSpacing: "0.02em",
                        borderRadius: 8,
                        cursor: matured && !isBusy ? "pointer" : "not-allowed",
                        border: `0.5px solid ${matured ? C.violet : "rgba(255,255,255,0.08)"}`,
                        background: matured ? "rgba(139, 92, 246, 0.14)" : "transparent",
                        color: matured ? C.violet : C.textMuted,
                        opacity: isBusy ? 0.6 : 1,
                        transition: `all 0.15s ${EASE}`,
                      }}
                    >
                      {isBusy ? "Redeeming…" : "Redeem"}
                    </button>
                  </div>
                  {errMsg && (
                    <div style={{ marginTop: 10, fontSize: 11, fontFamily: FS, color: C.red }}>
                      {errMsg}
                    </div>
                  )}
                </div>
              ),
            });
          });

          // USDC cash position. Pulls straight from the wallet-bridge's
          // live poll so this reflects the user's actual on-chain ATA
          // (Circle devnet USDC). If the wallet is disconnected the row
          // is skipped — the connect CTA lives in the header.
          if (liveUsdc > 0) {
            rows.push({
              key: "usdc",
              value: liveUsdc,
              el: (
                <div key="usdc" style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 14, padding: 20, marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: C.textMuted, fontFamily: FS, letterSpacing: "0.08em", marginBottom: 14 }}>CASH</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div style={{ width: 4, height: 24, borderRadius: 2, background: "#4a5a6a" }} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, fontFamily: FD }}>USDC</div>
                        <div style={{ fontSize: 11, color: C.textMuted, fontFamily: FS, marginTop: 2 }}>{IS_SUI ? "Sui testnet mUSDC" : "Solana · available"}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: C.textPrimary, fontFamily: FD }}>{fmtUsd(liveUsdc, 2)}</div>
                  </div>
                </div>
              ),
            });
          }

          // Sort by value descending
          rows.sort((a, b) => b.value - a.value);
          return rows.map(r => r.el);
        })()}
        </>
        )}
      </PageFrame>
    </>
  );
}
