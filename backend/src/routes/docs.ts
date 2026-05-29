import { Router, Request, Response } from 'express';

const router = Router();

const apiDocs = {
  name: 'Senthos API',
  version: '1.0.0',
  description: process.env.SUI_PACKAGE_ID
    ? 'Structured Prediction Market Products on Sui testnet'
    : 'Structured Prediction Market Products on Solana',
  base_url: '/api',
  endpoints: [
    {
      method: 'GET',
      path: '/api/health',
      description: 'Comprehensive health check. Tests Supabase DB and Polymarket API connectivity, reports uptime and memory usage.',
      response: '{ status: "ok" | "degraded", timestamp: string, uptime_seconds: number, memory_mb: number, services: { supabase: { status, latency_ms, error? }, polymarket: { status, latency_ms, error? } } }',
    },
    {
      method: 'GET',
      path: '/api/docs',
      description: 'This endpoint. Returns full API documentation as JSON.',
      response: '{ name, version, description, base_url, endpoints[] }',
    },
    // Bundles
    {
      method: 'GET',
      path: '/api/bundles',
      description: 'List all bundles with current NAV, enriched with legs',
      query_params: [
        'risk_tier - filter by tier (90 | 70 | 50)',
        'status - filter by status (active | resolved | cancelled)',
      ],
      response: 'BundleWithLegs[] - each includes legs[], nav, num_legs, resolved_legs',
    },
    {
      method: 'GET',
      path: '/api/bundles/name/:name',
      description: 'Get bundle by name (e.g. STHS-90-0430). Includes legs and NAV.',
      response: 'BundleWithLegs',
    },
    {
      method: 'GET',
      path: '/api/bundles/:id/performance',
      description: 'Rich performance metrics for a bundle including probability distribution, risk score, NAV change, resolution progress.',
      response: '{ bundle_id, bundle_name, risk_tier, status, current_nav, issue_price, nav_change, nav_change_percent, legs_summary: { total, active, won, lost, resolution_progress, weighted_win_rate }, probability_stats: { average, min, max, spread, std_dev }, risk_score, days_to_resolution, resolution_date, created_at }',
    },
    {
      method: 'GET',
      path: '/api/bundles/:id/analysis',
      description: 'Diversification and risk analysis for a bundle. Returns HHI weight concentration, probability dispersion, NAV standard deviation, scenario analysis (best/worst/expected case with upside/downside), and per-leg risk contributions.',
      response: '{ bundle_id, bundle_name, risk_tier, current_nav, analysis: { diversification_score (0-100), weight_concentration (HHI), probability_dispersion, expected_nav, nav_std_dev, scenarios: { best_case, worst_case, expected, upside, downside }, leg_risk: [{ leg_id, question, weight, probability, risk_contribution, marginal_impact }] } }',
    },
    {
      method: 'GET',
      path: '/api/bundles/compare',
      description: 'Compare multiple bundles side-by-side. Returns enriched data for each bundle plus a comparison summary identifying highest NAV, lowest risk, most resolved, and best performance.',
      query_params: ['ids - comma-separated bundle UUIDs (required, max 5)'],
      response: '{ bundles: [{ id, name, risk_tier, status, issue_price, current_nav, nav_change_percent, num_legs, resolved_legs, avg_probability, days_to_resolution, resolution_date }], comparison: { highest_nav, lowest_risk, most_resolved, best_performance } }',
    },
    {
      method: 'GET',
      path: '/api/bundles/:id',
      description: 'Get single bundle by UUID with all legs and current NAV',
      response: 'BundleWithLegs',
    },
    {
      method: 'POST',
      path: '/api/bundles',
      description: 'Create a new bundle with legs. Fetches live Polymarket probabilities, calculates issue price, assigns equal weights if not specified.',
      body: {
        name: 'string (required) - e.g. STHS-90-0430',
        risk_tier: 'number (required) - 90 | 70 | 50',
        resolution_date: 'string (required) - ISO date',
        description: 'string (optional)',
        theme: 'string (optional)',
        legs: [
          {
            market_id: 'string (required) - Polymarket condition ID',
            question: 'string (required)',
            weight: 'number (optional) - defaults to 1/num_legs',
            polymarket_url: 'string (optional)',
          },
        ],
      },
      response: 'BundleWithLegs (201 Created)',
    },
    // NAV
    {
      method: 'GET',
      path: '/api/nav/:bundleId',
      description: 'Get live NAV for a bundle. Fetches latest Polymarket prices, updates DB, returns full breakdown with per-leg contributions.',
      response: '{ bundle_id, nav, legs: [{ id, probability, weight, contribution }] }',
    },
    {
      method: 'GET',
      path: '/api/nav/:bundleId/history',
      description: 'NAV history for a bundle. Returns historical snapshots recorded every 2 minutes by cron, suitable for rendering price charts.',
      query_params: [
        'since - ISO datetime string, return all snapshots since this time (e.g. 2024-01-01T00:00:00Z)',
        'limit - max snapshots to return (default 100, ignored if since is provided)',
      ],
      response: '{ bundle_id, count: number, history: NAVSnapshot[] } where NAVSnapshot = { id, bundle_id, nav, legs_data: LegNAVContribution[], created_at }',
    },
    // Deposit
    {
      method: 'POST',
      path: '/api/deposit',
      description: 'Record a deposit. Calculates fees (structuring fee), mints tokens at current NAV, creates position and transaction records.',
      body: {
        bundle_id: 'string (required) - UUID of bundle',
        wallet_address: 'string (required) - Solana wallet address',
        amount_usdc: 'number (required) - positive USDC amount',
      },
      response: '{ transaction_id, bundle_id, tokens_minted, issue_price, fee_usdc, net_usdc } (201 Created)',
    },
    {
      method: 'GET',
      path: '/api/deposit/portfolio/:walletAddress',
      description: 'Get all positions for a wallet with current NAV values, unrealized PnL, and total portfolio summary.',
      response: '{ wallet_address, positions: [{ position_id, bundle_id, bundle_name, tokens_held, entry_price, deposited_usdc, current_nav, current_value, unrealized_pnl, pnl_percent }], total_value, total_deposited, total_pnl, total_pnl_percent }',
    },
    {
      method: 'GET',
      path: '/api/deposit/transactions/:walletAddress',
      description: 'Get transaction history for a wallet. Returns all deposits, redemptions, and transfers enriched with bundle names.',
      response: '{ wallet_address, count, transactions: [{ id, bundle_id, bundle_name, type, amount_usdc, tokens, fee_usdc, tx_signature?, created_at }] }',
    },
    // Markets
    {
      method: 'GET',
      path: '/api/markets',
      description: 'List available Polymarket markets',
      query_params: [
        'limit - max results (default 20)',
        'active - filter active markets (default true)',
      ],
      response: '{ count: number, markets: Market[] }',
    },
    {
      method: 'GET',
      path: '/api/markets/search/:query',
      description: 'Search Polymarket markets by text query',
      query_params: ['limit - max results (default 20)'],
      response: '{ query, count, markets: Market[] }',
    },
    {
      method: 'GET',
      path: '/api/markets/:conditionId',
      description: 'Get single market details by Polymarket condition ID',
      response: 'Market',
    },
    // Resolution
    {
      method: 'POST',
      path: '/api/nav/:bundleId/check-resolutions',
      description: 'Manually trigger resolution check for a bundle. Detects legs with prob >= 0.99 (won) or <= 0.01 (lost). Auto-updates bundle status to resolved when all legs resolve.',
      response: '{ bundle_id, newly_resolved: [{ leg_id, question, status, resolution_value }], newly_resolved_count, total_legs, resolved_legs, bundle_fully_resolved }',
    },
    {
      method: 'POST',
      path: '/api/nav/:bundleId/simulate-resolution',
      description: 'DEMO ONLY: Force-resolve a leg manually for testing/demos.',
      body: {
        leg_id: 'string (required) - UUID of the leg',
        outcome: 'string (required) - "won" or "lost"',
      },
      response: '{ bundle_id, leg: { leg_id, question, status, resolution_value }, total_legs, resolved_legs, bundle_fully_resolved }',
    },
    // Redemption
    {
      method: 'POST',
      path: '/api/deposit/redeem',
      description: 'Prepare a sell transaction for a bundle position. Active vaults use early-exit (pool pro-rata payout net of exit fee); finalized vaults use final redeem payout.',
      body: {
        bundle_id: 'string (required) - UUID of bundle',
        wallet_address: 'string (required) - Solana wallet address',
        amount_tokens: 'number (optional) - partial sell amount; defaults to full position',
      },
      response: '{ kind: "prepared", bundle_id, wallet_address, total_tokens, expected_usdc, redeem_kind: "active_early" | "finalized", exit_fee_usdc?, transaction_base64, vault_pda, trax_mint, recent_blockhash, last_valid_block_height }',
    },
    // Leaderboard
    {
      method: 'GET',
      path: '/api/leaderboard',
      description: 'Top wallets by total deposited value. Groups all positions by wallet, sums deposits, and ranks.',
      query_params: ['limit - max wallets to return (default 10, max 100)'],
      response: '{ count: number, wallets: [{ wallet_address, total_deposited, position_count, approximate_value }] }',
    },
    // SSE (Server-Sent Events)
    {
      method: 'GET',
      path: '/api/sse/nav/:bundleId',
      description: 'SSE stream for live NAV updates. Sends initial NAV immediately, then refreshes every 30 seconds. Connect with EventSource.',
      response: 'SSE stream - data: { nav, legs: [{ id, probability, weight, contribution }], timestamp }',
    },
    {
      method: 'GET',
      path: '/api/sse/portfolio/:walletAddress',
      description: 'SSE stream for live portfolio value updates. Recalculates all positions every 30 seconds.',
      response: 'SSE stream - data: { wallet_address, positions: [{ bundle_id, tokens_held, entry_price, deposited_usdc, current_nav, current_value, pnl }], total_deposited, total_current_value, total_pnl, timestamp }',
    },
    {
      method: 'GET',
      path: '/api/sse/bundles',
      description: 'SSE stream for all active bundles with NAV updates. Sends initial snapshot immediately, then refreshes every 60 seconds. Useful for dashboard views.',
      response: 'SSE stream - data: { count, bundles: [{ id, name, risk_tier, status, issue_price, current_nav, nav_change_percent, num_legs, resolved_legs, avg_probability }], timestamp }',
    },
    // Admin
    {
      method: 'GET',
      path: '/api/admin/stats',
      description: 'Platform-level statistics: bundle counts, position/transaction totals, USDC deposit/redemption/fee aggregates.',
      response: '{ total_bundles, active_bundles, resolved_bundles, total_legs, total_positions, total_transactions, total_deposited_usdc, total_redeemed_usdc, total_fees_collected, timestamp }',
    },
    {
      method: 'POST',
      path: '/api/admin/bundles/:id/cancel',
      description: 'Cancel an active bundle. Sets status to cancelled. Returns error if bundle is not active.',
      response: 'Bundle (updated with status: cancelled)',
    },
    {
      method: 'GET',
      path: '/api/admin/transactions',
      description: 'List all transactions with optional filters. Ordered by created_at descending.',
      query_params: [
        'wallet - filter by wallet address',
        'type - filter by type (deposit | redemption | transfer)',
        'limit - max results (default 50)',
      ],
      response: '{ count: number, transactions: Transaction[] }',
    },
    // Demo
    {
      method: 'POST',
      path: '/api/demo/simulate-lifecycle',
      description: 'Demo-only: Runs a full product lifecycle simulation in one call. Picks a random active bundle (or uses bundle_id from body), simulates a deposit, and returns the full lifecycle data including NAV and portfolio snapshot.',
      body: {
        bundle_id: 'string (optional) - UUID of bundle. Picks random active bundle if omitted.',
        wallet_address: 'string (optional) - defaults to demo-wallet-001',
        amount_usdc: 'number (optional) - USDC amount to deposit, defaults to 100',
      },
      response: '{ demo: true, lifecycle: { step_1_bundle: BundleWithLegs, step_2_deposit: { transaction_id, bundle_id, wallet_address, amount_usdc, fee_usdc, net_usdc, tokens_minted, issue_price }, step_3_nav: NAVResult, step_4_portfolio: { wallet_address, bundle_id, total_tokens, total_deposited, current_nav, current_value, unrealized_pnl, pnl_percent, position_count } }, message: string }',
    },
    {
      method: 'GET',
      path: '/api/demo/status',
      description: 'Returns demo status: demo wallet address, active/total bundle counts, and usage instructions.',
      response: '{ demo_wallet: string, note: string, active_bundles: number, total_bundles: number }',
    },
    // Webhooks (Helius / Solana)
    {
      method: 'POST',
      path: '/api/webhook/helius',
      description: 'Helius webhook handler for Solana on-chain events. Expects an array of event objects. Processes TOKEN_MINT, TOKEN_BURN, and TRANSFER events.',
      body: '[{ type: string, description: string, signature: string, ... }]',
      response: '{ processed: number, total: number }',
    },
    {
      method: 'GET',
      path: '/api/webhook/health',
      description: 'Health check for the Helius webhook endpoint. Use as Helius ping URL.',
      response: '{ status: "ok", service: "helius-webhook" }',
    },
    // Batch
    {
      method: 'POST',
      path: '/api/batch/nav',
      description: 'Get live NAV for multiple bundles in one request. Fetches latest Polymarket prices for each bundle concurrently.',
      body: {
        bundle_ids: 'string[] (required) - array of bundle UUIDs, max 20',
      },
      response: '{ count: number, results: { [bundle_id]: NAVResult | { error: string } } }',
    },
    {
      method: 'POST',
      path: '/api/batch/bundles',
      description: 'Get full bundle data (with legs) for multiple bundles in one request. Fetches concurrently.',
      body: {
        bundle_ids: 'string[] (required) - array of bundle UUIDs, max 20',
      },
      response: '{ count: number, results: { [bundle_id]: BundleWithLegs | { error: string } } }',
    },
    // PPN (Principal Protected Notes)
    {
      method: 'POST',
      path: '/api/ppn/deposit',
      description: 'Create a PPN (Principal Protected Note) position. Principal is locked in a Meteora yield vault for safety; only accrued yield is deployed into the linked bundle. Returns vault details and yield projections.',
      body: {
        bundle_id: 'string (required) - UUID of the bundle to link yield deployment to',
        wallet_address: 'string (required) - Solana wallet address',
        amount_usdc: 'number (required) - USDC amount to deposit as principal',
        maturity_days: 'number (optional) - days until maturity, 7-365, default 30',
      },
      response: '{ vault_id, bundle_id, principal_usdc, estimated_apy, estimated_yield_at_maturity, maturity_date, message } (201 Created)',
    },
    {
      method: 'GET',
      path: '/api/ppn/portfolio/:walletAddress',
      description: 'Get all PPN vaults for a wallet with yield projections, accrued yield, days remaining, and portfolio summary. Principal is always protected.',
      response: '{ wallet_address, vaults: [{ vault_id, bundle_id, bundle_name, bundle_status, principal_usdc, yield_deployed_usdc, accrued_yield, projected_total_yield, estimated_apy, status, days_elapsed, days_remaining, maturity_date, created_at, total_value }], summary: { total_vaults, total_principal, total_accrued_yield, total_value, principal_protected: true } }',
    },
    {
      method: 'POST',
      path: '/api/ppn/withdraw/:vaultId',
      description: 'Withdraw from a matured PPN vault. Returns principal + accumulated yield. Fails if vault has not reached maturity (returns days remaining and early withdrawal info).',
      response: '{ vault_id, wallet_address, principal_returned, yield_earned, total_payout, days_held, effective_apy, message }',
    },
    // Price Alerts
    {
      method: 'POST',
      path: '/api/alerts',
      description: 'Create a new price alert. Triggers when NAV crosses the specified threshold (above/below) or changes by a percentage.',
      body: {
        bundle_id: 'string (required) - UUID of the bundle to monitor',
        wallet_address: 'string (required) - wallet address to associate the alert with',
        alert_type: 'string (required) - "above" | "below" | "change_percent"',
        threshold: 'number (required) - NAV threshold for above/below, or percentage for change_percent',
      },
      response: 'PriceAlert (201 Created)',
    },
    {
      method: 'GET',
      path: '/api/alerts/:walletAddress',
      description: 'Get all price alerts for a wallet, with counts of active and triggered alerts.',
      response: '{ wallet_address, count, active, triggered, alerts: PriceAlert[] }',
    },
    {
      method: 'POST',
      path: '/api/alerts/check/:bundleId',
      description: 'Check and trigger alerts for a bundle based on current live NAV. Compares NAV against all active alerts. Called by cron or manually.',
      response: '{ bundle_id, current_nav, nav_change_percent, alerts_checked, alerts_triggered, triggered: [{ alert_id, wallet_address, alert_type, threshold, current_nav }] }',
    },
    {
      method: 'DELETE',
      path: '/api/alerts/:alertId',
      description: 'Delete a price alert by ID.',
      response: '{ deleted: true, alert_id: string }',
    },
    // On-chain
    {
      method: 'GET',
      path: '/api/onchain/status',
      description: 'Probes the Senthos vault and PPN programs on Solana devnet. Returns cluster slot/epoch plus per-program lamports, executable flag, owner (BPF upgradeable loader), and data size.',
      response: '{ cluster, rpc_url, slot, epoch, programs: { vault: { program_id, deployed, executable, owner, lamports, data_size, latency_ms }, ppn: {...} }, total_latency_ms, timestamp }',
    },
    // ML model deliverables
    {
      method: 'GET',
      path: '/api/ml/health',
      description: 'Reports whether the traxis-correlation-deliverables folder is present and lists the files it contains.',
      response: '{ status: "ok" | "missing", root?, file_count?, files? }',
    },
    {
      method: 'GET',
      path: '/api/ml/metrics',
      description: 'Returns the final audit + walk-forward + Monte Carlo metrics for the Senthos correlation model (classifier precision, p-value, VaR, CVaR, etc.).',
      response: '{ model, execution_status, all_checks_passed, metrics: {...}, artifacts: { summary, walkforward_step16, monte_carlo_step14, model_metrics_step12 } }',
    },
    {
      method: 'GET',
      path: '/api/ml/artifact/:name',
      description: 'Serve a specific ML JSON artifact by filename. Restricted to .json files in the deliverables folder.',
      response: 'Raw JSON artifact content',
    },
  ],
};

router.get('/', (_req: Request, res: Response) => {
  res.json(apiDocs);
});

export const docsRoutes = router;
