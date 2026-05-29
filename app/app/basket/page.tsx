"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Header, PageFrame } from "../_components/Header";
import { Sparkline } from "../_components/charts";
import { C, FS, FD, FM, EASE, tc, tl } from "../_lib/tokens";
import { BUNDLES, type Bundle } from "../_lib/bundles";
import {
  isLiveBasket,
  type BasketSlot,
  type LiveBasket,
  type WindowKey,
} from "../_lib/live-baskets";
import { useLiveBaskets } from "../_lib/use-live-baskets";
import { fetchAllVaultPrices, type VaultPriceResponse } from "../../lib/api";

type TierFilter = "all" | 90 | 70 | 50;
type WindowFilter = "all" | "week" | "month" | "long";
type SortOption =
  | "grid"
  | "change_desc"
  | "change_asc"
  | "nav_desc"
  | "nav_asc"
  | "days_asc";

const WINDOW_LABEL: Record<Exclude<WindowFilter, "all">, string> = {
  week: "This week",
  month: "This month",
  long: "Long term",
};

const SORT_LABEL: Record<SortOption, string> = {
  grid: "By tier · time",
  change_desc: "Top gainers",
  change_asc: "Top losers",
  nav_desc: "Highest prob",
  nav_asc: "Lowest prob",
  days_asc: "Expiring soon",
};

// Rendering order for the natural grid sort.
const WINDOW_ORDER: Record<WindowKey, number> = { week: 0, month: 1, long: 2 };
const TIER_ORDER: Record<90 | 70 | 50, number> = { 90: 0, 70: 1, 50: 2 };

function formatDaysLeft(days: number): string {
  if (!Number.isFinite(days)) return "TBD";
  if (days <= 0) return "Resolving";
  if (days === 1) return "1 day";
  return `${days} days`;
}

function formatAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

type DataState =
  | { status: "loading" }
  | { status: "ok"; slots: BasketSlot[]; at: number; source: "live" }
  | { status: "fallback"; baskets: Bundle[]; error: string; source: "seed" };

