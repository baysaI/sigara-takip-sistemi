/**
 * Form dropdown kaynaklari: garsonlar ve sigara turleri.
 */
'use strict';

const express = require('express');
const { db } = require('../db/database');
const { requireAuth, requireAdmin, asyncHandler } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Garsonlarda aktif/pasif ayrimi yoktur: ayrilan garson silinir.
// (is_active sutunu eski kurulumlarla uyum icin duruyor, filtrelenmez.)
const listWaiters = db.prepare('SELECT id, name, is_active FROM waiters ORDER BY name COLLATE NOCASE');
const listAllWaiters = listWaiters;
const listTypes = db.prepare('SELECT id, name FROM cigarette_types WHERE is_active = 1 ORDER BY name COLLATE NOCASE');

/* ------------------------------------------------------------------
   POPULERLIK SIRALAMASI (?sort=popular)
   Kayit formunda en cok verilen sigaralar ustte olsun diye. Filtre
   listelerinde kullanilmaz: orada bilinen bir adi aramak icin alfabetik
   siralama daha kullanisli.

   Olcut: son POPULER_GUN gunde dagitilan PAKET adedi. Sabit "tum zamanlar"
   yerine kayan pencere; birakilan bir marka zamanla ustten duser, yeni
   populerlesen yukari cikar.

   Iptal edilmis ve degisimle gecersizlesmis kayitlar sayilmaz — satis
   gerceklesmemis sayilir.
   ------------------------------------------------------------------ */
const POPULER_ADET = 10;   // kac tanesi "POPULER" rozeti alacak
const POPULER_GUN = 30;    // kac gunluk pencereye bakilacak

const listTypesByPopularity = db.prepare(`
  SELECT t.id, t.name, COALESCE(SUM(r.quantity), 0) AS sales
  FROM cigarette_types t
  LEFT JOIN records r
    ON r.cigarette_type_id = t.id
   AND r.created_at >= @since
   AND r.superseded_by IS NULL
   AND r.cancelled_at IS NULL
  WHERE t.is_active = 1
  GROUP BY t.id, t.name
  ORDER BY sales DESC, t.name COLLATE NOCASE
`);

/** GET /api/waiters  (?all=1 -> pasifler de gelir, admin ekrani icin) */
router.get('/waiters', asyncHandler((req, res) => {
  const rows = req.query.all === '1' ? listAllWaiters.all() : listWaiters.all();
  res.json({ ok: true, waiters: rows });
}));

/** POST /api/waiters - yeni garson (admin) */
router.post('/waiters', requireAdmin, asyncHandler((req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ ok: false, error: 'Garson adi bos olamaz.' });
  if (name.length > 60) return res.status(400).json({ ok: false, error: 'Garson adi cok uzun.' });

  try {
    const info = db.prepare('INSERT INTO waiters (name) VALUES (?)').run(name);
    res.status(201).json({ ok: true, waiter: { id: info.lastInsertRowid, name, is_active: 1 } });
  } catch (err) {
    if (String(err.code).includes('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ ok: false, error: 'Bu isimde bir garson zaten var.' });
    }
    throw err;
  }
}));

/** PATCH /api/waiters/:id - aktif/pasif (admin). Gecmis kayitlar korunur. */
router.patch('/waiters/:id', requireAdmin, asyncHandler((req, res) => {
  const id = Number(req.params.id);
  const isActive = req.body.is_active ? 1 : 0;
  const info = db.prepare('UPDATE waiters SET is_active = ? WHERE id = ?').run(isActive, id);
  if (!info.changes) return res.status(404).json({ ok: false, error: 'Garson bulunamadi.' });
  res.json({ ok: true });
}));

/**
 * GET /api/cigarette-types
 *   ?all=1          pasifler de gelir (yonetim ekrani)
 *   ?sort=popular   son 30 gunun satisina gore siralar; ilk 10'a
 *                   popular:true dusulur (satisi olanlar icinde)
 */
router.get('/cigarette-types', asyncHandler((req, res) => {
  if (req.query.sort === 'popular' && req.query.all !== '1') {
    const since = new Date(Date.now() - POPULER_GUN * 86400000).toISOString();
    const rows = listTypesByPopularity.all({ since });

    /* Satisi OLMAYAN tur "populer" sayilmaz: liste 10'dan kisaysa ya da
       hic satis yoksa rozet bosuna dagitilmasin. */
    const types = rows.map((t, i) => ({
      ...t,
      popular: i < POPULER_ADET && t.sales > 0
    }));

    return res.json({
      ok: true,
      types,
      popular: { count: types.filter((t) => t.popular).length, days: POPULER_GUN }
    });
  }

  const rows = req.query.all === '1' ? listAllTypes.all() : listTypes.all();
  res.json({ ok: true, types: rows });
}));

/** DELETE /api/waiters/:id - garsonu tamamen sil (admin).
 *  Gecmis kayitlar bozulmaz: records.waiter_name snapshot olarak tutulur,
 *  waiter_id ise ON DELETE SET NULL ile bosaltilir. */
router.delete('/waiters/:id', requireAdmin, asyncHandler((req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const garson = db.prepare('SELECT name FROM waiters WHERE id = ?').get(id);
  if (!garson) return res.status(404).json({ ok: false, error: 'Garson bulunamadi.' });

  const kayit = db.prepare('SELECT COUNT(*) c FROM records WHERE waiter_id = ?').get(id).c;
  db.prepare('DELETE FROM waiters WHERE id = ?').run(id);

  res.json({ ok: true, deleted: garson.name, affectedRecords: kayit });
}));

