'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const config = require('./config');
const { db } = require('./db/database');
const { requireAuth } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const lookupRoutes = require('./routes/lookups');
const recordRoutes = require('./routes/records');
const userRoutes = require('./routes/users');
const flagRoutes = require('./routes/flags');
const stockRoutes = require('./routes/stock');
const reportRoutes = require('./routes/reports');
const adminRoutes = require('./routes/admin');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

/* ---------------------------- Middleware ---------------------------- */
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false }));

app.use(session({
  name: 'sigara.sid',
  store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'data') }),
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',   // HTTPS arkasindaysa true
    maxAge: 12 * 60 * 60 * 1000                 // 12 saat vardiya
  }
}));

/* ------------------------- Korumali sayfalar ------------------------ */
// Oturum gerektiren sayfalar. express.static'ten ONCE tanimlanir,
// yoksa statik katman dosyayi kontrolsuz servis eder.
const PROTECTED_PAGES = ['kayit', 'arsiv', 'sorgu', 'stok', 'rapor', 'yonetim'];

app.get(['/', '/index.html'], (req, res) => {
  res.redirect(req.session?.user ? '/kayit.html' : '/login.html');
});

app.get(PROTECTED_PAGES.map((p) => `/${p}.html`), requireAuth, (req, res) => {
  const page = path.basename(req.path);

  // Yonetim ve rapor sayfalari admin disina servis edilmez (asil koruma API'de,
  // bu sadece sayfanin bosuna acilmasini engeller).
  const ADMIN_PAGES = ['yonetim.html', 'rapor.html'];
  if (ADMIN_PAGES.includes(page) && req.session.user.role !== 'admin') {
    return res.redirect('/kayit.html');
  }
  res.sendFile(path.join(__dirname, 'public', page));
});

// Eski tek sayfalik panel adresini yeni ana sayfaya yonlendir
app.get('/dashboard.html', (req, res) => res.redirect('/kayit.html'));

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

/* ------------------------------ API --------------------------------- */
app.use('/api/auth', authRoutes);

app.get('/api/config', (req, res) => {
  res.json({
    ok: true,
    cooldownHours: config.COOLDOWN_HOURS,
    dayStartHour: config.DAY_START_HOUR,
    serverTime: new Date().toISOString()
  });
});

app.use('/api', lookupRoutes);        // /api/waiters, /api/cigarette-types
app.use('/api/users', userRoutes);
app.use('/api/records', recordRoutes);
app.use('/api/flags', flagRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);


/* --------------------------- Hata yakalama -------------------------- */
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'Boyle bir API ucu yok.' });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  // Bozuk JSON govdesi gibi istemci kaynakli hatalar 400 olarak isaretlenir;
  // hepsini 500'e cevirmek istemciye yanlis bilgi verir.
  const status = err.status || err.statusCode || 500;

  if (status >= 500) console.error('[HATA]', err);

  res.status(status).json({
    ok: false,
    error: err.type === 'entity.parse.failed'
      ? 'Gecersiz JSON govdesi.'
      : (status >= 500 ? 'Sunucu hatasi olustu.' : err.message)
  });
});

/* ----------------------------- Baslat ------------------------------- */
const server = app.listen(config.PORT, () => {
  const { c: userCount } = db.prepare('SELECT COUNT(*) c FROM users').get();
  console.log('==============================================');
  console.log('  SIGARA TAKIP SISTEMI');
  console.log(`  http://localhost:${config.PORT}`);
  console.log(`  Kural: ${config.COOLDOWN_HOURS} saatte bir`);
  console.log(`  Kayitli kullanici: ${userCount}`);
  if (userCount === 0) console.log('  ! Once "npm run seed" calistirin.');
  console.log('==============================================');
});

// Port doluysa yigin izi yerine ne yapilacagini soyle.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('==============================================');
    console.error(`  ${config.PORT} portu zaten kullanimda.`);
    console.error('  Muhtemelen sunucu baska bir pencerede acik.');
    console.error('');
    console.error('  Cozum 1: Acik olan sunucuyu kullanin -> http://localhost:' + config.PORT);
    console.error('  Cozum 2: Eski surecleri kapatin ->');
    console.error('           netstat -ano | findstr :' + config.PORT);
    console.error('           taskkill /F /PID <yukarida cikan PID>');
    console.error('  Cozum 3: Farkli port ile calistirin ->');
    console.error('           .env dosyasina PORT=3001 yazin');
    console.error('==============================================');
    process.exit(1);
  }
  console.error('[SUNUCU HATASI]', err);
  process.exit(1);
});

function shutdown() {
  console.log('\nKapatiliyor...');
  server.close(() => { db.close(); process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = app;
