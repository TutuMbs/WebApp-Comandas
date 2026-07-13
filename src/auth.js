const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'comandas_auth';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const COOKIE_MAX_AGE = 1000 * 60 * 60 * 24 * 7;

function signAuthToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      establishment_name: user.establishment_name,
    },
    JWT_SECRET,
    { expiresIn: '7d' },
  );
}

function setAuthCookie(res, token) {
  const secureCookie =
    process.env.COOKIE_SECURE === 'true' ||
    (process.env.NODE_ENV === 'production' && String(process.env.PUBLIC_BASE_URL || '').startsWith('https://'));

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookie,
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function getAuthTokenFromReq(req) {
  return req.cookies?.[COOKIE_NAME];
}

function readAuthUser(req) {
  const token = getAuthTokenFromReq(req);
  if (!token) {
    return null;
  }

  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const authUser = readAuthUser(req);

  if (!authUser) {
    return res.redirect('/login');
  }

  req.authUser = authUser;
  res.locals.authUser = authUser;
  next();
}

function optionalAuth(req, res, next) {
  const authUser = readAuthUser(req);
  req.authUser = authUser;
  res.locals.authUser = authUser;
  next();
}

module.exports = {
  COOKIE_NAME,
  clearAuthCookie,
  optionalAuth,
  requireAuth,
  readAuthUser,
  setAuthCookie,
  signAuthToken,
};
