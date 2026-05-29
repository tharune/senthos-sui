#!/usr/bin/env python3
"""Generate Anchor 0.30.x-compatible IDL JSON for traxis_vault and traxis_ppn.

The Rust sources are the source of truth. This script encodes them by hand
because Anchor's `anchor idl build` is currently broken by an ahash 0.7.6
stdsimd feature gate in the IDL-generation dep graph (Rust 1.75 in the
container; ahash 0.7.6 requires nightly).
"""
import hashlib
import json
import os

VAULT_ADDRESS = "E77R7yqUEAWz9jUk92kSnrpvUBEwGpPT3iZaThbKQcJb"
PPN_ADDRESS = "4NnrpeWgdmVymcdGqbrmQUunHHvyVSevUXCKFGJYwbtE"


def ix_disc(name: str) -> list[int]:
    return list(hashlib.sha256(f"global:{name}".encode()).digest()[:8])


def acct_disc(name: str) -> list[int]:
    return list(hashlib.sha256(f"account:{name}".encode()).digest()[:8])


def event_disc(name: str) -> list[int]:
    return list(hashlib.sha256(f"event:{name}".encode()).digest()[:8])


# ---- Common type references used often ----
PUBKEY = "pubkey"
U64 = "u64"
U16 = "u16"
U8 = "u8"
I64 = "i64"
BOOL = "bool"


def arr(t, n):
    return {"array": [t, n]}


def defined(name):
    return {"defined": {"name": name}}


# ---- VAULT IDL ----

vault_types = [
    {
        "name": "Leg",
        "type": {
            "kind": "struct",
            "fields": [
                {"name": "market_id", "type": arr(U8, 32)},
                {"name": "weight_bps", "type": U16},
                {"name": "status", "type": defined("LegStatus")},
                {"name": "pad", "type": arr(U8, 5)},
            ],
        },
    },
    {
        "name": "LegStatus",
        "type": {
            "kind": "enum",
            "variants": [
                {"name": "Unresolved"},
                {"name": "Won"},
                {"name": "Lost"},
            ],
        },
    },
    {
        "name": "VaultState",
        "type": {
            "kind": "enum",
            "variants": [
                {"name": "Active"},
                {"name": "Finalized"},
                {"name": "Closed"},
            ],
        },
    },
    {
        "name": "LegInit",
        "type": {
            "kind": "struct",
            "fields": [
                {"name": "market_id", "type": arr(U8, 32)},
                {"name": "weight_bps", "type": U16},
            ],
        },
    },
    {
        "name": "InitializeVaultArgs",
        "type": {
            "kind": "struct",
            "fields": [
                {"name": "bundle_seed", "type": arr(U8, 16)},
                {"name": "issue_price_bps", "type": U16},
                {"name": "fee_bps", "type": U16},
                {"name": "risk_tier", "type": U8},
                {"name": "resolution_date", "type": I64},
                {"name": "legs", "type": {"vec": defined("LegInit")}},
            ],
        },
    },
    {
        "name": "Vault",
        "type": {
            "kind": "struct",
            "fields": [
                {"name": "bundle_seed", "type": arr(U8, 16)},
                {"name": "authority", "type": PUBKEY},
                {"name": "trax_mint", "type": PUBKEY},
                {"name": "usdc_mint", "type": PUBKEY},
                {"name": "usdc_vault", "type": PUBKEY},
                {"name": "fee_recipient", "type": PUBKEY},
                {"name": "issue_price_bps", "type": U16},
                {"name": "fee_bps", "type": U16},
                {"name": "risk_tier", "type": U8},
                {"name": "resolution_date", "type": I64},
                {"name": "legs", "type": arr(defined("Leg"), 16)},
                {"name": "leg_count", "type": U8},
                {"name": "total_tokens_minted", "type": U64},
                {"name": "total_usdc_deposited", "type": U64},
                {"name": "total_fees_collected", "type": U64},
                {"name": "final_payout_per_token", "type": U64},
                {"name": "state", "type": defined("VaultState")},
                {"name": "bump", "type": U8},
                {"name": "reserved", "type": arr(U8, 64)},
            ],
        },
    },
    {
        "name": "VaultInitialized",
        "type": {
            "kind": "struct",
            "fields": [
                {"name": "bundle_seed", "type": arr(U8, 16)},
                {"name": "vault", "type": PUBKEY},
                {"name": "trax_mint", "type": PUBKEY},
                {"name": "usdc_mint", "type": PUBKEY},
                {"name": "authority", "type": PUBKEY},
                {"name": "risk_tier", "type": U8},
                {"name": "issue_price_bps", "type": U16},
                {"name": "fee_bps", "type": U16},
                {"name": "leg_count", "type": U8},
                {"name": "resolution_date", "type": I64},
            ],
        },
    },
    {
        "name": "Deposited",
        "type": {
            "kind": "struct",
            "fields": [
                {"name": "vault", "type": PUBKEY},
                {"name": "user", "type": PUBKEY},
                {"name": "amount_usdc", "type": U64},
                {"name": "fee_usdc", "type": U64},
                {"name": "tokens_minted", "type": U64},
                {"name": "issue_price_bps", "type": U16},
            ],
        },
    },
    {
        "name": "LegResolved",
        "type": {
            "kind": "struct",
            "fields": [
                {"name": "vault", "type": PUBKEY},
                {"name": "leg_index", "type": U8},
                {"name": "outcome", "type": U8},
            ],
        },
    },
    {
        "name": "VaultFinalized",
        "type": {
            "kind": "struct",
            "fields": [
                {"name": "vault", "type": PUBKEY},
                {"name": "won_weight_bps", "type": U16},
                {"name": "final_payout_per_token", "type": U64},
                {"name": "total_tokens_minted", "type": U64},
            ],
        },
    },
    {
        "name": "Redeemed",
        "type": {
            "kind": "struct",
            "fields": [
                {"name": "vault", "type": PUBKEY},
                {"name": "user", "type": PUBKEY},
                {"name": "tokens_burned", "type": U64},
                {"name": "usdc_out", "type": U64},
            ],
        },
    },
    {
        "name": "FeesWithdrawn",
        "type": {
            "kind": "struct",
            "fields": [
                {"name": "vault", "type": PUBKEY},
                {"name": "recipient", "type": PUBKEY},
                {"name": "amount_usdc", "type": U64},
            ],
        },
    },
]

