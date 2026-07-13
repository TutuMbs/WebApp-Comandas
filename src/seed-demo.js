require('dotenv').config();

const bcrypt = require('bcryptjs');

const { getSupabaseClient, initDb } = require('./db');

async function main() {
  await initDb();
  const supabase = getSupabaseClient();
  const passwordHash = await bcrypt.hash('Demo1234!', 12);
  const now = new Date().toISOString();
  const orders = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      number: 1,
      customerName: 'Maria',
      items: '2 cafes e 1 pao de queijo',
      status: 'awaiting',
      createdAt: '2026-07-11T12:00:00.000Z',
      updatedAt: '2026-07-11T12:00:00.000Z',
      deliveredAt: null,
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      number: 2,
      customerName: 'Joao',
      items: '1 suco de laranja e 1 misto quente',
      status: 'preparing',
      createdAt: '2026-07-11T12:05:00.000Z',
      updatedAt: '2026-07-11T12:08:00.000Z',
      deliveredAt: null,
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      number: 3,
      customerName: 'Ana',
      items: '1 cappuccino',
      status: 'ready',
      createdAt: '2026-07-11T12:10:00.000Z',
      updatedAt: '2026-07-11T12:14:00.000Z',
      deliveredAt: null,
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      number: 4,
      customerName: 'Pedro',
      items: '1 pizza brotinho',
      status: 'delivered',
      createdAt: '2026-07-11T11:40:00.000Z',
      updatedAt: '2026-07-11T11:55:00.000Z',
      deliveredAt: '2026-07-11T11:55:00.000Z',
    },
  ];

  const deleteOrders = await supabase.from('orders').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (deleteOrders.error) {
    throw deleteOrders.error;
  }

  const deleteUsers = await supabase.from('users').delete().neq('id', 0);
  if (deleteUsers.error) {
    throw deleteUsers.error;
  }

  const userResult = await supabase
    .from('users')
    .insert({
      id: 1,
      establishment_name: 'Cafe Demo',
      email: 'demo@comandas.local',
      password_hash: passwordHash,
      created_at: now,
    })
    .select('id')
    .single();

  if (userResult.error) {
    throw userResult.error;
  }

  const userId = Number(userResult.data.id);
  const orderResult = await supabase.from('orders').insert(
    orders.map((order) => ({
      id: order.id,
      user_id: userId,
      number: order.number,
      customer_name: order.customerName,
      items: order.items,
      status: order.status,
      created_at: order.createdAt,
      updated_at: order.updatedAt,
      delivered_at: order.deliveredAt,
    })),
  );

  if (orderResult.error) {
    throw orderResult.error;
  }

  console.log('Seed demo criado com sucesso.');
  console.log('Banco em uso: Supabase');
  console.log('Login demo: demo@comandas.local');
  console.log('Senha demo: Demo1234!');
}

main().catch((error) => {
  console.error('Falha ao criar seed demo:', error);
  process.exitCode = 1;
});
