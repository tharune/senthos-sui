import { WalletProviders } from "./_providers/WalletProviders";
import { ThemeProvider, THEME_BOOTSTRAP_SCRIPT } from "./app/_lib/theme";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <title>Senthos · Structured Predictions</title>
        <link rel="icon" type="image/png" href="/senthos_appicon_256_full.png" />
        <link rel="apple-touch-icon" href="/senthos_appicon_256_full.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500;600;700;800&family=JetBrains+Mono:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
        {/* Apply the saved theme before React hydrates — avoids a flash of
            the wrong palette on first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        <style>{`
          /* ===== Theme variables ===== */
          :root {
            --c-bg: #05080c;
            --c-surface: #0a0f18;
            --c-card: #0d131c;
            --c-card-hover: #121a26;
            --c-card-gradient: linear-gradient(135deg, rgba(15, 21, 32, 0.7) 0%, rgba(5, 8, 12, 0.8) 100%);
            --c-card-gradient-hover: linear-gradient(160deg, rgba(15, 22, 34, 0.94) 0%, rgba(6, 10, 18, 0.96) 100%);
            --c-card-gradient-strong: linear-gradient(135deg, rgba(15, 21, 32, 0.85) 0%, rgba(5, 8, 12, 0.95) 100%);
            --c-panel-gradient: linear-gradient(180deg, rgba(13, 19, 28, 0.9) 0%, rgba(5, 8, 12, 0.95) 100%);
            --c-border: rgba(45, 212, 191, 0.08);
            --c-border-hover: rgba(45, 212, 191, 0.18);
            --c-border-strong: rgba(45, 212, 191, 0.22);
            --c-text-primary: #eef2f7;
            --c-text-secondary: #6b8099;
            --c-text-muted: #3a4f62;
            --c-text-strong: #d6dce6;
            --c-text-subtle: #a3b0c2;
            --c-text-dim: #8d9aad;
            --c-header-bg: rgba(5, 8, 12, 0.82);
            --c-page-glow: rgba(13, 148, 136, 0.06);
            --c-scrollbar-thumb: rgba(45, 212, 191, 0.15);
            --c-scrollbar-thumb-hover: rgba(45, 212, 191, 0.3);
            --c-edge-fade: #05080c;
          }

          [data-theme="light"] {
            --c-bg: #f4f6f9;
            --c-surface: #ffffff;
            --c-card: #ffffff;
            --c-card-hover: #eef1f5;
            --c-card-gradient: #ffffff;
            --c-card-gradient-hover: #f9fbfd;
            --c-card-gradient-strong: #ffffff;
            --c-panel-gradient: #ffffff;
            --c-border: rgba(13, 148, 136, 0.22);
            --c-border-hover: rgba(13, 148, 136, 0.45);
            --c-border-strong: rgba(13, 148, 136, 0.35);
            --c-text-primary: #0b111a;
            --c-text-secondary: #4a5668;
            --c-text-muted: #8a96a8;
            --c-text-strong: #0b111a;
            --c-text-subtle: #2d3544;
            --c-text-dim: #4a5668;
            --c-header-bg: rgba(244, 246, 249, 0.88);
            --c-page-glow: rgba(13, 148, 136, 0.12);
            --c-scrollbar-thumb: rgba(13, 148, 136, 0.25);
            --c-scrollbar-thumb-hover: rgba(13, 148, 136, 0.45);
            --c-edge-fade: #f4f6f9;
          }

          /* ===== Light-mode elevation (soft shadows instead of glow) ===== */
          [data-theme="light"] .senthos-card {
            box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.04);
          }
          [data-theme="light"] .senthos-card:hover {
            box-shadow: 0 2px 4px rgba(15, 23, 42, 0.06), 0 8px 20px rgba(15, 23, 42, 0.06);
          }

          /* ===== Base reset + theme-aware chrome ===== */
          *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
          html, body {
            background: var(--c-bg);
            color: var(--c-text-primary);
            font-family: 'Inter', system-ui, sans-serif;
            -webkit-font-smoothing: antialiased;
            transition: background-color 0.2s ease, color 0.2s ease;
          }
          ::-webkit-scrollbar { width: 4px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb {
            background: var(--c-scrollbar-thumb);
            border-radius: 2px;
          }
          ::-webkit-scrollbar-thumb:hover { background: var(--c-scrollbar-thumb-hover); }
          a { color: inherit; }
          input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
          input[type=range] { accent-color: #0d9488; }

          /* ===== Light-mode refinements for wallet-adapter dropdowns ===== */
          [data-theme="light"] .wallet-adapter-modal-wrapper {
            background: #ffffff !important;
            color: var(--c-text-primary) !important;
          }
          [data-theme="light"] .wallet-adapter-modal-list li {
            color: var(--c-text-primary) !important;
          }
        `}</style>
      </head>
      <body>
        <ThemeProvider>
          <WalletProviders>{children}</WalletProviders>
        </ThemeProvider>
      </body>
    </html>
  );
}
