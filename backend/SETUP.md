# LuKres Backend Setup

## 1. Environment

```bash
cp .env.example .env
```

Fill in your Supabase credentials in `.env`:
- `SUPABASE_URL` - your project URL (e.g. `https://abc123.supabase.co`)
- `SUPABASE_ANON_KEY` - your anon/public key

## 2. Install

```bash
npm install
```

## 3. Create tables

Go to your Supabase dashboard -> SQL Editor -> New Query.
Paste the contents of `src/db/schema.sql` and run it.

## 4. Verify

```bash
npm run setup
```

This tests Supabase connectivity and Polymarket API access. If tables are missing it will print the schema for you.

## 5. Seed demo data

```bash
npm run seed
```

Creates two demo bundles (LK-90-0430 and LK-70-0515) with 10 legs each. Fetches live probabilities from Polymarket. Idempotent - safe to run multiple times.

## 6. Run

```bash
npm run dev
```

Server starts on port 3001 (or whatever PORT is set to in .env).
