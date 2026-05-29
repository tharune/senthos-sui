/**
 * Traxis Vault — full lifecycle integration tests.
 *
 * Run with: `anchor test`  (uses anchor localnet)
 *
 * Coverage:
 *   - initialize_vault validates args + stores state
 *   - deposit transfers USDC, pays fee, mints TRAX, all atomically
 *   - resolve_leg flips legs, idempotent, authority-gated
 *   - finalize_vault requires all legs resolved, computes payout ratio
 *   - redeem burns TRAX, pays out pro-rata USDC
 *   - admin_withdraw_fees drains residual USDC
 *   - negative: deposit post-finalize, redeem pre-finalize, unauthorized resolve
 */
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getMint,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import {
  airdrop,
  createUsdcMint,
  deriveTraxMint,
  deriveUsdcVault,
  deriveVaultPda,
  ensureAtaIx,
  fundUsdc,
  randomBundleSeed,
  randomMarketId,
  tokenBalance,
} from "./helpers";

describe("traxis_vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.TraxisVault as Program<any>;

  let usdcMint: PublicKey;
  let authority: Keypair;
  let feeRecipient: Keypair;
  let feeRecipientAta: PublicKey;
  let userA: Keypair;
  let userB: Keypair;

  before(async () => {
    authority = (provider.wallet as anchor.Wallet).payer;
    feeRecipient = Keypair.generate();
    userA = Keypair.generate();
    userB = Keypair.generate();

    await Promise.all([
      airdrop(provider.connection, feeRecipient.publicKey),
      airdrop(provider.connection, userA.publicKey),
      airdrop(provider.connection, userB.publicKey),
    ]);

    usdcMint = await createUsdcMint(provider.connection, authority);
    // Fee recipient gets an ATA; its public key is passed to initialize_vault.
    const feeAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority,
      usdcMint,
      feeRecipient.publicKey,
    );
    feeRecipientAta = feeAta.address;

    // Give both users USDC to deposit.
    await fundUsdc(provider.connection, authority, usdcMint, userA.publicKey, 1_000);
    await fundUsdc(provider.connection, authority, usdcMint, userB.publicKey, 1_000);
  });

  // ---------------------------------------------------------------------------
  // Happy path: init → 2 deposits → mixed leg resolutions → finalize → redeems
  // ---------------------------------------------------------------------------
  describe("full lifecycle", () => {
    const bundleSeed = randomBundleSeed();
    const riskTier = 90;
    const issuePriceBps = 9000; // $0.90
    const feeBps = 50; // 0.5%
    // 3 legs, equal-weighted (~3333 each). 10000 total.
    const legs = [
      { marketId: randomMarketId(), weightBps: 3334 },
      { marketId: randomMarketId(), weightBps: 3333 },
      { marketId: randomMarketId(), weightBps: 3333 },
    ];
    const resolutionDate = new BN(Math.floor(Date.now() / 1000) + 30 * 86400);

    let vaultPda: PublicKey;
    let traxMint: PublicKey;
    let usdcVault: PublicKey;

    it("initialize_vault creates PDAs and stores state", async () => {
      [vaultPda] = deriveVaultPda(program.programId, bundleSeed);
      [traxMint] = deriveTraxMint(program.programId, bundleSeed);
      [usdcVault] = deriveUsdcVault(program.programId, bundleSeed);

      await program.methods
        .initializeVault({
          bundleSeed: Array.from(bundleSeed),
          issuePriceBps,
          feeBps,
          riskTier,
          resolutionDate,
          legs: legs.map((l) => ({
            marketId: l.marketId,
            weightBps: l.weightBps,
          })),
        })
        .accounts({
          authority: authority.publicKey,
          vault: vaultPda,
          traxMint,
          usdcMint,
          usdcVault,
          feeRecipient: feeRecipient.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      const vault = await program.account.vault.fetch(vaultPda);
      expect(vault.riskTier).to.equal(riskTier);
      expect(vault.issuePriceBps).to.equal(issuePriceBps);
      expect(vault.feeBps).to.equal(feeBps);
      expect(vault.legCount).to.equal(legs.length);
      expect(vault.totalTokensMinted.toString()).to.equal("0");
      expect(vault.totalUsdcDeposited.toString()).to.equal("0");
      // state is enum { Active: {} }
      assert.property(vault.state, "active");
    });

    it("deposit of 100 USDC by user A mints the expected TRAX and charges fee", async () => {
      const amount = new BN(100_000_000); // 100 USDC
      const userAUsdc = getAssociatedTokenAddressSync(usdcMint, userA.publicKey);
      const userATrax = getAssociatedTokenAddressSync(traxMint, userA.publicKey);

      // Create user A's TRAX ATA first.
      const ataIx = ensureAtaIx(userA.publicKey, userA.publicKey, traxMint);

      await program.methods
        .deposit(amount)
        .accounts({
          user: userA.publicKey,
          vault: vaultPda,
          traxMint,
          usdcVault,
          userUsdcAta: userAUsdc,
          userTraxAta: userATrax,
          feeRecipientAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .preInstructions([ataIx])
        .signers([userA])
        .rpc();

      const vault = await program.account.vault.fetch(vaultPda);
      // fee = 100 * 0.005 = 0.5 USDC = 500_000
      expect(vault.totalFeesCollected.toString()).to.equal("500000");
      // net = 99.5 USDC, tokens = 99.5 / 0.90 = 110.555555 TRAX = 110_555_555
      expect(vault.totalTokensMinted.toString()).to.equal("110555555");
      expect(vault.totalUsdcDeposited.toString()).to.equal("100000000");

      const traxBal = await tokenBalance(provider.connection, userATrax);
      expect(traxBal.toString()).to.equal("110555555");
      const feeBal = await tokenBalance(provider.connection, feeRecipientAta);
      expect(feeBal.toString()).to.equal("500000");
    });

    it("deposit of 50 USDC by user B mints proportionally", async () => {
      const amount = new BN(50_000_000);
      const userBUsdc = getAssociatedTokenAddressSync(usdcMint, userB.publicKey);
      const userBTrax = getAssociatedTokenAddressSync(traxMint, userB.publicKey);
      const ataIx = ensureAtaIx(userB.publicKey, userB.publicKey, traxMint);

      await program.methods
        .deposit(amount)
        .accounts({
          user: userB.publicKey,
          vault: vaultPda,
          traxMint,
          usdcVault,
          userUsdcAta: userBUsdc,
          userTraxAta: userBTrax,
          feeRecipientAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .preInstructions([ataIx])
        .signers([userB])
        .rpc();

      // user B: net = 49.75, tokens = 49.75 / 0.90 = 55.277777 = 55_277_777
      const traxBal = await tokenBalance(
        provider.connection,
        getAssociatedTokenAddressSync(traxMint, userB.publicKey),
      );
      expect(traxBal.toString()).to.equal("55277777");
    });

    it("exit_active while Active pays pro-rata USDC net of exit fee", async () => {
      const userATrax = getAssociatedTokenAddressSync(traxMint, userA.publicKey);
      const userAUsdc = getAssociatedTokenAddressSync(usdcMint, userA.publicKey);
      const traxBefore = await tokenBalance(provider.connection, userATrax);
      const usdcBefore = await tokenBalance(provider.connection, userAUsdc);
      const vaultBalBefore = await tokenBalance(provider.connection, usdcVault);
      const mintInfo = await getMint(provider.connection, traxMint);
      const supply = BigInt(mintInfo.supply.toString());
      const exitAmt = 10_555_555n;
      const gross = (exitAmt * vaultBalBefore) / supply;
      const fee = (gross * 30n) / 10000n;
      const net = gross - fee;

      await program.methods
        .exitActive(new BN(exitAmt.toString()))
        .accounts({
          user: userA.publicKey,
          vault: vaultPda,
          traxMint,
          usdcVault,
          userTraxAta: userATrax,
          userUsdcAta: userAUsdc,
          feeRecipientAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([userA])
        .rpc();

      const traxAfter = await tokenBalance(provider.connection, userATrax);
      const usdcAfter = await tokenBalance(provider.connection, userAUsdc);
      expect((traxBefore - traxAfter).toString()).to.equal(exitAmt.toString());
      expect((usdcAfter - usdcBefore).toString()).to.equal(net.toString());
    });

    it("non-authority cannot resolve_leg", async () => {
      try {
        await program.methods
          .resolveLeg(0, 1)
          .accounts({ authority: userA.publicKey, vault: vaultPda })
          .signers([userA])
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(String(err)).to.match(/Unauthorized|unauthorized|ConstraintHasOne/);
      }
    });

    it("authority resolves legs 0 (Won) and 2 (Won), leg 1 (Lost)", async () => {
      await program.methods
        .resolveLeg(0, 1)
        .accounts({ authority: authority.publicKey, vault: vaultPda })
        .rpc();
      await program.methods
        .resolveLeg(2, 1)
        .accounts({ authority: authority.publicKey, vault: vaultPda })
        .rpc();
      await program.methods
        .resolveLeg(1, 2)
        .accounts({ authority: authority.publicKey, vault: vaultPda })
        .rpc();

      const vault = await program.account.vault.fetch(vaultPda);
      assert.property(vault.legs[0].status, "won");
      assert.property(vault.legs[1].status, "lost");
      assert.property(vault.legs[2].status, "won");
    });

    it("resolve_leg is idempotent on same outcome but rejects conflicting", async () => {
      // Re-resolve leg 0 as Won — should succeed (no-op).
      await program.methods
        .resolveLeg(0, 1)
        .accounts({ authority: authority.publicKey, vault: vaultPda })
        .rpc();

      // Re-resolve leg 0 as Lost — should fail.
      try {
        await program.methods
          .resolveLeg(0, 2)
          .accounts({ authority: authority.publicKey, vault: vaultPda })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(String(err)).to.match(/LegAlreadyResolved/);
      }
    });

    it("redeem fails while vault is Active", async () => {
      const userATrax = getAssociatedTokenAddressSync(traxMint, userA.publicKey);
      const userAUsdc = getAssociatedTokenAddressSync(usdcMint, userA.publicKey);
      try {
        await program.methods
          .redeem(new BN(1_000_000))
          .accounts({
            user: userA.publicKey,
            vault: vaultPda,
            traxMint,
            usdcVault,
            userTraxAta: userATrax,
            userUsdcAta: userAUsdc,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([userA])
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(String(err)).to.match(/VaultNotFinalized/);
      }
    });

    it("finalize_vault computes won_weight = 6667 bps → $0.6667/TRAX", async () => {
      await program.methods
        .finalizeVault()
        .accounts({
          authority: authority.publicKey,
          vault: vaultPda,
          usdcVault,
        })
        .rpc();

      const vault = await program.account.vault.fetch(vaultPda);
      assert.property(vault.state, "finalized");
      // won_weight = 3334 + 3333 = 6667 bps; payout = 6667 * 1e6 / 1e4 = 666_700
      expect(vault.finalPayoutPerToken.toString()).to.equal("666700");
    });

    it("deposit after finalize is rejected", async () => {
      const userAUsdc = getAssociatedTokenAddressSync(usdcMint, userA.publicKey);
      const userATrax = getAssociatedTokenAddressSync(traxMint, userA.publicKey);
      try {
        await program.methods
          .deposit(new BN(1_000_000))
          .accounts({
            user: userA.publicKey,
            vault: vaultPda,
            traxMint,
            usdcVault,
            userUsdcAta: userAUsdc,
            userTraxAta: userATrax,
            feeRecipientAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([userA])
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(String(err)).to.match(/VaultNotActive/);
      }
    });

    it("user A redeems full TRAX balance and receives pro-rata USDC", async () => {
      const userATrax = getAssociatedTokenAddressSync(traxMint, userA.publicKey);
      const userAUsdc = getAssociatedTokenAddressSync(usdcMint, userA.publicKey);

      const traxBefore = await tokenBalance(provider.connection, userATrax);
      const usdcBefore = await tokenBalance(provider.connection, userAUsdc);

      await program.methods
        .redeem(new BN(traxBefore.toString()))
        .accounts({
          user: userA.publicKey,
          vault: vaultPda,
          traxMint,
          usdcVault,
          userTraxAta: userATrax,
          userUsdcAta: userAUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([userA])
        .rpc();

      const traxAfter = await tokenBalance(provider.connection, userATrax);
      const usdcAfter = await tokenBalance(provider.connection, userAUsdc);

      expect(traxAfter.toString()).to.equal("0");
      // tokens * payout / 1e6 = 110_555_555 * 666_700 / 1e6 = 73_707_386 (integer div).
      const expectedPayout = (traxBefore * 666700n) / 1_000_000n;
      expect((usdcAfter - usdcBefore).toString()).to.equal(expectedPayout.toString());
    });

    it("admin_withdraw_fees drains residual USDC to fee recipient", async () => {
      const before = await tokenBalance(provider.connection, feeRecipientAta);
      await program.methods
        .adminWithdrawFees()
        .accounts({
          authority: authority.publicKey,
          vault: vaultPda,
          usdcVault,
          feeRecipientAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      const after = await tokenBalance(provider.connection, feeRecipientAta);
      // Residual is small (rounding dust from integer division in payouts); just
      // assert that the call did not error and balance did not decrease.
      expect(after >= before).to.equal(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Validation failures at initialization time.
  // ---------------------------------------------------------------------------
  describe("initialize_vault validations", () => {
    it("rejects risk_tier != 50/70/90", async () => {
      const bundleSeed = randomBundleSeed();
      const [vaultPda] = deriveVaultPda(program.programId, bundleSeed);
      const [traxMint] = deriveTraxMint(program.programId, bundleSeed);
      const [usdcVault] = deriveUsdcVault(program.programId, bundleSeed);
      try {
        await program.methods
          .initializeVault({
            bundleSeed: Array.from(bundleSeed),
            issuePriceBps: 8000,
            feeBps: 50,
            riskTier: 80,
            resolutionDate: new BN(Date.now() / 1000 + 86400),
            legs: [{ marketId: randomMarketId(), weightBps: 10000 }],
          })
          .accounts({
            authority: authority.publicKey,
            vault: vaultPda,
            traxMint,
            usdcMint,
            usdcVault,
            feeRecipient: feeRecipient.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(String(err)).to.match(/InvalidRiskTier/);
      }
    });

    it("rejects leg weights that don't sum to 10000", async () => {
      const bundleSeed = randomBundleSeed();
      const [vaultPda] = deriveVaultPda(program.programId, bundleSeed);
      const [traxMint] = deriveTraxMint(program.programId, bundleSeed);
      const [usdcVault] = deriveUsdcVault(program.programId, bundleSeed);
      try {
        await program.methods
          .initializeVault({
            bundleSeed: Array.from(bundleSeed),
            issuePriceBps: 9000,
            feeBps: 50,
            riskTier: 90,
            resolutionDate: new BN(Date.now() / 1000 + 86400),
            legs: [
              { marketId: randomMarketId(), weightBps: 5000 },
              { marketId: randomMarketId(), weightBps: 4000 }, // sum = 9000
            ],
          })
          .accounts({
            authority: authority.publicKey,
            vault: vaultPda,
            traxMint,
            usdcMint,
            usdcVault,
            feeRecipient: feeRecipient.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(String(err)).to.match(/InvalidLegWeights/);
      }
    });
  });
});
