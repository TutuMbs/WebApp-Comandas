require('dotenv').config();

const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');

const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const {
  initDb,
  usingSupabase,
  getSupabaseConfig,
  createOrder,
  createUser,
  findUserByEmail,
  findUserByResetTokenHash,
  getOrderByIdForUser,
  listDeliveredOrders,
  listOrders,
  setPasswordResetToken,
  updateOrderStatus,
  updatePassword,
} = require('./db');
const {
  clearAuthCookie,
  optionalAuth,
  requireAuth,
  readAuthUser,
  setAuthCookie,
  signAuthToken,
} = require('./auth');
const { sendPasswordResetEmail } = require('./mailer');

const STATUS_META = {
  awaiting: { label: 'Aguardando', className: 'status-awaiting' },
  preparing: { label: 'Em preparo', className: 'status-preparing' },
  ready: { label: 'Pronto', className: 'status-ready' },
  delivered: { label: 'Entregue', className: 'status-delivered' },
};

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const REALTIME_TRANSPORT = process.env.REALTIME_TRANSPORT || (process.env.VERCEL ? 'polling' : 'socket');
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cookie: false,
});

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser());
app.use(optionalAuth);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((req, res, next) => {
  res.locals.appName = 'Comandas QR';
  res.locals.currentYear = new Date().getFullYear();
  res.locals.statusMeta = STATUS_META;
  res.locals.authUser = req.authUser || null;
  res.locals.baseUrl = getBaseUrl(req);
  res.locals.realtimeTransport = REALTIME_TRANSPORT;
  next();
});

app.get('/health', (req, res) => {
  const supabaseConfig = getSupabaseConfig();
  return res.json({
    ok: true,
    runtime: process.env.VERCEL ? 'vercel' : 'local',
    realtimeTransport: REALTIME_TRANSPORT,
    supabaseConfigured: supabaseConfig.isConfigured,
    hasSupabaseUrl: Boolean(supabaseConfig.supabaseUrl),
    hasSupabaseSecretKey: Boolean(supabaseConfig.supabaseSecretKey),
  });
});

function getBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  }

  const proto = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

function getPublicOrderUrl(req, orderId) {
  return `${getBaseUrl(req)}/c/${orderId}`;
}

function formatOrderNumber(number) {
  return `Comanda ${String(number).padStart(3, '0')}`;
}