export default function BasketsPage() {
  const router = useRouter();
  const [tier, setTier] = useState<TierFilter>("all");
  const [win, setWin] = useState<WindowFilter>("all");
  const [sort, setSort] = useState<SortOption>("grid");
  const [query, setQuery] = useState("");
  const basketState = useLiveBaskets();

  // Vault mint prices — fetched once so every card shows the price users
  // will actually pay, not the live Polymarket NAV.
  const [vaultPrices, setVaultPrices] = useState<Record<string, VaultPriceResponse>>({});
  useEffect(() => {
    fetchAllVaultPrices().then((r) => {
      if (!r) return;
      const map: Record<string, VaultPriceResponse> = {};
      for (const p of r.prices) {
        if (p.bundle_name) map[p.bundle_name] = p;
      }
      setVaultPrices(map);
    });
  }, []);

  // Derive our local view from the shared cache. The shared hook already
  // deduplicates fetches across every /app/* page — we just reshape its
  // output into the existing DataState to keep the UI tree unchanged.
  const data: DataState = useMemo(() => {
    if (basketState.status === "loading") return { status: "loading" };
    if (basketState.status === "error") {
      return {
        status: "fallback",
        baskets: BUNDLES,
        error: basketState.error,
        source: "seed",
      };
    }
    if (basketState.baskets.length === 0) {
      return {
        status: "fallback",
        baskets: BUNDLES,
        error: "Live basket feed returned no baskets; using seeded Sui-local universe.",
        source: "seed",
      };
    }
    return {
      status: "ok",
      slots: basketState.baskets as unknown as BasketSlot[],
      at: basketState.at,
      source: "live",
    };
  }, [basketState]);

  // The grid mixes real live baskets (LiveBasket) with placeholder slots for
  // tier×window combos that don't have 10 live legs yet. Fallback mode shows
  // only seeded bundles (no placeholders).
  const slots: BasketSlot[] =
    data.status === "ok"
      ? data.slots
      : data.status === "fallback"
        ? data.baskets.map((b) => ({
            ...b,
            live: true as const,
            window: (tl(b.daysLeft) === "This week"
              ? "week"
              : tl(b.daysLeft) === "This month"
                ? "month"
                : "long") as WindowKey,
            markets: [],
          }))
        : [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = slots.filter((s) => {
      if (tier !== "all" && s.tier !== tier) return false;
      if (win !== "all" && s.window !== win) return false;
      if (q && !s.id.toLowerCase().includes(q)) return false;
      return true;
    });

    // "grid" sort keeps the canonical 3×3 layout (rows = tier 90→50,
    // cols = window week→long). Placeholders stay in their natural slot so
    // the grid is uniform even when some combos don't have 10 live legs.
    if (sort === "grid") {
      return matching.sort((a, b) => {
        const tierDiff = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
        if (tierDiff !== 0) return tierDiff;
        return WINDOW_ORDER[a.window] - WINDOW_ORDER[b.window];
      });
    }

    // For every other sort mode, push placeholders to the bottom so the
    // real baskets surface first in the chosen ranking.
    return matching.sort((a, b) => {
      const aLive = isLiveBasket(a);
      const bLive = isLiveBasket(b);
      if (aLive !== bLive) return aLive ? -1 : 1;
      if (!aLive || !bLive) return 0;
      if (sort === "change_desc") return b.change - a.change;
      if (sort === "change_asc") return a.change - b.change;
      if (sort === "nav_desc") return b.nav - a.nav;
      if (sort === "nav_asc") return a.nav - b.nav;
      return a.daysLeft - b.daysLeft;
    });
  }, [slots, tier, win, sort, query]);

  return (
    <>
      <Header />
      <style>{BASKET_CSS}</style>
      <PageFrame>
        {/* Hero + live-status bar.
            The status bar used to live as a footer strip under the grid,
            but that's (a) easy to miss and (b) visually redundant with
            the "Live feed unavailable" warning banner that slots in when
            things break. Promoting it to the top as a compact pill next
            to the title makes the data-source + freshness obvious on
            first read. */}
        <section
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 18,
            marginBottom: 18,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h1
              style={{
                fontFamily: FD,
                fontSize: "clamp(28px, 3vw, 38px)",
                lineHeight: 1.05,
                letterSpacing: "-0.028em",
                fontWeight: 400,
                color: C.textPrimary,
                margin: 0,
              }}
            >
              Constellations
            </h1>
            <p
              style={{
                fontFamily: FS,
                fontSize: 13,
                lineHeight: 1.5,
                color: C.textSecondary,
                maxWidth: 640,
                margin: "6px 0 0",
              }}
            >
              Nine constellations across three risk tiers × three resolution
              windows, each bundling live Polymarket legs into one STHS token.
              Inception NAVs target ~95% / ~50% / ~5% (high / mid / low) within
              a ±2% band.
            </p>
          </div>
          {data.status === "ok" && <LiveStatusPill at={data.at} />}
        </section>

        {/* Toolbar */}
        <section
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
            marginBottom: 14,
          }}
        >
          <PillGroup<TierFilter>
            value={tier}
            onChange={setTier}
            options={[
              { value: "all", label: "All" },
              { value: 90, label: "High", color: tc(90) },
              { value: 70, label: "Mid", color: tc(70) },
              { value: 50, label: "Low", color: tc(50) },
            ]}
          />
          <PillGroup<WindowFilter>
            value={win}
            onChange={setWin}
            options={[
              { value: "all", label: "Any" },
              { value: "week", label: "Short" },
              { value: "month", label: "Medium" },
              { value: "long", label: "Long" },
            ]}
          />
          <div style={{ flex: 1 }} />
          <SearchInput value={query} onChange={setQuery} />
          <SortMenu value={sort} onChange={setSort} />
        </section>

        {/* Grid */}
        {data.status === "fallback" && (
          <div
            style={{
              marginBottom: 14,
              padding: "10px 14px",
              borderRadius: 10,
              border: `0.5px solid rgba(217, 119, 6, 0.28)`,
              background: "rgba(217, 119, 6, 0.07)",
              color: "#fbbf24",
              fontFamily: FM,
              fontSize: 11,
              letterSpacing: "0.06em",
            }}
          >
            Live feed unavailable · showing cached data · {data.error}
          </div>
        )}
        {data.status === "loading" ? (
          <LoadingGrid />
        ) : filtered.length === 0 ? (
          <EmptyState onReset={() => { setTier("all"); setWin("all"); setQuery(""); }} />
        ) : (
          <div
            className="basket-grid"
            style={{
              display: "grid",
              // Locked to 3 columns (the product is a 3-tier × 3-window
              // grid by design — a 4th column only emerges on wide
              // monitors from auto-fit and breaks the mental model).
              // Narrow viewports collapse to 2 / 1 columns via the
              // BASKET_CSS media queries.
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 14,
              alignItems: "stretch",
            }}
          >
            {filtered.map((s, i) =>
              isLiveBasket(s) ? (
                <BasketCard
                  key={s.id}
                  bundle={s}
                  onClick={() => router.push(`/app/basket/${s.id}`)}
                  shimmerDelay={(i % 6) * 0.9}
                  vaultPrice={vaultPrices[s.id]?.issue_price ?? null}
                />
              ) : (
                <PlaceholderCard key={s.id} tier={s.tier} window={s.window} />
              ),
            )}
          </div>
        )}
      </PageFrame>
    </>
  );
}

