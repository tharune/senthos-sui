/**
 * Mint a mock USDC SPL token on Solana testnet.
 *
 * Circle does NOT issue USDC on testnet (only devnet + mainnet), so every
 * project running on testnet deploys its own 6-decimal SPL mint and uses
 * that as USDC. This script does two things:
 *
 *   1. Creates an SPL mint on testnet with 6 decimals, owned by the
 *      AUTHORITY_KEYPAIR specified in backend/.env.testnet.
 *   2. Mints 10,000,000 of those tokens (i.e. "$10M" at the UI layer) to
 *      the authority's ATA, so downstream seed scripts + tests have
 *      plenty to work with.
 *
 * Idempotent: reuses an existing mint keypair at target/keys/testnet-usdc.json
 * if one is there, so re-running won't create a new mint. If you WANT a
 * fresh mint, delete that file first.
 *
 * Usage:
 *   cd <repo-root>
 *   npx tsx scripts/mint-testnet-usdc.ts
 *
 * After running, copy the printed mint address into:
 *   - backend/.env.testnet  →  USDC_MINT=...
 *   - .env.local.testnet    →  NEXT_PUBLIC_USDC_MINT=...
 *
 * Env (read from backend/.env.testnet):
 *   SOLANA_RPC_URL       (optional; defaults to https://api.testnet.solana.com)
 *   AUTHORITY_KEYPAIR    (required — file path OR JSON array)
 *
 * SOL cost: ~0.0015 SOL for mint rent + ATA rent. Airdrop on testnet is
 * rate-limited; DEPLOY-TO-TESTNET.command handles it upstream.
 */
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

// Prefer .env.testnet, fall back to .env. We load testnet-first so running
// this script doesn't require the switcher to have been invoked.
const TESTNET_ENV = path.join(__dirname, "..", "backend", ".env.testnet");
const DEFAULT_ENV = path.join(__dirname, "..", "backend", ".env");
dotenv.config({ path: fs.existsSync(TESTNET_ENV) ? TESTNET_ENV : DEFAULT_ENV });

import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getMint,
} from "@solana/spl-token";

const DECIMALS = 6;
const INITIAL_SUPPLY_UI = 10_000_000; // 10M tokens at UI layer
const INITIAL_SUPPLY_RAW = BigInt(INITIAL_SUPPLY_UI) * BigInt(10) ** BigInt(DECIMALS);

const MINT_KEYPAIR_FILE = path.join(
  __dirname,
  "..",
  "target",
  "keys",
  "testnet-usdc.json",
);

function loadAuthority(): Keypair {
  const raw = process.env.AUTHORITY_KEYPAIR;
  if (!raw) {
    throw new Error(
      "AUTHORITY_KEYPAIR not set in backend/.env.testnet. See .env.testnet.example.",
    );
  }
  let secret: Uint8Array;
  if (raw.trim().startsWith("[")) {
    secret = Uint8Array.from(JSON.parse(raw));
  } else {
    const file = fs.readFileSync(
      raw.replace(/^~/, process.env.HOME ?? ""),
      "utf-8",
    );
    secret = Uint8Array.from(JSON.parse(file));
  }
  return Keypair.fromSecretKey(secret);
}

