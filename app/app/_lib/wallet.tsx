"use client";
/**
 * Solana wallet integration for the Senthos app shell.
 *
 * Supports Phantom, Solflare, and Backpack via their injected providers.
 * We intentionally avoid the full `@solana/wallet-adapter-*` stack — it pulls
 * in a pile of peer deps and styling baggage and we only need three ops:
 *
 *   - connect() / disconnect()
 *   - signAndSendTransaction(tx) — the wallet signs + broadcasts, returns a
 *     signature; we then poll the RPC for confirmation ourselves.
 *   - publicKey as a `PublicKey` object for building ATAs, etc.
 *
 * Each wallet exposes roughly the same shape on `window.<name>` so we wrap
 * them in a single `SolanaWalletProvider` interface. Detection paths are
 * wallet-exclusive (not `window.solana`, which is whichever wallet loaded
 * last) so we can reliably identify which ones are installed.
 *
 * RPC defaults to Solana devnet and can be overridden with
 * `NEXT_PUBLIC_SOLANA_RPC_URL` in `.env.local`.
 *
 * NOTE: this file is a Client Component. Anything that calls `useWallet()`
 * must also be a Client Component (i.e. have "use client" at the top).
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { C } from "./tokens";

// ---------- Unified provider shape (minimal subset we use) ----------

type WalletEvent = "connect" | "disconnect" | "accountChanged";

interface InjectedPublicKey {
  toString(): string;
  toBytes?(): Uint8Array;
}

interface SolanaWalletProvider {
  publicKey?: InjectedPublicKey | null;
  isConnected?: boolean;
  connect: (opts?: {
    onlyIfTrusted?: boolean;
  }) => Promise<{ publicKey?: InjectedPublicKey } | void | boolean>;
  disconnect: () => Promise<void>;
  signAndSendTransaction: (
    tx: Transaction | VersionedTransaction,
  ) => Promise<{ signature: string; publicKey?: InjectedPublicKey }>;
  signTransaction?: (
    tx: Transaction | VersionedTransaction,
  ) => Promise<Transaction | VersionedTransaction>;
  on?: (event: WalletEvent, handler: (arg: unknown) => void) => void;
  removeAllListeners?: (event: WalletEvent) => void;
  removeListener?: (event: WalletEvent, handler: (arg: unknown) => void) => void;
}

// ---------- Wallet registry ----------

export type WalletKey = "phantom" | "solflare" | "backpack";

interface WalletDescriptor {
  key: WalletKey;
  label: string;
  installUrl: string;
  /** Tiny single-character glyph used in the UI — cheaper than bundling SVGs. */
  glyph: string;
  /** Returns the injected provider if this wallet is installed, else null. */
  detect: () => SolanaWalletProvider | null;
}

type InjectedWindow = {
  phantom?: { solana?: SolanaWalletProvider & { isPhantom?: boolean } };
  solana?: SolanaWalletProvider & { isPhantom?: boolean };
  solflare?: SolanaWalletProvider & { isSolflare?: boolean };
  backpack?: SolanaWalletProvider & { isBackpack?: boolean };
  xnft?: { solana?: SolanaWalletProvider & { isBackpack?: boolean } };
};

export const WALLETS: WalletDescriptor[] = [
  {
    key: "phantom",
    label: "Phantom",
    installUrl: "https://phantom.app/download",
    glyph: "P",
    detect: () => {
      if (typeof window === "undefined") return null;
      const w = window as unknown as InjectedWindow;
      const p = w.phantom?.solana ?? (w.solana?.isPhantom ? w.solana : null);
      return p && p.isPhantom ? p : null;
    },
  },
  {
    key: "solflare",
    label: "Solflare",
    installUrl: "https://solflare.com/download",
    glyph: "S",
    detect: () => {
      if (typeof window === "undefined") return null;
      const w = window as unknown as InjectedWindow;
      const p = w.solflare;
      return p && p.isSolflare ? p : null;
    },
  },
  {
    key: "backpack",
    label: "Backpack",
    installUrl: "https://backpack.app/download",
    glyph: "B",
    detect: () => {
      if (typeof window === "undefined") return null;
      const w = window as unknown as InjectedWindow;
      const p = w.backpack ?? w.xnft?.solana;
      return p && p.isBackpack ? p : null;
    },
  },
];