/* ---------- Live-status pill ----------
 *
 * Compact top-of-page freshness indicator. Three segments (status /
 * source / age) separated by thin vertical bars instead of mid-dots so
 * the eye doesn't read them as bullet points. The green dot pulses via
 * the `.basket-live-dot` keyframe animation (defined at the bottom of
 * BASKET_CSS) which makes "live" feel live even on a stale tab. */
function LiveStatusPill({ at }: { at: number }) {
  // Re-render every 10s so "updated just now" → "updated 12s ago"
  // without needing a router event. Cheap — just a setState on a tick.
  const [, force] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => force((n) => n + 1), 10_000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div
      role="status"
      aria-label="Live data status"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        padding: "7px 14px",
        borderRadius: 999,
        border: `0.5px solid ${C.border}`,
        background: C.surface,
        fontFamily: FM,
        fontSize: 10.5,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
        <span
          aria-hidden
          className="basket-live-dot"
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: C.green,
            boxShadow: `0 0 10px ${C.green}cc`,
          }}
        />
        <span style={{ color: C.green, fontWeight: 600 }}>Live</span>
      </span>
      <span
        aria-hidden
        style={{ width: 1, height: 10, background: C.border }}
      />
      <span style={{ color: C.textSecondary, fontWeight: 500 }}>Polymarket</span>
      <span
        aria-hidden
        style={{ width: 1, height: 10, background: C.border }}
      />
      <span style={{ color: C.textMuted, fontWeight: 400 }}>
        {formatAgo(at)}
      </span>
    </div>
  );
}

/* ---------- Chart-forward card ---------- */

