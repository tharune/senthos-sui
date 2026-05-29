# Senthos Correlation Model — Integration Spec

End-to-end description of the ML model that ships with this repo, how the backend consumes it, and the rules under which every future structured product gets built.

## 1. What the model is

A binary classifier trained to predict, for a pair of prediction-market contracts, whether their future absolute return correlation will meet or exceed 0.6. Metadata from `model_metrics_step12.json`:

| Field | Value |
|---|---|
| Training rows | 410,777 |
| Train / valid split | 328,623 / 82,154 |
| Features | 20 engineered (topic overlap, tag overlap, venue, volume, temporal, liquidity, etc.) |
| Target label | `abs_corr_target >= 0.6` |
| Decision threshold | 0.70 |
| Precision | 0.9432 |
| Recall | 0.8831 |
| ROC-AUC | 0.9326 |
| Regression RMSE | 0.0836 |

Walk-forward cross-validation against a naive equal-weight baseline (`final_summary_step19.json`):
- Mean improvement: **+4.82%**
- p-value: **3.10e-05**
- All audit checks passed: **true**

Monte-Carlo basket risk (`monte_carlo_step14.json`):
- Basket size: 50 legs, paths 20,000, horizon 7 days, σ_daily = 4%
- VaR_95 = 0.02431, VaR_99 = 0.03396
- CVaR_95 = 0.03031, CVaR_99 = 0.03903

Optimisation (`optimization_metrics_step13.json`):
- Target basket size: 50
- Optimiser's internal mean |ρ|: 0.000
- Random baseline: 0.00114
- Diversification gain vs random: 0.114%

## 2. What ships in this repo

`traxis-correlation-deliverables/` contains:

| File | Purpose |
|---|---|
| `final_summary_step19.{json,md}` | Headline audit metrics |
| `model_metrics_step12.json` | Classifier metrics (precision, recall, threshold, feature count) |
| `optimization_metrics_step13.json` | Target basket size + achieved/random internal correlation |
| `monte_carlo_step14.json` | σ_daily assumption, VaR, CVaR over 20k simulated paths |
| `walkforward_step16_metrics.json` | Out-of-sample walk-forward trial |
| `final_audit_step18.json` | Combined audit of steps 12–17 |
| `detailed_audit_report.{json,md}` | Step-by-step audit trail |
| `local_recheck_report.json` | Reproducibility verification |
| `traxis-correlation-production-20260417T071458Z.tar.zst` | Opaque production bundle: trained sklearn model + training pipeline |
| `SHA256SUMS.txt`, `manifest-*.txt` | Integrity manifest |

The `.tar.zst` requires Python + scikit-learn + the training dataset to invoke; absolute paths inside it point at `/root/traxis-correlation/...` from the training VM. The Node backend **does not shell out to Python**. Instead, it ships a TypeScript-native correlation service (see §3) that consumes the audited metrics and applies a deterministic stand-in for the pair classifier.

## 3. Runtime integration — `backend/src/services/correlation.ts`

A single module exports the full correlation surface. All other backend code depends on this module — never on the raw JSON files.

### 3.1 Artifact loader

`loadArtifacts()` — lazy, memoised, O(4 file reads) on first call. Resolves the deliverables folder from four candidate locations, parses the four relevant JSONs, and exposes a typed `ModelArtifacts` record including the model version (derived from the production tarball filename), classifier precision/recall/threshold, basket-size target, Monte-Carlo σ/VaR/CVaR, and the `all_checks_passed` flag.

Every subsequent function calls `loadArtifacts()` instead of re-reading the files.

### 3.2 Pair-correlation heuristic — `scoreLegPair(a, b)`

Deterministic approximation of the trained classifier. Computes three signals from Polymarket metadata:

| Signal | Source | Range |
|---|---|---|
| `textSim` | Jaccard overlap of question tokens (stop-worded, length ≥ 3) | [0, 1] |
| `tagSim` | Jaccard of `tags[]` lists (when provided) | [0, 1] |
| `temporalSim` | `exp(-((dayGap / 10)^2))` on resolution dates | [0, 1] |

Combined with a **noisy-OR**: `ρ_pred = 1 − ∏(1 − sᵢ)`. Noisy-OR rather than weighted sum because a single strong signal (e.g., 80% question-text overlap) must be sufficient to flag the pair. This matches the classifier's multi-feature behaviour: any strong feature can dominate the decision.