/* ------------------------------------------------------------------
   INFO VERENLER — garsonlarla ayni desen.

   Ad once serbest metindi ve ayni kisi farkli yazimlarla boluniyordu.
   Artik kalici tanim listesi: yonetici ekler/siler, sigaraci kayit
   acarken LISTEDEN secer. records.info_by ad snapshot'i olarak kalir,
   bu yuzden kisi silinse de arsiv bozulmaz.
   ------------------------------------------------------------------ */
const listInfoProviders = db.prepare(
  'SELECT id, name, is_active FROM info_providers ORDER BY name COLLATE NOCASE'
);

/** GET /api/info-providers - kayit formu ve suzgecler icin */
router.get('/info-providers', asyncHandler((req, res) => {
  res.json({ ok: true, providers: listInfoProviders.all() });
}));

/** POST /api/info-providers - yeni kisi (admin) */
router.post('/info-providers', requireAdmin, asyncHandler((req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ ok: false, error: 'Isim bos olamaz.' });
  if (name.length > 60) return res.status(400).json({ ok: false, error: 'Isim cok uzun.' });

  try {
    const info = db.prepare('INSERT INTO info_providers (name) VALUES (?)').run(name);
    res.status(201).json({ ok: true, provider: { id: info.lastInsertRowid, name, is_active: 1 } });
  } catch (err) {
    if (String(err.code).includes('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ ok: false, error: 'Bu isim zaten kayitli.' });
    }
    throw err;
  }
}));

/** PATCH /api/info-providers/:id - adi degistir (admin).
 *  Gecmis kayitlardaki ad snapshot'i DEGISMEZ: o kayit acilirken gecerli
 *  olan ad neyse arsivde o kalir. */
router.patch('/info-providers/:id', requireAdmin, asyncHandler((req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ ok: false, error: 'Isim bos olamaz.' });
  if (name.length > 60) return res.status(400).json({ ok: false, error: 'Isim cok uzun.' });

  try {
    const info = db.prepare('UPDATE info_providers SET name = ? WHERE id = ?').run(name, id);
    if (!info.changes) return res.status(404).json({ ok: false, error: 'Kisi bulunamadi.' });
    res.json({ ok: true, provider: { id, name } });
  } catch (err) {
    if (String(err.code).includes('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ ok: false, error: 'Bu isim zaten kayitli.' });
    }
    throw err;
  }
}));

/** DELETE /api/info-providers/:id - kisiyi sil (admin).
 *  Gecmis kayitlar bozulmaz: records.info_by ad snapshot'i tutulur,
 *  info_by_id ise ON DELETE SET NULL ile bosalir. */
router.delete('/info-providers/:id', requireAdmin, asyncHandler((req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const kisi = db.prepare('SELECT name FROM info_providers WHERE id = ?').get(id);
  if (!kisi) return res.status(404).json({ ok: false, error: 'Kisi bulunamadi.' });

  const kayit = db.prepare('SELECT COUNT(*) c FROM records WHERE info_by_id = ?').get(id).c;
  db.prepare('DELETE FROM info_providers WHERE id = ?').run(id);

  res.json({ ok: true, deleted: kisi.name, affectedRecords: kayit });
}));

/** GET /api/cigarette-types?all=1 - pasifler dahil (yonetim ekrani) */
const listAllTypes = db.prepare('SELECT id, name, is_active FROM cigarette_types ORDER BY is_active DESC, name COLLATE NOCASE');

/** PATCH /api/cigarette-types/:id - aktif/pasif (admin). Gecmis kayitlar korunur. */
router.patch('/cigarette-types/:id', requireAdmin, asyncHandler((req, res) => {
  const id = Number(req.params.id);
  const isActive = req.body.is_active ? 1 : 0;
  const info = db.prepare('UPDATE cigarette_types SET is_active = ? WHERE id = ?').run(isActive, id);
  if (!info.changes) return res.status(404).json({ ok: false, error: 'Sigara turu bulunamadi.' });
  res.json({ ok: true });
}));

/** POST /api/cigarette-types (admin) */
router.post('/cigarette-types', requireAdmin, asyncHandler((req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ ok: false, error: 'Sigara turu bos olamaz.' });
  try {
    const info = db.prepare('INSERT INTO cigarette_types (name) VALUES (?)').run(name);
    res.status(201).json({ ok: true, type: { id: info.lastInsertRowid, name } });
  } catch (err) {
    if (String(err.code).includes('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ ok: false, error: 'Bu sigara turu zaten kayitli.' });
    }
    throw err;
  }
}));

/** DELETE /api/cigarette-types/:id - sigara turunu sil (admin).
 *  Stok karti ve hareket gecmisindeki bagi da kopar; arsivdeki tur adi kalir. */
router.delete('/cigarette-types/:id', requireAdmin, asyncHandler((req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const tur = db.prepare('SELECT name, stock FROM cigarette_types WHERE id = ?').get(id);
  if (!tur) return res.status(404).json({ ok: false, error: 'Sigara turu bulunamadi.' });

  const kayit = db.prepare('SELECT COUNT(*) c FROM records WHERE cigarette_type_id = ?').get(id).c;
  db.prepare('DELETE FROM cigarette_types WHERE id = ?').run(id);

  res.json({ ok: true, deleted: tur.name, lostStock: tur.stock, affectedRecords: kayit });
}));

module.exports = router;
