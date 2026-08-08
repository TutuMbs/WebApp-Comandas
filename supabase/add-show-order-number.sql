alter table public.users
  add column if not exists show_order_number boolean not null default true;
