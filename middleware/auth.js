'use strict';

/** Oturum yoksa 401 dondurur (API) veya login sayfasina yonlendirir (sayfa istegi). */
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();

  // NOT: router icinde req.path mount noktasina goreli oldugu icin originalUrl kullanilir.
  if (req.originalUrl.startsWith('/api') || req.xhr || req.get('accept')?.includes('application/json')) {
    return res.status(401).json({ ok: false, error: 'Oturum bulunamadi. Lutfen giris yapin.' });
  }
  return res.redirect('/login.html');
}

/** Sadece admin rolu. */
function requireAdmin(req, res, next) {
  if (req.session?.user?.role === 'admin') return next();
  return res.status(403).json({ ok: false, error: 'Bu islem icin yonetici yetkisi gerekli.' });
}

/**
 * Sadece KOK HESAP (users.is_root = 1) — piramidin en ustu.
 *
 * Veri sifirlama gibi geri donusu olmayan islemler icin. Yonetici olmak
 * yetmez; yalnizca korumali kok hesap yapabilir.
 *
 * Bayrak OTURUMDAN DEGIL veritabanindan okunur: yetki oturum acikken
 * degistirilmis olabilir ve bu ucta bayat bilgiyle karar vermek istemeyiz.
 * Nadir cagrilan bir uc oldugu icin ek sorgunun maliyeti onemsiz.
 */
function isRoot(req) {
  const id = req.session?.user?.id;
  if (!id) return false;

  const { db } = require('../db/database');
  return !!db.prepare('SELECT is_root FROM users WHERE id = ?').get(id)?.is_root;
}

/**
 * Kok hesap mi? Middleware bicimi — yetkisi olmayana 401/403 doner.
 * Veri sifirlama, kalici silme ve iz birakmayan duzeltme bunu kullanir.
 */
function requireRoot(req, res, next) {
  if (!req.session?.user?.id) {
    return res.status(401).json({ ok: false, error: 'Oturum bulunamadi. Lutfen giris yapin.' });
  }
  if (isRoot(req)) return next();

  return res.status(403).json({
    ok: false,
    error: 'Bu bölüme yalnızca korumalı kök hesap erişebilir.'
  });
}

/** Tum route'lari try/catch ile sarmalamamak icin kucuk yardimci. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { requireAuth, requireAdmin, requireRoot, isRoot, asyncHandler };
