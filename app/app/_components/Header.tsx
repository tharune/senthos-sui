"use client";

import React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { C, FD } from "../_lib/tokens";
import { ThemeToggle } from "../_lib/theme";

const ConnectButton = dynamic(
  async () => (await import("./ConnectButton")).ConnectButton,
  { ssr: false },
);

const NAV_LEFT = [
  { id: "portfolio", label: "Portfolio",      href: "/app/portfolio" },
  { id: "basket",    label: "Constellations", href: "/app/basket" },
  { id: "tranche",   label: "Tranches",       href: "/app/tranche" },
  { id: "ppn",       label: "PPN",            href: "/app/ppn" },
  { id: "distribution", label: "Distribution", href: "/app/distribution" },
  { id: "docs",      label: "About",          href: "/app/docs" },
];

export function Header() {
  const pathname = usePathname();

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500;600;700&family=JetBrains+Mono:wght@300;400;500&display=swap');
        .senthos-nav-link:hover { color: ${C.textPrimary} !important; }
        /* Flatten the wallet-adapter button chrome to match the rest of the header. */
        .wallet-adapter-button {
          height: 32px !important;
          padding: 0 14px !important;
          border-radius: 6px !important;
          background: transparent !important;
          border: 0.5px solid ${C.border} !important;
          color: ${C.textPrimary} !important;
          font-family: 'Inter', system-ui, sans-serif !important;
          font-size: 12px !important;
          font-weight: 500 !important;
          letter-spacing: 0.02em !important;
          box-shadow: none !important;
          line-height: 32px !important;
        }
        .wallet-adapter-button:not([disabled]):hover {
          background: ${C.surface} !important;
          border-color: ${C.borderHover} !important;
        }
        .wallet-adapter-button-trigger {
          background: transparent !important;
        }
        .wallet-adapter-button-start-icon,
        .wallet-adapter-button-end-icon {
          margin: 0 6px 0 0 !important;
        }
      `}</style>
      <header style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        background: C.headerBg,
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderBottom: `0.5px solid ${C.border}`,
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        gap: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24, flex: 1, minWidth: 0 }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", flexShrink: 0 }}>
            <Image src="/senthos_full.png" alt="Senthos" width={22} height={22} priority />
            <span style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, fontFamily: FD, letterSpacing: "0.14em" }}>
              SENTHOS
            </span>
          </Link>

          <nav style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            overflowX: "auto",
            whiteSpace: "nowrap",
            scrollbarWidth: "none",
          }}>
            {NAV_LEFT.map((n) => {
              const active = pathname === n.href || (n.href !== "/app" && pathname?.startsWith(n.href));
              return (
                <Link
                  key={n.id}
                  href={n.href}
                  className="senthos-nav-link"
                  style={{
                    position: "relative",
                    padding: "4px 0",
                    fontSize: 13,
                    fontWeight: 400,
                    fontFamily: FD,
                    letterSpacing: "0.01em",
                    textDecoration: "none",
                    color: active ? C.textPrimary : C.textSecondary,
                    transition: "color 0.15s linear",
                  }}
                >
                  {n.label}
                  {active && (
                    <span
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: -18,
                        height: 1,
                        background: C.tealLight,
                      }}
                    />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <ThemeToggle />
          <ConnectButton variant="header" />
        </div>
      </header>
    </>
  );
}

export function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <main style={{
      minHeight: "calc(100vh - 56px)",
      padding: "36px 40px 60px",
      maxWidth: 1440,
      margin: "0 auto",
      position: "relative",
    }}>
      <div style={{
        position: "fixed",
        inset: 0,
        background: `radial-gradient(ellipse 80% 50% at 50% -10%, ${C.pageGlow} 0%, transparent 70%)`,
        pointerEvents: "none",
        zIndex: 0,
      }} />
      <div style={{ position: "relative", zIndex: 1 }}>
        {children}
      </div>
    </main>
  );
}
