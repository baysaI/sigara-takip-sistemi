'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db/database');
const { requireAuth, asyncHandler } = require('../middleware/auth');

const router = express.Router();

const findUserStmt = db.prepare(
  'SELECT id, username, password_hash, full_name, role, is_active FROM users WHERE username = ?'
);

/** POST /api/auth/login */
router.post('/login', asyncHandler((req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'Kullanici adi ve sifre zorunludur.' });
  }

  const user = findUserStmt.get(username);
  // Kullanici yok / sifre yanlis ayrimi yapilmaz (kullanici adi sizdirmamak icin).
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ ok: false, error: 'Kullanici adi veya sifre hatali.' });
  }
  if (!user.is_active) {
    return res.status(403).json({ ok: false, error: 'Bu hesap pasif durumda. Yonetici ile gorusun.' });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ ok: false, error: 'Oturum baslatilamadi.' });
    req.session.user = {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role
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

/** GET /api/auth/me - sayfa acilisinda oturum kontrolu */
router.get('/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.session.user });
});

module.exports = router;
