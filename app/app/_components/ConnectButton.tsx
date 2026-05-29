"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import type { Wallet } from "@solana/wallet-adapter-react";
import { C, FM, FD, FS } from "../_lib/tokens";
import { IS_SUI, SUI_ACTIVE_ADDRESS, shortAddress } from "../_lib/chain";

/**
 * Render children into <body> once we're on the client.
 *
 * The wallet button sits inside the sticky <header>, which has
 * `backdrop-filter: blur(...)`. Per CSS spec, `backdrop-filter` makes the
 * element a containing block for ALL descendants — including ones with
 * `position: fixed`. So without portalling, the modal (inset:0 + position:
 * fixed) gets clipped to the 56px header strip instead of covering the
 * viewport, which is the "stuck at the top of the page" bug.
 */
function BodyPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

/**
 * Drop-in replacement for WalletMultiButton.
 *
 * Difference from the default:
 *   - Non-installed wallets go in a separate "Install" section that does not
 *     hijack the click into a URL redirect. Installed wallets always connect.
 *   - Follows the stock `WalletModal` flow: `select()` and let WalletProvider's
 *     `autoConnect` fire the adapter handshake. Previously we called
 *     `adapter.connect()` ourselves to preserve the user-gesture window, but
 *     that tripped a Wallet Standard dedupe race — see `handlePick` below.
 *
 * Variants:
 *   - `variant="header"`  compact button for top nav
 *   - `variant="block"`   full-width button for inline cards
 */
