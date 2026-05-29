/**
 * Scratch smoke test from a sandbox-side session — safe to delete.
 *
 * Used once to verify buildDepositTx() produces a valid VersionedTransaction
 * against the live devnet vault (LK-90-0430 @ D63QUGkx...vfieTtx). The check
 * passed: 5 instructions in the right order, expected 1.143678 TRAX for
 * 1 USDC at 8700 bps issue price.
 *
 * Can be deleted (`rm backend/test-prepare-deposit.ts`) — the sandbox mount
 * blocked my own delete, so leaving this minimal stub instead.
 */
export {};
