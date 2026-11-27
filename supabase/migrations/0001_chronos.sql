-- CHRONOS venue aggregate store.
-- One row per venue holds the queue, exchanges, quotes and ledger as a JSONB
-- document. Writes use optimistic concurrency on `revision`:
--   UPDATE chronos_venues SET state = $s, revision = $r + 1 WHERE id = $id AND revision = $r
-- PostgreSQL executes that single statement atomically, so two concurrent
-- reservations against the same venue can never both commit.

create table if not exists public.chronos_venues (
  id          text primary key,
  revision    bigint not null default 0 check (revision >= 0),
  state       jsonb  not null,
  updated_at  timestamptz not null default now()
);

-- Row level security with no policies: only the service role (server-side) can
-- read or write. Browsers never talk to this table directly.
alter table public.chronos_venues enable row level security;
revoke all on table public.chronos_venues from anon, authenticated;
