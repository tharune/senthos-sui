"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Header, PageFrame } from "../_components/Header";
import { MetricTile } from "../_components/charts";
import { C, FS, FD, FM, EASE, tc, fmtUsd, BACKEND_URL } from "../_lib/tokens";
import { IS_SUI } from "../_lib/chain";
import { BUNDLES, bundleById } from "../_lib/bundles";
import { useSandbox } from "../_lib/demo-state";
import { useLiveBaskets } from "../_lib/use-live-baskets";
import type { LiveBasket } from "../_lib/live-baskets";
import {
  useWalletSigner,
  useUsdcBalance,
  explorerTxUrl,
} from "../_lib/wallet-bridge";
import {
  ppnDeposit,
  ppnRedeem,
  ppnDivest,
  ppnCloseEarly,
  fetchPpnPortfolio,
  PpnError,
} from "../_lib/ppn-client";
import { mergePpnVaults, mergeTranches } from "../_lib/ppn-hydrate";

// PPN fee structure (mirrored server-side in backend/src/routes/ppn.ts):
//
//   MANAGEMENT_FEE_BPS   (10 bps)  charged once on deposit.
//   STRATEGY_FEE_BPS     (5 bps)   charged on BOTH sides — open and close.
//
// Entry fee total = 15 bps, exit fee total = 5 bps, round-trip = 20 bps.
const MANAGEMENT_FEE_BPS = 10;
const STRATEGY_FEE_BPS = 5;
const MANAGEMENT_FEE_RATE = MANAGEMENT_FEE_BPS / 10_000;
const STRATEGY_FEE_RATE = STRATEGY_FEE_BPS / 10_000;

// Product copy block rendered at the bottom of the deposit card so the
// panel fills the column and explains the product the same way the basket
// page does.
const HOW_IT_WORKS: Array<{ num: string; title: string; body: string }> = [
  {
    num: "01",
    title: "Auto-routed vault",
    body: IS_SUI
      ? "Principal is routed through the local Sui mock-USDC vault sleeve, refreshed every 5 minutes."
      : "Principal is deposited into the highest-APY USDC vault on Solana, refreshed every 5 minutes.",
  },
  {
    num: "02",
    title: "Protected split",
    body: "Vault portion is sized to return 100% of principal by maturity. The remainder funds basket upside.",
  },
  {
    num: "03",
    title: "Exit any time",
    body: "Redeem at maturity or divest early from the positions panel. 5 bps strategy fee on close.",
  },
];

// Resolution window filter — mirrors the Short/Medium/Long vocabulary used
// across the basket and tranche pages (the basket suffixes SHORT/MED/LONG
// map to these buckets). This is intentionally coarser than the underlying
// `matchesPickerWindow` so users see three sensible buckets, not five.
type WindowFilter = "all" | "short" | "medium" | "long";
function matchesWindow(daysLeft: number, filter: WindowFilter): boolean {
  if (filter === "all") return true;
  if (filter === "short") return daysLeft <= 30;
  if (filter === "medium") return daysLeft > 30 && daysLeft <= 180;
  return daysLeft > 180;
}

// Backend `/api/vaults/yields` returns the ranked USDC lending venues after
// applying the TVL floor + slug allowlist server-side. We surface only the
// three fields the UI renders.
type VaultSource = { name: string; apy: number; live: boolean };

interface YieldsResponse {
  sources: Array<{ name: string; apy: number; live: boolean }>;
  best: { name: string; apy: number; live: boolean } | null;
  fetched_at: number;
  cache_stale: boolean;
}

// Dynamic split: vault grows back to principal by maturity.
function calcDynamicSplit(
  apyDecimal: number,
  days: number,
): { vaultPct: number; basketPct: number } {
  if (apyDecimal <= 0 || days <= 0) return { vaultPct: 0.99, basketPct: 0.01 };
  const dailyRate = apyDecimal / 365;
  const growthFactor = Math.pow(1 + dailyRate, days);
  const vaultPct = 1 / growthFactor;
  return { vaultPct, basketPct: 1 - vaultPct };
}

// ---------------------------------------------------------------------------
// Shared presentational primitives — match the Basket / Tranche theme.
// Card:   C.card background, 0.5px C.border, radius 14, padding 18-20px.
// Labels: FM, 10px, 0.14em letter-spacing, textMuted colour, uppercase.
// ---------------------------------------------------------------------------

const CARD_STYLE: React.CSSProperties = {
  background: C.card,
  border: `0.5px solid ${C.border}`,
  borderRadius: 14,
  padding: "18px 20px",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: FM,
        fontSize: 10,
        letterSpacing: "0.14em",
        color: C.textMuted,
        textTransform: "uppercase",
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
  color,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: string;
}) {
  const accent = color ?? C.tealLight;
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 14px",
        borderRadius: 100,
        cursor: "pointer",
        border: `0.5px solid ${active ? accent : C.border}`,
        background: active ? `${accent}14` : "transparent",
        color: active ? accent : C.textSecondary,
        fontSize: 12,
        fontFamily: FD,
        fontWeight: active ? 500 : 400,
        letterSpacing: "0.01em",
        transition: `all 0.2s ${EASE}`,
      }}
    >
      {children}
    </button>
  );
}