function loadOrCreateMintKeypair(): Keypair {
  if (fs.existsSync(MINT_KEYPAIR_FILE)) {
    const raw = JSON.parse(fs.readFileSync(MINT_KEYPAIR_FILE, "utf-8"));
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  fs.mkdirSync(path.dirname(MINT_KEYPAIR_FILE), { recursive: true });
  const kp = Keypair.generate();
  fs.writeFileSync(
    MINT_KEYPAIR_FILE,
    JSON.stringify(Array.from(kp.secretKey)),
    "utf-8",
  );
  console.log(`  wrote new mint keypair → ${MINT_KEYPAIR_FILE}`);
  return kp;
}

async function main() {
  const rpcUrl =
    process.env.SOLANA_RPC_URL ?? clusterApiUrl("testnet" as any);
  if (!rpcUrl.includes("testnet")) {
    console.warn(
      `⚠  SOLANA_RPC_URL doesn't look like a testnet endpoint: ${rpcUrl}`,
    );
    console.warn(
      "   Continuing anyway — if this isn't intentional, Ctrl+C now.",
    );
  }
  const conn = new Connection(rpcUrl, "confirmed");
  const authority = loadAuthority();
  const mintKp = loadOrCreateMintKeypair();

  console.log(`RPC:       ${rpcUrl}`);
  console.log(`Authority: ${authority.publicKey.toBase58()}`);
  console.log(`Mint:      ${mintKp.publicKey.toBase58()}`);
  console.log("");

  // Fast-path: mint already exists on-chain.
  try {
    const existing = await getMint(conn, mintKp.publicKey);
    console.log(`✓ Mint already exists on-chain (supply=${existing.supply}).`);
    console.log(`  decimals:       ${existing.decimals}`);
    console.log(`  mintAuthority:  ${existing.mintAuthority?.toBase58() ?? "(null)"}`);
    if (existing.decimals !== DECIMALS) {
      throw new Error(
        `Existing mint has ${existing.decimals} decimals, expected ${DECIMALS}. ` +
          "Delete target/keys/testnet-usdc.json and rerun to create a fresh mint.",
      );
    }
    console.log("");
    console.log("No fresh mint created. If you want a new one, delete");
    console.log(`  ${MINT_KEYPAIR_FILE}`);
    console.log("and rerun.");
    return;
  } catch (err) {
    // Mint doesn't exist yet — continue below.
  }

  // Check authority has enough SOL for rent.
  const balance = await conn.getBalance(authority.publicKey);
  console.log(`Authority balance: ${balance / 1e9} SOL`);
  if (balance < 0.01 * 1e9) {
    throw new Error(
      `Authority has less than 0.01 SOL (${balance / 1e9}). ` +
        "Run `solana airdrop 1 --url testnet` first.",
    );
  }

  // Create the mint.
  console.log("Creating mint...");
  const mintAddress = await createMint(
    conn,
    authority, // payer
    authority.publicKey, // mint authority
    authority.publicKey, // freeze authority (keep same; we never freeze)
    DECIMALS,
    mintKp, // use the keypair we persisted
    { commitment: "confirmed" },
  );
  console.log(`  ✓ mint created: ${mintAddress.toBase58()}`);

  // Ensure authority's ATA and mint initial supply to it.
  console.log("Creating authority ATA + minting initial supply...");
  const ata = await getOrCreateAssociatedTokenAccount(
    conn,
    authority,
    mintAddress,
    authority.publicKey,
    false,
    "confirmed",
  );
  console.log(`  ✓ authority ATA: ${ata.address.toBase58()}`);

  const sig = await mintTo(
    conn,
    authority,
    mintAddress,
    ata.address,
    authority,
    INITIAL_SUPPLY_RAW,
    [],
    { commitment: "confirmed" },
  );
  console.log(`  ✓ minted ${INITIAL_SUPPLY_UI.toLocaleString()} tokens`);
  console.log(`    tx: ${sig}`);
  console.log("");

  // Persist the address so the orchestrator can pipe it into .env files.
  const logsDir = path.join(__dirname, "..", ".logs");
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(
    path.join(logsDir, "testnet-usdc-mint.txt"),
    mintAddress.toBase58() + "\n",
    "utf-8",
  );

  console.log("=".repeat(64));
  console.log("Mock testnet USDC is ready.");
  console.log("Mint address:", mintAddress.toBase58());
  console.log("");
  console.log("Paste this into BOTH:");
  console.log(`  backend/.env.testnet   →  USDC_MINT=${mintAddress.toBase58()}`);
  console.log(`  .env.local.testnet     →  NEXT_PUBLIC_USDC_MINT=${mintAddress.toBase58()}`);
  console.log("=".repeat(64));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
