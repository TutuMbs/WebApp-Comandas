const { createClient } = require('@supabase/supabase-js');
const crypto = require('node:crypto');

let supabaseClient = null;
const COUNTER_SEED_ITEMS = '__counter_seed__';

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || null;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || null;

  return {
    supabaseUrl,
    supabaseSecretKey,
    isConfigured: Boolean(supabaseUrl && supabaseSecretKey),
  };
}

function getSupabaseClient() {
  const { supabaseUrl, supabaseSecretKey } = getSupabaseConfig();

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL nao configurada. Defina a URL do projeto Supabase nas variaveis da Vercel.');
  }

  if (!supabaseSecretKey) {
    throw new Error(
      'SUPABASE_SECRET_KEY nao configurada. Defina a secret key do projeto Supabase nas variaveis da Vercel.',
    );
  }

  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabaseSecretKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }

  return supabaseClient;
}

async function initDb() {
  getSupabaseClient();
}

function normalizeDbOrder(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    id: String(row.id),
    user_id: Number(row.user_id),
    number: Number(row.number),
    alert_revision: Number(row.alert_revision || 0),
    created_at: row.created_at ? String(row.created_at) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
    preparing_at: row.preparing_at ? String(row.preparing_at) : null,
    ready_at: row.ready_at ? String(row.ready_at) : null,
    delivered_at: row.delivered_at ? String(row.delivered_at) : null,
  };
}

function normalizeDbUser(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    id: Number(row.id),
    reset_token_expires_at: row.reset_token_expires_at == null ? null : Number(row.reset_token_expires_at),
    created_at: row.created_at ? String(row.created_at) : null,
  };
}

function isCounterSeedOrder(row) {
  return row?.items === COUNTER_SEED_ITEMS;
}

async function ensureNoError(result, context) {
  if (result.error) {
    const error = new Error(`${context}: ${result.error.message}`);
    error.cause = result.error;
    throw error;
  }
}

async function findUserByEmail(email) {
  await initDb();
  const supabase = getSupabaseClient();
  const result = await supabase
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .limit(1)
    .maybeSingle();

  await ensureNoError(result, 'Falha ao buscar usuario por e-mail');
  return normalizeDbUser(result.data);
}

async function findUserById(id) {
  await initDb();
  const supabase = getSupabaseClient();
  const result = await supabase.from('users').select('*').eq('id', id).limit(1).maybeSingle();
  await ensureNoError(result, 'Falha ao buscar usuario por id');
  return normalizeDbUser(result.data);
}

async function createUser({ establishmentName, email, passwordHash }) {
  await initDb();
  const supabase = getSupabaseClient();
  const result = await supabase
    .from('users')
    .insert({
      establishment_name: establishmentName.trim(),
      email: email.toLowerCase().trim(),
      password_hash: passwordHash,
    })
    .select('*')
    .single();

  await ensureNoError(result, 'Falha ao criar usuario');
  return normalizeDbUser(result.data);
}

async function setPasswordResetToken(userId, tokenHash, expiresAt) {
  await initDb();
  const supabase = getSupabaseClient();
  const result = await supabase
    .from('users')
    .update({
      reset_token_hash: tokenHash,
      reset_token_expires_at: expiresAt,
    })
    .eq('id', userId);

  await ensureNoError(result, 'Falha ao salvar token de reset');
}

async function findUserByResetTokenHash(tokenHash) {
  await initDb();
  const supabase = getSupabaseClient();
  const result = await supabase
    .from('users')
    .select('*')
    .eq('reset_token_hash', tokenHash)
    .gt('reset_token_expires_at', Date.now())
    .limit(1)
    .maybeSingle();

  await ensureNoError(result, 'Falha ao buscar token de reset');
  return normalizeDbUser(result.data);
}

async function clearPasswordResetToken(userId) {
  await initDb();
  const supabase = getSupabaseClient();
  const result = await supabase
    .from('users')
    .update({
      reset_token_hash: null,
      reset_token_expires_at: null,
    })
    .eq('id', userId);

  await ensureNoError(result, 'Falha ao limpar token de reset');
}

async function updatePassword(userId, passwordHash) {
  await initDb();
  const supabase = getSupabaseClient();
  const result = await supabase
    .from('users')
    .update({
      password_hash: passwordHash,
      reset_token_hash: null,
      reset_token_expires_at: null,
    })
    .eq('id', userId);

  await ensureNoError(result, 'Falha ao atualizar senha');
}

