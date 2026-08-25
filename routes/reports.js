/**
 * MODUL 9 — Gun sonu raporu.
 *
 * Secilen tarih araligi icin:
 *   · Toplam dagitilan sigara (marka bazli)
 *   · Garson bazli dagilim
 *   · Sigaraci bazli islem dokumu
 *   · Kalan stok raporu
 *   · Ozel onay/uyari mekanizmasina takilan islemler
 *
 * from/to ISO tarih-saat olarak gelir; frontend yerel gun sinirlarini
 * ISO'ya cevirip gonderir (bkz. localDateToISO).
 */
'use strict';

const express = require('express');
const { db } = require('../db/database');
const { requireAuth, requireAdmin, asyncHandler } = require('../middleware/auth');
const { listStock, stockSummary } = require('../services/stock');
const { LEVEL_LABELS } = require('../services/flags');

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);   // gun sonu raporu yalnizca yoneticiye

/** Aralik verilmediyse bugunun tamamini (sunucu yerel gunu) kullan. */
function resolveRange(query) {
  if (query.from || query.to) {
    return {
      from: String(query.from || '1970-01-01T00:00:00.000Z'),
      to: String(query.to || new Date().toISOString())
    };
  }
  const now = new Date();
  const bas = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const son = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { from: bas.toISOString(), to: son.toISOString() };
}

/** GET /api/reports/daily?from=&to= */
router.get('/daily', asyncHandler((req, res) => {
  const { from, to } = resolveRange(req.query);
  const p = { from, to };

  /* --- Genel ozet --- */
  const ozet = db.prepare(`
    SELECT COUNT(*) AS islem,
           COALESCE(SUM(quantity), 0) AS paket,
           COUNT(DISTINCT player_id) AS oyuncu,
           COUNT(DISTINCT waiter_name) AS garson,
           COUNT(DISTINCT username) AS sigaraci
    FROM records WHERE created_at BETWEEN @from AND @to
  `).get(p);

  /* --- Marka bazli dagitim --- */
  const markalar = db.prepare(`
    SELECT cigarette_type AS name,
           COUNT(*) AS islem,
           COALESCE(SUM(quantity), 0) AS paket
    FROM records WHERE created_at BETWEEN @from AND @to
    GROUP BY cigarette_type
    ORDER BY paket DESC, name COLLATE NOCASE
  `).all(p);

  /* --- Garson bazli dagilim --- */
  const garsonlar = db.prepare(`
    SELECT waiter_name AS name,
           COUNT(*) AS islem,
           COALESCE(SUM(quantity), 0) AS paket,
           COUNT(DISTINCT player_id) AS oyuncu
    FROM records WHERE created_at BETWEEN @from AND @to
    GROUP BY waiter_name
    ORDER BY paket DESC, name COLLATE NOCASE
  `).all(p);

  /* --- Sigaraci bazli islem dokumu --- */
  const sigaracilar = db.prepare(`
    SELECT username AS name,
           COUNT(*) AS islem,
           COALESCE(SUM(quantity), 0) AS paket,
           MIN(created_at) AS ilk,
           MAX(created_at) AS son
    FROM records WHERE created_at BETWEEN @from AND @to
    GROUP BY username
    ORDER BY islem DESC, name COLLATE NOCASE
  `).all(p);

  /* --- Ozel onay/uyari ile gecen islemler (Modul 7) --- */
  const onaylilar = db.prepare(`
    SELECT id, player_id, cigarette_type, quantity, waiter_name, username,
           flag_level, flag_note, approved_by, approval_note, created_at
    FROM records
    WHERE created_at BETWEEN @from AND @to AND flag_level IS NOT NULL
    ORDER BY created_at DESC
  `).all(p).map((r) => ({ ...r, flag_label: LEVEL_LABELS[r.flag_level] || r.flag_level }));

  /* --- Erken alimlar: 4 saat dolmadan yetkili onayiyla verilenler --- */
  const erkenler = db.prepare(`
    SELECT id, player_id, cigarette_type, quantity, waiter_name, username,
           early_remaining_ms, early_approved_by, early_note, created_at
    FROM records
    WHERE created_at BETWEEN @from AND @to AND early_release = 1
    ORDER BY created_at DESC
  `).all(p);

  /* --- Donem icindeki stok hareketleri --- */
  const stokHareket = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0) AS giris,
      COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END), 0) AS cikis
    FROM stock_movements WHERE created_at BETWEEN @from AND @to
  `).get(p);

  const ikmaller = db.prepare(`
    SELECT type_name, SUM(delta) AS miktar, COUNT(*) AS hareket
    FROM stock_movements
    WHERE created_at BETWEEN @from AND @to AND reason = 'ikmal'
    GROUP BY type_name ORDER BY miktar DESC
  `).all(p);

  res.json({
    ok: true,
    range: { from, to },
    summary: {
      islem: ozet.islem,
      paket: ozet.paket,
      oyuncu: ozet.oyuncu,
      garson: ozet.garson,
      sigaraci: ozet.sigaraci,
      onayli: onaylilar.length,
      erken: erkenler.length,
      stokGiris: stokHareket.giris,
      stokCikis: stokHareket.cikis
    },
    brands: markalar,
    waiters: garsonlar,
    operators: sigaracilar,
    approvals: onaylilar,
    earlyReleases: erkenler,
    restocks: ikmaller,
    // Kalan stok raporu her zaman ANLIK durumu gosterir
    stock: { cards: listStock(), summary: stockSummary() },
    generatedAt: new Date().toISOString()
  });
}));

module.exports = router;