export function ConnectButton({
  variant = "header",
}: {
  variant?: "header" | "block";
}) {
  const {
    wallets,
    publicKey,
    connected,
    connecting,
    disconnecting,
    disconnect,
    select,
    wallet: activeWallet,
  } = useWallet();

  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // The post-connect menu is portalled to <body> so it escapes the header's
  // backdrop-filter containing block. That also means it's no longer a DOM
  // descendant of menuRef, so outside-click detection needs to check this
  // separate ref too.
  const menuContentRef = useRef<HTMLDivElement | null>(null);

  // Close the post-connect menu if the user clicks outside.
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      const insideButton = menuRef.current?.contains(t);
      const insideMenu = menuContentRef.current?.contains(t);
      if (!insideButton && !insideMenu) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const isReady = (w: Wallet | null | undefined) =>
    !!w &&
    (w.readyState === WalletReadyState.Installed ||
      w.readyState === WalletReadyState.Loadable);

  // Treat these as non-fatal — they're all expected handshake states that
  // either auto-resolve on the next render or are user-driven (rejection).
  const SILENT_ERROR_RE = /NotSelected|NotReady|Already|rejected|User rejected|Unsupported/i;

  // When the user picks a wallet, we only call `select()`. WalletProvider
  // (with `autoConnect=true`) takes it from there: on the next render
  // WalletProviderBase mounts the newly-selected adapter, subscribes to its
  // events, and fires `adapter.connect()` via its own autoConnect effect.
  //
  // Earlier iterations of this handler also called `w.adapter.connect()`
  // synchronously inside the click, reasoning that we needed to preserve the
  // user-gesture token for Phantom's popup. That turned out to cause a worse
  // bug on fresh page load:
  //
  //   1. `wallets` initially contains our explicit `PhantomWalletAdapter`
  //      (the one registered in `WalletProviders`).
  //   2. Between the click and the popup confirmation, the Phantom extension
  //      announces via the Wallet Standard.
  //   3. `useStandardWalletAdapters` swaps in the Standard-wrapped Phantom
  //      and filters out the explicit one (dedupe by name).
  //   4. The `connect()` we already dispatched resolves against the *old*
  //      adapter instance, so Phantom reports connected at the extension
  //      layer, but WalletProvider's current adapter (the wrapped one) is
  //      still disconnected. The UI looks stuck.
  //   5. A later render (e.g. on tab navigation) runs WalletProviderBase's
  //      autoConnect effect against the wrapped adapter, which reads
  //      Phantom's already-granted session and reports connected without a
  //      popup — which is the "switch tabs and come back, now it works"
  //      behavior the user saw.
  //
  // Letting `select()` + autoConnect drive the handshake sidesteps that race:
  // connect() fires against whichever adapter WalletProviderBase is mounted
  // on at render time, so the Standard-wrapped instance (if present) is the
  // one whose connected state we observe. Phantom's approval popup is owned
  // by the extension process and opens via port messaging, not `window.open`,
  // so the gesture window is not strictly required.
  const handlePick = useCallback(
    (w: Wallet) => {
      setError(null);
      // Non-installed wallets route to their install page instead of
      // attempting a connect that would throw WalletNotReadyError.
      if (!isReady(w)) {
        if (w.adapter.url) {
          window.open(w.adapter.url, "_blank", "noopener,noreferrer");
        } else {
          setError(`${w.adapter.name} is not installed.`);
        }
        return;
      }
      try {
        select(w.adapter.name);
        setOpen(false);
      } catch (e) {
        const msg = (e as Error).message;
        if (!SILENT_ERROR_RE.test(msg)) {
          setError(msg);
        }
      }
    },
    [select],
  );

  // Surface adapter errors (locked wallet, rejected connect, etc.) so the
  // user sees why the popup never completed. WalletProvider swallows these
  // internally; we want them visible in our modal.
  useEffect(() => {
    const adapter = activeWallet?.adapter;
    if (!adapter) return;
    const onError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (!SILENT_ERROR_RE.test(msg)) setError(msg);
    };
    adapter.on("error", onError);
    return () => {
      adapter.off("error", onError);
    };
  }, [activeWallet?.adapter]);

  const { installed, loadable, notDetected } = useMemo(() => {
    const installed: Wallet[] = [];
    const loadable: Wallet[] = [];
    const notDetected: Wallet[] = [];
    for (const w of wallets) {
      switch (w.readyState) {
        case WalletReadyState.Installed:
          installed.push(w);
          break;
        case WalletReadyState.Loadable:
          loadable.push(w);
          break;
        default:
          notDetected.push(w);
      }
    }
    // Sort each bucket alphabetically for stable rendering.
    const byName = (a: Wallet, b: Wallet) => a.adapter.name.localeCompare(b.adapter.name);
    return {
      installed: installed.sort(byName),
      loadable:  loadable.sort(byName),
      notDetected: notDetected.sort(byName),
    };
  }, [wallets]);

  const label = connecting
    ? "Connecting…"
    : disconnecting
      ? "Disconnecting…"
      : connected && publicKey
        ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}`
        : "Connect Wallet";

  const baseBtn: React.CSSProperties = variant === "header"
    ? {
        height: 32,
        padding: "0 14px",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: "0.02em",
      }
    : {
        width: "100%",
        height: 40,
        padding: "0 16px",
        borderRadius: 10,
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: "0.02em",
      };

  if (IS_SUI) {
    return (
      <button
        type="button"
        title={`Sui testnet dev account: ${SUI_ACTIVE_ADDRESS}`}
        style={{
          ...baseBtn,
          fontFamily: FD,
          background: `${C.teal}14`,
          color: C.tealLight,
          border: `0.5px solid ${C.teal}66`,
          cursor: "default",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontFamily: FM }}>{shortAddress(SUI_ACTIVE_ADDRESS)}</span>
      </button>
    );
  }

  return (
    <div style={{ position: "relative", display: "inline-block" }} ref={menuRef}>
      <button
        type="button"
        onClick={() => {
          if (connected) setMenuOpen((m) => !m);
          else setOpen(true);
        }}
        style={{
          ...baseBtn,
          fontFamily: FD,
          background: "transparent",
          color: C.textPrimary,
          borderTop: `0.5px solid ${C.border}`,
          borderRight: `0.5px solid ${C.border}`,
          borderBottom: `0.5px solid ${C.border}`,
          borderLeft: `0.5px solid ${C.border}`,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          transition: "background 0.15s, border-color 0.15s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = C.surface;
          (e.currentTarget as HTMLElement).style.borderColor = C.borderHover;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "transparent";
          (e.currentTarget as HTMLElement).style.borderColor = C.border;
        }}
      >
        {connected && activeWallet && (
          <img
            src={activeWallet.adapter.icon}
            alt=""
            width={14}
            height={14}
            style={{ borderRadius: 3, display: "block" }}
          />
        )}
        <span style={{ fontFamily: connected ? FM : FD }}>{label}</span>
      </button>

      {/* Post-connect dropdown: copy address / disconnect. Portalled out
          because the button lives inside <header>'s backdrop-filter
          containing block, which would otherwise clip the menu. */}
      {connected && menuOpen && (
        <BodyPortal>
        <div
          ref={menuContentRef}
          style={{
            position: "fixed",
            top: (menuRef.current?.getBoundingClientRect().bottom ?? 0) + 6,
            right: Math.max(
              8,
              window.innerWidth -
                (menuRef.current?.getBoundingClientRect().right ?? window.innerWidth),
            ),
            minWidth: 200,
            background: C.card,
            borderTop: `0.5px solid ${C.border}`,
            borderRight: `0.5px solid ${C.border}`,
            borderBottom: `0.5px solid ${C.border}`,
            borderLeft: `0.5px solid ${C.border}`,
            borderRadius: 10,
            padding: 4,
            boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
            zIndex: 10000,
          }}
        >
          <button
            type="button"
            onClick={() => {
              if (publicKey) navigator.clipboard.writeText(publicKey.toBase58());
              setMenuOpen(false);
            }}
            style={menuItemStyle}
          >
            Copy address
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setMenuOpen(false);
            }}
            style={menuItemStyle}
          >
            Change wallet
          </button>
          <button
            type="button"
            onClick={async () => {
              setMenuOpen(false);
              try {
                await disconnect();
              } catch {
                // swallow — disconnect errors are non-fatal
              }
              // Defensive: force-clear the persisted walletName so the
              // next page load doesn't try to silently auto-connect to
              // a wallet the user just explicitly disconnected from.
              // Normally the adapter's 'disconnect' event does this,
              // but some wallets don't always fire it cleanly, which
              // leaves us in a stuck state on the next reload.
              try {
                select(null);
              } catch {
                // select(null) is a valid no-op if nothing is selected
              }
            }}
            style={{ ...menuItemStyle, color: C.coral }}
          >
            Disconnect
          </button>
        </div>
        </BodyPortal>
      )}

      {/* Wallet-picker modal. Portalled to <body> for the same containing-
          block reason as the menu above. */}
      {open && (
        <BodyPortal>
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.72)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "calc(100% - 40px)",
              maxWidth: 380,
              background: C.card,
              borderTop: `0.5px solid ${C.border}`,
              borderRight: `0.5px solid ${C.border}`,
              borderBottom: `0.5px solid ${C.border}`,
              borderLeft: `0.5px solid ${C.border}`,
              borderRadius: 16,
              boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
              overflow: "hidden",
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ padding: "18px 20px 10px", position: "relative" }}>
              <div style={{
                fontFamily: FM, fontSize: 10, letterSpacing: "0.18em",
                color: C.tealLight, fontWeight: 600, marginBottom: 8,
              }}>
                SOLANA · {(process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").toUpperCase()}
              </div>
              <div style={{
                fontFamily: FD, fontSize: 16, fontWeight: 600,
                color: C.textPrimary, letterSpacing: "-0.005em",
              }}>
                Connect a wallet
              </div>
              <div style={{
                fontFamily: FS, fontSize: 12, color: C.textSecondary,
                marginTop: 4, lineHeight: 1.5,
              }}>
                Installed wallets connect instantly. Hardware wallets will prompt on your device.
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{
                  position: "absolute", top: 14, right: 14,
                  width: 26, height: 26, borderRadius: 6,
                  background: "transparent",
                  borderTop: `0.5px solid ${C.border}`,
                  borderRight: `0.5px solid ${C.border}`,
                  borderBottom: `0.5px solid ${C.border}`,
                  borderLeft: `0.5px solid ${C.border}`,
                  color: C.textSecondary,
                  fontSize: 14, cursor: "pointer",
                  lineHeight: "24px",
                }}
              >
                ×
              </button>
            </div>

            <div style={{ overflowY: "auto", padding: "0 14px 14px" }}>
              {installed.length > 0 && (
                <WalletSection title="Detected" wallets={installed} onPick={handlePick} />
              )}
              {loadable.length > 0 && (
                <WalletSection title="Hardware / loadable" wallets={loadable} onPick={handlePick} />
              )}
              {notDetected.length > 0 && (
                <WalletSection
                  title="Install to use"
                  wallets={notDetected}
                  onPick={(w) => {
                    if (w.adapter.url) window.open(w.adapter.url, "_blank", "noopener,noreferrer");
                  }}
                  badge="INSTALL"
                  muted
                />
              )}
              {installed.length === 0 && loadable.length === 0 && (
                <div style={{
                  padding: "18px 6px",
                  fontSize: 12, color: C.textSecondary, fontFamily: FS,
                  lineHeight: 1.6, textAlign: "center",
                }}>
                  No Solana wallets detected in this browser. Install Phantom, Solflare, or Backpack to continue.
                </div>
              )}
              {error && (
                <div style={{
                  marginTop: 10, padding: "10px 12px",
                  background: C.redBg,
                  borderTop: `0.5px solid ${C.red}55`,
                  borderRight: `0.5px solid ${C.red}55`,
                  borderBottom: `0.5px solid ${C.red}55`,
                  borderLeft: `0.5px solid ${C.red}55`,
                  borderRadius: 8,
                  color: C.red, fontFamily: FS, fontSize: 11,
                }}>
                  {error}
                </div>
              )}
            </div>
          </div>
        </div>
        </BodyPortal>
      )}
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "8px 10px",
  background: "transparent",
  border: "none",
  color: C.textSecondary,
  fontFamily: FD,
  fontSize: 12,
  textAlign: "left",
  cursor: "pointer",
  borderRadius: 6,
};

function WalletSection({
  title,
  wallets,
  onPick,
  badge,
  muted,
}: {
  title: string;
  wallets: Wallet[];
  onPick: (w: Wallet) => void;
  badge?: string;
  muted?: boolean;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{
        fontFamily: FM, fontSize: 10, letterSpacing: "0.14em",
        color: C.textMuted, fontWeight: 500,
        padding: "0 4px 8px", textTransform: "uppercase",
      }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {wallets.map((w) => (
          <button
            key={w.adapter.name}
            type="button"
            onClick={() => onPick(w)}
            style={{
              height: 52,
              padding: "0 14px",
              borderRadius: 10,
              background: C.surface,
              borderTop: `0.5px solid transparent`,
              borderRight: `0.5px solid transparent`,
              borderBottom: `0.5px solid transparent`,
              borderLeft: `0.5px solid transparent`,
              color: muted ? C.textSecondary : C.textPrimary,
              fontFamily: FD, fontSize: 14, fontWeight: 500,
              cursor: "pointer",
              display: "flex", alignItems: "center", gap: 12,
              transition: "background 0.15s, border-color 0.15s",
              textAlign: "left",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = C.cardHover;
              (e.currentTarget as HTMLElement).style.borderTopColor = C.borderHover;
              (e.currentTarget as HTMLElement).style.borderRightColor = C.borderHover;
              (e.currentTarget as HTMLElement).style.borderBottomColor = C.borderHover;
              (e.currentTarget as HTMLElement).style.borderLeftColor = C.borderHover;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = C.surface;
              (e.currentTarget as HTMLElement).style.borderTopColor = "transparent";
              (e.currentTarget as HTMLElement).style.borderRightColor = "transparent";
              (e.currentTarget as HTMLElement).style.borderBottomColor = "transparent";
              (e.currentTarget as HTMLElement).style.borderLeftColor = "transparent";
            }}
          >
            <img
              src={w.adapter.icon}
              alt=""
              width={24}
              height={24}
              style={{ borderRadius: 6, display: "block", flexShrink: 0 }}
            />
            <span style={{ flex: 1 }}>{w.adapter.name}</span>
            {badge && (
              <span style={{
                fontFamily: FM, fontSize: 10, letterSpacing: "0.08em",
                color: C.textMuted, fontWeight: 500,
              }}>
                {badge}
              </span>
            )}
            {!badge && (
              <span style={{
                fontFamily: FM, fontSize: 10, letterSpacing: "0.06em",
                color: C.tealLight, textTransform: "uppercase",
                padding: "2px 8px",
                borderTop: `0.5px solid ${C.border}`,
                borderRight: `0.5px solid ${C.border}`,
                borderBottom: `0.5px solid ${C.border}`,
                borderLeft: `0.5px solid ${C.border}`,
                borderRadius: 100,
                background: "rgba(45, 212, 191, 0.08)",
              }}>
                DETECTED
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