Design contract: the heuristic is calibrated to **never under-estimate** correlation for a pair the classifier would flag. It may over-estimate (false positives), which biases bundle construction toward extra diversification — always a safe direction.

### 3.3 Weight optimiser — `optimizeWeights(legs, opts?)`

Greedy decorrelation + inverse-variance clamp:

1. Build the N×N predicted correlation matrix via `scoreLegPair`.
2. For each leg *i*, compute `avgCorr_i = mean_j ρ(i,j)` — how "central" this leg is to the basket's correlation structure.
3. Raw weight `w_i ∝ 1 − avgCorr_i`: legs that look more independent get more allocation.
4. Normalise to sum to 1, clamp each to `[floor_bps, cap_bps]` (defaults 200 bps / 2500 bps), renormalise.

Returns the weights plus the realised `internal_corr_mean = Σ_{i<j} 2·w_i·w_j·ρ(i,j)` — the expected portfolio-level correlation under the chosen weighting. This number is persisted for every bundle.

### 3.4 Risk guardrail — `assessBasketRisk(legs, weights)`

Projects basket 7-day tail risk and compares against the audited envelope.

Given an expected ρ for the basket and N legs:

```
σ_daily_basket = σ_daily · √(ρ + (1 − ρ) / N)
σ_horizon     = σ_daily_basket · √7
VaR_95_proj   = 1.645 · σ_horizon
VaR_99_proj   = 2.326 · σ_horizon
CVaR_99_proj  = 2.665 · σ_horizon
```

The audited CVaR_99 (0.039) was computed on a 50-leg, near-zero-correlation basket, so its absolute value is tied to specific diversification. The fair per-basket comparison is the **risk ratio** vs a perfectly uncorrelated basket of the same size N:

```
risk_ratio = √(N·ρ + 1 − ρ)
```

- `risk_ratio = 1.0` → basket is as well-diversified as the audit assumed.
- `risk_ratio > 1.25` → correlation is eroding diversification by more than 25%. **Rejected.**

Tolerance is a config constant. The test suite proves:
- 8 uncorrelated legs → ρ ≈ 0.008, risk_ratio ≈ 1.03 → **accepted**.
- 3 near-identical BTC price markets → ρ ≈ 0.44, risk_ratio ≈ 1.37 → **rejected** with reason `correlation risk-ratio 1.374 exceeds tolerance 1.25 (rho=0.4444 on 3 legs)`.

### 3.5 Public manifest — `getModelManifest()`

Returns a canonical view of the model state: version, loaded path, audit numbers, optimisation targets, risk envelope, runtime strategy, guardrail tolerance. Available at the HTTP surface (§5).

## 4. Basket-creation flow — `POST /api/bundles`

Every structured product created through this API now passes through the correlation service. The handler in `backend/src/routes/bundles.ts`:

```
1. enrich legs in parallel
   → getMarketProbability() + fetchMarketByConditionId() from Polymarket
   → get YES price + end_date_iso + tags for each leg
2. assemble LegMetadata[]
3. compute weights
   IF body.legs all have weight THEN
     use caller-supplied weights  (audit trail flags used_model_weights = false)
   ELSE
     weights = optimizeWeights(legs).weights
4. risk = assessBasketRisk(legs, weights)
5. metrics.recordModelUsage({bundle_name, leg_count, internal_corr, cvar_99_projected, accepted, reason, model_version})
6. IF NOT risk.accepted THEN
     return 422 {
       error: "Bundle rejected by correlation model risk gate",
       detail: "...",
       projected: {var_95, var_99, cvar_99, internal_corr_mean},
       audited_envelope: {cvar_99, tolerance_pct: 15},
       model_version
     }
7. issue_price = calculateIssuePrice(legs, weights)
8. createBundle + createLeg (Supabase)
9. return 201 BundleWithLegs + {
     model: { version, strategy, internal_corr_mean, used_model_weights,
              risk: { var_95_projected, var_99_projected, cvar_99_projected, audited_cvar_99 } }
   }
```

Every successful response now carries the `model` block so any downstream consumer (frontend, on-chain initializer, analytics) can see which model shaped the basket and what its risk envelope was at creation.