function descriptorFor(key: WalletKey): WalletDescriptor {
  const d = WALLETS.find((w) => w.key === key);
  if (!d) throw new Error(`Unknown wallet: ${key}`);
  return d;
}

export function detectInstalledWallets(): WalletDescriptor[] {
  return WALLETS.filter((w) => w.detect() !== null);
}

// ---------- RPC ----------

export const SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

export const SOLANA_CLUSTER =
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";

let _connection: Connection | null = null;
export function getConnection(): Connection {
  if (!_connection) {
    _connection = new Connection(SOLANA_RPC_URL, "confirmed");
  }
  return _connection;
}

// ---------- Context ----------

type WalletStatus = "disconnected" | "connecting" | "connected" | "error";

interface WalletContextValue {
  /** Which wallet is currently active (if any). */
  activeKey: WalletKey | null;
  activeLabel: string | null;
  publicKey: PublicKey | null;
  status: WalletStatus;
  error: string | null;
  /** Descriptors for every wallet we know about. */
  knownWallets: WalletDescriptor[];
  /** Descriptors for wallets actually installed in this browser. */
  installedWallets: WalletDescriptor[];
  /**
   * Connect. If a specific wallet key is passed, connect to that one.
   * Otherwise: if exactly one wallet is installed, connect to it; if multiple,
   * surface a picker via the {@link pickerOpen} flag for the UI to render.
   */
  connect: (key?: WalletKey) => Promise<void>;
  disconnect: () => Promise<void>;
  /** True when the UI should show the wallet picker. */
  pickerOpen: boolean;
  openPicker: () => void;
  closePicker: () => void;
  /**
   * Deserialize a base64 transaction built by the backend, have the active
   * wallet sign + submit it, and return the signature. Caller is responsible
   * for waiting on confirmation (use {@link waitForConfirmation}).
   */
  signAndSendBase64Tx: (txBase64: string) => Promise<string>;
  /** Poll the RPC until the signature has at least `confirmed` commitment. */
  waitForConfirmation: (signature: string, timeoutMs?: number) => Promise<boolean>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

/** Last-used wallet key, persisted so return visitors go straight back to
 *  the wallet they used before (and we try a silent reconnect against it). */
const LAST_WALLET_STORAGE_KEY = "senthos:lastWallet";

function readLastWalletKey(): WalletKey | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_WALLET_STORAGE_KEY);
    if (raw && WALLETS.some((w) => w.key === raw)) return raw as WalletKey;
  } catch {
    // sandboxed storage — ignore
  }
  return null;
}

