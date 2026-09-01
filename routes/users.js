/**
 * Kullanici (sigaraci / yonetici) hesap yonetimi.
 * Hesaplar yalnizca yonetici tarafindan olusturulur; kendi kendine kayit yoktur.
 */
'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db/database');
const { requireAuth, requireAdmin, asyncHandler } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const MIN_PASSWORD = 6;
const USERNAME_RE = /^[A-Za-z0-9._-]{3,30}$/;

const listAll = db.prepare(`
  SELECT id, username, full_name, role, is_active, is_root, created_at
  FROM users ORDER BY is_root DESC, role DESC, username COLLATE NOCASE
`);
const listNames = db.prepare(
  'SELECT username FROM users WHERE is_active = 1 ORDER BY username COLLATE NOCASE'
);
const byId = db.prepare('SELECT id, username, full_name, role, is_active, is_root FROM users WHERE id = ?');

/**
 * KOK HESAP KORUMASI — piramidin en ustu.
 *
 * Kok hesaba BASKA hicbir yonetici dokunamaz: sifre sifirlama, pasife
 * alma, yetki dusurme ve silme kapalidir. Yalnizca hesabin sahibi
 * (o hesapla giris yapmis olan) kendi sifresini degistirebilir; aksi
 * halde kurulum sifresinde kilitli kalirdi.
 *
 * @returns {null|{status:number, error:string}} engel varsa aciklamasi
 */
function kokEngeli(hedef, istekSahibi, islem) {
  if (!hedef.is_root) return null;
  if (hedef.id === istekSahibi.id && islem === 'password') return null;   // kendi sifresi

  return {
    status: 403,
    error: hedef.id === istekSahibi.id
      ? 'Kök hesapta yalnızca şifre değiştirilebilir.'
      : `"${hedef.username}" korumalı kök hesaptır; başka bir yönetici tarafından değiştirilemez.`
  };
}

/** Sistemin yonetici olmadan kalmasini engeller. */
function activeAdminCount(exceptId) {
  return db.prepare(
    "SELECT COUNT(*) c FROM users WHERE role = 'admin' AND is_active = 1 AND id != ?"
  ).get(exceptId ?? -1).c;
}

/* ------------------------------------------------------------------ */
/* GET /api/users                                                      */
/* Yonetici tam listeyi, digerleri arsiv filtresi icin sadece adlari.  */
/* ------------------------------------------------------------------ */
router.get('/', asyncHandler((req, res) => {
  if (req.session.user.role === 'admin') {
    return res.json({ ok: true, users: listAll.all() });
  }
  res.json({ ok: true, users: listNames.all() });
}));

/* ------------------------------------------------------------------ */
/* POST /api/users - yeni hesap (admin)                                */
/* ------------------------------------------------------------------ */
router.post('/', requireAdmin, asyncHandler((req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const fullName = String(req.body.full_name || '').trim() || null;
  const role = req.body.role === 'admin' ? 'admin' : 'sigaraci';

  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({
      ok: false,
      error: 'Kullanici adi 3-30 karakter olmali; harf, rakam, nokta, tire ve alt cizgi kullanilabilir.'
    });
  }
  if (password.length < MIN_PASSWORD) {
    return res.status(400).json({ ok: false, error: `Sifre en az ${MIN_PASSWORD} karakter olmalidir.` });
  }
  if (fullName && fullName.length > 80) {
    return res.status(400).json({ ok: false, error: 'Ad soyad en fazla 80 karakter olabilir.' });
  }

  try {
    const info = db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role)
      VALUES (?, ?, ?, ?)
    `).run(username, bcrypt.hashSync(password, 10), fullName, role);

    res.status(201).json({ ok: true, user: byId.get(info.lastInsertRowid) });
  } catch (err) {
    if (String(err.code).includes('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ ok: false, error: 'Bu kullanici adi zaten kayitli.' });
    }
    throw err;
  }
}));

/* ------------------------------------------------------------------ */
/* PATCH /api/users/:id - aktif/pasif, sifre sifirlama, rol (admin)    */
/* ------------------------------------------------------------------ */
router.patch('/:id', requireAdmin, asyncHandler((req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const user = byId.get(id);
  if (!user) return res.status(404).json({ ok: false, error: 'Kullanici bulunamadi.' });

  const kendisi = id === req.session.user.id;

  /* --- Aktif / pasif --- */
  if (Object.prototype.hasOwnProperty.call(req.body, 'is_active')) {
    const engel = kokEngeli(user, req.session.user, 'is_active');
    if (engel) return res.status(engel.status).json({ ok: false, error: engel.error });

    const isActive = req.body.is_active ? 1 : 0;

    if (!isActive && kendisi) {
      return res.status(400).json({ ok: false, error: 'Kendi hesabinizi pasife alamazsiniz.' });
    }
    if (!isActive && user.role === 'admin' && activeAdminCount(id) === 0) {
      return res.status(400).json({ ok: false, error: 'Sistemde en az bir aktif yonetici kalmalidir.' });
    }
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(isActive, id);
  }

  /* --- Sifre sifirlama ---
     Kok hesabin sifresini YALNIZCA kendisi degistirebilir; baska bir
     yonetici sifirlayip hesabi ele geciremez. */
  if (req.body.password != null) {
    const engel = kokEngeli(user, req.session.user, 'password');
    if (engel) return res.status(engel.status).json({ ok: false, error: engel.error });

    const password = String(req.body.password);
    if (password.length < MIN_PASSWORD) {
      return res.status(400).json({ ok: false, error: `Sifre en az ${MIN_PASSWORD} karakter olmalidir.` });
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), id);
  }

  /* --- Rol --- */
  if (req.body.role) {
    const engel = kokEngeli(user, req.session.user, 'role');
    if (engel) return res.status(engel.status).json({ ok: false, error: engel.error });

    const role = req.body.role === 'admin' ? 'admin' : 'sigaraci';

    if (role !== 'admin' && kendisi) {
      return res.status(400).json({ ok: false, error: 'Kendi yonetici yetkinizi kaldiramazsiniz.' });
    }
    if (role !== 'admin' && user.role === 'admin' && activeAdminCount(id) === 0) {
      return res.status(400).json({ ok: false, error: 'Sistemde en az bir aktif yonetici kalmalidir.' });
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }

  res.json({ ok: true, user: byId.get(id) });
}));

/** DELETE /api/users/:id - hesabi tamamen sil (admin).
 *  Kendi hesabini ve son aktif yoneticiyi silmek engellidir.
 *  Gecmis kayitlarda username snapshot olarak kalir. */
router.delete('/:id', requireAdmin, asyncHandler((req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const user = byId.get(id);
  if (!user) return res.status(404).json({ ok: false, error: 'Kullanici bulunamadi.' });

  const engel = kokEngeli(user, req.session.user, 'delete');
  if (engel) return res.status(engel.status).json({ ok: false, error: engel.error });

  if (id === req.session.user.id) {
    return res.status(400).json({ ok: false, error: 'Kendi hesabinizi silemezsiniz.' });
  }
  if (user.role === 'admin' && activeAdminCount(id) === 0) {
    return res.status(400).json({ ok: false, error: 'Sistemde en az bir aktif yonetici kalmalidir.' });
  }

  const kayit = db.prepare('SELECT COUNT(*) c FROM records WHERE user_id = ?').get(id).c;
  db.prepare('DELETE FROM users WHERE id = ?').run(id);

  res.json({ ok: true, deleted: user.username, affectedRecords: kayit });
}));

module.exports = router;
