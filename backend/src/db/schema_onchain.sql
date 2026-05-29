-- Onchain integration columns. Additive migration — safe to run on an existing DB.
-- Apply in Supabase SQL Editor after the base schema.

-- Deterministic index of a leg inside its bundle, used to address legs in the
-- onchain vault program (legs: [Leg; 16]). Set at bundle creation time.
alter table legs add column if not exists leg_index int;
create index if not exists idx_legs_bundle_leg_index on legs (bundle_id, leg_index);

-- Onchain addresses for a bundle. Populated when the onchain vault is created.
alter table bundles add column if not exists vault_pda text;
alter table bundles add column if not exists trax_mint text;
alter table bundles add column if not exists usdc_vault text;
alter table bundles add column if not exists onchain_tx_signature text;

-- Onchain transaction tied to a DB transaction row. Populated when a
-- deposit/redeem is confirmed on-chain.
alter table transactions add column if not exists onchain_tx_signature text;

-- Track whether a leg resolution has been mirrored on-chain (resolve_leg CPI).
alter table legs add column if not exists onchain_resolved_at timestamptz;
alter table legs add column if not exists onchain_resolve_tx text;

-- Track whether the vault has been finalized on-chain.
alter table bundles add column if not exists onchain_finalized_at timestamptz;
alter table bundles add column if not exists onchain_finalize_tx text;
