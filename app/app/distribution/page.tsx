"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Header, PageFrame } from "../_components/Header";
import { C, FD, FM, FS, EASE, fmtUsd } from "../_lib/tokens";
import { SUI_ACTIVE_ADDRESS, shortAddress, suiExplorerTxUrl } from "../_lib/chain";
import {
  DistributionPosition,
  DistributionQuote,
  DistributionTemplate,
  fetchDistributionPositions,
  fetchDistributionTemplates,
  openDistribution,
  quoteDistribution,
  settleDistribution,
} from "../_lib/distribution-client";

const CARD: React.CSSProperties = {
  background: C.card,
  border: `0.5px solid ${C.border}`,
  borderRadius: 8,
  padding: 20,
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: FM,
      fontSize: 10,
      letterSpacing: "0.14em",
      color: C.textMuted,
      textTransform: "uppercase",
      marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function fmtNumber(value: number, unit: string): string {
  if (unit === "USD") return fmtUsd(value, value >= 1000 ? 0 : 1);
  if (unit === "cuts") return value.toFixed(1);
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: C.surface,
      borderRadius: 6,
      padding: "12px 14px",
      minHeight: 68,
    }}>
      <div style={{ color: C.textMuted, fontFamily: FM, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ color: C.textPrimary, fontFamily: FD, fontSize: 18, fontWeight: 600, marginTop: 8, overflowWrap: "anywhere" }}>
        {value}
      </div>
    </div>
  );
}

function normalizeToPercent(weights: number[]): number[] {
  const sum = weights.reduce((acc, n) => acc + n, 0);
  if (sum <= 0) return weights;
  return weights.map((n) => Math.round((n / sum) * 1000) / 10);
}

