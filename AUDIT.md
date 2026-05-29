# Deep Audit  -  SCBC-Hackathon-2026 Combined Repo
_Date: 2026-04-18 · Host: macOS (Node 22.19.0, no Rust/Solana toolchain)_

## TL;DR
| Component | Status | Notes |
|---|---|---|
| Next.js 16 frontend | ✅ Running on `http://localhost:3000` | Senthos UI, 55 KB HTML, builds clean |
| Express backend | ✅ Running on `http://localhost:3001` | Needed 3 fixes (see patches) |
| Polymarket integration | ✅ Fully working | Real data, live prices |
| Supabase integration | ⚠️ Placeholder credentials | Reads return empty; writes fail silently |
| On-chain Anchor programs | ✅ Deployed on devnet | Both vault + PPN executable at expected addresses |
| Local Anchor build | ❌ Missing toolchain | No `anchor`/`solana`/`cargo`/`rustc` locally |
| ML correlation deliverables | ✅ Copied in | 11 files, 5 MB tarball, metrics JSON |

---

## 1. Frontend  -  Next.js 16 (Senthos UI)

- **Source**: `main` branch
- **Port**: 3000
- **Build**: `npm run build` succeeds in ~1 s (Turbopack)
- **Runtime**: static prerender of `/`, returns 55,187 bytes of HTML
- **Title**: `Senthos · Structured Predictions`
- **Stack**: Next.js 16.2.4, React 19.2.4, Tailwind 4
- **Status**: ✅ Working

### Tweaks required
The root `tsconfig.json` was tightened so Next.js no longer type-checks the backend/anchor sources. Target bumped to `ES2020` (backend uses `BigInt` literals).

---

## 2. Backend  -  Express / TypeScript

- **Source**: `main` + on-chain files from `phase-15-devnet-deploy`
- **Port**: 3001
- **Build**: `npm run build` succeeds (`tsc`)
- **Runtime**: `tsx watch src/index.ts`
- **Status**: ✅ Running

### Endpoint probe results
| Route | HTTP | Response (truncated) |
|---|---|---|
| `GET /api/health` | 200 | `{"status":"degraded",...,"supabase":{"status":"error"},"polymarket":{"status":"ok","latency_ms":152}}` |
| `GET /api/docs` | 200 | Full API docs JSON, 42 endpoints documented |
| `GET /api/markets?limit=2` | 200 | Real Polymarket markets (Russia-Ukraine Ceasefire, etc.) |
| `GET /api/markets/search/bitcoin` | 200 | 20 matched markets |
| `GET /api/bundles` | 200 | `[]` (empty, DB unreachable) |
| `GET /api/bundles/name/LK-90-0430` | 404 | `{"error":"Bundle not found: LK-90-0430"}` |
| `GET /api/leaderboard` | 200 | `{"count":0,"wallets":[]}` |
| `GET /api/admin/stats` | 200 | All-zero stats object |
| `GET /api/admin/transactions` | 200 | `{"count":0,"transactions":[]}` |
| `GET /api/demo/status` | 200 | `{"demo_wallet":"demo-wallet-001",...}` |
| `GET /api/webhook/health` | 200 | `{"status":"ok","service":"helius-webhook"}` |
| `GET /api/nav/<fake-uuid>` | 404 | Useful not-found message |
| `GET /api/deposit/portfolio/<wallet>` | 200 | Empty portfolio summary |
| `GET /api/alerts/<wallet>` | 200 | Empty alerts summary |
| `GET /api/ppn/portfolio/<wallet>` | 200 | Empty vaults with `principal_protected: true` |

### What doesn't work without credentials
- Anything that writes to Supabase (`POST /api/bundles`, `POST /api/deposit`, etc.) will return 500s once actually invoked  -  the fake URL resolves but the REST endpoint is not a Supabase instance.
- The 2-minute cron `refreshAllBundles()` fires, hits the fake URL, logs an error after ~7 s, then sleeps again.
- `/api/sse/*` streams will open but emit errors on first tick.

### What doesn't work without a real Solana wallet / USDC
- `POST /api/bundles` and on-chain-bridge helpers (`initializeOnchainVaultForBundle`) need a valid `AUTHORITY_KEYPAIR` and will throw `Missing required env var` the moment they're called.
- `POST /api/deposit` builds a user-signed tx assuming a real Phantom pubkey; without that it throws.

### Fixes applied during merge
1. **`app.options('*', cors())` removed**  -  Express 4.22 ships with path-to-regexp that rejects the bare `*`. This was silently eating all subsequent requests after the first, which caused every endpoint to hang for 30+ seconds. The regular `cors()` middleware already handles preflight.
2. **`express-rate-limit` migrated to v8**  -  the repo uses v8.3.2 but still had v6-style options (`max`, `standardHeaders: true`). The v8 library silently stalls requests under certain localhost configurations. Switched to `limit`, `standardHeaders: 'draft-7'`, and explicit `validate.trustProxy: false`. Also added a `DISABLE_RATE_LIMIT=true` env override used locally.
3. **`config/index.ts` softened**  -  was `process.exit(1)` on missing Supabase envs; now logs a warning so the server can boot for demos.
4. **`requestLogger`** now logs on arrival for easier debugging.
5. **Daemonisation**  -  `nohup npm run dev &` alone is not enough on macOS; the process ends up `TN` (stopped-by-tty). Use a double-sub-shell: `(nohup bash -c 'exec npm run dev' < /dev/null > log 2>&1 &)`.

