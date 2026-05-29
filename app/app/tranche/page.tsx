"use client";

import React, { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Header, PageFrame } from "../_components/Header";
import { C, FS, FD, FM, EASE, trancheColor, tc, tl } from "../_lib/tokens";
import { BUNDLES } from "../_lib/bundles";
import { useLiveBaskets, formatYieldPct } from "../_lib/use-live-baskets";
import { computeBasketStats, quoteTranchesFromStats, type TrancheQuote } from "./_quote";
import type { LiveBasket } from "../_lib/live-baskets";

const TIER_LABEL: Record<90 | 70 | 50, string> = {
  90: "High probability",
  70: "Mid probability",
  50: "Low probability",
};

export default function TranchesPage() {
  const router = useRouter();
  const state = useLiveBaskets();

  const groups = useMemo(() => {
    const empty: Record<90 | 70 | 50, LiveBasket[]> = { 90: [], 70: [], 50: [] };
    const baskets =
      state.status === "ok" && state.baskets.length > 0
        ? state.baskets
        : BUNDLES.map((b) => ({
            ...b,
            live: true as const,
            window: (tl(b.daysLeft) === "This week"
              ? "week"
              : tl(b.daysLeft) === "This month"
                ? "month"
                : "long") as "week" | "month" | "long",
            markets: [],
          }) as unknown as LiveBasket);
    for (const b of baskets) empty[b.tier].push(b);
    const winOrder: Record<"week" | "month" | "long", number> = {
      week: 0,
      month: 1,
      long: 2,
    };
    for (const t of [90, 70, 50] as const) {
      empty[t].sort((a, b) => winOrder[a.window] - winOrder[b.window]);
    }
    return empty;
  }, [state]);

  return (
    <>
      <Header />
      <PageFrame>
        <section style={{ marginBottom: 20 }}>
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
            Tranches
          </h1>
          <p
            style={{
              fontFamily: FS,
              fontSize: 13,
              color: C.textSecondary,
              margin: "6px 0 0",
              lineHeight: 1.55,
            }}
          >
            Each basket mints three yield tokens stacked by risk —{" "}
            <span style={{ color: trancheColor("senior") }}>senior</span> gets
            paid first at a low fixed APY,{" "}
            <span style={{ color: trancheColor("mezzanine") }}>mezzanine</span>{" "}
            sits in the balanced middle sleeve, and{" "}
            <span style={{ color: trancheColor("junior") }}>junior</span> takes
            the first loss but keeps all the upside when the basket
            overperforms. Pick the sleeve that matches your risk appetite,
            deposit USDC, and earn the annualized yield shown on the right of
            each row once the basket resolves.
          </p>
        </section>

        {state.status === "loading" && <LoadingGrid />}
        {state.status === "error" && (
          <EmptyState title="Couldn't load live baskets" subtitle={state.error} />
        )}
        {state.status === "ok" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            {([90, 70, 50] as const).map((t) => {
              const baskets = groups[t];
              if (baskets.length === 0) return null;
              return (
                <TierGroup
                  key={t}
                  tier={t}
                  baskets={baskets}
                  onClick={(b) => router.push(`/app/tranche/${b.id}`)}
                />
              );
            })}
          </div>
        )}
      </PageFrame>
    </>
  );
}

/* ---------- Tier group (header + basket row) ---------- */