export default function DistributionMarketsPage() {
  const [templates, setTemplates] = useState<DistributionTemplate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [weights, setWeights] = useState<number[]>([]);
  const [amount, setAmount] = useState("100");
  const [quote, setQuote] = useState<DistributionQuote | null>(null);
  const [positions, setPositions] = useState<DistributionPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [busy, setBusy] = useState<"open" | "settle" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? null,
    [templates, selectedId],
  );

  const refreshPositions = useCallback(async () => {
    const next = await fetchDistributionPositions(SUI_ACTIVE_ADDRESS);
    setPositions(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const nextTemplates = await fetchDistributionTemplates();
        if (cancelled) return;
        setTemplates(nextTemplates);
        const first = nextTemplates[0];
        if (first) {
          setSelectedId(first.id);
          setWeights(first.buckets.map((bucket) => Math.round(bucket.reference_probability * 1000) / 10));
        }
        await refreshPositions();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load distribution markets");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [refreshPositions]);

  useEffect(() => {
    if (!selected || weights.length !== selected.buckets.length) return;
    const amountUsdc = Number(amount);
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
      setQuote(null);
      return;
    }

    let cancelled = false;
    setQuoteLoading(true);
    const timer = setTimeout(async () => {
      try {
        const next = await quoteDistribution({
          marketId: selected.id,
          weights,
          amountUsdc,
        });
        if (!cancelled) {
          setQuote(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setQuote(null);
          setError(err instanceof Error ? err.message : "Quote failed");
        }
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [amount, selected, weights]);

  function selectTemplate(template: DistributionTemplate) {
    setSelectedId(template.id);
    setWeights(template.buckets.map((bucket) => Math.round(bucket.reference_probability * 1000) / 10));
    setQuote(null);
    setError(null);
  }

  function updateWeight(index: number, value: number) {
    setWeights((current) => current.map((weight, i) => i === index ? Math.max(0, value) : weight));
  }

  async function handleOpen() {
    if (!selected) return;
    const amountUsdc = Number(amount);
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
      setError("Enter a positive mock USDC amount");
      return;
    }
    setBusy("open");
    setError(null);
    try {
      const position = await openDistribution({
        marketId: selected.id,
        weights,
        amountUsdc,
        recipient: SUI_ACTIVE_ADDRESS,
      });
      setPositions((current) => [position, ...current.filter((p) => p.id !== position.id)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Open failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleSettle(positionId: string) {
    setBusy("settle");
    setError(null);
    try {
      const settled = await settleDistribution(positionId);
      setPositions((current) => current.map((position) => position.id === settled.id ? settled : position));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Settle failed");
    } finally {
      setBusy(null);
    }
  }

  const totalWeight = weights.reduce((acc, n) => acc + n, 0);
  const latestDigest = positions[0]?.digests.buy ?? positions[0]?.digests.claim ?? null;

  return (
    <>
      <Header />
      <PageFrame>
        <style>{`
          .dist-button:hover { border-color: ${C.borderHover} !important; transform: translateY(-1px); }
          .dist-range { width: 100%; accent-color: ${C.tealLight}; }
          .dist-input:focus { outline: none; border-color: ${C.tealLight} !important; box-shadow: 0 0 0 3px ${C.tealLight}22; }
          @media (max-width: 900px) {
            .dist-grid { grid-template-columns: 1fr !important; }
            .dist-products { grid-template-columns: 1fr !important; }
            .dist-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
            .dist-position-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important; }
          }
          @media (max-width: 560px) {
            .dist-metrics { grid-template-columns: 1fr !important; }
            .dist-row { grid-template-columns: 1fr !important; gap: 8px !important; }
            .dist-position-row { grid-template-columns: 1fr !important; }
          }
        `}</style>

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, marginBottom: 24 }}>
          <div>
            <div style={{
              fontFamily: FM,
              color: C.tealLight,
              fontSize: 11,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              marginBottom: 10,
            }}>
              Sui testnet product
            </div>
            <h1 style={{ fontFamily: FS, fontSize: 34, lineHeight: 1.08, margin: 0, color: C.textPrimary, letterSpacing: 0 }}>
              Distribution markets
            </h1>
            <p style={{ maxWidth: 760, color: C.textSecondary, fontSize: 15, lineHeight: 1.7, margin: "12px 0 0" }}>
              Trade an entire probability curve instead of a single yes/no outcome. The frontend sends every bucket weight to the backend, the backend prices the submitted distribution, and the Sui harness opens a mock-USDC backed testnet receipt.
            </p>
          </div>
          <div style={{
            ...CARD,
            minWidth: 220,
            padding: "14px 16px",
            color: C.textSecondary,
            fontSize: 12,
            lineHeight: 1.6,
          }}>
            <div style={{ fontFamily: FM, color: C.textMuted, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" }}>
              Wallet
            </div>
            <div style={{ color: C.textPrimary, marginTop: 6 }}>{shortAddress(SUI_ACTIVE_ADDRESS)}</div>
            <div>{positions.length} local position{positions.length === 1 ? "" : "s"}</div>
          </div>
        </div>

        {error && (
          <div style={{
            border: `0.5px solid ${C.red}`,
            background: `${C.red}10`,
            color: C.red,
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 13,
            marginBottom: 18,
          }}>
            {error}
          </div>
        )}

        <div className="dist-products" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: 18 }}>
          {templates.map((template) => {
            const active = template.id === selectedId;
            return (
              <button
                key={template.id}
                className="dist-button"
                onClick={() => selectTemplate(template)}
                style={{
                  ...CARD,
                  cursor: "pointer",
                  textAlign: "left",
                  borderColor: active ? C.tealLight : C.border,
                  background: active ? `${C.tealLight}12` : C.card,
                  transition: `all 0.18s ${EASE}`,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <div style={{ color: C.textPrimary, fontFamily: FD, fontWeight: 600, fontSize: 14 }}>{template.name}</div>
                  <span style={{ color: active ? C.tealLight : C.textMuted, fontFamily: FM, fontSize: 10 }}>{template.expiry_label}</span>
                </div>
                <p style={{ margin: "8px 0 0", color: C.textSecondary, fontSize: 12, lineHeight: 1.5 }}>
                  {template.description}
                </p>
              </button>
            );
          })}
        </div>

        <div className="dist-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(360px, 0.65fr)", gap: 18 }}>
          <section style={CARD}>
            <SectionLabel>Curve builder</SectionLabel>
            {loading || !selected ? (
              <div style={{ color: C.textSecondary, fontSize: 13 }}>Loading distribution templates...</div>
            ) : (
              <>
                <div style={{ display: "grid", gap: 12 }}>
                  {selected.buckets.map((bucket, index) => {
                    const current = weights[index] ?? 0;
                    const quoted = quote?.normalized[index] ?? bucket.reference_probability;
                    return (
                      <div key={bucket.id} className="dist-row" style={{
                        display: "grid",
                        gridTemplateColumns: "120px minmax(0, 1fr) 74px",
                        alignItems: "center",
                        gap: 12,
                      }}>
                        <div>
                          <div style={{ color: C.textPrimary, fontSize: 13, fontWeight: 500 }}>{bucket.label}</div>
                          <div style={{ color: C.textMuted, fontFamily: FM, fontSize: 10 }}>ref {pct(bucket.reference_probability)}</div>
                        </div>
                        <div style={{ display: "grid", gap: 7 }}>
                          <input
                            className="dist-range"
                            type="range"
                            min={0}
                            max={100}
                            step={0.5}
                            value={current}
                            onChange={(event) => updateWeight(index, Number(event.target.value))}
                            aria-label={`${bucket.label} probability`}
                          />
                          <div style={{ height: 6, borderRadius: 999, background: C.surface, overflow: "hidden" }}>
                            <div style={{ width: `${Math.min(100, quoted * 100)}%`, height: "100%", background: C.tealLight }} />
                          </div>
                        </div>
                        <input
                          className="dist-input"
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          value={current}
                          onChange={(event) => updateWeight(index, Number(event.target.value))}
                          style={{
                            width: "100%",
                            background: C.surface,
                            border: `0.5px solid ${C.border}`,
                            borderRadius: 6,
                            color: C.textPrimary,
                            fontFamily: FM,
                            fontSize: 12,
                            padding: "7px 8px",
                          }}
                        />
                      </div>
                    );
                  })}
                </div>

                <div style={{
                  marginTop: 18,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 14,
                  flexWrap: "wrap",
                  borderTop: `0.5px solid ${C.border}`,
                  paddingTop: 16,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <label style={{ color: C.textSecondary, fontSize: 12, display: "grid", gap: 6 }}>
                      Collateral
                      <input
                        className="dist-input"
                        type="number"
                        min={1}
                        step={1}
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        style={{
                          width: 130,
                          background: C.surface,
                          border: `0.5px solid ${C.border}`,
                          borderRadius: 6,
                          color: C.textPrimary,
                          fontFamily: FM,
                          fontSize: 13,
                          padding: "8px 10px",
                        }}
                      />
                    </label>
                    <button
                      className="dist-button"
                      onClick={() => setWeights((current) => normalizeToPercent(current))}
                      style={{
                        marginTop: 20,
                        height: 34,
                        borderRadius: 6,
                        border: `0.5px solid ${C.border}`,
                        background: C.surface,
                        color: C.textPrimary,
                        padding: "0 12px",
                        cursor: "pointer",
                      }}
                    >
                      Normalize
                    </button>
                  </div>
                  <div style={{ color: Math.abs(totalWeight - 100) < 0.05 ? C.green : C.amber, fontFamily: FM, fontSize: 12 }}>
                    raw sum {totalWeight.toFixed(1)}%
                  </div>
                </div>
              </>
            )}
          </section>

          <aside style={{ display: "grid", gap: 18, alignContent: "start" }}>
            <section style={CARD}>
              <SectionLabel>Quote</SectionLabel>
              <div className="dist-metrics" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                <MetricCell label="Expected" value={quote && selected ? fmtNumber(quote.expected_value, selected.unit) : "-"} />
                <MetricCell label="Peak bucket" value={quote?.peak_bucket.label ?? "-"} />
                <MetricCell label="L2 move" value={quote ? quote.l2_distance.toFixed(3) : "-"} />
                <MetricCell label="Entropy" value={quote ? quote.entropy.toFixed(2) : "-"} />
              </div>
              <div style={{ marginTop: 16, display: "grid", gap: 8, color: C.textSecondary, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Maker fee</span>
                  <span style={{ color: C.textPrimary }}>{quote ? fmtUsd(quote.maker_fee_usdc, 2) : "-"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Net collateral</span>
                  <span style={{ color: C.textPrimary }}>{quote ? fmtUsd(quote.net_collateral_usdc, 2) : "-"}</span>
                </div>
              </div>
              <button
                onClick={handleOpen}
                disabled={!quote || busy !== null || quoteLoading}
                style={{
                  width: "100%",
                  marginTop: 16,
                  height: 42,
                  borderRadius: 6,
                  border: `0.5px solid ${quote ? C.tealLight : C.border}`,
                  background: quote ? C.tealLight : C.surface,
                  color: quote ? "#001311" : C.textMuted,
                  fontWeight: 700,
                  cursor: quote && busy === null ? "pointer" : "not-allowed",
                }}
              >
                {busy === "open" ? "Opening on Sui..." : quoteLoading ? "Quoting..." : "Open on Sui testnet"}
              </button>
              {latestDigest && (
                <a
                  href={suiExplorerTxUrl(latestDigest)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: "inline-block", marginTop: 10, color: C.tealLight, fontSize: 12, textDecoration: "none" }}
                >
                  Latest transaction
                </a>
              )}
            </section>

            <section style={CARD}>
              <SectionLabel>Payout curve</SectionLabel>
              <div style={{ display: "grid", gap: 9 }}>
                {(quote?.payout_curve ?? selected?.buckets.map((bucket) => ({
                  bucket_id: bucket.id,
                  label: bucket.label,
                  probability: bucket.reference_probability,
                  reference_probability: bucket.reference_probability,
                  payout_usdc: 0,
                  pnl_usdc: 0,
                })) ?? []).map((row) => (
                  <div key={row.bucket_id} style={{ display: "grid", gridTemplateColumns: "80px minmax(0, 1fr) 52px", alignItems: "center", gap: 10 }}>
                    <span style={{ color: C.textSecondary, fontSize: 12 }}>{row.label}</span>
                    <div style={{ height: 7, borderRadius: 999, background: C.surface, overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(100, row.probability * 100)}%`, height: "100%", background: row.pnl_usdc >= 0 ? C.green : C.coral }} />
                    </div>
                    <span style={{ color: C.textPrimary, fontFamily: FM, fontSize: 11, textAlign: "right" }}>{pct(row.probability)}</span>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>

        <section style={{ ...CARD, marginTop: 18 }}>
          <SectionLabel>Positions</SectionLabel>
          {positions.length === 0 ? (
            <div style={{ color: C.textSecondary, fontSize: 13 }}>No local distribution positions yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {positions.map((position) => (
                <div key={position.id} className="dist-position-row" style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(180px, 1fr) minmax(160px, 1fr) 100px 130px",
                  gap: 12,
                  alignItems: "center",
                  border: `0.5px solid ${C.border}`,
                  borderRadius: 8,
                  padding: "12px",
                }}>
                  <div>
                    <div style={{ color: C.textPrimary, fontSize: 13, fontWeight: 600 }}>{position.template_name}</div>
                    <div style={{ color: C.textMuted, fontFamily: FM, fontSize: 10 }}>{shortAddress(position.sui_position_id)}</div>
                  </div>
                  <div style={{ color: C.textSecondary, fontSize: 12 }}>
                    Peak {position.quote.peak_bucket.label} at {pct(Math.max(...position.quote.normalized))}
                  </div>
                  <div style={{ color: position.status === "open" ? C.green : C.textMuted, fontFamily: FM, fontSize: 11, textTransform: "uppercase" }}>
                    {position.status}
                  </div>
                  {position.status === "open" ? (
                    <button
                      onClick={() => handleSettle(position.id)}
                      disabled={busy !== null}
                      style={{
                        height: 32,
                        borderRadius: 6,
                        border: `0.5px solid ${C.border}`,
                        background: C.surface,
                        color: C.textPrimary,
                        cursor: busy === null ? "pointer" : "not-allowed",
                      }}
                    >
                      {busy === "settle" ? "Settling..." : "Settle"}
                    </button>
                  ) : (
                    <a
                      href={position.digests.claim ? suiExplorerTxUrl(position.digests.claim) : "#"}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: C.tealLight, fontSize: 12, textDecoration: "none" }}
                    >
                      Claim tx
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </PageFrame>
    </>
  );
}