async function getOrderById(orderId) {
  await initDb();
  const supabase = getSupabaseClient();
  const result = await supabase
    .from('orders')
    .select('*, users!inner(establishment_name)')
    .eq('id', orderId)
    .limit(1)
    .maybeSingle();

  await ensureNoError(result, 'Falha ao buscar comanda');
  if (!result.data) {
    return null;
  }

  return normalizeDbOrder({
    ...result.data,
    establishment_name: result.data.users.establishment_name,
  });
}

async function getOrderByIdForUser(orderId, userId) {
  await initDb();
  const supabase = getSupabaseClient();
  const result = await supabase
    .from('orders')
    .select('*, users!inner(establishment_name)')
    .eq('id', orderId)
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  await ensureNoError(result, 'Falha ao buscar comanda do usuario');
  if (!result.data) {
    return null;
  }

  return normalizeDbOrder({
    ...result.data,
    establishment_name: result.data.users.establishment_name,
  });
}

async function createOrder(userId, payload = {}) {
  await initDb();
  const supabase = getSupabaseClient();
  const result = await supabase.rpc('create_order', {
    p_user_id: Number(userId),
    p_customer_name: payload.customerName?.trim() || null,
    p_items: payload.items?.trim() || null,
    p_status: payload.status || 'awaiting',
  });

  await ensureNoError(result, 'Falha ao criar comanda');
  const createdOrderId = Array.isArray(result.data) ? result.data[0]?.id : result.data?.id;

  if (!createdOrderId) {
    throw new Error('Falha ao criar comanda: resposta sem id');
  }

  return getOrderById(createdOrderId);
}

async function listOrders(userId, filters = {}) {
  await initDb();
  const supabase = getSupabaseClient();
  let query = supabase
    .from('orders')
    .select('*, users!inner(establishment_name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (filters.status) {
    query = query.eq('status', filters.status);
  } else if (filters.activeOnly !== false) {
    query = query.neq('status', 'delivered');
  }

  const result = await query;
  await ensureNoError(result, 'Falha ao listar comandas');

  let rows = result.data.map((row) =>
    normalizeDbOrder({
      ...row,
      establishment_name: row.users.establishment_name,
    }),
  );
  rows = rows.filter((row) => !isCounterSeedOrder(row));

  if (filters.q) {
    const q = String(filters.q).trim().toLowerCase();
    rows = rows.filter((row) => {
      return (
        String(row.number).toLowerCase().includes(q) ||
        String(row.customer_name || '').toLowerCase().includes(q) ||
        String(row.items || '').toLowerCase().includes(q)
      );
    });
  }

  return rows;
}

async function getOrderNumberSettings(userId) {
  await initDb();
  const supabase = getSupabaseClient();
  const maxResult = await supabase
    .from('orders')
    .select('number')
    .eq('user_id', userId)
    .order('number', { ascending: false })
    .limit(1);
  await ensureNoError(maxResult, 'Falha ao buscar numeracao atual');

  const seedResult = await supabase
    .from('orders')
    .select('id, number')
    .eq('user_id', userId)
    .eq('items', COUNTER_SEED_ITEMS)
    .order('number', { ascending: false })
    .limit(1);
  await ensureNoError(seedResult, 'Falha ao buscar ajuste de numeracao');

  const currentNextNumber = Number(maxResult.data?.[0]?.number || 0) + 1;
  const configuredNextNumber = seedResult.data?.[0]?.number ? Number(seedResult.data[0].number) + 1 : null;

  return {
    currentNextNumber,
    configuredNextNumber,
  };
}