# --- Vault accounts list for instructions ---
# Note: writable=mut, signer=sig. PDA info omitted; runtime derives with our explicit seeds code in anchor.ts.

def acc(name, *, writable=False, signer=False, address=None):
    a = {"name": name, "writable": writable, "signer": signer}
    if address:
        a["address"] = address
    return a


TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
SYSTEM_PROGRAM = "11111111111111111111111111111111"
RENT_SYSVAR = "SysvarRent111111111111111111111111111111111"


vault_instructions = [
    {
        "name": "initialize_vault",
        "discriminator": ix_disc("initialize_vault"),
        "accounts": [
            acc("authority", writable=True, signer=True),
            acc("vault", writable=True),
            acc("fee_recipient"),
            acc("system_program", address=SYSTEM_PROGRAM),
            acc("rent", address=RENT_SYSVAR),
        ],
        "args": [{"name": "args", "type": defined("InitializeVaultArgs")}],
    },
    {
        "name": "initialize_trax_mint",
        "discriminator": ix_disc("initialize_trax_mint"),
        "accounts": [
            acc("authority", writable=True, signer=True),
            acc("vault", writable=True),
            acc("trax_mint", writable=True),
            acc("system_program", address=SYSTEM_PROGRAM),
            acc("token_program", address=TOKEN_PROGRAM),
            acc("rent", address=RENT_SYSVAR),
        ],
        "args": [],
    },
    {
        "name": "initialize_vault_tokens",
        "discriminator": ix_disc("initialize_vault_tokens"),
        "accounts": [
            acc("authority", writable=True, signer=True),
            acc("vault", writable=True),
            acc("usdc_mint"),
            acc("usdc_vault", writable=True),
            acc("system_program", address=SYSTEM_PROGRAM),
            acc("token_program", address=TOKEN_PROGRAM),
            acc("rent", address=RENT_SYSVAR),
        ],
        "args": [],
    },
    {
        "name": "deposit",
        "discriminator": ix_disc("deposit"),
        "accounts": [
            acc("user", writable=True, signer=True),
            acc("vault", writable=True),
            acc("trax_mint", writable=True),
            acc("usdc_vault", writable=True),
            acc("user_usdc_ata", writable=True),
            acc("user_trax_ata", writable=True),
            acc("fee_recipient_ata", writable=True),
            acc("token_program", address=TOKEN_PROGRAM),
        ],
        "args": [{"name": "amount_usdc", "type": U64}],
    },
    {
        "name": "resolve_leg",
        "discriminator": ix_disc("resolve_leg"),
        "accounts": [
            acc("authority", signer=True),
            acc("vault", writable=True),
        ],
        "args": [
            {"name": "leg_index", "type": U8},
            {"name": "outcome", "type": U8},
        ],
    },
    {
        "name": "finalize_vault",
        "discriminator": ix_disc("finalize_vault"),
        "accounts": [
            acc("authority", signer=True),
            acc("vault", writable=True),
            acc("usdc_vault"),
        ],
        "args": [],
    },
    {
        "name": "redeem",
        "discriminator": ix_disc("redeem"),
        "accounts": [
            acc("user", writable=True, signer=True),
            acc("vault", writable=True),
            acc("trax_mint", writable=True),
            acc("usdc_vault", writable=True),
            acc("user_trax_ata", writable=True),
            acc("user_usdc_ata", writable=True),
            acc("token_program", address=TOKEN_PROGRAM),
        ],
        "args": [{"name": "amount_tokens", "type": U64}],
    },
    {
        "name": "exit_active",
        "discriminator": ix_disc("exit_active"),
        "accounts": [
            acc("user", writable=True, signer=True),
            acc("vault", writable=True),
            acc("trax_mint", writable=True),
            acc("usdc_vault", writable=True),
            acc("user_trax_ata", writable=True),
            acc("user_usdc_ata", writable=True),
            acc("fee_recipient_ata", writable=True),
            acc("token_program", address=TOKEN_PROGRAM),
        ],
        "args": [{"name": "amount_tokens", "type": U64}],
    },
    {
        "name": "admin_withdraw_fees",
        "discriminator": ix_disc("admin_withdraw_fees"),
        "accounts": [
            acc("authority", signer=True),
            acc("vault", writable=True),
            acc("usdc_vault", writable=True),
            acc("fee_recipient_ata", writable=True),
            acc("token_program", address=TOKEN_PROGRAM),
        ],
        "args": [],
    },
]

