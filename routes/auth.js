'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db/database');
const { requireAuth, asyncHandler } = require('../middleware/auth');
const { loginRateLimit, loginBasarisiz, loginBasarili } = require('../middleware/rateLimit');

const router = express.Router();

const findUserStmt = db.prepare(
  'SELECT id, username, password_hash, full_name, role, is_active FROM users WHERE username = ?'
);

/** POST /api/auth/login — kaba kuvvete karsi deneme sinirli */
router.post('/login', loginRateLimit, asyncHandler((req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'Kullanici adi ve sifre zorunludur.' });
  }

  const user = findUserStmt.get(username);
  // Kullanici yok / sifre yanlis ayrimi yapilmaz (kullanici adi sizdirmamak icin).
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    loginBasarisiz(req);
    return res.status(401).json({ ok: false, error: 'Kullanici adi veya sifre hatali.' });
  }
  if (!user.is_active) {
    return res.status(403).json({ ok: false, error: 'Bu hesap pasif durumda. Yonetici ile gorusun.' });
  }

  loginBasarili(req);   // dogru sifre girildi, sayaci sifirla

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ ok: false, error: 'Oturum baslatilamadi.' });
    req.session.user = {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      is_root: user.is_root ? 1 : 0
    };
    req.session.save(() => res.json({ ok: true, user: req.session.user }));
  });
}));

/** POST /api/auth/logout */
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sigara.sid');
    res.json({ ok: true });
  });
});

/**
 * GET /api/auth/me - sayfa acilisinda oturum kontrolu
 *
 * Rol ve kok bayragi VERITABANINDAN tazelenir: yetki oturum acikken
 * degistirilmis olabilir. Ayrica surum yukseltmeden onceki oturumlarda
 * is_root alani hic bulunmaz; taze okuma sayesinde kullanicinin yeniden
 * giris yapmasi gerekmez.
 */
router.get('/me', requireAuth, (req, res) => {
  const guncel = db.prepare(
    'SELECT role, is_active, is_root FROM users WHERE id = ?'
  ).get(req.session.user.id);

  if (!guncel || !guncel.is_active) {
    return req.session.destroy(() => {
      res.status(401).json({ ok: false, error: 'Hesabiniz artik aktif degil. Lutfen tekrar giris yapin.' });
    });
  }

  req.session.user.role = guncel.role;
  req.session.user.is_root = guncel.is_root ? 1 : 0;

  res.json({ ok: true, user: req.session.user });
});

module.exports = router;
