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
const { businessDayRange } = require('../services/businessDay');
const { buildReconciliation, saveCounts, dayKey } = require('../services/reconciliation');

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);   // gun sonu raporu yalnizca yoneticiye

/**
 * Aralik verilmediyse icinde bulunulan IS GUNUNU kullan.
 * Gun degisimi gece yarisinda degil DAY_START_HOUR saatinde olur.
 */
function resolveRange(query) {
  if (query.from || query.to) {
    return {
      from: String(query.from || '1970-01-01T00:00:00.000Z'),
      to: String(query.to || new Date().toISOString())
    };
  }
  const { from, to } = businessDayRange();
  return { from, to };
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

/** Gun parametresini (YYYY-MM-DD) o gunun oglenine cevirir; yoksa simdi. */
function gunAni(q) {
  return q.day ? new Date(`${String(q.day)}T12:00:00`) : new Date();
}

/* ------------------------------------------------------------------ */
/* GET /api/reports/reconciliation?day=YYYY-MM-DD                      */
/* Gun sonu stok mutabakati: DEVIR / GIRIS / TUKETIM / KALAN / SAYIM   */
/* ------------------------------------------------------------------ */
router.get('/reconciliation', asyncHandler((req, res) => {
  const an = gunAni(req.query);
  if (Number.isNaN(an.getTime())) {
    return res.status(400).json({ ok: false, error: 'Gecersiz gun formati (YYYY-MM-DD bekleniyor).' });
  }
  res.json({ ok: true, ...buildReconciliation(an) });
}));

/* ------------------------------------------------------------------ */
/* POST /api/reports/counts - fiziksel sayimi kaydet                   */
/* Govde: { day: 'YYYY-MM-DD', counts: [{type_id, counted}, ...] }     */
/* ------------------------------------------------------------------ */
router.post('/counts', asyncHandler((req, res) => {
  const day = String(req.body.day || dayKey(new Date()));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return res.status(400).json({ ok: false, error: 'Gecersiz gun formati (YYYY-MM-DD bekleniyor).' });
  }

  const gelen = Array.isArray(req.body.counts) ? req.body.counts : [];
  const counts = [];
  for (const c of gelen) {
    const typeId = Number.parseInt(c.type_id, 10);
    const counted = Number.parseInt(c.counted, 10);
    if (!Number.isInteger(typeId)) continue;
    if (!Number.isInteger(counted) || counted < 0 || counted > 1000000) {
      return res.status(400).json({ ok: false, error: 'Sayim degeri 0-1000000 arasinda tam sayi olmalidir.' });
    }
    counts.push({ type_id: typeId, counted });
  }

  if (!counts.length) {
    return res.status(400).json({ ok: false, error: 'Kaydedilecek sayim bulunamadi.' });
  }

  const sonuc = saveCounts({ day, counts, user: req.session.user });
  res.json({ ok: true, ...sonuc, ...buildReconciliation(new Date(`${day}T12:00:00`)) });
}));

/* ------------------------------------------------------------------ */
/* GET /api/reports/reconciliation.csv?day=  - Excel'e aktar           */
/* ------------------------------------------------------------------ */
router.get('/reconciliation.csv', asyncHandler((req, res) => {
  const an = gunAni(req.query);
  const rapor = buildReconciliation(an);

  // Turkce Excel noktali virgul bekler; ondalik ayraci virguldur.
  const sayi = (n) => String(n ?? '').replace('.', ',');
  const alan = (v) => {
    const s = String(v ?? '');
    return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const satirlar = [
    [`GUN SONU STOK MUTABAKATI - ${rapor.day}`],
    [],
    ['NO', 'SIGARA ADI', 'DEVIR', 'GIRIS', 'TUKETIM', 'DUZELTME', 'KALAN', 'SAYIM', 'FARK', 'B.FIYAT', 'TUTAR'],
    ...rapor.rows.map((r) => [
      r.no, r.name, r.devir, r.giris, r.tuketim, r.duzeltme, r.kalan,
      r.sayim ?? '', r.fark ?? '', sayi(r.unitPrice), sayi(r.tutar.toFixed(2))
    ]),
    [],
    ['', 'TOPLAM', rapor.totals.devir, rapor.totals.giris, rapor.totals.tuketim,
     rapor.totals.duzeltme, rapor.totals.kalan, '', '', '', sayi(rapor.totals.tutar.toFixed(2))]
  ];

  const csv = satirlar.map((r) => r.map(alan).join(';')).join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sigara-sayim-${rapor.day}.csv"`);
  res.send('﻿' + csv);   // BOM: Excel Turkce karakterleri dogru acsin
}));

module.exports = router;