vault_accounts = [
    {"name": "Vault", "discriminator": acct_disc("Vault")},
]

vault_events = [
    {"name": "VaultInitialized", "discriminator": event_disc("VaultInitialized")},
    {"name": "Deposited", "discriminator": event_disc("Deposited")},
    {"name": "LegResolved", "discriminator": event_disc("LegResolved")},
    {"name": "VaultFinalized", "discriminator": event_disc("VaultFinalized")},
    {"name": "Redeemed", "discriminator": event_disc("Redeemed")},
    {"name": "FeesWithdrawn", "discriminator": event_disc("FeesWithdrawn")},
]

vault_errors = [
    (6000, "ArithOverflow", "Arithmetic overflow"),
    (6001, "VaultNotActive", "Vault is not in Active state"),
    (6002, "VaultNotFinalized", "Vault is not in Finalized state"),
    (6003, "VaultAlreadyFinalized", "Vault already finalized"),
    (6004, "LegIndexOutOfRange", "Leg index out of range"),
    (6005, "LegAlreadyResolved", "Leg already resolved with a different outcome"),
    (6006, "InvalidLegWeights", "Leg weights must sum to 10000 bps"),
    (6007, "InvalidLegCount", "Invalid leg count: must be between 1 and 16"),
    (6008, "InvalidIssuePrice", "Issue price must be in (0, 10000] bps"),
    (6009, "InvalidFeeBps", "Fee bps must be <= 500 (5%)"),
    (6010, "InvalidRiskTier", "Invalid risk tier: must be 50, 70, or 90"),
    (6011, "LegsNotFullyResolved", "Not all legs have been resolved"),
    (6012, "Unauthorized", "Unauthorized: signer is not the vault authority"),
    (6013, "InsufficientVaultBalance", "Insufficient USDC in vault to cover final payouts"),
    (6014, "ZeroDeposit", "Deposit amount must be > 0"),
    (6015, "ZeroRedeem", "Redeem amount must be > 0"),
    (6016, "InvalidOutcome", "Outcome byte must be 1 (Won) or 2 (Lost)"),
    (6017, "MintMismatch", "Token accounts must match vault's configured mints"),
    (6018, "InvalidFeeRecipientAta", "Fee recipient ATA must be owned by fee_recipient and match usdc_mint"),
]


