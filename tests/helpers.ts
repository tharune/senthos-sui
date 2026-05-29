/**
 * Shared test helpers for Anchor integration tests.
 */
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";

export const VAULT_SEED = Buffer.from("vault");
export const MINT_SEED = Buffer.from("mint");
export const USDC_VAULT_SEED = Buffer.from("usdc_vault");
export const PPN_SEED = Buffer.from("ppn");
export const METEORA_MOCK_SEED = Buffer.from("meteora_mock");
export const METEORA_MOCK_POOL_SEED = Buffer.from("meteora_mock_pool");

/** Derive the vault PDA for a bundle seed. */
export function deriveVaultPda(
  programId: PublicKey,
  bundleSeed: Uint8Array,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, Buffer.from(bundleSeed)],
    programId,
  );
}

export function deriveTraxMint(
  programId: PublicKey,
  bundleSeed: Uint8Array,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [MINT_SEED, Buffer.from(bundleSeed)],
    programId,
  );
}

export function deriveUsdcVault(
  programId: PublicKey,
  bundleSeed: Uint8Array,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [USDC_VAULT_SEED, Buffer.from(bundleSeed)],
    programId,
  );
}

export function derivePpnNote(
  programId: PublicKey,
  owner: PublicKey,
  noteSeed: Uint8Array,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PPN_SEED, owner.toBuffer(), Buffer.from(noteSeed)],
    programId,
  );
}

export function deriveMeteoraAdapter(
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([METEORA_MOCK_SEED], programId);
}

export function deriveMeteoraPool(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [METEORA_MOCK_POOL_SEED],
    programId,
  );
}

/** Airdrop SOL to a pubkey (localnet/devnet). */
export async function airdrop(
  connection: anchor.web3.Connection,
  pubkey: PublicKey,
  amountSol = 2,
): Promise<void> {
  const sig = await connection.requestAirdrop(
    pubkey,
    amountSol * LAMPORTS_PER_SOL,
  );
  await connection.confirmTransaction(sig, "confirmed");
}

/** Create a fresh USDC-like mint (6 decimals) on the current cluster. */
export async function createUsdcMint(
  connection: anchor.web3.Connection,
  payer: Keypair,
): Promise<PublicKey> {
  return await createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    6,
  );
}

/** Fund a wallet with freshly minted USDC. Returns the ATA. */
export async function fundUsdc(
  connection: anchor.web3.Connection,
  payer: Keypair,
  usdcMint: PublicKey,
  recipient: PublicKey,
  amountUi: number,
): Promise<PublicKey> {
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    usdcMint,
    recipient,
  );
  await mintTo(
    connection,
    payer,
    usdcMint,
    ata.address,
    payer,
    Math.floor(amountUi * 1_000_000),
  );
  return ata.address;
}

/** Read raw token balance (base units). */
export async function tokenBalance(
  connection: anchor.web3.Connection,
  ata: PublicKey,
): Promise<bigint> {
  const acct = await getAccount(connection, ata);
  return acct.amount;
}

/** Build instruction to create an ATA if it doesn't exist. */
export function ensureAtaIx(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
): anchor.web3.TransactionInstruction {
  const ata = getAssociatedTokenAddressSync(mint, owner, true);
  return createAssociatedTokenAccountInstruction(payer, ata, owner, mint);
}

/** Random 16-byte seed for a vault. */
export function randomBundleSeed(): Uint8Array {
  const s = new Uint8Array(16);
  crypto.getRandomValues(s);
  return s;
}

/** Random 8-byte seed for a ppn note. */
export function randomNoteSeed(): Uint8Array {
  const s = new Uint8Array(8);
  crypto.getRandomValues(s);
  return s;
}

/** Random 32-byte market id. */
export function randomMarketId(): number[] {
  const s = new Uint8Array(32);
  crypto.getRandomValues(s);
  return Array.from(s);
}
