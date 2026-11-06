-- Enable row level security and add no policies.
-- Access then depends on the connecting role. The API uses DATABASE_URL on the
-- server; the browser never receives that connection string.
alter table public.dataset_snapshots enable row level security;
alter table public.neighbourhoods enable row level security;
alter table public.listings enable row level security;