export default function PpnPage() {
  const { state, dispatch } = useSandbox();
  const basketState = useLiveBaskets();
  const { connected, publicKey } = useWallet();
  const appConnected = IS_SUI || connected;
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const wallet = useWalletSigner();
  const usdc = useUsdcBalance();
  const [selectedBundle, setSelectedBundle] = useState<string | null>(null);
  const [amt, setAmt] = useState("");
  const [renderNow, setRenderNow] = useState<number>(() => Date.now());

  // On-chain submission lifecycle mirrors the basket page: stage drives the
  // button label/disabled state while txError + txSignature drive the UI
  // strip beneath the submit button.
  const [txStage, setTxStage] = useState<
    "idle" | "preparing" | "signing" | "confirming" | "persisting" | "done"
  >("idle");
  const [txError, setTxError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);

  // Per-position action state: which vault id is currently redeeming, and
  // any error string to surface on that row. Separate from the deposit
  // lifecycle so a redeem failure doesn't tear down the deposit form.
  const [redeemBusyId, setRedeemBusyId] = useState<string | null>(null);
  const [redeemError, setRedeemError] = useState<Record<string, string>>({});

  const [vaultSources, setVaultSources] = useState<VaultSource[]>([]);
  const [bestVault, setBestVault] = useState<VaultSource | null>(null);
  const [apyLoading, setApyLoading] = useState(true);

  useEffect(() => {
    const t = setInterval(() => setRenderNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Hydrate the PPN + tranche reducer slices from Supabase on connect so the
  // "Your notes" section stays in sync with the portfolio tab regardless of
  // route history.
  useEffect(() => {
    let cancelled = false;
    if (IS_SUI) return () => {
      cancelled = true;
    };
    if (!connected || !publicKey) {
      dispatch({ type: "ppn/hydrate", vaults: [] });
      dispatch({ type: "tranche/hydrate", positions: [] });
      return;
    }
    const walletAddr = publicKey.toBase58();
    (async () => {
      try {
        const portfolio = await fetchPpnPortfolio(walletAddr);
        if (cancelled) return;
        dispatch({ type: "ppn/hydrate", vaults: mergePpnVaults(portfolio) });
        dispatch({
          type: "tranche/hydrate",
          positions: mergeTranches(portfolio),
        });
      } catch {
        // Swallow: portfolio page will retry, shouldn't block the picker.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, dispatch]);

  useEffect(() => {
    let cancelled = false;
    async function fetchApys() {
      if (!cancelled) setApyLoading(true);
      try {
        const res = await fetch(`${BACKEND_URL}/api/vaults/yields`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as YieldsResponse;
        if (cancelled) return;
        const sources: VaultSource[] = (body.sources ?? [])
          .filter((s) => typeof s?.apy === "number" && s.apy > 0)
          .map((s) => ({ name: s.name, apy: s.apy, live: s.live }));
        sources.sort((a, b) => b.apy - a.apy);
        setVaultSources(sources);
        setBestVault(sources[0] ?? null);
      } catch {
        // Leave prior snapshot in place on transient failure.
      } finally {
        if (!cancelled) setApyLoading(false);
      }
    }

    fetchApys();
    const interval = setInterval(fetchApys, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const [bundleTier, setBundleTier] = useState<"all" | 90 | 70 | 50>("all");
  const [bundleTime, setBundleTime] = useState<WindowFilter>("all");

  const liveBaskets: LiveBasket[] =
    basketState.status === "ok" && basketState.baskets.length > 0
      ? basketState.baskets
      : (BUNDLES as unknown as LiveBasket[]);

  const filteredBaskets = useMemo(() => {
    return liveBaskets
      .filter((b) => bundleTier === "all" || b.tier === bundleTier)
      .filter((b) => matchesWindow(b.daysLeft, bundleTime))
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }, [liveBaskets, bundleTier, bundleTime]);

  useEffect(() => {
    if (filteredBaskets.length === 0) {
      if (selectedBundle !== null) setSelectedBundle(null);
      return;
    }
    const stillThere = filteredBaskets.some((b) => b.id === selectedBundle);
    if (!stillThere) setSelectedBundle(filteredBaskets[0].id);
  }, [filteredBaskets, selectedBundle]);

  const APY = bestVault?.apy ?? 0.035;
  const selectedBundleObj =
    liveBaskets.find((b) => b.id === selectedBundle) ??
    filteredBaskets[0] ??
    null;
  const maturityDays = selectedBundleObj?.daysLeft ?? 0;

  const dep = parseFloat(amt) || 0;
  const liveUsdc = usdc.uiAmount;
  const insufficient = appConnected && dep > liveUsdc;
  const txBusy =
    txStage === "preparing" ||
    txStage === "signing" ||
    txStage === "confirming" ||
    txStage === "persisting";
  // Entry fees: 10 bps management + 5 bps strategy, assessed off the top.
  // What's left gets split between the yield vault and the basket sleeve.
  // On redeem, another 5 bps strategy fee is charged — not shown in the
  // deposit breakdown but surfaced in the "How it works" copy below.
  const { vaultPct, basketPct } = calcDynamicSplit(APY, maturityDays);
  const managementFee = dep * MANAGEMENT_FEE_RATE;
  const strategyFee = dep * STRATEGY_FEE_RATE;
  const totalOpenFee = managementFee + strategyFee;
  const netDeposit = Math.max(0, dep - totalOpenFee);
  const vaultAmt = netDeposit * vaultPct;
  const basketAmt = netDeposit * basketPct;
  const vaultAtMaturity = vaultAmt * Math.pow(1 + APY / 365, maturityDays);
  const estimatedYield = vaultAtMaturity - vaultAmt;

  async function handleDeposit() {
    if (!appConnected) {
      setWalletModalVisible(true);
      return;
    }
    if (
      dep <= 0 ||
      insufficient ||
      !selectedBundle ||
      !selectedBundleObj ||
      txBusy
    ) {
      return;
    }
    setTxError(null);
    setTxSignature(null);
    setTxStage("preparing");
    try {
      const result = await ppnDeposit({
        wallet,
        bundleId: selectedBundle,
        amountUsdc: dep,
        maturityDays,
      });
      setTxStage("done");
      setTxSignature(result.signature);
      dispatch({
        type: "ppn/open",
        id: result.prepare.vault_id,
        bundleId: selectedBundle,
        usdcAmount: dep,
        apy: APY * 100,
        maturityDays,
        createdAt: Date.now(),
      });
      void usdc.refresh();
      // Re-hydrate the PPN portfolio from the backend so the "Your
      // Positions" panel picks up the freshly-confirmed note without
      // requiring a tab switch / reload. The optimistic `ppn/open`
      // dispatch above can't be relied on: the reducer's `state.usdc`
      // starts at INITIAL_USDC=0 while the real USDC balance is polled
      // live, so `action.usdcAmount > state.usdc` trips and the open
      // becomes a no-op. This mirrors the post-exit hydrate in
      // `finishExitFlow` so every write path lands on the same
      // refresh guarantee. Fire-and-forget so the done-stage toast +
      // 1.8s timer still fire on schedule for the good path.
      if (!IS_SUI && publicKey) {
        fetchPpnPortfolio(publicKey.toBase58())
          .then((portfolio) => {
            dispatch({ type: "ppn/hydrate", vaults: mergePpnVaults(portfolio) });
            dispatch({
              type: "tranche/hydrate",
              positions: mergeTranches(portfolio),
            });
          })
          .catch((e) => console.warn("post-deposit ppn hydrate failed:", e));
      }
      setTimeout(() => {
        setAmt("");
        setTxStage("idle");
      }, 1800);
    } catch (err) {
      setTxStage("idle");
      if (err instanceof PpnError) {
        setTxError(err.message);
      } else if (err instanceof Error) {
        setTxError(
          /user rejected/i.test(err.message)
            ? "Transaction was rejected in your wallet."
            : err.message,
        );
      } else {
        setTxError(String(err));
      }
    }
  }

  /**
   * Close a full PPN position.
   *
   * One UI row can represent multiple underlying on-chain notes (multiple
   * deposits into the same bundle get merged). `rowKey` identifies the row
   * for error-reporting, and `vaultIds` lists every underlying note to
   * redeem sequentially.
   *
   * The backend `redeem_at_maturity` handler enforces maturity on-chain;
   * pre-maturity calls return 400 and we surface the message on the row.
   */
  /**
   * Shared finish-step for all three exit flows: refresh USDC balance, re-
   * hydrate the PPN portfolio, and wipe the row's error state.
   */
  async function finishExitFlow(rowKey: string) {
    void usdc.refresh();
    if (IS_SUI) {
      dispatch({ type: "ppn/close", vaultId: rowKey, payoutUsdc: 0 });
    } else if (publicKey) {
      const portfolio = await fetchPpnPortfolio(publicKey.toBase58());
      dispatch({ type: "ppn/hydrate", vaults: mergePpnVaults(portfolio) });
      dispatch({
        type: "tranche/hydrate",
        positions: mergeTranches(portfolio),
      });
    }
    setRedeemError((prev) => {
      const next = { ...prev };
      delete next[rowKey];
      return next;
    });
  }

  function handleExitError(rowKey: string, err: unknown) {
    let msg: string;
    if (err instanceof PpnError) msg = err.message;
    else if (err instanceof Error)
      msg = /user rejected/i.test(err.message)
        ? "Transaction was rejected in your wallet."
        : err.message;
    else msg = String(err);
    setRedeemError((prev) => ({ ...prev, [rowKey]: msg }));
  }

  /** Close the position at maturity — full unwind via redeem_at_maturity. */
  async function handleWithdraw(rowKey: string, vaultIds: string[]) {
    if (!appConnected || redeemBusyId) return;
    setRedeemError((prev) => {
      const next = { ...prev };
      delete next[rowKey];
      return next;
    });
    setRedeemBusyId(rowKey);
    try {
      for (const id of vaultIds) {
        // eslint-disable-next-line no-await-in-loop
        await ppnRedeem({ wallet, vaultId: id });
      }
      await finishExitFlow(rowKey);
    } catch (err) {
      handleExitError(rowKey, err);
    } finally {
      setRedeemBusyId(null);
    }
  }

  /** Exit the basket sleeve only; keep principal earning in the vault. */
  async function handleDivest(rowKey: string, vaultIds: string[]) {
    if (!appConnected || redeemBusyId) return;
    setRedeemError((prev) => {
      const next = { ...prev };
      delete next[rowKey];
      return next;
    });
    setRedeemBusyId(rowKey);
    try {
      for (const id of vaultIds) {
        // eslint-disable-next-line no-await-in-loop
        await ppnDivest({ wallet, vaultId: id });
      }
      await finishExitFlow(rowKey);
    } catch (err) {
      handleExitError(rowKey, err);
    } finally {
      setRedeemBusyId(null);
    }
  }

  /** Early full exit: sell basket + pull principal out of the adapter. */
  async function handleClose(rowKey: string, vaultIds: string[]) {
    if (!appConnected || redeemBusyId) return;
    setRedeemError((prev) => {
      const next = { ...prev };
      delete next[rowKey];
      return next;
    });
    setRedeemBusyId(rowKey);
    try {
      for (const id of vaultIds) {
        // eslint-disable-next-line no-await-in-loop
        await ppnCloseEarly({ wallet, vaultId: id });
      }
      await finishExitFlow(rowKey);
    } catch (err) {
      handleExitError(rowKey, err);
    } finally {
      setRedeemBusyId(null);
    }
  }

  /**
   * Sell-all: matured notes use Withdraw (redeem_at_maturity), others use
   * Close (close_early). Skipping Divest in the bulk path intentionally —
   * it's a scalpel, not a hammer.
   */
  async function handleRedeemAll() {
    if (!appConnected || redeemBusyId) return;
    for (const v of state.ppnVaults) {
      const ids = v.allVaultIds ?? [v.id];
      const matured = (v as any).status === "matured";
      // eslint-disable-next-line no-await-in-loop
      if (matured) await handleWithdraw(v.id, ids);
      // eslint-disable-next-line no-await-in-loop
      else await handleClose(v.id, ids);
    }
  }

  const bestVaultLabel = apyLoading
    ? "BEST VAULT APY"
    : bestVault?.name
      ? `BEST VAULT APY · ${bestVault.name}`
      : "BEST VAULT APY";

  return (
    <>
      <Header />
      <PageFrame>
        {/* -------------------- Page header (matches Tranches/Basket) -------- */}
        <section style={{ marginBottom: 22 }}>
          <h1
            style={{
              fontFamily: FD,
              fontSize: "clamp(28px, 3vw, 40px)",
              fontWeight: 400,
              letterSpacing: "-0.024em",
              color: C.textPrimary,
              margin: 0,
            }}
          >
            Principal-protected notes
          </h1>
          <p
            style={{
              fontFamily: FS,
              fontSize: 13.5,
              color: C.textSubtle,
              margin: "8px 0 0",
              lineHeight: 1.65,
              maxWidth: 720,
            }}
          >
            Deposit USDC, get principal back at maturity. We park most of it in
            the highest-yielding USDC vault on {IS_SUI ? "Sui testnet" : "Solana"}, and put the rest into a
            basket for upside. Your deposit is guaranteed, the basket is the only
            part that can move.
          </p>
        </section>

        {/* -------------------- Top metric tiles ---------------------------- */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 14,
            marginBottom: 20,
          }}
        >
          <MetricTile
            label="PRINCIPAL"
            value="100% guaranteed"
            color={C.teal}
            sub="returned at maturity"
          />
          <MetricTile
            label={bestVaultLabel}
            value={apyLoading ? "Loading…" : `${(APY * 100).toFixed(2)}%`}
            color={C.green}
            sub={
              apyLoading
                ? "scanning vaults"
                : `${bestVault?.live ? "live rate" : "estimated"} · auto-selected`
            }
          />
        </div>

        {/* -------------------- Two-column body ----------------------------- */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 360px",
            alignItems: "start",
            gap: 20,
          }}
          className="ppn-body-grid"
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              minWidth: 0,
            }}
          >
            {/* -------- Vault routing -------- */}
            <div style={CARD_STYLE}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 14,
                  gap: 16,
                }}
              >
                <div
                  style={{
                    fontFamily: FM,
                    fontSize: 10,
                    letterSpacing: "0.14em",
                    color: C.textMuted,
                    textTransform: "uppercase",
                  }}
                >
                  Vault routing
                </div>
                <div
                  style={{
                    fontFamily: FM,
                    fontSize: 10.5,
                    color: C.textSubtle,
                    letterSpacing: "0.02em",
                  }}
                >
                  {vaultSources.length > 0
                    ? `${vaultSources.length} pools scanned · auto-routed to best`
                    : "scanning pools…"}
                </div>
              </div>

              {vaultSources.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  {vaultSources.map((v, i) => {
                    const isBest = i === 0;
                    return (
                      <div
                        key={v.name}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "8px 12px",
                          borderRadius: 8,
                          background: isBest
                            ? "rgba(45, 212, 191, 0.06)"
                            : "transparent",
                          border: `0.5px solid ${
                            isBest
                              ? "rgba(45, 212, 191, 0.22)"
                              : "rgba(255,255,255,0.04)"
                          }`,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {isBest && (
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: C.tealLight,
                              }}
                            />
                          )}
                          <span
                            style={{
                              fontSize: 12,
                              color: isBest ? C.textPrimary : C.textSecondary,
                              fontFamily: FD,
                              fontWeight: isBest ? 500 : 400,
                            }}
                          >
                            {v.name}
                          </span>
                          {isBest && (
                            <span
                              style={{
                                fontSize: 9,
                                color: C.tealLight,
                                fontFamily: FM,
                                letterSpacing: "0.14em",
                                padding: "1px 6px",
                                border: `0.5px solid ${C.tealLight}44`,
                                borderRadius: 3,
                              }}
                            >
                              BEST
                            </span>
                          )}
                        </div>
                        <span
                          style={{
                            fontSize: 12,
                            color: isBest ? C.tealLight : C.textSecondary,
                            fontFamily: FM,
                            fontWeight: isBest ? 600 : 400,
                          }}
                        >
                          {(v.apy * 100).toFixed(2)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div
                style={{
                  marginTop: 16,
                  padding: "14px 16px 16px",
                  borderRadius: 10,
                  background: C.surface,
                  border: `0.5px solid ${C.border}`,
                }}
              >
                {/* Top row: three stat columns */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    marginBottom: 14,
                  }}
                >
                  {(
                    [
                      ["Vault", `${(vaultPct * 100).toFixed(2)}%`, C.tealLight],
                      ["Basket", `${(basketPct * 100).toFixed(2)}%`, C.amber],
                      ["Maturity", `${maturityDays}d`, C.textStrong],
                    ] as const
                  ).map(([label, value, color]) => (
                    <div key={label}>
                      <div
                        style={{
                          fontSize: 9.5,
                          color: C.textMuted,
                          fontFamily: FM,
                          letterSpacing: "0.16em",
                          textTransform: "uppercase",
                          marginBottom: 4,
                        }}
                      >
                        {label}
                      </div>
                      <div
                        style={{
                          fontSize: 15,
                          color,
                          fontFamily: FD,
                          fontWeight: 500,
                          letterSpacing: "-0.005em",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {value}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Always-visible split bar (vault vs basket ratio) */}
                <div
                  style={{
                    display: "flex",
                    height: 6,
                    borderRadius: 3,
                    overflow: "hidden",
                    background: C.border,
                  }}
                >
                  <div
                    style={{
                      width: `${vaultPct * 100}%`,
                      background: C.tealLight,
                    }}
                  />
                  <div
                    style={{
                      width: `${basketPct * 100}%`,
                      background: C.amber,
                    }}
                  />
                </div>

                {/* Dollar split appears once a deposit amount is entered */}
                {dep > 0 && (
                  <div
                    style={{
                      marginTop: 8,
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 11,
                      fontFamily: FM,
                      letterSpacing: "0.02em",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <span style={{ color: C.tealLight }}>
                      {fmtUsd(vaultAmt, 0)} vault
                    </span>
                    <span style={{ color: C.amber }}>
                      {fmtUsd(basketAmt, 0)} basket
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* -------- Basket picker -------- */}
            <div
              style={{
                ...CARD_STYLE,
                display: "flex",
                flexDirection: "column",
              }}
            >
              {/* Header row: section label + inline filters on the right */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 14,
                  gap: 16,
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    fontFamily: FM,
                    fontSize: 10,
                    letterSpacing: "0.14em",
                    color: C.textMuted,
                    textTransform: "uppercase",
                  }}
                >
                  Reference basket
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  <FilterPill
                    active={bundleTier === "all"}
                    onClick={() => {
                      setBundleTier("all");
                      setBundleTime("all");
                    }}
                  >
                    All
                  </FilterPill>
                  {([90, 70, 50] as const).map((t) => {
                    const tierLabel = { 90: "High", 70: "Mid", 50: "Low" }[t];
                    return (
                      <FilterPill
                        key={t}
                        active={bundleTier === t}
                        color={tc(t)}
                        onClick={() => {
                          setBundleTier(t);
                          setBundleTime("all");
                        }}
                      >
                        {tierLabel}
                      </FilterPill>
                    );
                  })}
                  <span
                    style={{
                      width: 1,
                      alignSelf: "stretch",
                      background: C.border,
                      margin: "0 4px",
                    }}
                  />
                  {(
                    [
                      ["all", "All"],
                      ["short", "Short"],
                      ["medium", "Medium"],
                      ["long", "Long"],
                    ] as const
                  ).map(([key, label]) => (
                    <FilterPill
                      key={key}
                      active={bundleTime === key}
                      onClick={() => setBundleTime(key)}
                    >
                      {label}
                    </FilterPill>
                  ))}
                </div>
              </div>

              {/* List states */}
              {basketState.status === "loading" && (
                <div
                  style={{
                    textAlign: "center",
                    color: C.textMuted,
                    fontSize: 12,
                    fontFamily: FS,
                    padding: "24px 0",
                  }}
                >
                  Loading live baskets…
                </div>
              )}
              {basketState.status === "error" && (
                <div
                  style={{
                    textAlign: "center",
                    color: C.red,
                    fontSize: 12,
                    fontFamily: FS,
                    padding: "24px 0",
                  }}
                >
                  Couldn&apos;t load live baskets: {basketState.error}
                </div>
              )}
              {basketState.status === "ok" && filteredBaskets.length === 0 && (
                <div
                  style={{
                    textAlign: "center",
                    color: C.textMuted,
                    fontSize: 12,
                    fontFamily: FS,
                    padding: "24px 0",
                  }}
                >
                  No baskets match these filters.
                </div>
              )}
              {basketState.status === "ok" && filteredBaskets.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {filteredBaskets.map((b) => {
                    const active = selectedBundle === b.id;
                    const tierAccent = tc(b.tier);
                    return (
                      <button
                        key={b.id}
                        onClick={() => setSelectedBundle(b.id)}
                        style={{
                          textAlign: "left",
                          display: "grid",
                          gridTemplateColumns: "auto minmax(0, 1fr) auto",
                          alignItems: "center",
                          gap: 14,
                          background: active ? C.cardHover : C.surface,
                          border: `0.5px solid ${
                            active ? `${tierAccent}66` : C.border
                          }`,
                          borderRadius: 12,
                          padding: "14px 16px",
                          cursor: "pointer",
                          transition: `all 0.15s ${EASE}`,
                          boxShadow: active
                            ? `inset 3px 0 0 ${tierAccent}`
                            : `inset 3px 0 0 ${tierAccent}55`,
                        }}
                      >
                        <span style={{ width: 0 }} />
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: C.textPrimary,
                              fontFamily: FD,
                              letterSpacing: "-0.005em",
                              marginBottom: 4,
                            }}
                          >
                            {b.id}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: C.textDim,
                              fontFamily: FM,
                              letterSpacing: "0.04em",
                            }}
                          >
                            {b.totalLegs} legs · NAV{" "}
                            {(b.nav * 100).toFixed(1)}% · resolves {b.date}
                          </div>
                        </div>
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            minWidth: 52,
                            padding: "5px 10px",
                            borderRadius: 7,
                            background: `${tierAccent}14`,
                            border: `0.5px solid ${tierAccent}33`,
                            fontSize: 11,
                            color: tierAccent,
                            fontFamily: FM,
                            fontWeight: 600,
                            letterSpacing: "0.04em",
                            whiteSpace: "nowrap",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {b.daysLeft}d
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* -------- Your positions -------- */}
            {state.ppnVaults.length > 0 && (
              <div style={CARD_STYLE}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 14,
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      fontFamily: FM,
                      fontSize: 10,
                      letterSpacing: "0.14em",
                      color: C.textMuted,
                      textTransform: "uppercase",
                    }}
                  >
                    Your positions
                  </div>
                  <button
                    type="button"
                    onClick={handleRedeemAll}
                    disabled={!appConnected || !!redeemBusyId}
                    style={{
                      padding: "5px 12px",
                      borderRadius: 6,
                      border: `0.5px solid ${
                        !appConnected || !!redeemBusyId
                          ? C.border
                          : `${C.violet}55`
                      }`,
                      background:
                        !appConnected || !!redeemBusyId
                          ? "transparent"
                          : `${C.violet}14`,
                      color:
                        !appConnected || !!redeemBusyId
                          ? C.textMuted
                          : C.violet,
                      fontFamily: FD,
                      fontSize: 11,
                      fontWeight: 500,
                      letterSpacing: "0.02em",
                      cursor:
                        !appConnected || !!redeemBusyId
                          ? "not-allowed"
                          : "pointer",
                      transition: `all 0.15s ${EASE}`,
                    }}
                  >
                    Sell all
                  </button>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {state.ppnVaults.map((v) => {
                    const liveBasket = liveBaskets.find(
                      (b) => b.id === v.bundleId,
                    );
                    const b = liveBasket ?? bundleById(v.bundleId);
                    const elapsed = Math.max(
                      0,
                      (renderNow - v.createdAt) / 86_400_000,
                    );
                    const daysLeft = Math.max(
                      0,
                      v.maturityDays - Math.floor(elapsed),
                    );
                    const accrued =
                      v.principal *
                      (v.apy / 100 / 365) *
                      Math.min(elapsed, v.maturityDays);
                    const matured = daysLeft <= 0;
                    const vaultIds = v.allVaultIds ?? [v.id];
                    const busy = redeemBusyId === v.id;
                    const rowError = redeemError[v.id];
                    return (
                      <div
                        key={v.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "auto 1fr auto",
                          alignItems: "center",
                          gap: 14,
                          padding: "12px 14px",
                          background: C.surface,
                          border: `0.5px solid rgba(255,255,255,0.05)`,
                          borderRadius: 10,
                          boxShadow: `inset 3px 0 0 ${C.violet}`,
                        }}
                      >
                        <span style={{ width: 0 }} />
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "baseline",
                              gap: 10,
                              marginBottom: 4,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 13,
                                color: C.textPrimary,
                                fontFamily: FD,
                                fontWeight: 600,
                                letterSpacing: "-0.005em",
                              }}
                            >
                              {b?.id ?? v.bundleId}
                            </span>
                            <span
                              style={{
                                fontSize: 10.5,
                                color: matured ? C.green : C.textDim,
                                fontFamily: FM,
                                letterSpacing: "0.04em",
                              }}
                            >
                              {matured ? "matured" : `${daysLeft}d to maturity`}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: C.textSubtle,
                              fontFamily: FM,
                              letterSpacing: "0.02em",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {fmtUsd(v.principal, 2)} principal · +
                            {fmtUsd(accrued, 2)} accrued · {v.apy.toFixed(2)}%
                            APY
                          </div>
                          {rowError && (
                            <div
                              style={{
                                fontSize: 11,
                                color: C.red,
                                fontFamily: FS,
                                marginTop: 4,
                                letterSpacing: "0.01em",
                              }}
                            >
                              {rowError}
                            </div>
                          )}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: 6,
                            alignItems: "center",
                          }}
                        >
                          <button
                            type="button"
                            disabled={!appConnected || busy || !matured}
                            onClick={() => handleWithdraw(v.id, vaultIds)}
                            title={
                              matured
                                ? "Close position, withdraw principal + yield + basket"
                                : "Available once the note matures"
                            }
                            style={{
                              padding: "6px 12px",
                              borderRadius: 7,
                              border: `0.5px solid ${
                                !appConnected || busy || !matured
                                  ? C.border
                                  : `${C.tealLight}55`
                              }`,
                              background:
                                !appConnected || busy || !matured
                                  ? "transparent"
                                  : `${C.tealLight}14`,
                              color:
                                !appConnected || busy || !matured
                                  ? C.textMuted
                                  : C.tealLight,
                              fontFamily: FD,
                              fontSize: 11,
                              fontWeight: 500,
                              letterSpacing: "0.02em",
                              whiteSpace: "nowrap",
                              cursor:
                                !appConnected || busy || !matured
                                  ? "not-allowed"
                                  : "pointer",
                              transition: `all 0.15s ${EASE}`,
                            }}
                          >
                            {busy ? "…" : "Withdraw"}
                          </button>
                          <button
                            type="button"
                            disabled={!appConnected || busy}
                            onClick={() => handleDivest(v.id, vaultIds)}
                            title="Sell only the basket sleeve; keep principal in the yield vault"
                            style={{
                              padding: "6px 12px",
                              borderRadius: 7,
                              border: `0.5px solid ${
                                !appConnected || busy
                                  ? C.border
                                  : C.borderHover
                              }`,
                              background: "transparent",
                              color:
                                !appConnected || busy
                                  ? C.textMuted
                                  : C.textSubtle,
                              fontFamily: FD,
                              fontSize: 11,
                              fontWeight: 500,
                              letterSpacing: "0.02em",
                              whiteSpace: "nowrap",
                              cursor:
                                !appConnected || busy
                                  ? "not-allowed"
                                  : "pointer",
                              transition: `all 0.15s ${EASE}`,
                            }}
                          >
                            Divest
                          </button>
                          <button
                            type="button"
                            disabled={!appConnected || busy}
                            onClick={() => handleClose(v.id, vaultIds)}
                            title="Close the position early: sell basket, unwind vault, return proceeds"
                            style={{
                              padding: "6px 12px",
                              borderRadius: 7,
                              border: `0.5px solid ${
                                !appConnected || busy
                                  ? C.border
                                  : `${C.red}55`
                              }`,
                              background:
                                !appConnected || busy
                                  ? "transparent"
                                  : `${C.red}14`,
                              color:
                                !appConnected || busy
                                  ? C.textMuted
                                  : C.red,
                              fontFamily: FD,
                              fontSize: 11,
                              fontWeight: 500,
                              letterSpacing: "0.02em",
                              whiteSpace: "nowrap",
                              cursor:
                                !appConnected || busy
                                  ? "not-allowed"
                                  : "pointer",
                              transition: `all 0.15s ${EASE}`,
                            }}
                          >
                            Close
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* -------- Right panel: deposit form + how it works -------- */}
          <div
            style={{
              ...CARD_STYLE,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: C.textPrimary,
                  fontFamily: FD,
                  letterSpacing: "-0.005em",
                }}
              >
                New PPN
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: C.textMuted,
                  fontFamily: FM,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                {appConnected ? (
                  <>
                    <span>Balance </span>
                    <span
                      style={{
                        color: C.textStrong,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {usdc.loading && liveUsdc === 0
                        ? "…"
                        : `$${liveUsdc.toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })}`}
                    </span>
                  </>
                ) : (
                  <span>Connect wallet</span>
                )}
              </div>
            </div>

            <div
              style={{
                fontSize: 10,
                color: C.textMuted,
                fontFamily: FM,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                marginBottom: 7,
              }}
            >
              Deposit USDC
            </div>
            <input
              type="number"
              inputMode="decimal"
              placeholder="0"
              value={amt}
              onChange={(e) => {
                setAmt(e.target.value);
                if (txStage === "done") {
                  setTxStage("idle");
                  setTxSignature(null);
                }
                if (txError) setTxError(null);
              }}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "12px 14px",
                fontSize: 20,
                fontFamily: FD,
                fontWeight: 500,
                background: C.surface,
                border: `0.5px solid ${
                  insufficient ? C.red : "rgba(255, 255, 255, 0.08)"
                }`,
                borderRadius: 10,
                color: C.textPrimary,
                marginBottom: insufficient ? 6 : 14,
                outline: "none",
                fontVariantNumeric: "tabular-nums",
              }}
            />
            {insufficient && (
              <div
                style={{
                  fontSize: 11,
                  color: C.red,
                  fontFamily: FS,
                  marginBottom: 10,
                }}
              >
                Insufficient balance
              </div>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 10,
                color: C.textMuted,
                fontFamily: FM,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                marginBottom: 14,
              }}
            >
              <span>Maturity</span>
              <span
                style={{
                  color: C.textStrong,
                  fontSize: 11.5,
                  letterSpacing: "0.02em",
                  textTransform: "none",
                  fontFamily: FD,
                }}
              >
                {maturityDays}d · auto from basket
              </span>
            </div>

            {/* Split breakdown */}
            <div
              style={{
                background: C.surface,
                border: `0.5px solid ${C.border}`,
                borderRadius: 10,
                padding: "14px 16px",
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: C.textMuted,
                    fontFamily: FM,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                  }}
                >
                  Breakdown
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: C.textSecondary,
                    fontFamily: FM,
                    letterSpacing: "0.02em",
                  }}
                >
                  {maturityDays}d @ {(APY * 100).toFixed(2)}%
                  {bestVault?.name ? ` · ${bestVault.name}` : ""}
                </div>
              </div>
              {(
                [
                  [
                    "Management fee",
                    dep > 0 ? `${fmtUsd(managementFee, 2)} (0.10%)` : "0.10%",
                    C.textSubtle,
                  ],
                  [
                    "Creation fee",
                    dep > 0 ? `${fmtUsd(strategyFee, 2)} (0.05%)` : "0.05%",
                    C.textSubtle,
                  ],
                  [
                    "Redemption fee",
                    dep > 0
                      ? `${fmtUsd(dep * STRATEGY_FEE_RATE, 2)} (0.05%)`
                      : "0.05% at exit",
                    C.textDim,
                  ],
                  [
                    "Vault principal",
                    dep > 0 ? fmtUsd(vaultAmt, 2) : "—",
                    C.tealLight,
                  ],
                  [
                    "Basket upside",
                    dep > 0 ? fmtUsd(basketAmt, 2) : "—",
                    C.amber,
                  ],
                  [
                    "Vault yield",
                    dep > 0 ? `+${fmtUsd(estimatedYield, 2)}` : "—",
                    C.green,
                  ],
                  [
                    "Minimum return",
                    dep > 0 ? fmtUsd(netDeposit, 2) : "—",
                    C.textStrong,
                  ],
                ] as const
              ).map(([k, v, c], i, arr) => (
                <div
                  key={k}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: 12.5,
                    fontFamily: FS,
                    marginBottom: i === arr.length - 1 ? 0 : 9,
                  }}
                >
                  <span style={{ color: C.textSubtle }}>{k}</span>
                  <span
                    style={{
                      color: c,
                      fontFamily: FD,
                      fontWeight: 500,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {v}
                  </span>
                </div>
              ))}
            </div>

            {(() => {
              const disabled =
                (appConnected && (insufficient || dep <= 0 || !selectedBundle)) ||
                txBusy ||
                txStage === "done";
              const label = !appConnected
                ? "Connect wallet"
                : !selectedBundle
                  ? "Pick a basket first"
                  : dep <= 0
                    ? "Enter an amount"
                    : insufficient
                      ? "Insufficient USDC"
                      : txStage === "preparing"
                        ? "Preparing transaction…"
                        : txStage === "signing"
                          ? "Awaiting wallet signature…"
                          : txStage === "confirming"
                            ? IS_SUI ? "Confirming on Sui…" : "Confirming on Solana…"
                            : txStage === "persisting"
                              ? "Finalising…"
                              : txStage === "done"
                                ? "✓ PPN opened"
                                : "Open PPN";
              const bg =
                txStage === "done"
                  ? C.green
                  : disabled
                    ? "rgba(255,255,255,0.04)"
                    : C.violet;
              const color =
                disabled && txStage !== "done" ? C.textMuted : "#fff";
              const border =
                disabled && txStage !== "done"
                  ? `0.5px solid rgba(255,255,255,0.06)`
                  : "none";
              return (
                <button
                  onClick={handleDeposit}
                  disabled={disabled}
                  style={{
                    width: "100%",
                    padding: "11px 0",
                    borderRadius: 10,
                    border,
                    background: bg,
                    color,
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: FD,
                    letterSpacing: "0.01em",
                    cursor: disabled ? "not-allowed" : "pointer",
                    transition: `all 0.15s ${EASE}`,
                  }}
                >
                  {label}
                </button>
              );
            })()}

            {txError && (
              <div
                style={{
                  fontFamily: FM,
                  fontSize: 11,
                  lineHeight: 1.45,
                  color: C.red,
                  background: C.redBg,
                  border: `0.5px solid ${C.red}33`,
                  borderRadius: 8,
                  padding: "8px 12px",
                  marginTop: 10,
                  letterSpacing: "0.02em",
                }}
              >
                {txError}
              </div>
            )}
            {txSignature && (
              <a
                href={explorerTxUrl(txSignature)}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "block",
                  fontFamily: FM,
                  fontSize: 11,
                  color: C.violet,
                  background: C.violetBg,
                  border: `0.5px solid ${C.violet}33`,
                  borderRadius: 8,
                  padding: "8px 12px",
                  marginTop: 10,
                  letterSpacing: "0.04em",
                  fontWeight: 500,
                  textAlign: "center",
                  textDecoration: "none",
                }}
              >
                View on {IS_SUI ? "Sui" : "Solana"} Explorer ↗
              </a>
            )}
            <div
              style={{
                fontSize: 10,
                color: C.textMuted,
                fontFamily: FM,
                textAlign: "center",
                marginTop: 12,
                letterSpacing: "0.06em",
                lineHeight: 1.5,
              }}
            >
              Split auto-calculated · principal guaranteed at maturity
            </div>

            {/* ---- How it works ---- */}
            <div
              style={{
                marginTop: 20,
                paddingTop: 18,
                borderTop: `0.5px solid rgba(255,255,255,0.06)`,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    fontFamily: FM,
                    fontSize: 10,
                    letterSpacing: "0.18em",
                    color: C.textMuted,
                    fontWeight: 500,
                    textTransform: "uppercase",
                  }}
                >
                  How it works
                </span>
                <span
                  style={{
                    flex: 1,
                    height: 1,
                    background: C.border,
                  }}
                />
              </div>
              <ol
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {HOW_IT_WORKS.map((step) => (
                  <li
                    key={step.num}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "24px 1fr",
                      columnGap: 12,
                      rowGap: 3,
                      alignItems: "baseline",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: FM,
                        fontSize: 10,
                        fontWeight: 500,
                        letterSpacing: "0.1em",
                        color: C.violet,
                        paddingTop: 2,
                        opacity: 0.85,
                      }}
                    >
                      {step.num}
                    </div>
                    <div
                      style={{
                        fontFamily: FD,
                        fontSize: 12.5,
                        fontWeight: 500,
                        color: C.textPrimary,
                        letterSpacing: "-0.002em",
                      }}
                    >
                      {step.title}
                    </div>
                    <div />
                    <div
                      style={{
                        fontFamily: FS,
                        fontSize: 11.5,
                        lineHeight: 1.55,
                        color: C.textDim,
                        fontWeight: 400,
                      }}
                    >
                      {step.body}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>

        <style>{PPN_CSS}</style>
      </PageFrame>
    </>
  );
}

const PPN_CSS = `
  @media (max-width: 900px) {
    .ppn-body-grid {
      grid-template-columns: minmax(0, 1fr) !important;
    }
  }
`;
