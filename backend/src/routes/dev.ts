import { Router, type Request, type Response } from "express";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { loadKeypairBytes } from "../solana/anchor";

const router = Router();

/**
 * Faucet endpoint for the testnet mock USDC mint. Anyone can request
 * up to 1000 mock USDC for any wallet — no auth, no rate limit beyond
 * the express generalLimiter applied at app level.
 *
 * Requires AUTHORITY_KEYPAIR to point at a local mint-authority keypair.
 * Mock USDC has no value and exists only on testnet.
 *
 * Disabled when SOLANA_CLUSTER is not "testnet" — there's no mock USDC
 * mint we control on devnet (Circle's mint) or mainnet.
 */
router.post("/airdrop-mock-usdc", async (req: Request, res: Response) => {
  const cluster = process.env.SOLANA_CLUSTER ?? "devnet";
  if (cluster !== "testnet") {
    res.status(400).json({
      error: `airdrop-mock-usdc is only available on testnet (current cluster: ${cluster})`,
    });
    return;
  }

  const { walletAddress, amount } = (req.body ?? {}) as {
    walletAddress?: string;
    amount?: number;
  };
  if (!walletAddress) {
    res.status(400).json({ error: "walletAddress is required" });
    return;
  }
  const amountUi = Math.min(Math.max(Number(amount) || 100, 1), 1000);

  let recipient: PublicKey;
  try {
    recipient = new PublicKey(walletAddress);
  } catch {
    res.status(400).json({ error: "walletAddress is not a valid pubkey" });
    return;
  }

  const usdcMintStr = process.env.USDC_MINT;
  if (!usdcMintStr) {
    res.status(500).json({ error: "USDC_MINT env var is not set" });
    return;
  }
  const usdcMint = new PublicKey(usdcMintStr);

  if (!process.env.AUTHORITY_KEYPAIR) {
    res.status(500).json({ error: "AUTHORITY_KEYPAIR env var is not set" });
    return;
  }
  let authority: Keypair;
  try {
    authority = Keypair.fromSecretKey(loadKeypairBytes(process.env.AUTHORITY_KEYPAIR));
  } catch (err) {
    res.status(500).json({
      error: `failed to load authority keypair: ${(err as Error).message}`,
    });
    return;
  }

  const conn = new Connection(
    process.env.SOLANA_RPC_URL ?? "https://api.testnet.solana.com",
    "confirmed",
  );
  const ata = await getAssociatedTokenAddress(usdcMint, recipient);

  const tx = new Transaction();
  // Idempotently create the recipient ATA if it doesn't exist.
  const ataInfo = await conn.getAccountInfo(ata);
  if (!ataInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey,
        ata,
        recipient,
        usdcMint,
        TOKEN_PROGRAM_ID,
      ),
    );
  }
  const rawAmount = BigInt(Math.floor(amountUi * 1_000_000));
  tx.add(
    createMintToInstruction(usdcMint, ata, authority.publicKey, rawAmount),
  );

  try {
    const sig = await sendAndConfirmTransaction(conn, tx, [authority], {
      commitment: "confirmed",
    });
    res.json({
      ok: true,
      signature: sig,
      amount: amountUi,
      mint: usdcMintStr,
      ata: ata.toBase58(),
      recipient: walletAddress,
      explorer: `https://explorer.solana.com/tx/${sig}?cluster=testnet`,
    });
  } catch (err) {
    res
      .status(500)
      .json({ error: `airdrop failed: ${(err as Error).message}` });
  }
});

/**
 * GET /api/dev/balances/:walletAddress
 *
 * Proxy token balance queries through the backend so the browser never
 * hits the RPC directly (avoids 429 rate-limit errors on both testnet
 * and devnet). Returns USDC balance + all other SPL token balances.
 *
 * Under concurrent load the raw RPC call (getParsedTokenAccountsByOwner)
 * is expensive and devnet will return 500s when multiple concurrent
 * calls fire for the same wallet (classic thundering herd on frontend
 * mount / tab switch). This handler guards against both:
 *
 *   - 2s in-memory cache per wallet → repeat polls within 2s are served
 *     from cache, never hit RPC.
 *   - Promise coalescing → multiple concurrent cache-miss requests for
 *     the same wallet share ONE in-flight RPC call instead of each
 *     firing their own.
 *
 * These together reduce a 3-way concurrent poll from "3 RPC calls, 2 of
 * them rate-limited to 500" down to "1 RPC call, all 3 requests served
 * from the single result".
 */
