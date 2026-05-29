/**
 * One-off: transfer SOL from AUTHORITY_KEYPAIR to an arbitrary pubkey on
 * whatever cluster SOLANA_RPC_URL points at. Used to get past the testnet
 * faucet's rate limits when funding a Phantom wallet for tx-fee money.
 *
 * Usage: npx tsx scripts/send-testnet-sol.ts <RECIPIENT> <AMOUNT_SOL>
 */
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

const TESTNET_ENV = path.join(__dirname, "..", "backend", ".env.testnet");
const DEFAULT_ENV = path.join(__dirname, "..", "backend", ".env");
dotenv.config({ path: fs.existsSync(TESTNET_ENV) ? TESTNET_ENV : DEFAULT_ENV });

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

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
  if (!recipientStr || !amountStr) {
    console.error("Usage: npx tsx scripts/send-testnet-sol.ts <RECIPIENT> <AMOUNT_SOL>");
    process.exit(2);
  }
  const amount = parseFloat(amountStr);
  if (!Number.isFinite(amount) || amount <= 0) {
    console.error(`Invalid amount: ${amountStr}`);
    process.exit(2);
  }

  const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.testnet.solana.com";
  const conn = new Connection(rpcUrl, "confirmed");
  const authority = loadAuthority();
  const recipient = new PublicKey(recipientStr);
  const lamports = Math.round(amount * LAMPORTS_PER_SOL);

  console.log(`RPC:       ${rpcUrl}`);
  console.log(`From:      ${authority.publicKey.toBase58()}`);
  console.log(`To:        ${recipient.toBase58()}`);
  console.log(`Amount:    ${amount} SOL (${lamports} lamports)`);

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: recipient,
      lamports,
    }),
  );
  const sig = await sendAndConfirmTransaction(conn, tx, [authority], {
    commitment: "confirmed",
  });
  console.log(`  ✓ sent: ${sig}`);
  console.log(`https://explorer.solana.com/tx/${sig}?cluster=testnet`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