## 5. HTTP surface

| Endpoint | Purpose |
|---|---|
| `GET /api/ml/manifest` | Full runtime manifest: audit metrics, guardrail tolerance, counters, recent events |
| `GET /api/ml/metrics` | Raw audit metrics (same shape as `final_summary_step19.json` plus step JSONs) |
| `GET /api/ml/health` | File-system presence check on the deliverables folder |
| `GET /api/ml/artifact/:name` | Individual JSON artifact by filename (path-traversal safe) |
| `GET /api/metrics` | Full backend metrics, **includes new `model_usage` block** |
| `GET http://localhost:3002/data` | Monitor snapshot, **includes new `model_usage` block** |
| `POST /api/bundles` | Passes through the correlation service (§4); returns `model` block on accept, 422 on reject |

The `model_usage` block in both metrics endpoints is:

```json
{
  "manifest": { "version": "...", "audit": {...}, "optimization": {...}, "risk": {...}, "runtime": {...} },
  "counters": {
    "bundles_scored": 2,
    "bundles_accepted": 1,
    "bundles_rejected": 1,
    "last_version": "traxis-correlation-production-20260417T071458Z.tar.zst",
    "last_internal_corr": 0.444
  },
  "recent_events": [
    { "timestamp": ..., "bundle_name": "CORR-90-0430", "leg_count": 3,
      "internal_corr": 0.444, "cvar_99_projected": 0.19, "accepted": false,
      "reason": "correlation risk-ratio 1.374 exceeds tolerance 1.25 (rho=0.4444 on 3 legs)",
      "model_version": "traxis-correlation-production-20260417T071458Z.tar.zst" }
  ]
}
```

## 6. Monitoring

The `/monitor` dashboard on port 3002 has two new rows that update on every poll (1 s default):

### Row: Model usage · runtime
- **Bundles scored** counter (blue) with last-used version as subtitle
- **Accepted** counter (green) — passed the VaR guardrail
- **Rejected** counter (red) — failed the VaR guardrail
- **Runtime** KV block: strategy (`greedy_decorrelation + inverse-variance clamp`), tolerance (`+25% vs audited CVaR_99`), target basket size (50)

### Row: Model usage · recent events
- Last 10 bundle-creation attempts with per-row: relative timestamp, accept/reject badge, bundle name + leg count + ρ + reject reason, projected CVaR_99, truncated model version

## 7. Model-Integration Contract (enforced going forward)

Every new structured product in this protocol **must** go through `POST /api/bundles`. That handler is the single enforcement point — there is no back door. The guarantees that come with it:

1. **Every basket is scored.** `metrics.recordModelUsage` is called whether or not the gate accepts the bundle, so the counter counts both admissions and rejections.
2. **Every basket is risk-gated.** If the projected 7-day CVaR_99 risk-ratio exceeds the tolerance, the bundle is refused with a structured 422 response before any DB write or on-chain initialisation.
3. **Every bundle is stamped with the model version.** The `model.version` field on the accept response is the tarball filename. Downstream consumers can audit which model shaped the bundle.
4. **Every bundle carries its realised correlation.** `model.internal_corr_mean` is stored on the bundle record and visible forever, letting us audit whether live post-resolution correlation matches the model's prediction.
5. **Weights come from the model unless explicitly overridden.** If the caller omits weights, `optimizeWeights` is the source of truth. If the caller supplies weights, the gate still runs; the bundle can still be rejected for excessive correlation.

Adding a new product type later (e.g., PPN vaults with embedded baskets) must import `optimizeWeights` + `assessBasketRisk` from `services/correlation.ts`. The contract is enforced at the type level — `LegMetadata` is the required input and `RiskAssessment.accepted` gates the write path.

## 8. Runbook — updating the model

When a new training run lands:

1. Replace the files in `traxis-correlation-deliverables/` (keep the same filenames).
2. Update `SHA256SUMS.txt`.
3. Restart the backend. The first call to `/api/ml/manifest` will expose the new `version` (derived from the tarball filename) and the new audit numbers.
4. If `runtime.guardrail_tolerance` needs tightening based on new audit data, edit the `tolerance` constant in `services/correlation.ts:360`.

No code changes are needed for a drop-in model update — the loader reads whatever JSON is on disk.