function BasketCard({
  bundle,
  onClick,
  shimmerDelay,
  vaultPrice,
}: {
  bundle: Bundle;
  onClick: () => void;
  shimmerDelay: number;
  vaultPrice: number | null;
}) {
  const [hov, setHov] = useState(false);
  const color = tc(bundle.tier);
  const posChange = bundle.change >= 0;
  const tierCls = `basket-card-tier-${bundle.tier}`;

  // Card preview = last 24 hours of 5-min ticks (288 points). The
  // card's "+X% today" label below the sparkline is a 1D move, so the
  // sparkline has to share that timeframe — showing a 30-day slice
  // next to a "today" percentage was inconsistent (the curve could
  // tell a different story than the number).
  //
  // We fall back to the daily year-series if `dayHistory` isn't
  // populated (seed-fallback mode pre-refactor), so the card never
  // renders empty.
  const cardSeries = useMemo(() => {
    if (bundle.dayHistory && bundle.dayHistory.length > 0) return bundle.dayHistory;
    return bundle.history.slice(-30);
  }, [bundle.dayHistory, bundle.history]);
  const { min: seriesMin, max: seriesMax } = useMemo(() => {
    if (cardSeries.length === 0) return { min: 0, max: 0 };
    let mn = cardSeries[0];
    let mx = cardSeries[0];
    for (const v of cardSeries) {
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    return { min: mn, max: mx };
  }, [cardSeries]);
  const seriesMid = (seriesMin + seriesMax) / 2;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`basket-card ${tierCls} ${hov ? "basket-card--hov" : ""}`}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        borderRadius: 16,
        padding: "1.2px", // thickness of animated border frame
        cursor: "pointer",
        overflow: "hidden",
        transition: `transform 0.25s ${EASE}, box-shadow 0.25s ${EASE}`,
        transform: hov ? "translateY(-3px)" : "translateY(0)",
        boxShadow: hov
          ? `0 14px 36px rgba(0,0,0,0.42), 0 0 30px ${color}22`
          : "0 4px 14px rgba(0,0,0,0.18)",
      }}
    >
      {/* Rotating conic gradient border (per tier) */}
      <span aria-hidden className="basket-card__border" />

      {/* Inner content surface */}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          // Tighter inner spacing + shorter chart (see below) make the
          // whole card ~50px shorter so a full 3×3 grid fits on a
          // 1440×900 laptop without scrolling.
          gap: 10,
          padding: 16,
          borderRadius: 14.8,
          background: hov ? C.cardGradientHover : C.cardGradient,
          overflow: "hidden",
          transition: `background 0.25s ${EASE}`,
          backdropFilter: "blur(10px)",
        }}
      >
        {/* Corner halo — brighter on hover */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: -70,
            right: -70,
            width: 200,
            height: 200,
            background: `radial-gradient(circle, ${color}2a 0%, transparent 65%)`,
            opacity: hov ? 1 : 0.55,
            transition: `opacity 0.25s ${EASE}`,
            pointerEvents: "none",
          }}
        />
        {/* Diagonal shimmer sweep */}
        <span
          aria-hidden
          className="basket-card__shimmer"
          style={{ animationDelay: `${shimmerDelay}s` }}
        />

        {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, position: "relative" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: color,
                boxShadow: `0 0 10px ${color}80`,
                flexShrink: 0,
              }}
            />
            <div
              style={{
                fontFamily: FD,
                fontSize: 15,
                fontWeight: 500,
                color: C.textPrimary,
                letterSpacing: "0.01em",
              }}
            >
              {bundle.id}
            </div>
          </div>
          <div
            style={{
              fontFamily: FM,
              fontSize: 11,
              color: C.textMuted,
              marginTop: 6,
              letterSpacing: "0.02em",
            }}
          >
            {bundle.totalLegs} legs · {bundle.tier === 90 ? "high" : bundle.tier === 70 ? "mid" : "low"} probability
          </div>
        </div>
        <span
          style={{
            flexShrink: 0,
            marginTop: 2,
            fontFamily: FM,
            fontSize: 11,
            fontWeight: 500,
            // Tier-colored for every basket, not just the ≤20d urgent
            // ones — the days value is the primary "when" metric on the
            // card and should read with the same emphasis across every
            // row. (Previously only <=20d got the tint, which made the
            // rest of the grid feel grey and lifeless.)
            color,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {formatDaysLeft(bundle.daysLeft)}
        </span>
      </div>

      {/* Chart — the star of the card. `bundle.history` is a full year of
          daily NAV points; the card preview always shows the most-recent
          30 days so the visual matches the "today" numbers below. The
          full history is only consumed by the basket detail page.

          The small column on the right is a static y-axis scale (max /
          mid / min NAV for the visible 30-day window). No range picker
          here — the card is one-glance by design; the range picker
          lives on the detail page. */}
      <div
        style={{
          position: "relative",
          // Shorter chart than before (88 vs 120) — still generous enough
          // to read the curve at a glance, but saves 32px per card which
          // is the difference between a 3×3 grid fitting and not fitting
          // on a standard laptop viewport.
          height: 88,
          margin: "0 -4px",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          alignItems: "stretch",
          columnGap: 6,
        }}
      >
        <div style={{ position: "relative", minWidth: 0 }}>
          <Sparkline data={cardSeries} color={color} height={88} />
        </div>
        <div
          aria-hidden
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "1px 0 4px",
            fontFamily: FM,
            fontSize: 9.5,
            color: C.textMuted,
            letterSpacing: "0.02em",
            textAlign: "right",
            minWidth: 38,
            pointerEvents: "none",
          }}
        >
          <span>{(seriesMax * 100).toFixed(1)}%</span>
          <span>{(seriesMid * 100).toFixed(1)}%</span>
          <span>{(seriesMin * 100).toFixed(1)}%</span>
        </div>
      </div>

      {/* Footer: probability + 24h change + resolves */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
          position: "relative",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: FD,
              fontSize: 24,
              fontWeight: 300,
              color,
              letterSpacing: "-0.025em",
              lineHeight: 1,
            }}
          >
            {(bundle.nav * 100).toFixed(1)}%
          </div>
          <div
            style={{
              fontFamily: FM,
              fontSize: 10.5,
              color: C.textMuted,
              marginTop: 4,
            }}
          >
            ${bundle.nav.toFixed(3)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontFamily: FM,
              fontSize: 12,
              fontWeight: 500,
              color: posChange ? C.green : C.red,
              letterSpacing: "0.01em",
            }}
          >
            {posChange ? "+" : ""}
            {bundle.change.toFixed(1)}% today
          </div>
          <div
            style={{
              fontFamily: FM,
              fontSize: 10.5,
              color: C.textMuted,
              marginTop: 4,
              letterSpacing: "0.02em",
            }}
          >
            Resolves {bundle.date}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

