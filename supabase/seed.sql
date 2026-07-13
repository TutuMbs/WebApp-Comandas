begin;

delete from public.orders;
delete from public.users;

insert into public.users (
  id,
  establishment_name,
  email,
  password_hash,
  created_at
)
values (
  1,
  'Cafe Demo',
  'demo@comandas.local',
  '$2b$12$Uv07mKTvsa1vAoih.yHR8.x2kmb1lcpV2wSwTuS6QYrlkQlLHGkKW',
  now()
);

insert into public.orders (
  id,
  user_id,
  number,
  customer_name,
  items,
  status,
  created_at,
  updated_at,
  delivered_at
) values
  ('11111111-1111-4111-8111-111111111111', 1, 1, 'Maria', '2 cafes e 1 pao de queijo', 'awaiting', '2026-07-11T12:00:00.000Z', '2026-07-11T12:00:00.000Z', null),
  ('22222222-2222-4222-8222-222222222222', 1, 2, 'Joao', '1 suco de laranja e 1 misto quente', 'preparing', '2026-07-11T12:05:00.000Z', '2026-07-11T12:08:00.000Z', null),
  ('33333333-3333-4333-8333-333333333333', 1, 3, 'Ana', '1 cappuccino', 'ready', '2026-07-11T12:10:00.000Z', '2026-07-11T12:14:00.000Z', null),
  ('44444444-4444-4444-8444-444444444444', 1, 4, 'Pedro', '1 pizza brotinho', 'delivered', '2026-07-11T11:40:00.000Z', '2026-07-11T11:55:00.000Z', '2026-07-11T11:55:00.000Z');

select setval(pg_get_serial_sequence('public.users', 'id'), coalesce((select max(id) from public.users), 1), true);

commit;
