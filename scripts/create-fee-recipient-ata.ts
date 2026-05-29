/**
 * One-off: create the fee recipient's Associated Token Account for
 * USDC_MINT on whatever cluster SOLANA_RPC_URL points at. Deposit txs
 * fail with AccountNotInitialized (Anchor 3012) on the `fee_recipient_ata`
 * constraint until this ATA exists.
 *
 * Rent (~0.002 SOL) is paid by AUTHORITY_KEYPAIR. Idempotent — returns
 * the existing ATA address without re-creating if already there.
 */
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

const TESTNET_ENV = path.join(__dirname, "..", "backend", ".env.testnet");
const DEFAULT_ENV = path.join(__dirname, "..", "backend", ".env");
dotenv.config({ path: fs.existsSync(TESTNET_ENV) ? TESTNET_ENV : DEFAULT_ENV });

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";

function loadAuthority(): Keypair {
  const raw = process.env.AUTHORITY_KEYPAIR;
  if (!raw) throw new Error("AUTHORITY_KEYPAIR not set");
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

async function main() {
  const mintStr = process.env.USDC_MINT;
  const feeStr = process.env.FEE_RECIPIENT;
  if (!mintStr) throw new Error("USDC_MINT not set");
  if (!feeStr) throw new Error("FEE_RECIPIENT not set");

  const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.testnet.solana.com";
  const conn = new Connection(rpcUrl, "confirmed");
  const authority = loadAuthority();
  const mint = new PublicKey(mintStr);
  const feeRecipient = new PublicKey(feeStr);

  console.log(`RPC:            ${rpcUrl}`);
  console.log(`Mint:           ${mint.toBase58()}`);
  console.log(`Fee recipient:  ${feeRecipient.toBase58()}`);
  console.log(`Funder:         ${authority.publicKey.toBase58()}`);

  const ata = await getOrCreateAssociatedTokenAccount(
    conn,
    authority,
    mint,
    feeRecipient,
    false,
    "confirmed",
  );
  console.log(`  ✓ ATA:          ${ata.address.toBase58()}`);
  console.log(`  amount:         ${ata.amount}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
