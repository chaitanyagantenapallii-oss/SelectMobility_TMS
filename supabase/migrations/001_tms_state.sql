create table if not exists public.tms_state (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.tms_state enable row level security;
revoke all on table public.tms_state from anon, authenticated;
grant all on table public.tms_state to service_role;
