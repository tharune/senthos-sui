-- PPN on-chain integration columns. Additive migration — safe to run on an
-- existing DB. Apply in Supabase SQL Editor after schema_onchain.sql.
--
-- New columns let the backend persist the on-chain artifacts of a PPN note:
--
--   note_seed_hex          — the 8-byte note seed (hex) the user's wallet
--                            used to derive the note PDA. Needed at redeem
--                            time so we can re-derive the same PDA.
--   onchain_tx_signature   — signature of the initialize_note transaction.
--                            Same convention as transactions.onchain_tx_signature.
--   redemption_tx_signature — signature of the redeem_at_maturity / close_early
--                             tx once it lands. Null until the user closes.
--                             Shared by both paths because they both mark the
--                             vault `withdrawn` — the tx type disambiguates.
--   divest_tx_signature     — signature of the divest tx once it lands. The
--                             vault stays `active` after divest (principal
--                             sleeve still earns), so this column is
--                             populated independently.
--   maturity_ts             — unix timestamp (seconds) of the on-chain maturity.
--                             The existing `maturity_date` column is a DATE —
--                             fine for display, but the on-chain ix needs the
--                             exact timestamp, so we store both.
--
-- The existing `vault_address` column now stores the note PDA (base58) for
-- on-chain notes; stub rows keep the legacy `stub_vault_*` format so the two
-- code paths can coexist until the UI has fully migrated.

alter table ppn_vaults add column if not exists note_seed_hex text;
alter table ppn_vaults add column if not exists onchain_tx_signature text;
alter table ppn_vaults add column if not exists redemption_tx_signature text;
alter table ppn_vaults add column if not exists divest_tx_signature text;
alter table ppn_vaults add column if not exists maturity_ts bigint;

create index if not exists idx_ppn_vaults_onchain_tx_signature
  on ppn_vaults (onchain_tx_signature)
  where onchain_tx_signature is not null;