vault_idl = {
    "address": VAULT_ADDRESS,
    "metadata": {
        "name": "traxis_vault",
        "version": "0.1.0",
        "spec": "0.1.0",
        "description": "Traxis Vault - tranched structured product on Solana",
    },
    "instructions": vault_instructions,
    "accounts": vault_accounts,
    "events": vault_events,
    "errors": [{"code": c, "name": n, "msg": m} for c, n, m in vault_errors],
    "types": vault_types,
}

# ---- PPN IDL ----

ppn_types = [
    {
        "name": "PpnState",
        "type": {
            "kind": "enum",
            "variants": [
                {"name": "Active"},
                {"name": "Redeemed"},
            ],
        },
    },
    {
        "name": "InitializeNoteArgs",
        "type": {
            "kind": "struct",
            "fields": [
                {"name": "note_seed", "type": arr(U8, 8)},
                {"name": "principal_usdc", "type": U64},
                {"name": "maturity_ts", "type": I64},
            ],
        },
    },
    {
        "name": "PpnNote",
        "type": {
            "kind": "struct",
            "fields": [
                {"name": "owner", "type": PUBKEY},
                {"name": "note_seed", "type": arr(U8, 8)},
                {"name": "principal_usdc", "type": U64},
                {"name": "yield_harvested_usdc", "type": U64},
                {"name": "trax_mint", "type": PUBKEY},
                {"name": "trax_holdings", "type": U64},
                {"name": "trax_vault", "type": PUBKEY},
                {"name": "usdc_mint", "type": PUBKEY},
                {"name": "maturity_ts", "type": I64},
                {"name": "last_harvest_ts", "type": I64},
                {"name": "state", "type": defined("PpnState")},
                {"name": "bump", "type": U8},
                {"name": "reserved", "type": arr(U8, 64)},
            ],
        },
    },
    {
        "name": "MeteoraMockAdapter",
        "type": {
            "kind": "struct",
            "fields": [
                {"name": "authority", "type": PUBKEY},
                {"name": "usdc_mint", "type": PUBKEY},
                {"name": "usdc_pool", "type": PUBKEY},
                {"name": "apy_bps", "type": U16},
                {"name": "total_principal", "type": U64},
                {"name": "bump", "type": U8},
                {"name": "reserved", "type": arr(U8, 32)},
            ],
        },
    },
    {
        "name": "MockAdapterInitialized",
        "type": {
            "kind": "struct",
            "fields": [
                {"name": "adapter", "type": PUBKEY},
                {"name": "apy_bps", "type": U16},
                {"name": "usdc_mint", "type": PUBKEY},
            ],
        },
    },
    {
        "name": "NoteInitialized",
        "type": {
            "kind": "struct",
            "fields": [
                {"name": "note", "type": PUBKEY},
                {"name": "owner", "type": PUBKEY},
                {"name": "principal_usdc", "type": U64},
                {"name": "maturity_ts", "type": I64},
                {"name": "trax_vault", "type": PUBKEY},
            ],
        },
    },
    {
        "name": "YieldHarvested",
        "type": {
            "kind": "struct",
            "fields": [
                {"name": "note", "type": PUBKEY},
                {"name": "yield_usdc", "type": U64},
                {"name": "trax_received", "type": U64},
                {"name": "timestamp", "type": I64},
            ],
        },
    },
    {
        "name": "NoteRedeemed",
        "type": {
            "kind": "struct",
            "fields": [
                {"name": "note", "type": PUBKEY},
                {"name": "owner", "type": PUBKEY},
                {"name": "principal_returned", "type": U64},
                {"name": "trax_transferred", "type": U64},
            ],
        },
    },
    {
        "name": "NoteDivested",
        "type": {
            "kind": "struct",
            "fields": [
                {"name": "note", "type": PUBKEY},
                {"name": "owner", "type": PUBKEY},
                {"name": "trax_burned", "type": U64},
                {"name": "gross_usdc", "type": U64},
                {"name": "strategy_fee_usdc", "type": U64},
                {"name": "net_to_owner_usdc", "type": U64},
            ],
        },
    },
    {
        "name": "NoteClosedEarly",
        "type": {
            "kind": "struct",
            "fields": [
                {"name": "note", "type": PUBKEY},
                {"name": "owner", "type": PUBKEY},
                {"name": "basket_usdc", "type": U64},
                {"name": "principal_usdc", "type": U64},
                {"name": "strategy_fee_usdc", "type": U64},
                {"name": "net_to_owner_usdc", "type": U64},
            ],
        },
    },
]

