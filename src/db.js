const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || null;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || null;

if (!supabaseUrl) {
  throw new Error('SUPABASE_URL nao configurada. Defina a URL do projeto Supabase para iniciar o app.');
}

if (!supabaseSecretKey) {
  throw new Error(
    'SUPABASE_SECRET_KEY nao configurada. Defina a secret key do projeto Supabase para iniciar o app.',
  );
}

const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

async function initDb() {
  return Promise.resolve();
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
    created_at: row.created_at ? String(row.created_at) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
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

async function ensureNoError(result, context) {
  if (result.error) {
    const error = new Error(`${context}: ${result.error.message}`);
    error.cause = result.error;
    throw error;
  }
}

async function findUserByEmail(email) {
  await initDb();
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
  const result = await supabase.from('users').select('*').eq('id', id).limit(1).maybeSingle();
  await ensureNoError(result, 'Falha ao buscar usuario por id');
  return normalizeDbUser(result.data);
}

async function createUser({ establishmentName, email, passwordHash }) {
  await initDb();
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

async function listDeliveredOrders(userId, filters = {}) {
  return listOrders(userId, { ...filters, status: 'delivered', activeOnly: false });
}

async function updateOrderStatus(orderId, userId, status) {
  await initDb();
  const now = new Date().toISOString();
  const result = await supabase
    .from('orders')
    .update({
      status,
      updated_at: now,
      delivered_at: status === 'delivered' ? now : null,
    })
    .eq('id', orderId)
    .eq('user_id', userId)
    .select('id')
    .limit(1);

  await ensureNoError(result, 'Falha ao atualizar status da comanda');
  if (!result.data || result.data.length === 0) {
    return null;
  }

  return getOrderByIdForUser(orderId, userId);
}

module.exports = {
  supabase,
  usingSupabase: true,
  initDb,
  createOrder,
  createUser,
  findUserByEmail,
  findUserById,
  findUserByResetTokenHash,
  getOrderById,
  getOrderByIdForUser,
  listDeliveredOrders,
  listOrders,
  setPasswordResetToken,
  clearPasswordResetToken,
  updateOrderStatus,
  updatePassword,
};
