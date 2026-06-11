-- Supabase SQL setup for simple website visit logging.
-- Apply manually in Supabase SQL editor (or your migration process) before enabling visit logging in production.

create extension if not exists pgcrypto;

create table if not exists public.site_visits (
  id uuid primary key default gen_random_uuid(),
  visited_at timestamptz not null default now(),
  page_path text null,
  page_url text null,
  referrer text null,
  user_agent text null,
  ip_address text null
);

create index if not exists site_visits_visited_at_idx
  on public.site_visits (visited_at desc);
