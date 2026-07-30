alter table public.orders
  add column if not exists alert_revision integer not null default 0;