/* ---------- Toolbar building blocks ---------- */

type PillOption<V> = { value: V; label: string; color?: string };

function PillGroup<V extends string | number>({
  value,
  onChange,
  options,
}: {
  value: V;
  onChange: (v: V) => void;
  options: PillOption<V>[];
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        padding: 2,
        borderRadius: 999,
        background: C.surface,
        border: `0.5px solid ${C.border}`,
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        const accent = o.color ?? C.tealLight;
        return (
          <button
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            style={{
              padding: "5px 13px",
              fontFamily: FD,
              fontSize: 12,
              fontWeight: active ? 500 : 400,
              letterSpacing: "0.01em",
              color: active ? accent : C.textSecondary,
              background: active ? `${accent}14` : "transparent",
              border: "none",
              borderRadius: 999,
              cursor: "pointer",
              transition: `color 0.15s ${EASE}, background 0.15s ${EASE}`,
            }}
            onMouseEnter={(e) => {
              if (!active) (e.currentTarget as HTMLElement).style.color = C.textPrimary;
            }}
            onMouseLeave={(e) => {
              if (!active) (e.currentTarget as HTMLElement).style.color = C.textSecondary;
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderRadius: 999,
        border: `0.5px solid ${focus ? C.borderHover : C.border}`,
        background: C.surface,
        transition: `border-color 0.15s ${EASE}`,
        width: 220,
      }}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
        <circle cx="7" cy="7" r="5" stroke={C.textMuted} strokeWidth="1.2" />
        <path d="M11 11L14 14" stroke={C.textMuted} strokeWidth="1.2" strokeLinecap="round" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        placeholder="Search"
        style={{
          flex: 1,
          minWidth: 0,
          background: "transparent",
          border: "none",
          outline: "none",
          color: C.textPrimary,
          fontFamily: FD,
          fontSize: 12,
          letterSpacing: "0.01em",
        }}
      />
    </div>
  );
}

function SortMenu({
  value,
  onChange,
}: {
  value: SortOption;
  onChange: (s: SortOption) => void;
}) {
  return (
    <label
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 26px 6px 14px",
        borderRadius: 999,
        border: `0.5px solid ${C.border}`,
        background: C.surface,
        cursor: "pointer",
      }}
    >
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortOption)}
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          MozAppearance: "none",
          background: "transparent",
          border: "none",
          color: C.textPrimary,
          fontFamily: FD,
          fontSize: 12,
          letterSpacing: "0.01em",
          cursor: "pointer",
          outline: "none",
          paddingRight: 4,
        }}
      >
        {(Object.keys(SORT_LABEL) as SortOption[]).map((k) => (
          <option key={k} value={k} style={{ background: C.bg, color: C.textPrimary }}>
            {SORT_LABEL[k]}
          </option>
        ))}
      </select>
      <span
        aria-hidden
        style={{
          position: "absolute",
          right: 12,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: 9,
          color: C.textMuted,
          pointerEvents: "none",
        }}
      >
        ▾
      </span>
    </label>
  );
}