async function setNextOrderNumber(userId, nextNumber) {
  await initDb();
  const supabase = getSupabaseClient();
  const targetNextNumber = Number(nextNumber);
  if (!Number.isInteger(targetNextNumber) || targetNextNumber < 1) {
    throw new Error('Informe um numero de comanda valido.');
  }

  const settings = await getOrderNumberSettings(userId);
  if (targetNextNumber <= settings.currentNextNumber) {
    return {
      ...settings,
      applied: false,
      message: `A proxima comanda ja sera ${settings.currentNextNumber} ou maior.`,
    };
  }

  const seedNumber = targetNextNumber - 1;
  const seedResult = await supabase
    .from('orders')
    .select('id')
    .eq('user_id', userId)
    .eq('items', COUNTER_SEED_ITEMS)
    .limit(1);
  await ensureNoError(seedResult, 'Falha ao localizar ajuste de numeracao');

  if (seedResult.data?.[0]?.id) {
    const updateResult = await supabase
      .from('orders')
      .update({
        number: seedNumber,
        customer_name: 'Ajuste de numeracao',
        status: 'delivered',
        updated_at: new Date().toISOString(),
        delivered_at: new Date().toISOString(),
      })
      .eq('id', seedResult.data[0].id)
      .eq('user_id', userId);
    await ensureNoError(updateResult, 'Falha ao atualizar ajuste de numeracao');
  } else {
    const now = new Date().toISOString();
    const insertResult = await supabase.from('orders').insert({
      id: crypto.randomUUID(),
      user_id: userId,
      number: seedNumber,
      customer_name: 'Ajuste de numeracao',
      items: COUNTER_SEED_ITEMS,
      status: 'delivered',
      created_at: now,
      updated_at: now,
      delivered_at: now,
    });
    await ensureNoError(insertResult, 'Falha ao salvar ajuste de numeracao');
  }

  return {
    currentNextNumber: targetNextNumber,
    configuredNextNumber: targetNextNumber,
    applied: true,
    message: `A proxima comanda sera ${targetNextNumber}.`,
  };
}

async function listDeliveredOrders(userId, filters = {}) {
  return listOrders(userId, { ...filters, status: 'delivered', activeOnly: false });
}

async function updateOrderStatus(orderId, userId, status) {
  await initDb();
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();

  const payload = {
    status,
    updated_at: now,
    delivered_at: status === 'delivered' ? now : null,
  };
  if (status === 'preparing') {
    payload.preparing_at = now;
  }
  if (status === 'ready') {
    payload.ready_at = now;
  }

  let result = await supabase
    .from('orders')
    .update(payload)
    .eq('id', orderId)
    .eq('user_id', userId)
    .select('id')
    .limit(1);

  if (result.error && /preparing_at|ready_at/.test(result.error.message || '')) {
    delete payload.preparing_at;
    delete payload.ready_at;
    result = await supabase
      .from('orders')
      .update(payload)
      .eq('id', orderId)
      .eq('user_id', userId)
      .select('id')
      .limit(1);
  }

  await ensureNoError(result, 'Falha ao atualizar status da comanda');
  if (!result.data || result.data.length === 0) {
    return null;
  }

  return getOrderByIdForUser(orderId, userId);
}

async function resendOrderAlert(orderId, userId) {
  const order = await getOrderByIdForUser(orderId, userId);
  if (!order) {
    return null;
  }

  const supabase = getSupabaseClient();
  const now = new Date().toISOString();
  let nextAlertRevision = Number(order.alert_revision || 0) + 1;
  let result = await supabase
    .from('orders')
    .update({
      alert_revision: nextAlertRevision,
      updated_at: now,
    })
    .eq('id', orderId)
    .eq('user_id', userId)
    .select('id')
    .limit(1);

  if (result.error && /alert_revision/.test(result.error.message || '')) {
    nextAlertRevision = Date.now();
    result = await supabase
      .from('orders')
      .update({
        updated_at: now,
      })
      .eq('id', orderId)
      .eq('user_id', userId)
      .select('id')
      .limit(1);
  }

  await ensureNoError(result, 'Falha ao reenviar aviso da comanda');
  if (!result.data || result.data.length === 0) {
    return null;
  }

  const updatedOrder = await getOrderByIdForUser(orderId, userId);
  if (updatedOrder) {
    updatedOrder.alert_revision = nextAlertRevision;
  }

  return updatedOrder;
}

module.exports = {
  getSupabaseClient,
  getSupabaseConfig,
  usingSupabase: true,
  initDb,
  createOrder,
  createUser,
  findUserByEmail,
  findUserById,
  findUserByResetTokenHash,
  getOrderById,
  getOrderByIdForUser,
  getOrderNumberSettings,
  listDeliveredOrders,
  listOrders,
  setPasswordResetToken,
  clearPasswordResetToken,
  resendOrderAlert,
  setNextOrderNumber,
  updateOrderStatus,
  updatePassword,
};