function writeLastWalletKey(key: WalletKey | null) {
  if (typeof window === "undefined") return;
  try {
    if (key) window.localStorage.setItem(LAST_WALLET_STORAGE_KEY, key);
    else window.localStorage.removeItem(LAST_WALLET_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const providerRef = useRef<SolanaWalletProvider | null>(null);
  const activeKeyRef = useRef<WalletKey | null>(null);
  const [activeKey, setActiveKey] = useState<WalletKey | null>(null);
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [status, setStatus] = useState<WalletStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [installedWallets, setInstalledWallets] = useState<WalletDescriptor[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Read the installed wallets once on mount (and re-check after a tick, since
  // some extensions inject after `DOMContentLoaded`).
  useEffect(() => {
    const refresh = () => setInstalledWallets(detectInstalledWallets());
    refresh();
    const t = setTimeout(refresh, 300);
    return () => clearTimeout(t);
  }, []);

  // ---- event wiring helper --------------------------------------------------

  const attachListeners = useCallback(
    (provider: SolanaWalletProvider, key: WalletKey) => {
      const onConnect = (pk: unknown) => {
        const pkStr =
          (pk as InjectedPublicKey | undefined)?.toString?.() ??
          provider.publicKey?.toString();
        if (pkStr) {
          setPublicKey(new PublicKey(pkStr));
          setStatus("connected");
          setError(null);
        }
      };
      const onDisconnect = () => {
        if (activeKeyRef.current === key) {
          setPublicKey(null);
          setStatus("disconnected");
          setActiveKey(null);
          activeKeyRef.current = null;
          providerRef.current = null;
          writeLastWalletKey(null);
        }
      };
      const onAccountChanged = (pk: unknown) => {
        const pkStr =
          (pk as InjectedPublicKey | undefined)?.toString?.() ??
          provider.publicKey?.toString();
        if (pkStr) {
          setPublicKey(new PublicKey(pkStr));
          setStatus("connected");
        } else {
          setPublicKey(null);
          setStatus("disconnected");
        }
      };

      provider.on?.("connect", onConnect);
      provider.on?.("disconnect", onDisconnect);
      provider.on?.("accountChanged", onAccountChanged);

      return () => {
        if (provider.removeListener) {
          provider.removeListener("connect", onConnect);
          provider.removeListener("disconnect", onDisconnect);
          provider.removeListener("accountChanged", onAccountChanged);
        } else if (provider.removeAllListeners) {
          provider.removeAllListeners("connect");
          provider.removeAllListeners("disconnect");
          provider.removeAllListeners("accountChanged");
        }
      };
    },
    [],
  );

  // ---- silent reconnect on mount -------------------------------------------

  useEffect(() => {
    const lastKey = readLastWalletKey();
    if (!lastKey) return;
    const desc = WALLETS.find((w) => w.key === lastKey);
    if (!desc) return;
    const provider = desc.detect();
    if (!provider) return;

    let detach: (() => void) | null = null;

    provider
      .connect({ onlyIfTrusted: true })
      .then((res) => {
        const pkStr =
          (res && typeof res === "object" && "publicKey" in res
            ? res.publicKey?.toString()
            : null) ?? provider.publicKey?.toString();
        if (pkStr) {
          providerRef.current = provider;
          activeKeyRef.current = desc.key;
          setActiveKey(desc.key);
          setPublicKey(new PublicKey(pkStr));
          setStatus("connected");
          detach = attachListeners(provider, desc.key);
        }
      })
      .catch(() => {
        // expected: user hasn't trusted us yet, or wallet doesn't support
        // onlyIfTrusted (Backpack historically didn't). Stay disconnected.
      });

    return () => {
      detach?.();
    };
  }, [attachListeners]);

  // ---- connect / disconnect -------------------------------------------------

  const connectInternal = useCallback(
    async (desc: WalletDescriptor) => {
      const provider = desc.detect();
      if (!provider) {
        setError(`${desc.label} wallet not detected.`);
        setStatus("error");
        return;
      }
      setStatus("connecting");
      setError(null);
      try {
        const res = await provider.connect();
        const pkStr =
          (res && typeof res === "object" && "publicKey" in res
            ? res.publicKey?.toString()
            : null) ?? provider.publicKey?.toString();
        if (!pkStr) throw new Error(`${desc.label} did not return a public key.`);
        providerRef.current = provider;
        activeKeyRef.current = desc.key;
        setActiveKey(desc.key);
        setPublicKey(new PublicKey(pkStr));
        setStatus("connected");
        writeLastWalletKey(desc.key);
        attachListeners(provider, desc.key);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStatus("error");
      }
    },
    [attachListeners],
  );

  const connect = useCallback(
    async (key?: WalletKey) => {
      setPickerOpen(false);
      if (key) {
        await connectInternal(descriptorFor(key));
        return;
      }
      // No explicit pick: auto-connect if exactly one wallet is installed,
      // otherwise open the picker.
      const installed = detectInstalledWallets();
      setInstalledWallets(installed);
      if (installed.length === 0) {
        setError("No Solana wallet detected. Install Phantom, Solflare, or Backpack.");
        setStatus("error");
        setPickerOpen(true); // show the install options
        return;
      }
      if (installed.length === 1) {
        await connectInternal(installed[0]);
        return;
      }
      setPickerOpen(true);
    },
    [connectInternal],
  );

  const disconnect = useCallback(async () => {
    const provider = providerRef.current;
    if (provider) {
      try {
        await provider.disconnect();
      } catch {
        // ignore
      }
    }
    providerRef.current = null;
    activeKeyRef.current = null;
    setActiveKey(null);
    setPublicKey(null);
    setStatus("disconnected");
    writeLastWalletKey(null);
  }, []);

  const openPicker = useCallback(() => setPickerOpen(true), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  // ---- signing --------------------------------------------------------------

  const signAndSendBase64Tx = useCallback(async (txBase64: string) => {
    const provider = providerRef.current;
    if (!provider) throw new Error("No wallet connected.");

    const bytes = Uint8Array.from(atob(txBase64), (c) => c.charCodeAt(0));
    // Backend returns a serialized legacy Transaction today. All three
    // wallets accept both legacy and versioned; try versioned first and
    // fall back to legacy.
    let tx: Transaction | VersionedTransaction;
    try {
      tx = VersionedTransaction.deserialize(bytes);
    } catch {
      tx = Transaction.from(bytes);
    }
    const { signature } = await provider.signAndSendTransaction(tx);
    return signature;
  }, []);

  const waitForConfirmation = useCallback(
    async (signature: string, timeoutMs: number = 45_000) => {
      const conn = getConnection();
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const s = await conn.getSignatureStatus(signature, {
          searchTransactionHistory: true,
        });
        const val = s.value;
        if (val) {
          if (val.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(val.err)}`);
          }
          const c = val.confirmationStatus;
          if (c === "confirmed" || c === "finalized") return true;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      return false;
    },
    [],
  );

  const activeLabel = activeKey ? descriptorFor(activeKey).label : null;

  const value = useMemo<WalletContextValue>(
    () => ({
      activeKey,
      activeLabel,
      publicKey,
      status,
      error,
      knownWallets: WALLETS,
      installedWallets,
      connect,
      disconnect,
      pickerOpen,
      openPicker,
      closePicker,
      signAndSendBase64Tx,
      waitForConfirmation,
    }),
    [
      activeKey,
      activeLabel,
      publicKey,
      status,
      error,
      installedWallets,
      connect,
      disconnect,
      pickerOpen,
      openPicker,
      closePicker,
      signAndSendBase64Tx,
      waitForConfirmation,
    ],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      <WalletPickerModal />
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet() must be used inside <WalletProvider>");
  }
  return ctx;
}

// ---------- Picker modal ----------

function WalletPickerModal() {
  const {
    pickerOpen,
    closePicker,
    connect,
    knownWallets,
    installedWallets,
  } = useWallet();

  if (!pickerOpen) return null;

  const installedKeys = new Set(installedWallets.map((w) => w.key));

  return (
    <div
      onClick={closePicker}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(4, 8, 12, 0.62)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 340,
          background: C.card,
          border: `0.5px solid ${C.border}`,
          borderRadius: 14,
          padding: 20,
          color: C.textPrimary,
          fontFamily: "inherit",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>Connect a wallet</div>
          <button
            onClick={closePicker}
            style={{
              background: "none",
              border: "none",
              color: C.textSecondary,
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              padding: 0,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {knownWallets.map((w) => {
            const installed = installedKeys.has(w.key);
            return (
              <button
                key={w.key}
                onClick={() => {
                  if (installed) {
                    void connect(w.key);
                  } else {
                    window.open(w.installUrl, "_blank", "noopener,noreferrer");
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "11px 12px",
                  borderRadius: 10,
                  border: `0.5px solid ${C.border}`,
                  background: installed ? "#17222f" : "transparent",
                  color: C.textPrimary,
                  cursor: "pointer",
                  fontSize: 13,
                  fontFamily: "inherit",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 7,
                    background: C.surface,
                    border: `0.5px solid ${C.border}`,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: 12,
                    color: C.textSecondary,
                  }}
                >
                  {w.glyph}
                </span>
                <span style={{ flex: 1 }}>{w.label}</span>
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.06em",
                    color: installed ? "#22c55e" : C.textSecondary,
                  }}
                >
                  {installed ? "DETECTED" : "INSTALL ↗"}
                </span>
              </button>
            );
          })}
        </div>
        <div
          style={{
            marginTop: 14,
            fontSize: 10,
            color: C.textSecondary,
            lineHeight: 1.5,
          }}
        >
          {SOLANA_CLUSTER === "mainnet-beta" ? (
            <>Your wallet must be set to <b>Mainnet</b>.</>
          ) : (
            <>
              Your wallet must be set to{" "}
              <b>{SOLANA_CLUSTER.charAt(0).toUpperCase() + SOLANA_CLUSTER.slice(1)}</b>{" "}
              and funded with a small amount of {SOLANA_CLUSTER} SOL.
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Header connect button ----------

export function WalletConnectButton({
  compact = false,
}: {
  compact?: boolean;
}) {
  const {
    publicKey,
    status,
    connect,
    disconnect,
    installedWallets,
    activeLabel,
    openPicker,
  } = useWallet();

  const pkShort = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}`
    : null;

  const baseStyle: React.CSSProperties = {
    padding: compact ? "5px 10px" : "7px 14px",
    borderRadius: 8,
    border: `0.5px solid ${C.border}`,
    background: status === "connected" ? "#0a1f10" : C.card,
    color: C.textPrimary,
    fontSize: compact ? 11 : 12,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "inherit",
    fontVariantNumeric: "tabular-nums",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    transition: "background 0.15s",
    whiteSpace: "nowrap",
  };

  // No wallet installed → open picker so the user sees install links.
  if (installedWallets.length === 0 && status !== "connecting") {
    return (
      <button onClick={openPicker} style={baseStyle} title="Install a Solana wallet">
        Connect Wallet
      </button>
    );
  }

  if (status === "connected" && publicKey) {
    return (
      <button
        onClick={disconnect}
        style={baseStyle}
        title={`${activeLabel ?? "Wallet"}: ${publicKey.toBase58()} (click to disconnect)`}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: "#22c55e",
            display: "inline-block",
          }}
        />
        {compact ? pkShort : `${activeLabel ?? "Wallet"} · ${pkShort}`}
      </button>
    );
  }

  if (status === "connecting") {
    return (
      <button disabled style={{ ...baseStyle, opacity: 0.6, cursor: "default" }}>
        Connecting…
      </button>
    );
  }

  return (
    <button
      onClick={() => connect()}
      style={baseStyle}
      title="Connect a Solana wallet"
    >
      {installedWallets.length === 1
        ? `Connect ${installedWallets[0].label}`
        : "Connect Wallet"}
    </button>
  );
}

// ---------- SPL token helpers (no @solana/spl-token dep) ----------

/**
 * Hardcoded SPL program IDs. We avoid pulling in `@solana/spl-token` because
 * its full surface isn't worth the bundle size for what we need.
 */
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

/**
 * Derive the Associated Token Account address for `owner` + `mint`.
 * Equivalent to `@solana/spl-token::getAssociatedTokenAddressSync`.
 */
export function getAssociatedTokenAddress(
  mint: PublicKey,
  owner: PublicKey,
): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

/**
 * Fetch a token balance. Returns `0` if the ATA doesn't exist yet
 * (common for users who've never received the token).
 */
export async function fetchTokenBalance(
  mint: PublicKey,
  owner: PublicKey,
): Promise<{ amountRaw: bigint; decimals: number; uiAmount: number }> {
  const ata = getAssociatedTokenAddress(mint, owner);
  const conn = getConnection();
  try {
    const res = await conn.getTokenAccountBalance(ata, "confirmed");
    return {
      amountRaw: BigInt(res.value.amount),
      decimals: res.value.decimals,
      uiAmount: res.value.uiAmount ?? 0,
    };
  } catch (err: unknown) {
    // ATA doesn't exist → the user just has 0 of this mint.
    const msg = err instanceof Error ? err.message : String(err);
    if (/could not find account/i.test(msg) || /Account not found/i.test(msg)) {
      return { amountRaw: 0n, decimals: 0, uiAmount: 0 };
    }
    throw err;
  }
}

// ---------- Balance hooks ----------

/**
 * Poll interval (ms) for balance hooks. Devnet confirmations happen in ~1s,
 * so 12s is a reasonable balance between freshness and RPC politeness.
 */
const BALANCE_POLL_MS = 12_000;

/**
 * Live on-chain balance for an arbitrary SPL mint, belonging to the currently
 * connected wallet. Auto-refreshes at {@link BALANCE_POLL_MS}.
 *
 * Returns `null` when the wallet isn't connected yet (so the caller can fall
 * back to sandbox state or a placeholder).
 *
 * Usage:
 *     const usdc = useTokenBalance(USDC_MINT);
 *     usdc?.uiAmount // number | undefined
 */
export function useTokenBalance(mintBase58: string | PublicKey | null): {
  uiAmount: number;
  amountRaw: bigint;
  decimals: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} | null {
  const { publicKey, status } = useWallet();
  const [state, setState] = useState<{
    uiAmount: number;
    amountRaw: bigint;
    decimals: number;
    loading: boolean;
    error: string | null;
  }>({
    uiAmount: 0,
    amountRaw: 0n,
    decimals: 0,
    loading: false,
    error: null,
  });

  const mint = useMemo<PublicKey | null>(() => {
    if (!mintBase58) return null;
    if (mintBase58 instanceof PublicKey) return mintBase58;
    try {
      return new PublicKey(mintBase58);
    } catch {
      return null;
    }
  }, [mintBase58]);

  const refresh = useCallback(async () => {
    if (!publicKey || !mint) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await fetchTokenBalance(mint, publicKey);
      setState({
        uiAmount: r.uiAmount,
        amountRaw: r.amountRaw,
        decimals: r.decimals,
        loading: false,
        error: null,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, loading: false, error: msg }));
    }
  }, [publicKey, mint]);

  useEffect(() => {
    if (status !== "connected" || !publicKey || !mint) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      void refresh();
    };
    tick();
    const id = setInterval(tick, BALANCE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [status, publicKey, mint, refresh]);

  if (status !== "connected" || !publicKey || !mint) return null;
  return { ...state, refresh };
}

/**
 * Convenience hook for the user's USDC balance (Circle devnet mint by
 * default, overridable via `NEXT_PUBLIC_USDC_MINT`).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useUsdcBalance() {
  // We import USDC_MINT lazily so this file doesn't create a static import
  // cycle with `_lib/tokens.ts` (which imports nothing from here, but the
  // rule of thumb is cheap insurance).
  const mint = process.env.NEXT_PUBLIC_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
  return useTokenBalance(mint);
}

// ---------- Utility: derive an Explorer URL for a signature ----------

export function explorerTxUrl(signature: string): string {
  const cluster = SOLANA_CLUSTER === "mainnet-beta" ? "" : `?cluster=${SOLANA_CLUSTER}`;
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
}

/**
 * Utility: derive an Explorer URL for an account (ATA, mint, vault PDA, etc.)
 */
export function explorerAccountUrl(address: string | PublicKey): string {
  const a = address instanceof PublicKey ? address.toBase58() : address;
  const cluster = SOLANA_CLUSTER === "mainnet-beta" ? "" : `?cluster=${SOLANA_CLUSTER}`;
  return `https://explorer.solana.com/address/${a}${cluster}`;
}
