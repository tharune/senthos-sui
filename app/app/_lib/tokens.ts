/**
 * Shared visual tokens for the Senthos app shell.
 *
 * Two-tier palette:
 *
 *   1. **Surface / text / border tokens** resolve to CSS custom properties.
 *      These are the ones that flip between light and dark mode. See the
 *      `<style>` block in `app/layout.tsx` for the variable definitions.
 *      Because they're strings that happen to be `var(...)` expressions,
 *      every existing `style={{ background: C.card }}` inline usage picks
 *      up theme changes automatically — no re-render, no prop drilling.
 *
 *   2. **Accent colors** (teal, amber, green, red, violet, coral, blue)
 *      stay as literal hex strings. They look fine on both light and dark
 *      backgrounds, and the codebase frequently concatenates alpha-hex
 *      suffixes onto them (e.g. `${C.tealLight}44`) which only works with
 *      real hex values, not CSS variables.
 */
export const C = {
  // Theme-reactive surfaces.
  bg: "var(--c-bg)",
  surface: "var(--c-surface)",
  card: "var(--c-card)",
  cardHover: "var(--c-card-hover)",
  cardGradient: "var(--c-card-gradient)",
  cardGradientHover: "var(--c-card-gradient-hover)",
  cardGradientStrong: "var(--c-card-gradient-strong)",
  panelGradient: "var(--c-panel-gradient)",
  border: "var(--c-border)",
  borderHover: "var(--c-border-hover)",
  borderStrong: "var(--c-border-strong)",
  edgeFade: "var(--c-edge-fade)",

  // Theme-reactive text.
  textPrimary: "var(--c-text-primary)",
  textSecondary: "var(--c-text-secondary)",
  textMuted: "var(--c-text-muted)",

  // Extra semantic text tokens so PPN/portfolio pages don't need raw hex.
  textStrong: "var(--c-text-strong)",   // brighter than textPrimary, for numeric values
  textSubtle: "var(--c-text-subtle)",   // between primary and secondary
  textDim: "var(--c-text-dim)",         // between secondary and muted

  // Chrome (header backdrop, page glow).
  headerBg: "var(--c-header-bg)",
  pageGlow: "var(--c-page-glow)",

  // Accent colors — stay as hex so alpha concatenation patterns still work.
  teal: "#0d9488",
  tealLight: "#2dd4bf",
  tealBg: "#042420",
  amber: "#d97706",
  amberBg: "#1c1000",
  coral: "#ea580c",
  coralBg: "#1c0a00",
  green: "#22c55e",
  greenBg: "#0a1f10",
  red: "#ef4444",
  redBg: "#1f0a0a",
  violet: "#8b5cf6",
  violetBg: "#15091c",
  blue: "#3b82f6",
  blueBg: "#0a1424",
} as const;

export const FS = "'Inter', system-ui, sans-serif";
export const FD = "'Inter', system-ui, sans-serif";
export const FM = "'JetBrains Mono', 'SF Mono', Menlo, monospace";
export const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

// USDC balance a fresh portfolio starts with. Real balance comes from the
// connected wallet once wired; until then every session starts at zero.
export const INITIAL_USDC = 0;

export function tc(tier: number): string {
  return tier === 90 ? C.teal : tier === 70 ? C.amber : C.coral;
}

export function trancheColor(kind: "senior" | "mezzanine" | "junior"): string {
  return kind === "senior" ? C.teal : kind === "mezzanine" ? C.amber : C.coral;
}

export function tl(daysLeft: number): "This week" | "This month" | "Long term" {
  return daysLeft <= 20 ? "This week" : daysLeft <= 50 ? "This month" : "Long term";
}

export function lightenColor(hex: string, amount = 0.25): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const nr = Math.min(255, Math.round(r + (255 - r) * amount));
  const ng = Math.min(255, Math.round(g + (255 - g) * amount));
  const nb = Math.min(255, Math.round(b + (255 - b) * amount));
  return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
}

export function darkenColor(hex: string, amount = 0.2): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const nr = Math.max(0, Math.round(r * (1 - amount)));
  const ng = Math.max(0, Math.round(g * (1 - amount)));
  const nb = Math.max(0, Math.round(b * (1 - amount)));
  return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
}

export function fmtUsd(n: number, digits = 0): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