type BalancesResponse = {
  wallet: string;
  usdc: number;
  sths: Array<{ mint: string; uiAmount: number; ata: string }>;
};
const BALANCES_CACHE_MS = 2_000;
const balancesCache = new Map<string, { ts: number; data: BalancesResponse }>();
const balancesInFlight = new Map<string, Promise<BalancesResponse>>();

async function computeBalances(
  walletAddress: string,
): Promise<BalancesResponse> {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.testnet.solana.com";
  const usdcMint = process.env.USDC_MINT;
  const conn = new Connection(rpcUrl, "confirmed");
  const owner = new PublicKey(walletAddress);

  const tokenAccounts = await conn.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID,
  });

  let usdcBalance = 0;
  const sthsBalances: BalancesResponse["sths"] = [];
  for (const { pubkey, account } of tokenAccounts.value) {
    const info = (account.data as any).parsed?.info;
    if (!info) continue;
    const mint = info.mint as string;
    const uiAmount: number = info.tokenAmount?.uiAmount ?? 0;
    if (usdcMint && mint === usdcMint) {
      usdcBalance = uiAmount;
    } else {
      sthsBalances.push({ mint, uiAmount, ata: pubkey.toBase58() });
    }
  }
  return { wallet: walletAddress, usdc: usdcBalance, sths: sthsBalances };
}

router.get("/balances/:walletAddress", async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;

    // Serve from cache if fresh.
    const cached = balancesCache.get(walletAddress);
    if (cached && Date.now() - cached.ts < BALANCES_CACHE_MS) {
      res.json(cached.data);
      return;
    }

    // Coalesce concurrent cache-misses.
    let inFlight = balancesInFlight.get(walletAddress);
    if (!inFlight) {
      inFlight = (async () => {
        try {
          const data = await computeBalances(walletAddress);
          balancesCache.set(walletAddress, { ts: Date.now(), data });
          return data;
        } finally {
          balancesInFlight.delete(walletAddress);
        }
      })();
      balancesInFlight.set(walletAddress, inFlight);
    }

    const data = await inFlight;
    res.json(data);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to fetch balances: ${detail}` });
  }
});

/**
 * GET /api/dev/tx-status/:signature
 *
 * Proxy getSignatureStatus through the backend. The public testnet RPC
 * enforces IP-level rate limits, and the frontend's
 * wallet-bridge.waitForConfirmation() poller hammers it every 1.5s for up
 * to 60s per tx — which gets every teammate's browser throttled with
 * `429 Too many requests from your IP` and leaves the UI stuck on
 * "Confirming on Solana…" even though the tx landed fine.
 *
 * By serving this from a single backend IP, the full browser fleet shares
 * one rate-limit bucket and confirmations actually come back. Returns
 * { status: 'confirmed'|'finalized'|'processed'|'not_found', err: ... }
 * so the frontend doesn't have to know the full RPC response shape.
 */
router.get("/tx-status/:signature", async (req: Request, res: Response) => {
  try {
    const { signature } = req.params;
    const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.testnet.solana.com";
    const conn = new Connection(rpcUrl, "confirmed");
    const s = await conn.getSignatureStatus(signature, {
      searchTransactionHistory: true,
    });
    const val = s.value;
    if (!val) {
      res.json({ status: "not_found" });
      return;
    }
    if (val.err) {
      res.json({ status: "failed", err: val.err });
      return;
    }
    res.json({ status: val.confirmationStatus ?? "processed" });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to fetch tx status: ${detail}` });
  }
});

export const devRoutes = router;
export default router;
