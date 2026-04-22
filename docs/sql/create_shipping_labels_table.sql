-- Supabase SQL setup for private shipping label token records.
-- Apply manually in Supabase SQL editor (or your migration process) before enabling label route in production.

create extension if not exists pgcrypto;

create table if not exists public.shipping_labels (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,
  storage_path text not null,
  tracking_number text null,
  stripe_id text null,
  order_id text null,
  file_name text null,
  content_type text null,
  created_at timestamptz not null default now()
);

create index if not exists shipping_labels_created_at_idx
  on public.shipping_labels (created_at desc);