function TierGroup({
  tier,
  baskets,
  onClick,
}: {
  tier: 90 | 70 | 50;
  baskets: LiveBasket[];
  onClick: (b: LiveBasket) => void;
}) {
  const color = tc(tier);
  return (
    <section>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: color,
            boxShadow: `0 0 10px ${color}80`,
          }}
        />
        <span
          style={{
            fontFamily: FM,
            fontSize: 10,
            letterSpacing: "0.22em",
            color,
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          {TIER_LABEL[tier]}
        </span>
        <span style={{ flex: 1, height: 1, background: C.border }} />
        <span
          style={{
            fontFamily: FM,
            fontSize: 10,
            letterSpacing: "0.1em",
            color: C.textMuted,
          }}
        >
          {baskets.length} basket{baskets.length === 1 ? "" : "s"}
        </span>
      </header>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 14,
        }}
        className="tranche-grid"
      >
        {baskets.map((b) => (
          <BasketTrancheCard key={b.id} basket={b} onClick={() => onClick(b)} />
        ))}
      </div>
      <style>{`
        @media (max-width: 1000px) {
          .tranche-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
        @media (max-width: 640px) {
          .tranche-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}

/* ---------- Basket card ----------
 *
 * Compact tranche pricing card. Three parts from top to bottom:
 *   1. Header (basket id + meta + horizon pill)
 *   2. Distribution band — colored bar showing senior/mezz/junior
 *      widths on the outcome axis with the NAV tick anchored above.
 *   3. Three tranche rows with kind, attach/detach, price, APY.
 *
 * The band is the new bit — gives an instant read on where the
 * tranche split lives for this basket. Widths scale with σ so HIGH
 * tier baskets read as "mostly senior", LOW tier baskets as "mostly
 * junior", and MID as balanced.
 */
function BasketTrancheCard({
  basket,
  onClick,
}: {
  basket: LiveBasket;
  onClick: () => void;
}) {
  const color = tc(basket.tier);
  const { stats, quotes } = useMemo(() => {
    const s = computeBasketStats(
      basket.nav,
      basket.markets,
      basket.totalLegs,
      basket.daysLeft,
      basket.tier,
    );
    return { stats: s, quotes: quoteTranchesFromStats(s) };
  }, [basket.nav, basket.markets, basket.totalLegs, basket.daysLeft, basket.tier]);

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        background: C.card,
        border: `0.5px solid ${C.border}`,
        borderRadius: 14,
        padding: "16px 18px 14px",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        transition: `transform 0.15s ${EASE}, border-color 0.15s ${EASE}, background 0.15s ${EASE}`,
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = C.cardHover;
        el.style.borderColor = C.borderHover;
        el.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = C.card;
        el.style.borderColor = C.border;
        el.style.transform = "translateY(0)";
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 10,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: color,
                flexShrink: 0,
              }}
            />
            <div
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: C.textPrimary,
                fontFamily: FD,
                letterSpacing: "0.01em",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {basket.id}
            </div>
          </div>
          {/* Meta line: three discrete stats separated by flex gap, not
              middots. Window label is dropped because the section header
              above already says "High probability · N baskets" and the
              horizon pill on the right of the card carries the day
              count. */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 14,
              rowGap: 4,
              marginTop: 6,
              fontSize: 11,
              fontFamily: FM,
              color: C.textMuted,
              letterSpacing: "0.02em",
            }}
          >
            <span>{basket.totalLegs} legs</span>
            <span>
              NAV{" "}
              <span style={{ color: C.textSecondary }}>
                {(basket.nav * 100).toFixed(1)}%
              </span>
            </span>
            <span>
              σ{" "}
              <span style={{ color: C.textSecondary }}>
                {(stats.sigma * 100).toFixed(2)}%
              </span>
            </span>
          </div>
        </div>
        <div
          style={{
            fontSize: 11,
            color,
            fontFamily: FM,
            fontWeight: 500,
            letterSpacing: "0.08em",
            whiteSpace: "nowrap",
          }}
        >
          {basket.daysLeft}d
        </div>
      </div>

      <DistributionBand quotes={quotes} nav={basket.nav} />

      <div style={{ display: "flex", flexDirection: "column" }}>
        {quotes.map((q, i) => (
          <TrancheRow key={q.kind} quote={q} isFirst={i === 0} />
        ))}
      </div>
    </div>
  );
}

/**
 * Thin segmented bar showing where each tranche sits on the outcome
 * axis. Widths are proportional to notional share, colored by tranche,
 * with a subtle tick at the basket's NAV. Deliberately minimal — the
 * meta line above already surfaces NAV and σ numerically, so the band
 * is pure visual reinforcement (not a second copy of the same data).
 */
function DistributionBand({
  quotes,
  nav,
}: {
  quotes: TrancheQuote[];
  nav: number;
}) {
  const senior = quotes.find((q) => q.kind === "senior")!;
  const mezz = quotes.find((q) => q.kind === "mezzanine")!;
  const junior = quotes.find((q) => q.kind === "junior")!;
  const navPct = Math.max(0, Math.min(100, nav * 100));

  const segments: Array<{ pct: number; color: string; title: string }> = [
    {
      pct: senior.notionalShare * 100,
      color: trancheColor("senior"),
      title: `Senior · 0–${(senior.detach * 100).toFixed(0)}%`,
    },
    {
      pct: mezz.notionalShare * 100,
      color: trancheColor("mezzanine"),
      title: `Mezzanine · ${(mezz.attach * 100).toFixed(0)}–${(mezz.detach * 100).toFixed(0)}%`,
    },
    {
      pct: junior.notionalShare * 100,
      color: trancheColor("junior"),
      title: `Junior · ${(junior.attach * 100).toFixed(0)}–100%`,
    },
  ];

  return (
    <div style={{ position: "relative", height: 6 }}>
      <div
        style={{
          display: "flex",
          height: 6,
          gap: 2,
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        {segments.map((s, i) => (
          <div
            key={i}
            title={s.title}
            style={{
              width: `${s.pct}%`,
              background: s.color,
              opacity: 0.72,
              borderRadius: 3,
            }}
          />
        ))}
      </div>
      {/* NAV tick — subtle, sits above the bar. */}
      <div
        aria-hidden
        title={`μ ${(nav * 100).toFixed(1)}%`}
        style={{
          position: "absolute",
          top: -2,
          left: `${navPct}%`,
          transform: "translateX(-50%)",
          width: 1.5,
          height: 10,
          background: C.textPrimary,
          opacity: 0.7,
          borderRadius: 1,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

/**
 * Single tranche row. Two columns: on the left the kind label (small
 * caps, tier-colored) with the attach–detach range just below; on the
 * right the market price in display font and the APY in mono, both
 * right-aligned so they tabulate across the three rows. A thin top
 * divider separates rows — no nested surfaces, no drop shadows, no
 * coloured dots to the left. The row reads as a clean data line.
 */
function TrancheRow({
  quote,
  isFirst,
}: {
  quote: TrancheQuote;
  isFirst: boolean;
}) {
  const color = trancheColor(quote.kind);
  const attach = Math.round(quote.attach * 100);
  const detach = Math.round(quote.detach * 100);
  const apyColor =
    quote.expectedApyPct >= 50
      ? C.green
      : quote.expectedApyPct >= 10
        ? C.tealLight
        : quote.expectedApyPct >= 0
          ? C.textSecondary
          : C.red;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "12px 0",
        borderTop: isFirst ? "none" : `0.5px solid ${C.border}`,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span
          style={{
            fontSize: 10.5,
            fontFamily: FM,
            letterSpacing: "0.18em",
            color,
            fontWeight: 600,
            textTransform: "uppercase",
          }}
        >
          {quote.kind}
        </span>
        <span
          style={{
            fontSize: 10.5,
            fontFamily: FM,
            letterSpacing: "0.04em",
            color: C.textMuted,
          }}
        >
          {attach}–{detach}%
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 16,
        }}
      >
        <span
          style={{
            fontFamily: FD,
            fontSize: 14,
            fontWeight: 500,
            letterSpacing: "-0.005em",
            color: C.textPrimary,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          ${quote.marketPrice.toFixed(4)}
        </span>
        <span
          style={{
            fontFamily: FM,
            fontSize: 11.5,
            fontWeight: 600,
            color: apyColor,
            letterSpacing: "0.01em",
            minWidth: 92,
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatYieldPct(quote.expectedApyPct)}
          <span
            style={{
              color: C.textMuted,
              fontWeight: 500,
              marginLeft: 5,
              letterSpacing: "0.06em",
            }}
          >
            APY
          </span>
        </span>
      </div>
    </div>
  );
}

/* ---------- Loading / empty ---------- */

function LoadingGrid() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
        gap: 14,
      }}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 240,
            background: C.card,
            border: `0.5px solid ${C.border}`,
            borderRadius: 14,
            opacity: 0.45,
          }}
        />
      ))}
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div
      style={{
        padding: "48px 24px",
        textAlign: "center",
        background: C.card,
        border: `0.5px solid ${C.border}`,
        borderRadius: 14,
      }}
    >
      <div
        style={{
          fontFamily: FD,
          fontSize: 16,
          color: C.textPrimary,
          fontWeight: 500,
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: FS,
          fontSize: 12,
          color: C.textSecondary,
          maxWidth: 420,
          margin: "0 auto",
          lineHeight: 1.6,
        }}
      >
        {subtitle}
      </div>
    </div>
  );
}