function formatDateTime(value) {
  if (!value) {
    return 'nunca';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function getStatusLabel(status) {
  return STATUS_META[status]?.label || status;
}

function getStatusClass(status) {
  return STATUS_META[status]?.className || 'status-awaiting';
}

function serializeOrder(req, order) {
  return {
    id: order.id,
    userId: order.user_id,
    number: order.number,
    numberLabel: formatOrderNumber(order.number),
    customerName: order.customer_name || '',
    items: order.items || '',
    status: order.status,
    statusLabel: getStatusLabel(order.status),
    statusClass: getStatusClass(order.status),
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    deliveredAt: order.delivered_at || null,
    publicUrl: getPublicOrderUrl(req, order.id),
  };
}

function emitOrderEvents(req, order, eventName) {
  const payload = serializeOrder(req, order);
  io.to(`order:${order.id}`).emit(eventName, payload);
  io.to(`user:${order.user_id}`).emit(eventName, payload);
}

function requireGuest(req, res, next) {
  if (req.authUser) {
    return res.redirect('/dashboard');
  }

  next();
}

function renderAuthPage(res, view, options = {}) {
  return res.render(view, {
    pageTitle: options.pageTitle,
    error: options.error || null,
    form: options.form || {},
    resetMode: Boolean(options.resetMode),
    resetToken: options.resetToken || null,
  });
}

async function renderDashboard(req, res, extra = {}) {
  const payload = await buildDashboardData(req);
  const { search, status, orders, activeCount, preparingCount, readyCount } = payload;

  return res.render('dashboard', {
    pageTitle: 'Dashboard',
    search,
    selectedStatus: status,
    activeCount,
    preparingCount,
    readyCount,
    orders: orders.map((order) => ({
      ...serializeOrder(req, order),
      customerName: order.customer_name || 'Sem nome',
      items: order.items || 'Sem observações',
      statusLabel: getStatusLabel(order.status),
      statusClass: getStatusClass(order.status),
      createdAtFormatted: formatDateTime(order.created_at),
      updatedAtFormatted: formatDateTime(order.updated_at),
      deliveredAtFormatted: formatDateTime(order.delivered_at),
    })),
    flash: extra.flash || null,
  });
}

async function buildDashboardData(req) {
  const search = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim();

  const orders = await listOrders(req.authUser.sub, {
    q: search || null,
    status: status || null,
  });
  const activeCount = orders.length;
  const preparingCount = orders.filter((order) => order.status === 'preparing').length;
  const readyCount = orders.filter((order) => order.status === 'ready').length;

  return {
    search,
    status,
    orders,
    activeCount,
    preparingCount,
    readyCount,
  };
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

function validatePassword(password) {
  return String(password || '').trim().length >= 8;
}

app.get('/', (req, res) => {
  if (req.authUser) {
    return res.redirect('/dashboard');
  }

  return res.redirect('/login');
});

app.get('/register', requireGuest, (req, res) => {
  renderAuthPage(res, 'register', {
    pageTitle: 'Cadastro',
    form: {},
  });
});

app.post('/register', requireGuest, async (req, res) => {
  const establishmentName = String(req.body.establishmentName || '').trim();
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');

  if (!establishmentName || !email || !password) {
    return renderAuthPage(res, 'register', {
      pageTitle: 'Cadastro',
      error: 'Preencha nome do estabelecimento, e-mail e senha.',
      form: { establishmentName, email },
    });
  }

  if (!validatePassword(password)) {
    return renderAuthPage(res, 'register', {
      pageTitle: 'Cadastro',
      error: 'Use uma senha com pelo menos 8 caracteres.',
      form: { establishmentName, email },
    });
  }

  if (await findUserByEmail(email)) {
    return renderAuthPage(res, 'register', {
      pageTitle: 'Cadastro',
      error: 'Já existe uma conta com este e-mail.',
      form: { establishmentName, email },
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await createUser({ establishmentName, email, passwordHash });
  const token = signAuthToken(user);
  setAuthCookie(res, token);
  return res.redirect('/dashboard');
});

app.get('/login', requireGuest, (req, res) => {
  renderAuthPage(res, 'login', {
    pageTitle: 'Login',
    form: {},
  });
});

app.post('/login', requireGuest, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  const user = await findUserByEmail(email);

  if (!user) {
    return renderAuthPage(res, 'login', {
      pageTitle: 'Login',
      error: 'E-mail ou senha inválidos.',
      form: { email },
    });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return renderAuthPage(res, 'login', {
      pageTitle: 'Login',
      error: 'E-mail ou senha inválidos.',
      form: { email },
    });
  }

  const token = signAuthToken(user);
  setAuthCookie(res, token);
  return res.redirect('/dashboard');
});

app.post('/logout', requireAuth, (req, res) => {
  clearAuthCookie(res);
  return res.redirect('/login');
});

app.get('/forgot-password', requireGuest, (req, res) => {
  renderAuthPage(res, 'forgot-password', {
    pageTitle: 'Recuperar senha',
    form: {},
  });
});

app.post('/forgot-password', requireGuest, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const user = await findUserByEmail(email);

  if (!user) {
    return renderAuthPage(res, 'forgot-password', {
      pageTitle: 'Recuperar senha',
      form: { email },
      error: 'Se o e-mail existir, enviaremos as instruções de recuperação.',
    });
  }

  const token = createResetToken();
  const tokenHash = hashResetToken(token);
  const expiresAt = Date.now() + 1000 * 60 * 60;
  await setPasswordResetToken(user.id, tokenHash, expiresAt);

  const resetUrl = `${getBaseUrl(req)}/reset-password?token=${token}`;
  const mailResult = await sendPasswordResetEmail({
    to: user.email,
    establishmentName: user.establishment_name,
    resetUrl,
  });

  return res.render('forgot-password', {
    pageTitle: 'Recuperar senha',
    form: { email },
    success: mailResult.sent
      ? 'Enviamos um e-mail com o link de redefinição.'
      : 'O link foi gerado para ambiente de desenvolvimento.',
    devResetUrl: mailResult.sent ? null : resetUrl,
  });
});

app.get('/reset-password', requireGuest, async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token) {
    return res.redirect('/forgot-password');
  }

  const user = await findUserByResetTokenHash(hashResetToken(token));
  if (!user) {
    return renderAuthPage(res, 'reset-password', {
      pageTitle: 'Redefinir senha',
      error: 'O link de redefinição é inválido ou expirou.',
      resetToken: token,
      resetMode: true,
    });
  }

  return renderAuthPage(res, 'reset-password', {
    pageTitle: 'Redefinir senha',
    resetToken: token,
    resetMode: true,
  });
});

app.post('/reset-password', requireGuest, async (req, res) => {
  const token = String(req.body.token || '').trim();
  const password = String(req.body.password || '');
  const confirmation = String(req.body.confirmation || '');

  if (!token) {
    return res.redirect('/forgot-password');
  }

  if (!validatePassword(password)) {
    return renderAuthPage(res, 'reset-password', {
      pageTitle: 'Redefinir senha',
      error: 'Use uma senha com pelo menos 8 caracteres.',
      resetToken: token,
      resetMode: true,
    });
  }

  if (password !== confirmation) {
    return renderAuthPage(res, 'reset-password', {
      pageTitle: 'Redefinir senha',
      error: 'As senhas não conferem.',
      resetToken: token,
      resetMode: true,
    });
  }

  const user = await findUserByResetTokenHash(hashResetToken(token));
  if (!user) {
    return renderAuthPage(res, 'reset-password', {
      pageTitle: 'Redefinir senha',
      error: 'O link de redefinição é inválido ou expirou.',
      resetToken: token,
      resetMode: true,
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await updatePassword(user.id, passwordHash);
  return res.redirect('/login');
});

app.get('/dashboard', requireAuth, async (req, res) => {
  return renderDashboard(req, res);
});

app.get('/api/dashboard', requireAuth, async (req, res) => {
  const payload = await buildDashboardData(req);
  return res.json({
    ...payload,
    orders: payload.orders.map((order) => ({
      ...serializeOrder(req, order),
      customerName: order.customer_name || 'Sem nome',
      items: order.items || 'Sem observações',
      statusLabel: getStatusLabel(order.status),
      statusClass: getStatusClass(order.status),
      createdAtFormatted: formatDateTime(order.created_at),
      updatedAtFormatted: formatDateTime(order.updated_at),
      deliveredAtFormatted: formatDateTime(order.delivered_at),
    })),
  });
});

app.get('/history', requireAuth, async (req, res) => {
  const search = String(req.query.q || '').trim();
  const orders = await listDeliveredOrders(req.authUser.sub, {
    q: search || null,
  });

  return res.render('history', {
    pageTitle: 'Histórico',
    search,
    orders: orders.map((order) => ({
      ...serializeOrder(req, order),
      customerName: order.customer_name || 'Sem nome',
      items: order.items || 'Sem observações',
      statusLabel: getStatusLabel(order.status),
      statusClass: getStatusClass(order.status),
      createdAtFormatted: formatDateTime(order.created_at),
      updatedAtFormatted: formatDateTime(order.updated_at),
      deliveredAtFormatted: formatDateTime(order.delivered_at),
    })),
  });
});

app.post('/orders', requireAuth, async (req, res) => {
  const customerName = String(req.body.customerName || '').trim();
  const items = String(req.body.items || '').trim();

  const order = await createOrder(Number(req.authUser.sub), {
    customerName,
    items,
    status: 'awaiting',
  });

  emitOrderEvents(req, order, 'order:created');
  return res.redirect(`/orders/${order.id}/qr`);
});

app.get('/orders/:id/qr', requireAuth, async (req, res) => {
  const order = await getOrderByIdForUser(req.params.id, Number(req.authUser.sub));
  if (!order) {
    return res.status(404).render('not-found', {
      pageTitle: 'Comanda não encontrada',
      message: 'Não encontramos essa comanda no seu estabelecimento.',
      backUrl: '/dashboard',
    });
  }

  const publicUrl = getPublicOrderUrl(req, order.id);
  const qrDataUrl = await QRCode.toDataURL(publicUrl, {
    margin: 1,
    width: 360,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });

  return res.render('order-qr', {
    pageTitle: 'QR da comanda',
    order: {
      ...serializeOrder(req, order),
      customerName: order.customer_name || 'Sem nome',
      items: order.items || 'Sem observações',
      createdAtFormatted: formatDateTime(order.created_at),
      updatedAtFormatted: formatDateTime(order.updated_at),
    },
    qrDataUrl,
  });
});

app.post('/orders/:id/status', requireAuth, async (req, res) => {
  const status = String(req.body.status || '').trim();
  if (!Object.prototype.hasOwnProperty.call(STATUS_META, status)) {
    return res.redirect('/dashboard');
  }

  const order = await updateOrderStatus(req.params.id, Number(req.authUser.sub), status);
  if (!order) {
    return res.status(404).render('not-found', {
      pageTitle: 'Comanda não encontrada',
      message: 'Não encontramos essa comanda no seu estabelecimento.',
      backUrl: '/dashboard',
    });
  }

  emitOrderEvents(req, order, 'order:updated');
  const backUrl = req.get('Referrer') || '/dashboard';
  return res.redirect(backUrl);
});

app.get('/c/:id', async (req, res) => {
  const order = await findOrderByPublicId(req.params.id);
  if (!order) {
    return res.status(404).render('not-found', {
      pageTitle: 'Comanda não encontrada',
      message: 'Esse QR Code não corresponde a uma comanda ativa.',
      backUrl: '/',
    });
  }

  const qrPublicUrl = getPublicOrderUrl(req, order.id);
  return res.render('client', {
    pageTitle: `Acompanhamento - ${formatOrderNumber(order.number)}`,
    order: {
      ...serializeOrder(req, order),
      customerName: order.customer_name || 'Sem nome',
      items: order.items || 'Sem observações',
      createdAtFormatted: formatDateTime(order.created_at),
      updatedAtFormatted: formatDateTime(order.updated_at),
      numberLabel: formatOrderNumber(order.number),
    },
    qrPublicUrl,
  });
});

app.get('/api/orders/:id', async (req, res) => {
  const order = await findOrderByPublicId(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'order_not_found' });
  }

  return res.json({
    order: {
      ...serializeOrder(req, order),
      customerName: order.customer_name || 'Sem nome',
      items: order.items || 'Sem observações',
      createdAtFormatted: formatDateTime(order.created_at),
      updatedAtFormatted: formatDateTime(order.updated_at),
      numberLabel: formatOrderNumber(order.number),
    },
  });
});

function findOrderByPublicId(orderId) {
  return require('./db').getOrderById(orderId);
}

app.use((req, res) => {
  return res.status(404).render('not-found', {
    pageTitle: 'Página não encontrada',
    message: 'A página solicitada não existe.',
    backUrl: req.authUser ? '/dashboard' : '/login',
  });
});

app.use((error, req, res, next) => {
  console.error('Erro na aplicacao:', error);

  if (res.headersSent) {
    return next(error);
  }

  const acceptsJson = req.accepts(['html', 'json']) === 'json' || req.path.startsWith('/api/');
  if (acceptsJson) {
    return res.status(500).json({
      error: 'internal_server_error',
      message: error.message || 'Erro interno do servidor.',
    });
  }

  return res.status(500).render('not-found', {
    pageTitle: 'Erro interno',
    message: error.message || 'Erro interno do servidor.',
    backUrl: '/',
  });
});

io.on('connection', (socket) => {
  const authUser = readAuthUser({ cookies: parseCookies(socket.handshake.headers.cookie || '') });
  if (authUser?.sub) {
    socket.join(`user:${authUser.sub}`);
  }

  socket.on('join-order', ({ orderId }) => {
    if (orderId) {
      socket.join(`order:${orderId}`);
    }
  });
});

function parseCookies(cookieHeader) {
  return cookieHeader.split(';').reduce((acc, pair) => {
    const index = pair.indexOf('=');
    if (index === -1) {
      return acc;
    }

    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

async function startLocalServer() {
  await initDb();
  server.listen(PORT, () => {
    console.log(
      `Comandas QR rodando em ${BASE_URL} usando ${usingSupabase ? 'Supabase' : 'banco desconhecido'} com realtime ${REALTIME_TRANSPORT}`,
    );
  });
}

if (require.main === module) {
  startLocalServer().catch((error) => {
    console.error('Falha ao iniciar o banco de dados:', error);
    process.exit(1);
  });
}

module.exports = {
  app,
  server,
  startLocalServer,
};
