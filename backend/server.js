const express = require('express');
const session = require('express-session');
const axios = require('axios');

const app = express();
const PORT = 3000;

const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-secret-please';

const USERS = [
  {
    login: process.env.ADMIN_LOGIN || 'admin',
    password: process.env.ADMIN_PASSWORD || 'change-admin-password',
    role: 'admin'
  },
  {
    login: process.env.TEAM_LOGIN || 'team',
    password: process.env.TEAM_PASSWORD || 'change-team-password',
    role: 'team'
  }
];

const SHEET_ID = '1rqbtFPG0PY5A1dINbx28B9EOAIpuN1EB6kGW7mTakfc';
const SHEET_NAME = 'Свод';

app.set('trust proxy', 1);
app.use(express.json());

app.use(session({
  name: 'dashboard_sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 12
  }
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
    }
    next();
  };
}

function gvizUrl(range = '') {
  const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${encodeURIComponent(SHEET_NAME)}&tqx=responseHandler:cb`;
  return range ? `${base}&range=${encodeURIComponent(range)}` : base;
}

function unwrapGviz(text) {
  const start = text.indexOf('(');
  const end = text.lastIndexOf(')');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Bad GVIZ response');
  }
  return JSON.parse(text.slice(start + 1, end));
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'dashboard-auth', port: PORT });
});

app.get('/api/me', (req, res) => {
  res.json({
    authenticated: !!req.session.user,
    user: req.session.user || null
  });
});

app.post('/api/login', (req, res) => {
  const { login, password } = req.body || {};

  const user = USERS.find(
    u => u.login === String(login || '').trim() && u.password === String(password || '')
  );

  if (!user) {
    return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });
  }

  req.session.user = {
    login: user.login,
    role: user.role
  };

  return res.json({
    ok: true,
    user: req.session.user
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('dashboard_sid');
    res.json({ ok: true });
  });
});

app.get('/api/data', requireAuth, async (req, res) => {
  try {
    const [mainResp, leadsResp, svcResp] = await Promise.all([
      axios.get(gvizUrl(), { timeout: 15000 }),
      axios.get(gvizUrl('A36:R36'), { timeout: 15000 }),
      axios.get(gvizUrl('A84:ZZ84'), { timeout: 15000 })
    ]);

    res.json({
      ok: true,
      user: req.session.user,
      main: unwrapGviz(mainResp.data),
      leads: unwrapGviz(leadsResp.data),
      svc: unwrapGviz(svcResp.data)
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: 'DATA_FETCH_FAILED',
      message: err.message
    });
  }
});

app.get('/api/admin-only', requireRole('admin'), (req, res) => {
  res.json({ ok: true, message: 'admin access granted' });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`dashboard-auth started on http://127.0.0.1:${PORT}`);
});