ppn_instructions = [
    {
        "name": "initialize_mock_adapter",
        "discriminator": ix_disc("initialize_mock_adapter"),
        "accounts": [
            acc("authority", writable=True, signer=True),
            acc("adapter", writable=True),
            acc("usdc_mint"),
            acc("usdc_pool", writable=True),
            acc("system_program", address=SYSTEM_PROGRAM),
            acc("token_program", address=TOKEN_PROGRAM),
            acc("rent", address=RENT_SYSVAR),
        ],
        "args": [{"name": "apy_bps", "type": U16}],
    },
    {
        "name": "initialize_note",
        "discriminator": ix_disc("initialize_note"),
        "accounts": [
            acc("owner", writable=True, signer=True),
            acc("note", writable=True),
            acc("adapter", writable=True),
            acc("adapter_pool", writable=True),
            acc("usdc_mint"),
            acc("owner_usdc_ata", writable=True),
            acc("trax_vault"),
            acc("trax_mint"),
            acc("token_program", address=TOKEN_PROGRAM),
            acc("system_program", address=SYSTEM_PROGRAM),
        ],
        "args": [{"name": "args", "type": defined("InitializeNoteArgs")}],
    },
    {
        "name": "harvest_yield",
        "discriminator": ix_disc("harvest_yield"),
        "accounts": [
            acc("cranker", writable=True, signer=True),
            acc("note", writable=True),
            acc("adapter", writable=True),
            acc("adapter_pool", writable=True),
            acc("note_usdc_ata", writable=True),
            acc("note_trax_ata", writable=True),
            acc("vault", writable=True),
            acc("trax_mint", writable=True),
            acc("vault_usdc_vault", writable=True),
            acc("fee_recipient_ata", writable=True),
            acc("usdc_mint"),
            acc("traxis_vault_program", address=VAULT_ADDRESS),
            acc("token_program", address=TOKEN_PROGRAM),
        ],
        "args": [],
    },
    {
        "name": "redeem_at_maturity",
        "discriminator": ix_disc("redeem_at_maturity"),
        "accounts": [
            acc("owner", writable=True, signer=True),
            acc("note", writable=True),
            acc("adapter", writable=True),
            acc("adapter_pool", writable=True),
            acc("owner_usdc_ata", writable=True),
            acc("owner_trax_ata", writable=True),
            acc("note_trax_ata", writable=True),
            acc("token_program", address=TOKEN_PROGRAM),
        ],
        "args": [],
    },
    {
        "name": "divest",
        "discriminator": ix_disc("divest"),
        "accounts": [
            acc("owner", writable=True, signer=True),
            acc("note", writable=True),
            acc("vault", writable=True),
            acc("trax_mint", writable=True),
            acc("vault_usdc_vault", writable=True),
            acc("note_trax_ata", writable=True),
            acc("note_usdc_ata", writable=True),
            acc("owner_usdc_ata", writable=True),
            acc("fee_recipient_ata", writable=True),
            acc("usdc_mint"),
            acc("traxis_vault_program", address=VAULT_ADDRESS),
            acc("token_program", address=TOKEN_PROGRAM),
        ],
        "args": [{"name": "strategy_fee_bps", "type": U16}],
    },
    {
        "name": "close_early",
        "discriminator": ix_disc("close_early"),
        "accounts": [
            acc("owner", writable=True, signer=True),
            acc("note", writable=True),
            acc("adapter", writable=True),
            acc("adapter_pool", writable=True),
            acc("vault", writable=True),
            acc("trax_mint", writable=True),
            acc("vault_usdc_vault", writable=True),
            acc("note_trax_ata", writable=True),
            acc("note_usdc_ata", writable=True),
            acc("owner_usdc_ata", writable=True),
            acc("fee_recipient_ata", writable=True),
            acc("usdc_mint"),
            acc("traxis_vault_program", address=VAULT_ADDRESS),
            acc("token_program", address=TOKEN_PROGRAM),
        ],
        "args": [
            {"name": "strategy_fee_bps", "type": U16},
            {"name": "min_proceeds_usdc", "type": U64},
        ],
    },
]

