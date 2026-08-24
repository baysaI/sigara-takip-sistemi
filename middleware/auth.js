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

/** Tum route'lari try/catch ile sarmalamamak icin kucuk yardimci. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { requireAuth, requireAdmin, asyncHandler };
