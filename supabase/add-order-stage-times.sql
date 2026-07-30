alter table public.orders
  add column if not exists preparing_at timestamptz,
  add column if not exists ready_at timestamptz;

update public.orders
set preparing_at = updated_at
where preparing_at is null
  and status in ('preparing', 'ready', 'delivered');

update public.orders
set ready_at = updated_at
where ready_at is null
  and status in ('ready', 'delivered');