function PlaceholderCard({ tier, window: win }: { tier: 90 | 70 | 50; window: WindowKey }) {
  const color = tc(tier);
  const tierLabel = tier === 90 ? "High" : tier === 70 ? "Mid" : "Low";
  const winLabel = win === "week" ? "Short term" : win === "month" ? "Medium term" : "Long term";
  return (
    <div
      style={{
        position: "relative",
        borderRadius: 16,
        padding: 20,
        minHeight: 250,
        display: "flex",
        flexDirection: "column",
        background: "rgba(8, 12, 20, 0.35)",
        border: `0.5px dashed ${C.border}`,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            border: `1px solid ${color}`,
            opacity: 0.45,
          }}
        />
        <div
          style={{
            fontFamily: FD,
            fontSize: 14,
            fontWeight: 500,
            color: C.textSecondary,
            letterSpacing: "0.01em",
          }}
        >
          {tierLabel} · {winLabel}
        </div>
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontFamily: FM,
            fontSize: 11,
            letterSpacing: "0.16em",
            color: C.textMuted,
            textTransform: "uppercase",
          }}
        >
          Not yet available
        </span>
      </div>
    </div>
  );
}

function LoadingGrid() {
  return (
    <div
      className="basket-grid"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 14,
      }}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 250,
            borderRadius: 16,
            border: `0.5px solid ${C.border}`,
            background:
              "linear-gradient(160deg, rgba(12, 18, 28, 0.6) 0%, rgba(6, 10, 18, 0.75) 100%)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <span
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(100deg, transparent 40%, rgba(255,255,255,0.04) 50%, transparent 60%)",
              animation: "basket-shimmer 2.4s ease-in-out infinite",
            }}
          />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div
      style={{
        border: `0.5px dashed ${C.border}`,
        borderRadius: 16,
        padding: "60px 24px",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div style={{ fontFamily: FD, fontSize: 16, color: C.textPrimary, fontWeight: 500 }}>
        No baskets match
      </div>
      <div style={{ fontFamily: FS, fontSize: 13, color: C.textSecondary, maxWidth: 320 }}>
        Try a different tier, resolution window, or clear the search
      </div>
      <button
        onClick={onReset}
        style={{
          marginTop: 4,
          padding: "7px 16px",
          borderRadius: 100,
          border: `0.5px solid ${C.borderHover}`,
          background: "rgba(45, 212, 191, 0.08)",
          color: C.tealLight,
          fontFamily: FD,
          fontSize: 12,
          letterSpacing: "0.02em",
          cursor: "pointer",
          transition: `all 0.2s ${EASE}`,
        }}
      >
        Reset filters
      </button>
    </div>
  );
}

/* ---------- Animated gradient border + shimmer CSS ---------- */

