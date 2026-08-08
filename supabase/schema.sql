create extension if not exists pgcrypto;

create table if not exists public.users (
  id bigserial primary key,
  establishment_name text not null,
  email text not null unique,
  password_hash text not null,
  reset_token_hash text,
  reset_token_expires_at bigint,
  show_order_number boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key,
  user_id bigint not null references public.users(id) on delete cascade,
  number integer not null,
  customer_name text,
  items text,
  status text not null check (status in ('awaiting', 'preparing', 'ready', 'delivered')),
  alert_revision integer not null default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  preparing_at timestamptz,
  ready_at timestamptz,
  delivered_at timestamptz,
  unique (user_id, number)
);

alter table public.users enable row level security;
alter table public.orders enable row level security;

revoke all on table public.users from anon, authenticated;
revoke all on table public.orders from anon, authenticated;
grant all on table public.users to service_role;
grant all on table public.orders to service_role;

create index if not exists idx_orders_user_status on public.orders(user_id, status);
create index if not exists idx_orders_user_created on public.orders(user_id, created_at);
create index if not exists idx_orders_user_number on public.orders(user_id, number);

alter table public.orders
  add column if not exists alert_revision integer not null default 0;

alter table public.orders
  add column if not exists preparing_at timestamptz,
  add column if not exists ready_at timestamptz;

alter table public.users
  add column if not exists show_order_number boolean not null default true;

create or replace function public.create_order(
  p_user_id bigint,
  p_customer_name text,
  p_items text,
  p_status text default 'awaiting'
)
returns setof public.orders
language plpgsql
as $$
declare
  next_number integer;
  new_id uuid;
  created_row public.orders%rowtype;
begin
  perform pg_advisory_xact_lock(p_user_id);

  select coalesce(max(number), 0) + 1
  into next_number
  from public.orders
  where user_id = p_user_id;

  new_id := gen_random_uuid();

  insert into public.orders (
    id,
    user_id,
    number,
    customer_name,
    items,
    status,
    created_at,
    updated_at,
    preparing_at,
    ready_at
  )
  values (
    new_id,
    p_user_id,
    next_number,
    p_customer_name,
    p_items,
    coalesce(p_status, 'awaiting'),
    now(),
    now(),
    case when coalesce(p_status, 'awaiting') in ('preparing', 'ready', 'delivered') then now() else null end,
    case when coalesce(p_status, 'awaiting') in ('ready', 'delivered') then now() else null end
  )
  returning *
  into created_row;

  return next created_row;
end;
$$;
