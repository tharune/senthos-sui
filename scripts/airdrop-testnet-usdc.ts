/**
 * Airdrop the testnet mock USDC to any Solana wallet.
 *
 * Prerequisites:
 *   - scripts/mint-testnet-usdc.ts has been run once (so the mint exists)
 *   - backend/.env.testnet has USDC_MINT set to the mock mint address
 *   - AUTHORITY_KEYPAIR is the mint authority of that mock mint
 *
 * Usage:
 *   npx tsx scripts/airdrop-testnet-usdc.ts <WALLET_BASE58> [AMOUNT_UI]
 *
 * Examples:
 *   # Give wallet 1000 mock-USDC (default amount)
 *   npx tsx scripts/airdrop-testnet-usdc.ts 7xKXtg2C...
 *
 *   # Give wallet 5000 mock-USDC
 *   npx tsx scripts/airdrop-testnet-usdc.ts 7xKXtg2C... 5000
 *
 * This creates the recipient's ATA if it doesn't exist (paid by authority).
 */
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

const TESTNET_ENV = path.join(__dirname, "..", "backend", ".env.testnet");
const DEFAULT_ENV = path.join(__dirname, "..", "backend", ".env");
dotenv.config({ path: fs.existsSync(TESTNET_ENV) ? TESTNET_ENV : DEFAULT_ENV });

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getMint,
} from "@solana/spl-token";

const DEFAULT_AMOUNT_UI = 1000;

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
  const [recipientStr, amountStr] = process.argv.slice(2);
  if (!recipientStr) {
    console.error("Usage: npx tsx scripts/airdrop-testnet-usdc.ts <WALLET> [AMOUNT]");
    process.exit(2);
  }
  const amountUi = amountStr ? parseFloat(amountStr) : DEFAULT_AMOUNT_UI;
  if (!Number.isFinite(amountUi) || amountUi <= 0) {
    console.error(`Invalid amount: ${amountStr}`);
    process.exit(2);
  }

  const mintStr = process.env.USDC_MINT;
  if (!mintStr) {
    throw new Error(
      "USDC_MINT not set. Run scripts/mint-testnet-usdc.ts first and put the printed address in backend/.env.testnet.",
    );
  }

  const rpcUrl =
    process.env.SOLANA_RPC_URL ?? "https://api.testnet.solana.com";
  const conn = new Connection(rpcUrl, "confirmed");
  const authority = loadAuthority();
  const mint = new PublicKey(mintStr);
  const recipient = new PublicKey(recipientStr);

  const mintInfo = await getMint(conn, mint);
  const amountRaw =
    BigInt(Math.round(amountUi * 10 ** mintInfo.decimals));

  if (!mintInfo.mintAuthority?.equals(authority.publicKey)) {
    throw new Error(
      `Authority ${authority.publicKey.toBase58()} is NOT the mint authority ` +
        `of ${mint.toBase58()} (actual: ${mintInfo.mintAuthority?.toBase58() ?? "null"}). ` +
        "This mint can't be airdropped by this script.",
    );
  }

  console.log(`RPC:       ${rpcUrl}`);
  console.log(`Mint:      ${mint.toBase58()} (${mintInfo.decimals} dec)`);
  console.log(`Recipient: ${recipient.toBase58()}`);
  console.log(`Amount:    ${amountUi} (raw ${amountRaw})`);
  console.log("");

  const ata = await getOrCreateAssociatedTokenAccount(
    conn,
    authority,
    mint,
    recipient,
    false,
    "confirmed",
  );
  console.log(`  ATA: ${ata.address.toBase58()}`);

  const sig = await mintTo(
    conn,
    authority,
    mint,
    ata.address,
    authority,
    amountRaw,
    [],
    { commitment: "confirmed" },
  );
  console.log(`  ✓ airdrop complete: ${sig}`);
  console.log("");
  console.log(
    `https://explorer.solana.com/tx/${sig}?cluster=testnet`,
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