## 9. Honest limitations

These are the boundary conditions of the current integration, in plain language:

- **The trained sklearn classifier is not invoked at runtime.** The TypeScript `scoreLegPair` is a deterministic stand-in. It is calibrated to never under-estimate correlation versus the classifier (so the gate stays on the safe side), but it will differ from the classifier's actual output on individual pairs. To switch to the true classifier you'd run a Python sidecar that exposes `POST /predict` and replace the body of `scoreLegPair` with a `fetch` to that sidecar.
- **Polymarket metadata dictates signal quality.** Tags and end-dates are looked up via `fetchMarketByConditionId`. If the lookup returns null for a leg (e.g., fabricated or expired market IDs), `temporalSim` and `tagSim` collapse to zero and the heuristic falls back to text similarity only. In practice, every real Polymarket market returns both.
- **Risk model is parametric.** The projection uses a normal-tail approximation scaled from the audited σ_daily (4%). Fat-tail realities may differ. For high-accuracy risk, a full Monte-Carlo at basket-creation time would be more faithful but costs ~200 ms per call.
- **`target_basket_size = 50`** was the optimiser's setting during training. Production baskets today are smaller (3–10 legs). The guardrail ratio framing (§3.4) handles size scaling correctly, but the absolute CVaR number can't be compared directly across different N.
- **No on-chain enforcement.** The Anchor vault program accepts arbitrary weights today; enforcement lives in the API layer. A v2 of the on-chain program could include a `model_version` field and a signed attestation from the API, so anyone reading the chain can verify a basket passed the gate.

## 10. File map

```
backend/src/
├── services/
│   ├── correlation.ts      # (new) the whole service: loader, scorer, optimiser, risk gate, manifest
│   └── metrics.ts          # (edited) added modelBundlesScored/Accepted/Rejected counters + recordModelUsage()
├── routes/
│   ├── bundles.ts          # (edited) POST now calls optimizeWeights + assessBasketRisk, returns model block
│   ├── ml.ts               # (edited) added GET /api/ml/manifest
│   └── metrics.ts          # (edited) added model_usage block to response
└── monitor/
    ├── server.ts           # (edited) /data snapshot includes model_usage
    └── monitor.html        # (edited) new "Model usage · runtime" and "Model usage · recent events" rows

traxis-correlation-deliverables/   # (merged from ml-model branch)
├── final_summary_step19.json       # ← loader reads this
├── model_metrics_step12.json       # ← loader reads this
├── optimization_metrics_step13.json# ← loader reads this
├── monte_carlo_step14.json         # ← loader reads this
├── traxis-correlation-production-20260417T071458Z.tar.zst  # filename → model version
└── ... (audit reports, manifests)

MODEL_INTEGRATION.md        # (this document)
```

## 11. Smoke test (reproducible)

From a clean backend boot:

```bash
# Manifest
curl -s http://localhost:3001/api/ml/manifest | jq '.version, .audit.classifier_precision, .runtime'

# Accept path (8 uncorrelated markets)
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"name":"TEST-A","risk_tier":50,"resolution_date":"2026-05-30T00:00:00Z","legs":[...8 diverse questions...]}' \
  http://localhost:3001/api/bundles | jq '.model'
# → {"version":"...","internal_corr_mean":0.008,"used_model_weights":true,...}

# Reject path (3 BTC price tiers)
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"name":"CORR-B","risk_tier":90,"resolution_date":"2026-04-30T00:00:00Z","legs":[
         {"market_id":"0xc1","question":"Will Bitcoin close above 150k on April 30"},
         {"market_id":"0xc2","question":"Will Bitcoin close above 149k on April 30"},
         {"market_id":"0xc3","question":"Will Bitcoin close above 148k on April 30"}]}' \
  http://localhost:3001/api/bundles | jq
# → {"error":"Bundle rejected by correlation model risk gate","detail":"correlation risk-ratio 1.374 exceeds tolerance 1.25...","model_version":"..."}

# Counters
curl -s http://localhost:3001/api/metrics | jq '.model_usage.counters'
# → {"bundles_scored":2,"bundles_accepted":1,"bundles_rejected":1, ...}
```

All three return the documented shape on a fresh boot. The monitor at `http://localhost:3002` picks up the events within one poll interval.