const BASKET_CSS = `
@keyframes basket-spin {
  0%   { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
@keyframes basket-shimmer {
  0%   { transform: translateX(-130%) skewX(-18deg); opacity: 0; }
  20%  { opacity: 0.22; }
  60%  { opacity: 0.22; }
  100% { transform: translateX(230%) skewX(-18deg); opacity: 0; }
}
@keyframes basket-pulse {
  0%, 100% { opacity: 0.16; }
  50%      { opacity: 0.32; }
}

.basket-card {
  isolation: isolate;
}
.basket-card__border {
  position: absolute;
  inset: -40%;
  width: 180%;
  height: 180%;
  z-index: 0;
  border-radius: 50%;
  animation: basket-spin 18s linear infinite, basket-pulse 7s ease-in-out infinite;
  pointer-events: none;
  filter: blur(0.6px);
}
.basket-card--hov .basket-card__border {
  animation: basket-spin 10s linear infinite, basket-pulse 5s ease-in-out infinite;
}

.basket-card-tier-90 .basket-card__border {
  background: conic-gradient(
    from 0deg,
    rgba(94, 234, 212, 0) 0%,
    rgba(94, 234, 212, 0.35) 18%,
    rgba(45, 212, 191, 0.28) 30%,
    rgba(6, 182, 212, 0) 48%,
    rgba(20, 184, 166, 0.30) 70%,
    rgba(94, 234, 212, 0) 100%
  );
}
.basket-card-tier-70 .basket-card__border {
  background: conic-gradient(
    from 0deg,
    rgba(251, 191, 36, 0) 0%,
    rgba(253, 230, 138, 0.30) 18%,
    rgba(251, 191, 36, 0.28) 30%,
    rgba(245, 158, 11, 0) 48%,
    rgba(249, 115, 22, 0.28) 70%,
    rgba(251, 191, 36, 0) 100%
  );
}
.basket-card-tier-50 .basket-card__border {
  background: conic-gradient(
    from 0deg,
    rgba(244, 114, 182, 0) 0%,
    rgba(251, 113, 133, 0.32) 18%,
    rgba(239, 68, 68, 0.26) 30%,
    rgba(244, 114, 182, 0) 48%,
    rgba(251, 146, 60, 0.28) 70%,
    rgba(220, 38, 38, 0) 100%
  );
}

.basket-card__shimmer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    105deg,
    transparent 42%,
    rgba(255, 255, 255, 0.025) 49%,
    rgba(255, 255, 255, 0.05) 50%,
    rgba(255, 255, 255, 0.025) 51%,
    transparent 58%
  );
  mix-blend-mode: screen;
  animation: basket-shimmer 11s ease-in-out infinite;
  opacity: 0;
}
.basket-card--hov .basket-card__shimmer {
  animation-duration: 6s;
}

/* Green pulsing dot on the live-status pill. Scales slightly + fades
   so it reads as "heartbeat" instead of the "loading" shimmer. Toggled
   off when the user has reduced-motion enabled. */
@keyframes basket-live-pulse {
  0%, 100% { transform: scale(1);   opacity: 1;   box-shadow: 0 0 8px rgba(34, 197, 94, 0.75); }
  50%      { transform: scale(1.4); opacity: 0.55; box-shadow: 0 0 14px rgba(34, 197, 94, 0.9); }
}
.basket-live-dot {
  animation: basket-live-pulse 1.8s ease-in-out infinite;
  transform-origin: center;
}

@media (prefers-reduced-motion: reduce) {
  .basket-card__border,
  .basket-card__shimmer,
  .basket-live-dot { animation: none !important; }
}

/* Collapse the 3-column grid on narrower viewports. The card itself
   has a ~320px comfortable minimum — below that the sparkline loses
   enough horizontal room that the axis labels start to crowd the
   curve. Two clean breakpoints: 2-up below ~1000px, 1-up below ~640px. */
@media (max-width: 1000px) {
  .basket-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }
}
@media (max-width: 640px) {
  .basket-grid {
    grid-template-columns: minmax(0, 1fr) !important;
  }
}
`;