### Security notes
- 3 high-severity npm audit warnings remain in `backend/` (unrelated to our merge; pre-existing).
- Rate limiter disabled locally  -  **must re-enable for production** and configure `trust proxy` correctly.

---

## 3. On-chain  -  Anchor programs

- **Source**: `phase-15-devnet-deploy` branch
- **Programs**:
  - `traxis_vault` @ `DY7NAimrQZY7SxveXTb38XN7H69wAXjZZj8DRHto4Aat`
  - `traxis_ppn`  @ `3wDHsr9EnWkF968zYmSsj4hShNkAyFV6r7zxPrjqWNsp`

### Devnet deployment check (getAccountInfo)
| Program | Deployed | Lamports | Owner | Executable |
|---|---|---|---|---|
| traxis_vault | ✅ | 1,141,440 | `BPFLoaderUpgradeab1e11…` | yes |
| traxis_ppn   | ✅ | 1,141,440 | `BPFLoaderUpgradeab1e11…` | yes |

_(Note: `STATE.md` in the repo still claims PPN is "NOT YET DEPLOYED"  -  this is stale. Both programs are live on devnet at the addresses above.)_

### What works
- Reading on-chain state via the backend's `getVaultState(bundleId)`  -  tested that the RPC path works (devnet responds). Would return a real value if a bundle had been initialised on-chain.
- PDA derivation (`deriveVaultPda`, `deriveTraxMint`, `deriveUsdcVault`, `derivePpnNote`) is pure CPU, no RPC  -  confirmed these functions import cleanly with ES2020 target.
- IDL loading  -  `backend/src/idl/traxis_vault.json` and `traxis_ppn.json` are present and loaded on first program build.

### What doesn't work locally
- `anchor build` / `anchor test`  -  no Rust toolchain, no Solana CLI, no anchor binary on this host. `programs/*` source is intact but not compilable here.
- `scripts/deploy-devnet.sh`  -  same reason (requires anchor).
- Any authority-signed call from the backend (`initializeVault`, `resolveLeg`, `finalizeVault`, `adminWithdrawFees`)  -  requires a real `AUTHORITY_KEYPAIR` which the placeholder env doesn't provide.

---

## 4. ML correlation model

- **Source**: `ml-model` branch
- **Location**: `traxis-correlation-deliverables/`
- **Status**: ✅ Artifacts copied, no runtime integration

### Files
- `README.md`, `SHA256SUMS.txt`, `manifest-*.txt`
- Step artifacts: `model_metrics_step12.json`, `optimization_metrics_step13.json`, `monte_carlo_step14.json`, `walkforward_step16_metrics.json`, `final_audit_step18.json`
- `final_summary_step19.{json,md}`, `detailed_audit_report.{json,md}`, `local_recheck_report.json`
- Production bundle: `traxis-correlation-production-20260417T071458Z.tar.zst` (~5.5 MB)

### Key metrics (`final_summary_step19.json`)
- execution_status: `complete`
- all_checks_passed: `true`
- classifier_precision: **0.9432**
- walk-forward mean improvement: **0.0482**, p-value **3.1e-05**
- VaR95/99: **0.0243 / 0.0340**; CVaR95/99: **0.0303 / 0.0390**

### What works / doesn't
- ✅ Artifacts are browseable via the filesystem, checksums verifiable against `SHA256SUMS.txt`.
- ❌ The production `.tar.zst` contains Python training code referencing `/root/traxis-correlation/...`  -  extracting + running it requires Python + scikit-learn + the training dataset, none present on this host.
- ❌ No wiring in the backend routes to surface these metrics; they're static deliverables only.

---

## 5. What would be required to go fully live
1. **Supabase project** with the 6-table schema from `backend/src/db/schema.sql` + `schema_onchain.sql` loaded.
2. **Real Solana keypair** funded on devnet (see `15-fund-wallet.command`), pointed to by `AUTHORITY_KEYPAIR` in `backend/.env`.
3. **Helius API key** so the webhook endpoint has real traffic.
4. **Rust + Anchor 0.30.1 + Solana 1.18.26** toolchain if you want to rebuild/redeploy programs (already deployed on devnet otherwise).
5. **Python env** (`pandas`, `scikit-learn`, `numpy`) if you want to re-run the correlation model from the tarball.

## 6. Risk & polish items
- Open npm audit high-severity issues in `backend/` (3)  -  run `npm audit` + assess.
- `STATE.md` is outdated (claims PPN not deployed  -  it is).
- Rate limiter is currently bypassed (`DISABLE_RATE_LIMIT=true`)  -  re-enable before exposing the API publicly and wire up `trust proxy` correctly.
- The frontend currently has **no calls to the backend**  -  the Senthos page (`app/page.tsx`) is a static marketing surface. Wiring it to `/api/bundles`, `/api/nav`, and `/api/ppn/*` is the next obvious hackathon milestone.
- Dependabot-style: `@tailwindcss/postcss ^4` + Tailwind 4 is still in beta; expect churn.