ppn_accounts = [
    {"name": "PpnNote", "discriminator": acct_disc("PpnNote")},
    {"name": "MeteoraMockAdapter", "discriminator": acct_disc("MeteoraMockAdapter")},
]

ppn_events = [
    {"name": "MockAdapterInitialized", "discriminator": event_disc("MockAdapterInitialized")},
    {"name": "NoteInitialized", "discriminator": event_disc("NoteInitialized")},
    {"name": "YieldHarvested", "discriminator": event_disc("YieldHarvested")},
    {"name": "NoteRedeemed", "discriminator": event_disc("NoteRedeemed")},
    {"name": "NoteDivested", "discriminator": event_disc("NoteDivested")},
    {"name": "NoteClosedEarly", "discriminator": event_disc("NoteClosedEarly")},
]

ppn_errors = [
    (6000, "ArithOverflow", "Arithmetic overflow"),
    (6001, "ZeroPrincipal", "Principal must be greater than zero"),
    (6002, "InvalidMaturity", "Maturity must be in the future"),
    (6003, "AlreadyRedeemed", "Note has already been redeemed"),
    (6004, "NotMatured", "Note has not matured yet"),
    (6005, "Unauthorized", "Unauthorized"),
    (6006, "InvalidApy", "APY bps must be <= 5000 (50%)"),
    (6007, "MintMismatch", "Mint or token account mismatch"),
    (6008, "NoYield", "No yield to harvest"),
    (6009, "InsufficientPool", "Mock pool lacks sufficient USDC to cover withdrawal"),
    (6010, "InvalidStrategyFee", "Strategy fee bps must be <= 100 (1%)"),
    (6011, "NothingToDivest", "Note has no basket exposure to divest"),
    (6012, "SlippageExceeded", "Net proceeds fell below min_proceeds_usdc"),
]

ppn_idl = {
    "address": PPN_ADDRESS,
    "metadata": {
        "name": "traxis_ppn",
        "version": "0.1.0",
        "spec": "0.1.0",
        "description": "Traxis PPN - Principal Protected Notes",
    },
    "instructions": ppn_instructions,
    "accounts": ppn_accounts,
    "events": ppn_events,
    "errors": [{"code": c, "name": n, "msg": m} for c, n, m in ppn_errors],
    "types": ppn_types,
}

# Write both files.
OUT_DIRS = ["target/idl", "backend/src/idl"]
for d in OUT_DIRS:
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "traxis_vault.json"), "w") as f:
        json.dump(vault_idl, f, indent=2)
    with open(os.path.join(d, "traxis_ppn.json"), "w") as f:
        json.dump(ppn_idl, f, indent=2)
    print(f"Wrote {d}/traxis_vault.json and {d}/traxis_ppn.json")

print(f"\nvault.json: {os.path.getsize('target/idl/traxis_vault.json')} bytes")
print(f"ppn.json:   {os.path.getsize('target/idl/traxis_ppn.json')} bytes")
