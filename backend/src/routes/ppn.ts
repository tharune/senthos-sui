import { Router, Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import {
  getBundleById,
  createPPNVault,
  getPPNVaultsByWallet,
  getPPNVaultById,
  updatePPNVaultStatus,
  updatePPNVaultOnchain,
  getActivePPNVault,
  createTransaction,
} from '../db/queries';
import { PPNDepositRequest, PPNDepositResponse } from '../types';
import {
  buildPpnDepositTx,
  buildPpnRedeemTx,
  buildPpnDivestTx,
  buildPpnCloseTx,
  confirmTransaction,
  getUserUsdcDeltaFromTx,
  getMockAdapterState,
} from '../services/solana';
import { getConnection } from '../solana/anchor';

const router = Router();

// Default Meteora estimated APY (8%)
const DEFAULT_APY = 0.08;

// ---------------------------------------------------------------------------
// PPN fee structure (kept in one place so the on-chain program, the prepare
// route, the confirm route, and the UI breakdown all agree).
//
// Two fees are charged on a PPN note:
//
//   MANAGEMENT_FEE_BPS   (10 bps)  — charged once on deposit. Matches the
//                                    protocol take on constellation buys.
//   STRATEGY_FEE_BPS     (5 bps)   — charged on both sides of the strategy:
//                                    once at open (in addition to the mgmt
//                                    fee) and once at close (redeem /
//                                    divest). Covers the cost of structuring
//                                    + unwinding the vault+basket split.
//
// Both fees are assessed against the gross USDC notional (deposit size on
// open, principal-returned on close). They do NOT compound — total
// open-side fee is 15 bps, total close-side fee is 5 bps, round-trip 20 bps.
//
// On-chain handler contract:
//   1. Read BPS constants from the program config PDA (or take them as ix
//      args signed by the authority) so on-chain + off-chain stay in sync.
//   2. On `initialize_note`: transfer (mgmt + strategy) to FEE_RECIPIENT
//      before splitting the remainder between the yield vault and basket.
//   3. On `redeem_at_maturity` / `divest`: transfer strategy_fee from the
//      settled USDC before returning the remainder to the user.
//   4. Emit `PpnFeeTaken { note, kind: Open|Close, mgmt_bps, strategy_bps }`
//      so indexers can reconcile protocol revenue per note.
// ---------------------------------------------------------------------------
export const MANAGEMENT_FEE_BPS = 10; // 0.10%, deposit only
export const STRATEGY_FEE_BPS = 5;    // 0.05%, charged on open AND on close

function bpsToUsdc(amountUsdc: number, bps: number): number {
  return +(amountUsdc * (bps / 10_000)).toFixed(6);
}

function managementFeeUsdc(amountUsdc: number): number {
  return bpsToUsdc(amountUsdc, MANAGEMENT_FEE_BPS);
}

function strategyFeeUsdc(amountUsdc: number): number {
  return bpsToUsdc(amountUsdc, STRATEGY_FEE_BPS);
}

async function verifyPpnTxMatchesVault(
  signature: string,
  vaultWalletAddress: string,
  notePda?: string | null,
): Promise<boolean> {
  const conn = getConnection();
  const parsed = await conn.getParsedTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  if (!parsed || parsed.meta?.err) return false;
  const keys = parsed.transaction.message.accountKeys.map((k) =>
    typeof k === 'string' ? k : k.pubkey.toBase58(),
  );
  if (!keys.includes(vaultWalletAddress)) return false;
  if (notePda && !keys.includes(notePda)) return false;
  return true;
}

function inferTierFromBundleName(name?: string | null): 90 | 70 | 50 {
  const upper = (name ?? "").toUpperCase();
  if (upper.includes("HIGH") || upper.includes("-90-")) return 90;
  if (upper.includes("LOW") || upper.includes("-50-")) return 50;
  return 70;
}

/**
 * POST /api/ppn/deposit
 * Create a PPN position. Principal goes to Meteora vault, yield is deployed into the bundle.
 *
 * Body: { bundle_id, wallet_address, amount_usdc, maturity_days? }
 */
router.post('/deposit', async (req: Request, res: Response) => {
  try {
    const { bundle_id, wallet_address, amount_usdc, maturity_days = 30 } = req.body as PPNDepositRequest;

    if (!bundle_id || !wallet_address || !amount_usdc) {
      return res.status(400).json({ error: 'bundle_id, wallet_address, and amount_usdc are required' });
    }
    if (amount_usdc <= 0) {
      return res.status(400).json({ error: 'amount_usdc must be positive' });
    }
    if (maturity_days < 7 || maturity_days > 365) {
      return res.status(400).json({ error: 'maturity_days must be between 7 and 365' });
    }

    const bundle = await getBundleById(bundle_id);
    if (!bundle) {
      return res.status(404).json({ error: `Bundle not found: ${bundle_id}` });
    }
    if (bundle.status !== 'active') {
      return res.status(400).json({ error: `Bundle is not active (status: ${bundle.status})` });
    }

    // Calculate maturity date
    const maturityDate = new Date();
    maturityDate.setDate(maturityDate.getDate() + maturity_days);

    // Estimated yield at maturity
    const estimatedYield = amount_usdc * (DEFAULT_APY / 365) * maturity_days;

    // Create PPN vault record
    const vault = await createPPNVault({
      bundle_id,
      wallet_address,
      principal_usdc: amount_usdc,
      yield_deployed_usdc: 0,
      estimated_apy: DEFAULT_APY,
      vault_address: `stub_vault_${Date.now().toString(36)}`, // Solana vault - stub for now
      status: 'active',
      maturity_date: maturityDate.toISOString().split('T')[0],
    });

    if (!vault) {
      return res.status(500).json({ error: 'Failed to create PPN vault' });
    }

    // Record transaction
    await createTransaction({
      bundle_id,
      wallet_address,
      type: 'deposit',
      amount_usdc,
      tokens: 0, // PPN doesn't mint tokens directly
      fee_usdc: 0, // No structuring fee on PPN (fee comes from yield)
    });

    const response: PPNDepositResponse = {
      vault_id: vault.id,
      bundle_id,
      principal_usdc: amount_usdc,
      estimated_apy: DEFAULT_APY,
      estimated_yield_at_maturity: Math.round(estimatedYield * 100) / 100,
      maturity_date: maturityDate.toISOString().split('T')[0],
      message: `Principal of $${amount_usdc} USDC is protected in Meteora yield vault. Estimated yield of $${estimatedYield.toFixed(2)} will be deployed into bundle ${bundle.name} over ${maturity_days} days.`,
    };

    res.status(201).json(response);
  } catch (err) {
    console.error('POST /api/ppn/deposit error:', err);
    res.status(500).json({ error: 'Failed to process PPN deposit' });
  }
});

/**
 * GET /api/ppn/portfolio/:walletAddress
 * Get all PPN vaults for a wallet with yield projections.
 */
router.get('/portfolio/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const vaults = await getPPNVaultsByWallet(walletAddress);

    const enriched = await Promise.all(
      vaults.map(async (vault) => {
        const bundle = await getBundleById(vault.bundle_id);
        const maturityDate = new Date(vault.maturity_date);
        const now = new Date();
        const daysElapsed = Math.max(0, Math.floor((now.getTime() - new Date(vault.created_at).getTime()) / (1000 * 60 * 60 * 24)));
        const daysRemaining = Math.max(0, Math.ceil((maturityDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

        // Calculate accrued yield
        const accruedYield = vault.principal_usdc * (vault.estimated_apy / 365) * daysElapsed;
        const projectedTotalYield = vault.principal_usdc * (vault.estimated_apy / 365) * (daysElapsed + daysRemaining);

        return {
          vault_id: vault.id,
          bundle_id: vault.bundle_id,
          bundle_name: bundle?.name ?? 'Unknown',
          bundle_status: bundle?.status ?? 'unknown',
          principal_usdc: vault.principal_usdc,
          yield_deployed_usdc: vault.yield_deployed_usdc,
          accrued_yield: Math.round(accruedYield * 100) / 100,
          projected_total_yield: Math.round(projectedTotalYield * 100) / 100,
          estimated_apy: vault.estimated_apy,
          status: vault.status,
          days_elapsed: daysElapsed,
          days_remaining: daysRemaining,
          maturity_date: vault.maturity_date,
          created_at: vault.created_at,
          // Total value = principal (always protected) + accrued yield
          total_value: Math.round((vault.principal_usdc + accruedYield) * 100) / 100,
          tranche_kind: vault.tranche_kind ?? null,
          tranche_attach: vault.tranche_attach ?? null,
          tranche_detach: vault.tranche_detach ?? null,
          price_per_token: vault.price_per_token ?? null,
        };
      })
    );

    const totalPrincipal = enriched.reduce((sum, v) => sum + v.principal_usdc, 0);
    const totalAccruedYield = enriched.reduce((sum, v) => sum + v.accrued_yield, 0);
    const totalValue = enriched.reduce((sum, v) => sum + v.total_value, 0);

    res.json({
      wallet_address: walletAddress,
      vaults: enriched,
      summary: {
        total_vaults: enriched.length,
        total_principal: Math.round(totalPrincipal * 100) / 100,
        total_accrued_yield: Math.round(totalAccruedYield * 100) / 100,
        total_value: Math.round(totalValue * 100) / 100,
        principal_protected: true,
      },
    });
  } catch (err) {
    console.error('GET /api/ppn/portfolio/:walletAddress error:', err);
    res.status(500).json({ error: 'Failed to fetch PPN portfolio' });
  }
});

/**
 * POST /api/ppn/withdraw/:vaultId
 * Withdraw from a matured PPN vault. Returns principal + accumulated yield.
 */
router.post('/withdraw/:vaultId', async (req: Request, res: Response) => {
  try {
    const { vaultId } = req.params;

    const vault = await getPPNVaultById(vaultId);
    if (!vault) {
      return res.status(404).json({ error: 'PPN vault not found' });
    }
    if (vault.status !== 'active') {
      return res.status(400).json({ error: `Vault is not active (status: ${vault.status})` });
    }

    // Check if matured
    const maturityDate = new Date(vault.maturity_date);
    const now = new Date();
    const isMatured = now >= maturityDate;

    if (!isMatured) {
      const daysRemaining = Math.ceil((maturityDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return res.status(400).json({
        error: `Vault has not matured yet. ${daysRemaining} days remaining until ${vault.maturity_date}.`,
        early_withdrawal_available: true,
        early_withdrawal_penalty: '0% of principal (principal is always protected), but forfeits unrealized yield',
      });
    }

    // Calculate final yield
    const daysElapsed = Math.floor((now.getTime() - new Date(vault.created_at).getTime()) / (1000 * 60 * 60 * 24));
    const totalYield = vault.principal_usdc * (vault.estimated_apy / 365) * daysElapsed;
    const payoutUsdc = vault.principal_usdc + totalYield;

    // Update vault status
    await updatePPNVaultStatus(vaultId, 'withdrawn');

    // Record withdrawal transaction
    await createTransaction({
      bundle_id: vault.bundle_id,
      wallet_address: vault.wallet_address,
      type: 'redemption',
      amount_usdc: payoutUsdc,
      tokens: 0,
      fee_usdc: 0,
    });

    res.json({
      vault_id: vaultId,
      wallet_address: vault.wallet_address,
      principal_returned: vault.principal_usdc,
      yield_earned: Math.round(totalYield * 100) / 100,
      total_payout: Math.round(payoutUsdc * 100) / 100,
      days_held: daysElapsed,
      effective_apy: vault.estimated_apy,
      message: 'Principal and yield withdrawn successfully.',
    });
  } catch (err) {
    console.error('POST /api/ppn/withdraw/:vaultId error:', err);
    res.status(500).json({ error: 'Failed to process PPN withdrawal' });
  }
});

// ---------------------------------------------------------------------------
// On-chain PPN flow (non-custodial, matches /api/deposit prepare+confirm pattern).
//
// Unlike /deposit which writes the DB only after on-chain confirm, PPN writes a
// Supabase row at /prepare so the UI can render "pending" state. The row is
// upgraded from `status='active'` with on-chain artifacts once /confirm lands.
// If the user never submits, the stub row is a soft orphan — matches behaviour
// of the existing legacy /api/ppn/deposit endpoint.
// ---------------------------------------------------------------------------

/**
 * POST /api/ppn/onchain/prepare
 * Build the `initialize_note` transaction for the user to sign.
 * Body: { bundle_id, wallet_address, amount_usdc, maturity_days? }
 */
router.post('/onchain/prepare', async (req: Request, res: Response) => {
  try {
    const {
      bundle_id,
      wallet_address,
      amount_usdc,
      maturity_days = 30,
      // Tranche overlay — optional. Present only when a tranche BUY is issued
      // from /app/tranche/[id]; plain PPN deposits leave these undefined.
      tranche_kind,
      tranche_attach,
      tranche_detach,
      price_per_token,
    } = req.body as PPNDepositRequest;

    if (!bundle_id || !wallet_address || !amount_usdc) {
      return res.status(400).json({
        error: 'bundle_id, wallet_address, and amount_usdc are required',
      });
    }
    if (amount_usdc <= 0) {
      return res.status(400).json({ error: 'amount_usdc must be positive' });
    }
    if (maturity_days < 1 || maturity_days > 365) {
      return res.status(400).json({ error: 'maturity_days must be between 1 and 365' });
    }
    // Tranche metadata is optional as a group but must be self-consistent
    // when supplied. We don't enforce attach < detach here — the tranche
    // engine on the FE already guards that, and exotic presets may need
    // zero-width markers at the boundary of a range.
    if (tranche_kind !== undefined) {
      if (!['senior', 'mezzanine', 'junior'].includes(tranche_kind)) {
        return res.status(400).json({
          error: `tranche_kind must be one of: senior | mezzanine | junior (got "${tranche_kind}")`,
        });
      }
      if (
        typeof tranche_attach !== 'number' ||
        typeof tranche_detach !== 'number' ||
        typeof price_per_token !== 'number'
      ) {
        return res.status(400).json({
          error:
            'tranche_kind requires tranche_attach, tranche_detach, and price_per_token (all numbers)',
        });
      }
    }

    const bundle = await getBundleById(bundle_id);
    if (!bundle) return res.status(404).json({ error: `Bundle not found: ${bundle_id}` });
    if (bundle.status !== 'active') {
      return res.status(400).json({
        error: `Bundle is not active (status: ${bundle.status})`,
      });
    }

    // Guard: mock adapter must be initialized (one-time admin bootstrap).
    const adapter = await getMockAdapterState();
    if (!adapter) {
      return res.status(409).json({
        error:
          'Meteora mock adapter is not initialized. Run POST /api/admin/init-mock-adapter first.',
      });
    }

    // Maturity: exact timestamp for the on-chain ix, and a calendar date for
    // display. The on-chain program compares against Solana clock::unix_timestamp.
    const maturityMs = Date.now() + maturity_days * 86_400_000;
    const maturityTs = Math.floor(maturityMs / 1000);
    const maturityDate = new Date(maturityMs).toISOString().split('T')[0];

    const principalBaseUnits = BigInt(Math.round(amount_usdc * 1_000_000));

    let built;
    try {
      built = await buildPpnDepositTx({
        userPubkey: new PublicKey(wallet_address),
        bundleId: bundle_id,
        principalUsdc: principalBaseUnits,
        maturityTs,
      });
    } catch (err: any) {
      // Common case: the bundle's on-chain vault / trax_mint hasn't been
      // initialized yet — initialize_note needs the TRAX mint to exist.
      if (
        String(err).includes('Account does not exist') ||
        String(err).includes('not found')
      ) {
        return res.status(409).json({
          error:
            'Bundle vault is not initialized on-chain yet. Run POST /api/admin/bundles/:id/init-onchain first.',
        });
      }
      throw err;
    }

    // Persist a pending PPN vault row so /confirm can look it up by wallet+bundle.
    const apyFromAdapter = adapter.apyBps / 10_000;
    const vault = await createPPNVault({
      bundle_id,
      wallet_address,
      principal_usdc: amount_usdc,
      yield_deployed_usdc: 0,
      estimated_apy: apyFromAdapter,
      vault_address: built.notePda,
      status: 'active',
      maturity_date: maturityDate,
      note_seed_hex: built.noteSeedHex,
      maturity_ts: maturityTs,
      // Tranche overlay: NULL for vanilla PPN, populated when the FE is
      // buying a slice of the basket's (attach, detach) loss range.
      tranche_kind: tranche_kind ?? null,
      tranche_attach: tranche_attach ?? null,
      tranche_detach: tranche_detach ?? null,
      price_per_token: price_per_token ?? null,
    });
    if (!vault) {
      return res.status(500).json({ error: 'Failed to persist PPN vault record' });
    }

    const mgmtFee = managementFeeUsdc(amount_usdc);
    const openStrategyFee = strategyFeeUsdc(amount_usdc);
    const totalOpenFee = +(mgmtFee + openStrategyFee).toFixed(6);
    res.status(200).json({
      kind: 'prepared',
      vault_id: vault.id,
      bundle_id,
      wallet_address,
      amount_usdc,
      // Fee structure: 10 bps management (deposit only) + 5 bps strategy
      // (charged on both open and close). Net deposit reflects both.
      management_fee_bps: MANAGEMENT_FEE_BPS,
      management_fee_usdc: mgmtFee,
      strategy_fee_bps: STRATEGY_FEE_BPS,
      strategy_fee_usdc: openStrategyFee,
      total_open_fee_usdc: totalOpenFee,
      net_deposit_usdc: +(amount_usdc - totalOpenFee).toFixed(6),
      estimated_apy: apyFromAdapter,
      maturity_date: maturityDate,
      maturity_ts: maturityTs,
      note_pda: built.notePda,
      note_seed_hex: built.noteSeedHex,
      adapter_pda: built.adapterPda,
      adapter_pool: built.adapterPool,
      trax_mint: built.traxMint,
      trax_vault: built.traxVault,
      transaction_base64: built.transactionBase64,
      recent_blockhash: built.recentBlockhash,
      last_valid_block_height: built.lastValidBlockHeight,
    });
  } catch (err) {
    console.error('POST /api/ppn/onchain/prepare error:', err);
    res.status(500).json({ error: 'Failed to prepare PPN on-chain deposit' });
  }
});

/**
 * POST /api/ppn/onchain/confirm
 * Persist the on-chain signature after the wallet signs + the RPC confirms.
 * Body: { vault_id, signature }
 */
router.post('/onchain/confirm', async (req: Request, res: Response) => {
  try {
    const { vault_id, signature } = req.body as {
      vault_id: string;
      signature: string;
    };
    if (!vault_id || !signature) {
      return res.status(400).json({ error: 'vault_id and signature are required' });
    }

    const vault = await getPPNVaultById(vault_id);
    if (!vault) return res.status(404).json({ error: 'PPN vault not found' });

    const confirmed = await confirmTransaction(signature);
    if (!confirmed) {
      return res.status(400).json({ error: 'Transaction has not confirmed yet' });
    }

    // Best-effort: record the signature. If the column doesn't exist in the
    // DB schema yet, the vault row still exists from the prepare step so the
    // position is intact — don't fail the confirm over a missing column.
    await updatePPNVaultOnchain(vault_id, {
      onchain_tx_signature: signature,
    }).catch((err) => console.warn('updatePPNVaultOnchain non-fatal:', err));

    // Transaction row for portfolio/history. Read the real wallet-side
    // debit from the confirmed tx so a deposit with a 15 bps fee (PPN /
    // tranche combined mgmt + strategy) shows up with amount_usdc equal
    // to the gross the user paid and fee_usdc equal to the deducted fee.
    // Falls back to principal_usdc with fee=0 if the RPC can't find the
    // tx (rare; old behaviour).
    const ownerDelta = await getUserUsdcDeltaFromTx(signature, vault.wallet_address);
    // Deposits are debits → ownerDelta is negative. abs() to get gross.
    const grossPaid = ownerDelta != null && ownerDelta < 0 ? -ownerDelta : vault.principal_usdc;
    const feeUsdc = Math.max(0, grossPaid - vault.principal_usdc);
    const tx = await createTransaction({
      bundle_id: vault.bundle_id,
      wallet_address: vault.wallet_address,
      type: 'deposit',
      amount_usdc: grossPaid,
      tokens: 0,
      fee_usdc: feeUsdc,
      tx_signature: signature,
    });

    res.status(201).json({
      vault_id,
      bundle_id: vault.bundle_id,
      wallet_address: vault.wallet_address,
      principal_usdc: vault.principal_usdc,
      signature,
      transaction_id: tx?.id ?? null,
    });
  } catch (err) {
    console.error('POST /api/ppn/onchain/confirm error:', err);
    res.status(500).json({ error: 'Failed to confirm PPN on-chain deposit' });
  }
});

/**
 * POST /api/ppn/onchain/redeem/prepare
 * Build the `redeem_at_maturity` transaction for the user to sign.
 * Body: { bundle_id, wallet_address }  OR  { vault_id }
 */
router.post('/onchain/redeem/prepare', async (req: Request, res: Response) => {
  try {
    const { vault_id, bundle_id, wallet_address } = req.body as {
      vault_id?: string;
      bundle_id?: string;
      wallet_address?: string;
    };

    let vault = null as Awaited<ReturnType<typeof getPPNVaultById>> | null;
    if (vault_id) {
      vault = await getPPNVaultById(vault_id);
    } else if (bundle_id && wallet_address) {
      vault = await getActivePPNVault(wallet_address, bundle_id);
    }

    if (!vault) {
      return res.status(404).json({
        error: 'PPN vault not found. Supply vault_id, or (bundle_id + wallet_address).',
      });
    }
    if (wallet_address && wallet_address !== vault.wallet_address) {
      return res.status(403).json({
        error: 'Wallet mismatch for requested vault.',
      });
    }
    if (!vault.note_seed_hex) {
      return res.status(400).json({
        error: 'This PPN vault was created before on-chain integration (no note seed).',
      });
    }
    if (vault.status !== 'active') {
      return res.status(400).json({
        error: `PPN vault is not active (status: ${vault.status})`,
      });
    }

    // Maturity guard — check both the exact ts (preferred) and the legacy date.
    const nowSec = Math.floor(Date.now() / 1000);
    const matured = vault.maturity_ts
      ? nowSec >= vault.maturity_ts
      : new Date(vault.maturity_date).getTime() <= Date.now();
    if (!matured) {
      const secsRemaining = (vault.maturity_ts ?? 0) - nowSec;
      return res.status(400).json({
        error: `Note has not matured yet. ${Math.max(0, secsRemaining)}s remaining.`,
        maturity_ts: vault.maturity_ts,
        maturity_date: vault.maturity_date,
      });
    }

    // We need the bundle's TRAX mint to derive the note's TRAX ATA. Pull from
    // the bundle row rather than re-deriving so we stay in lock-step with the
    // on-chain vault regardless of which env we're in.
    const bundle = await getBundleById(vault.bundle_id);
    if (!bundle) {
      return res.status(404).json({ error: 'Parent bundle not found' });
    }
    const traxMintBase58 = (bundle as any).trax_mint as string | null | undefined;
    if (!traxMintBase58) {
      return res.status(409).json({
        error: 'Bundle has no trax_mint — run /api/admin/bundles/:id/init-onchain first.',
      });
    }

    const built = await buildPpnRedeemTx({
      userPubkey: new PublicKey(vault.wallet_address),
      noteSeedHex: vault.note_seed_hex,
      traxMintBase58,
    });

    // Close-side strategy fee: charged against the principal that's being
    // returned. Surfaced so the UI can display the expected proceeds and the
    // on-chain handler can enforce the same amount.
    const closeStrategyFee = strategyFeeUsdc(vault.principal_usdc);
    const expectedProceeds = +(vault.principal_usdc - closeStrategyFee).toFixed(6);

    res.status(200).json({
      kind: 'prepared',
      vault_id: vault.id,
      bundle_id: vault.bundle_id,
      wallet_address: vault.wallet_address,
      principal_usdc: vault.principal_usdc,
      strategy_fee_bps: STRATEGY_FEE_BPS,
      strategy_fee_usdc: closeStrategyFee,
      expected_proceeds_usdc: expectedProceeds,
      note_pda: built.notePda,
      transaction_base64: built.transactionBase64,
      recent_blockhash: built.recentBlockhash,
      last_valid_block_height: built.lastValidBlockHeight,
    });
  } catch (err) {
    console.error('POST /api/ppn/onchain/redeem/prepare error:', err);
    res.status(500).json({ error: 'Failed to prepare PPN on-chain redeem' });
  }
});

/**
 * POST /api/ppn/tranche/sell/rfq
 * Desk-style RFQ for tranche exits. Returns indicative pricing and
 * whether each lot is currently executable on-chain.
 *
 * Body: { vault_ids: string[] }
 */
router.post('/tranche/sell/rfq', async (req: Request, res: Response) => {
  try {
    const { vault_ids, wallet_address } = req.body as {
      vault_ids?: string[];
      wallet_address?: string;
    };
    if (!Array.isArray(vault_ids) || vault_ids.length === 0) {
      return res.status(400).json({ error: 'vault_ids (non-empty array) is required' });
    }
    if (!wallet_address) {
      return res.status(400).json({ error: 'wallet_address is required' });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const quotes = await Promise.all(
      vault_ids.map(async (vaultId) => {
        const vault = await getPPNVaultById(vaultId);
        if (!vault) {
          return {
            vault_id: vaultId,
            status: 'missing',
            error: 'Vault not found',
          };
        }
        if (vault.wallet_address !== wallet_address) {
          return {
            vault_id: vaultId,
            status: 'missing',
            error: 'Vault does not belong to wallet',
          };
        }
        const maturityTs =
          vault.maturity_ts ??
          Math.floor(new Date(vault.maturity_date).getTime() / 1000);
        const remainingSec = Math.max(0, maturityTs - nowSec);
        const matured = remainingSec === 0;
        const kind = vault.tranche_kind ?? 'senior';
        const bundle = await getBundleById(vault.bundle_id);
        const tier: 90 | 70 | 50 = inferTierFromBundleName(bundle?.name);
        const profileRiskMult: Record<90 | 70 | 50, number> = {
          90: 0.95,
          70: 1.15,
          50: 1.35,
        };
        const tenorYears = Math.max(0, remainingSec / (365 * 24 * 3600));
        const entryPricePerToken = Math.max(0.0005, vault.price_per_token ?? 1);
        const kindMmBps: Record<string, number> = {
          senior: 45,
          mezzanine: 95,
          junior: 165,
        };
        const kindSlipBps: Record<string, number> = {
          senior: 35,
          mezzanine: 120,
          junior: 220,
        };
        const kindUwBps: Record<string, number> = {
          senior: 40,
          mezzanine: 140,
          junior: 260,
        };
        // Conservative MM desk RFQ for early exits:
        // price = entry * (1 - MM - slippage - underwriting).
        const mmSpreadBps = Math.round(
          kindMmBps[kind] * (1 + 0.3 * Math.sqrt(tenorYears)) * profileRiskMult[tier],
        );
        const slippageBps = Math.round(
          kindSlipBps[kind] *
            (1 + 1.1 * Math.sqrt(tenorYears)) *
            profileRiskMult[tier],
        );
        const underwritingBps = Math.round(
          kindUwBps[kind] *
            (1 + 1.7 * Math.sqrt(tenorYears)) *
            profileRiskMult[tier],
        );
        const totalHaircutBps = matured
          ? 0
          : Math.min(6_500, mmSpreadBps + slippageBps + underwritingBps);
        const indicativePricePct = Math.max(0.05, 1 - totalHaircutBps / 10_000);
        const indicativePricePerToken = Math.max(
          0.0005,
          entryPricePerToken * indicativePricePct,
        );
        const indicativeUsdc =
          Math.max(0, vault.principal_usdc * indicativePricePct);

        // On-chain settlement preview — the ACTUAL amount the user will
        // receive when they click "Execute on-chain sell". This build's
        // close_early / redeem_at_maturity is a simplified unwind that
        // charges only a 30 bps basket-exit haircut (pre-maturity) + a
        // 5 bps strategy fee, which is a fraction of what a real desk
        // would haircut (the MM indicative above). Surfacing both makes
        // the sell modal honest: users see the market-realistic quote
        // AND what this demo program actually pays out.
        const basketSleeve = vault.yield_deployed_usdc ?? 0;
        const adapterSleeve = Math.max(0, vault.principal_usdc - basketSleeve);
        const daysElapsed = Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(vault.created_at).getTime()) / (1000 * 60 * 60 * 24),
          ),
        );
        const accruedYield = vault.principal_usdc * (vault.estimated_apy / 365) * daysElapsed;
        const basketExitFeeBps = matured ? 0 : 30;
        const strategyFeeBps = 5;
        const onchainGross = matured
          ? vault.principal_usdc + accruedYield
          : basketSleeve + adapterSleeve;
        const onchainBasketFee = (basketSleeve * basketExitFeeBps) / 10_000;
        const onchainStrategyFee =
          ((onchainGross - onchainBasketFee) * strategyFeeBps) / 10_000;
        const onchainExpected = Math.max(
          0,
          onchainGross - onchainBasketFee - onchainStrategyFee,
        );

        return {
          vault_id: vault.id,
          bundle_id: vault.bundle_id,
          tranche_kind: vault.tranche_kind,
          // Both matured and pre-maturity positions are executable on-chain
          // now that close_early exists. Matured lots route through
          // redeem_at_maturity (no fee other than the 5 bps strategy fee
          // we compute into expected_proceeds). Pre-maturity lots route
          // through close_early, which takes the same strategy fee and
          // additionally eats a 30 bps early-exit haircut on the basket
          // sleeve inside vault::exit_active. The MM-style haircut above
          // is an off-chain indicative quote for UI display only.
          status: 'can_execute_onchain',
          matured,
          maturity_ts: maturityTs,
          seconds_remaining: remainingSec,
          entry_price_per_token: entryPricePerToken,
          indicative_price_per_token: indicativePricePerToken,
          indicative_price_pct: indicativePricePct,
          indicative_usdc: Math.round(indicativeUsdc * 100) / 100,
          mm_spread_bps: mmSpreadBps,
          slippage_bps: slippageBps,
          underwriting_bps: underwritingBps,
          total_haircut_bps: totalHaircutBps,
          // Honest on-chain settlement preview — what close_early /
          // redeem_at_maturity will actually pay out. Shown alongside
          // the indicative MM quote in the UI so the two numbers are
          // clearly labeled.
          onchain_expected_usdc: Math.round(onchainExpected * 100) / 100,
          onchain_gross_usdc: Math.round(onchainGross * 100) / 100,
          onchain_basket_exit_fee_bps: basketExitFeeBps,
          onchain_strategy_fee_bps: strategyFeeBps,
        };
      }),
    );

    res.status(200).json({
      kind: 'rfq',
      quotes,
      executable_count: quotes.filter((q: any) => q.status === 'can_execute_onchain').length,
    });
  } catch (err) {
    console.error('POST /api/ppn/tranche/sell/rfq error:', err);
    res.status(500).json({ error: 'Failed to build tranche sell RFQ' });
  }
});

/**
 * POST /api/ppn/onchain/redeem/confirm
 * Persist the redeem signature and flip the vault to `withdrawn`.
 * Body: { vault_id, signature }
 */
router.post('/onchain/redeem/confirm', async (req: Request, res: Response) => {
  try {
    const { vault_id, signature, wallet_address } = req.body as {
      vault_id: string;
      signature: string;
      wallet_address?: string;
    };
    if (!vault_id || !signature) {
      return res.status(400).json({ error: 'vault_id and signature are required' });
    }

    const vault = await getPPNVaultById(vault_id);
    if (!vault) return res.status(404).json({ error: 'PPN vault not found' });
    if (wallet_address && wallet_address !== vault.wallet_address) {
      return res.status(403).json({ error: 'Wallet mismatch for vault' });
    }

    const confirmed = await confirmTransaction(signature);
    if (!confirmed) {
      return res.status(400).json({ error: 'Transaction has not confirmed yet' });
    }
    const signatureMatchesVault = await verifyPpnTxMatchesVault(
      signature,
      vault.wallet_address,
      vault.vault_address ?? null,
    );
    if (!signatureMatchesVault) {
      return res.status(400).json({
        error: 'Confirmed signature does not match expected wallet/note accounts',
      });
    }

    const updated = await updatePPNVaultOnchain(vault_id, {
      redemption_tx_signature: signature,
      status: 'withdrawn',
    });
    if (!updated) {
      return res.status(500).json({ error: 'Failed to update PPN vault after redeem' });
    }

    // Record the real wallet-side USDC delta, not the stored principal.
    // redeem_at_maturity pays principal + accrued yield − 5 bps strategy
    // fee; logging principal alone would hide both the yield and the fee
    // from the History tab.
    const ownerDelta = await getUserUsdcDeltaFromTx(signature, vault.wallet_address);
    const netReceived =
      ownerDelta != null && ownerDelta > 0 ? ownerDelta : vault.principal_usdc;
    const feeUsdc = Math.max(0, vault.principal_usdc - netReceived);

    const tx = await createTransaction({
      bundle_id: vault.bundle_id,
      wallet_address: vault.wallet_address,
      type: 'redemption',
      amount_usdc: netReceived,
      tokens: 0,
      fee_usdc: feeUsdc,
      tx_signature: signature,
    });

    res.status(201).json({
      vault_id,
      bundle_id: vault.bundle_id,
      wallet_address: vault.wallet_address,
      principal_returned: netReceived,
      signature,
      transaction_id: tx?.id ?? null,
    });
  } catch (err) {
    console.error('POST /api/ppn/onchain/redeem/confirm error:', err);
    res.status(500).json({ error: 'Failed to confirm PPN on-chain redeem' });
  }
});

// ---------------------------------------------------------------------------
// PPN early-exit routes (divest / close_early)
// Both follow the same prepare → sign → confirm contract as /onchain/redeem.
// ---------------------------------------------------------------------------

/**
 * POST /api/ppn/onchain/divest/prepare
 *
 * Build a `divest` tx: sells the note's basket TRAX holdings back to the
 * vault (via exit_active CPI), takes the PPN strategy fee off the USDC
 * proceeds, routes the rest to the owner. Principal stays in the yield
 * adapter — note remains `active`.
 *
 * Body: { vault_id }  OR  { bundle_id, wallet_address }
 */
router.post('/onchain/divest/prepare', async (req: Request, res: Response) => {
  try {
    const { vault_id, bundle_id, wallet_address } = req.body as {
      vault_id?: string;
      bundle_id?: string;
      wallet_address?: string;
    };

    let vault = null as Awaited<ReturnType<typeof getPPNVaultById>> | null;
    if (vault_id) {
      vault = await getPPNVaultById(vault_id);
    } else if (bundle_id && wallet_address) {
      vault = await getActivePPNVault(wallet_address, bundle_id);
    }

    if (!vault) {
      return res.status(404).json({
        error: 'PPN vault not found. Supply vault_id, or (bundle_id + wallet_address).',
      });
    }
    if (wallet_address && wallet_address !== vault.wallet_address) {
      return res.status(403).json({ error: 'Wallet mismatch for requested vault.' });
    }
    if (!vault.note_seed_hex) {
      return res.status(400).json({
        error: 'This PPN vault was created before on-chain integration (no note seed).',
      });
    }
    if (vault.status !== 'active') {
      return res.status(400).json({
        error: `PPN vault is not active (status: ${vault.status})`,
      });
    }
    // Tranches are allowed through: the RFQ is an off-chain haircut quote;
    // the on-chain settlement is the same divest for vanilla and tranche.

    const built = await buildPpnDivestTx({
      userPubkey: new PublicKey(vault.wallet_address),
      bundleId: vault.bundle_id,
      noteSeedHex: vault.note_seed_hex,
      strategyFeeBps: STRATEGY_FEE_BPS,
    });

    res.status(200).json({
      kind: 'prepared',
      vault_id: vault.id,
      bundle_id: vault.bundle_id,
      wallet_address: vault.wallet_address,
      strategy_fee_bps: STRATEGY_FEE_BPS,
      // On-chain computes the exact fee from the post-CPI balance; this is
      // a pre-trade display estimate and may be 0 if we didn't quote NAV.
      estimated_strategy_fee_usdc: Number(built.estimatedStrategyFeeUsdc) / 1_000_000,
      note_pda: built.notePda,
      transaction_base64: built.transactionBase64,
      recent_blockhash: built.recentBlockhash,
      last_valid_block_height: built.lastValidBlockHeight,
    });
  } catch (err) {
    console.error('POST /api/ppn/onchain/divest/prepare error:', err);
    res.status(500).json({ error: 'Failed to prepare PPN divest' });
  }
});

/**
 * POST /api/ppn/onchain/divest/confirm
 *
 * Persist the divest signature into `ppn_vaults.divest_tx_signature`. Does
 * NOT flip status — the vault sleeve is still live.
 * Body: { vault_id, signature, wallet_address? }
 */
router.post('/onchain/divest/confirm', async (req: Request, res: Response) => {
  try {
    const { vault_id, signature, wallet_address } = req.body as {
      vault_id: string;
      signature: string;
      wallet_address?: string;
    };
    if (!vault_id || !signature) {
      return res.status(400).json({ error: 'vault_id and signature are required' });
    }

    const vault = await getPPNVaultById(vault_id);
    if (!vault) return res.status(404).json({ error: 'PPN vault not found' });
    if (wallet_address && wallet_address !== vault.wallet_address) {
      return res.status(403).json({ error: 'Wallet mismatch for vault' });
    }

    const confirmed = await confirmTransaction(signature);
    if (!confirmed) {
      return res.status(400).json({ error: 'Transaction has not confirmed yet' });
    }
    const ok = await verifyPpnTxMatchesVault(
      signature,
      vault.wallet_address,
      vault.vault_address ?? null,
    );
    if (!ok) {
      return res.status(400).json({
        error: 'Confirmed signature does not match expected wallet/note accounts',
      });
    }

    await updatePPNVaultOnchain(vault_id, {
      divest_tx_signature: signature,
    } as any).catch((err) =>
      console.warn('updatePPNVaultOnchain (divest) non-fatal:', err),
    );

    // Log the real USDC delta so the History tab shows the actual
    // basket-unwind proceeds, not `0`. Divest pulls the basket sleeve
    // via exit_active (30 bps) and pays the user net-of-5-bps strategy
    // fee; principal stays deposited and the note keeps status=active.
    const ownerDelta = await getUserUsdcDeltaFromTx(signature, vault.wallet_address);
    const netReceived = ownerDelta != null && ownerDelta > 0 ? ownerDelta : 0;

    await createTransaction({
      bundle_id: vault.bundle_id,
      wallet_address: vault.wallet_address,
      type: 'divest',
      amount_usdc: netReceived,
      tokens: 0,
      // Divest fees ride inside the basket-exit math on-chain. We don't
      // know the gross vs net breakdown without more bookkeeping, so
      // leave fee_usdc as 0 and show amount_usdc as the honest net.
      fee_usdc: 0,
      tx_signature: signature,
    });

    res.status(201).json({
      vault_id,
      bundle_id: vault.bundle_id,
      wallet_address: vault.wallet_address,
      signature,
      status: 'active',
    });
  } catch (err) {
    console.error('POST /api/ppn/onchain/divest/confirm error:', err);
    res.status(500).json({ error: 'Failed to confirm PPN divest' });
  }
});

/**
 * POST /api/ppn/onchain/close/prepare
 *
 * Build a `close_early` tx: sells basket TRAX AND withdraws principal from
 * the yield adapter in a single ix, takes the PPN strategy fee off the
 * combined payout, routes the net to the owner. Marks the note Redeemed.
 *
 * Body: { vault_id, wallet_address, min_proceeds_usdc? }  (or bundle_id+wallet)
 */
router.post('/onchain/close/prepare', async (req: Request, res: Response) => {
  try {
    const { vault_id, bundle_id, wallet_address, min_proceeds_usdc } = req.body as {
      vault_id?: string;
      bundle_id?: string;
      wallet_address?: string;
      min_proceeds_usdc?: number;
    };

    let vault = null as Awaited<ReturnType<typeof getPPNVaultById>> | null;
    if (vault_id) {
      vault = await getPPNVaultById(vault_id);
    } else if (bundle_id && wallet_address) {
      vault = await getActivePPNVault(wallet_address, bundle_id);
    }

    if (!vault) {
      return res.status(404).json({
        error: 'PPN vault not found. Supply vault_id, or (bundle_id + wallet_address).',
      });
    }
    if (wallet_address && wallet_address !== vault.wallet_address) {
      return res.status(403).json({ error: 'Wallet mismatch for requested vault.' });
    }
    if (!vault.note_seed_hex) {
      return res.status(400).json({
        error: 'This PPN vault was created before on-chain integration (no note seed).',
      });
    }
    if (vault.status !== 'active') {
      return res.status(400).json({
        error: `PPN vault is not active (status: ${vault.status})`,
      });
    }
    // Note: tranche positions CAN use close_early. The tranche RFQ gives
    // an off-chain indicative quote (haircut vs FV), but the on-chain
    // settlement path for "early exit" is the same for vanilla PPN and
    // tranche positions — burn basket TRAX via vault::exit_active + pull
    // principal from the yield adapter + take the 5 bps strategy fee.

    const principalBaseUnits = BigInt(
      Math.round(((vault.principal_usdc as number) ?? 0) * 1_000_000),
    );
    const minProceedsBaseUnits =
      min_proceeds_usdc !== undefined && min_proceeds_usdc !== null
        ? BigInt(Math.round(min_proceeds_usdc * 1_000_000))
        : 0n;

    const built = await buildPpnCloseTx({
      userPubkey: new PublicKey(vault.wallet_address),
      bundleId: vault.bundle_id,
      noteSeedHex: vault.note_seed_hex,
      principalUsdc: principalBaseUnits,
      strategyFeeBps: STRATEGY_FEE_BPS,
      minProceedsUsdc: minProceedsBaseUnits,
    });

    res.status(200).json({
      kind: 'prepared',
      vault_id: vault.id,
      bundle_id: vault.bundle_id,
      wallet_address: vault.wallet_address,
      principal_usdc: vault.principal_usdc,
      strategy_fee_bps: STRATEGY_FEE_BPS,
      estimated_strategy_fee_usdc:
        Number(built.estimatedStrategyFeeUsdc) / 1_000_000,
      estimated_net_usdc: Number(built.estimatedNetUsdc) / 1_000_000,
      note_pda: built.notePda,
      transaction_base64: built.transactionBase64,
      recent_blockhash: built.recentBlockhash,
      last_valid_block_height: built.lastValidBlockHeight,
    });
  } catch (err) {
    console.error('POST /api/ppn/onchain/close/prepare error:', err);
    res.status(500).json({ error: 'Failed to prepare PPN close_early' });
  }
});

/**
 * POST /api/ppn/onchain/close/confirm
 *
 * Persist the close signature into `ppn_vaults.redemption_tx_signature` and
 * flip status → 'withdrawn'. Same audit contract as redeem/confirm.
 * Body: { vault_id, signature, wallet_address? }
 */
router.post('/onchain/close/confirm', async (req: Request, res: Response) => {
  try {
    const { vault_id, signature, wallet_address } = req.body as {
      vault_id: string;
      signature: string;
      wallet_address?: string;
    };
    if (!vault_id || !signature) {
      return res.status(400).json({ error: 'vault_id and signature are required' });
    }

    const vault = await getPPNVaultById(vault_id);
    if (!vault) return res.status(404).json({ error: 'PPN vault not found' });
    if (wallet_address && wallet_address !== vault.wallet_address) {
      return res.status(403).json({ error: 'Wallet mismatch for vault' });
    }

    const confirmed = await confirmTransaction(signature);
    if (!confirmed) {
      return res.status(400).json({ error: 'Transaction has not confirmed yet' });
    }
    const ok = await verifyPpnTxMatchesVault(
      signature,
      vault.wallet_address,
      vault.vault_address ?? null,
    );
    if (!ok) {
      return res.status(400).json({
        error: 'Confirmed signature does not match expected wallet/note accounts',
      });
    }

    const updated = await updatePPNVaultOnchain(vault_id, {
      redemption_tx_signature: signature,
      status: 'withdrawn',
    });
    if (!updated) {
      return res.status(500).json({ error: 'Failed to update PPN vault after close' });
    }

    // Log the REAL amount the user received, read from the tx's pre/post
    // USDC balances. Prior behaviour recorded vault.principal_usdc with a
    // 0 fee, which hid the 30 bps basket exit + 5 bps strategy fee from
    // the History tab and caused the displayed amount to never match the
    // user's actual wallet delta.
    const ownerDelta = await getUserUsdcDeltaFromTx(signature, vault.wallet_address);
    const netReceived =
      ownerDelta != null && ownerDelta > 0 ? ownerDelta : vault.principal_usdc;
    const feeUsdc = Math.max(0, vault.principal_usdc - netReceived);

    const tx = await createTransaction({
      bundle_id: vault.bundle_id,
      wallet_address: vault.wallet_address,
      type: 'redemption',
      amount_usdc: netReceived,
      tokens: 0,
      fee_usdc: feeUsdc,
      tx_signature: signature,
    });

    res.status(201).json({
      vault_id,
      bundle_id: vault.bundle_id,
      wallet_address: vault.wallet_address,
      principal_returned: netReceived,
      signature,
      transaction_id: tx?.id ?? null,
      status: 'withdrawn',
    });
  } catch (err) {
    console.error('POST /api/ppn/onchain/close/confirm error:', err);
    res.status(500).json({ error: 'Failed to confirm PPN close_early' });
  }
});

export const ppnRoutes = router;
