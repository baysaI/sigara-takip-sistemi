/**
 * MODUL 9 — Gun sonu raporu.
 *
 * Secilen donem icin:
 *   · Toplam dagitilan sigara (marka bazli)
 *   · Garson bazli dagilim
 *   · Sigaraci bazli islem dokumu
 *   · Sigara degisimleri
 *   · Kalan stok raporu
 *   · Ozel onay/uyari mekanizmasina takilan islemler
 *
 * DONEM KAVRAMI: gun artik saat 06:00'da degil, gun sonu raporu ALINDIGINDA
 * degisir (POST /close). Acik donem son kapanistan simdiye kadardir.
 *
 * Degistirilmis kayitlar (superseded_by dolu) toplamlarda SAYILMAZ; arsivde
 * durur ama gecerli olan yerine gecen kayittir. Aksi halde bir sigara
 * degisimi dagitilan paketi iki kat gosterirdi.
 */
'use strict';

const express = require('express');
const { db } = require('../db/database');
const { requireAuth, requireAdmin, asyncHandler } = require('../middleware/auth');
const { listStock, stockSummary } = require('../services/stock');
const { LEVEL_LABELS } = require('../services/flags');
const {
  openPeriod, closedPeriods, closedCount, periodById, periodByKey,
  periodsBetween, closeDay
} = require('../services/businessDay');
const { buildReconciliation, saveCounts } = require('../services/reconciliation');
const { exchangesInRange } = require('../services/exchange');
const { cancellationsInRange } = require('../services/cancellation');

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);   // gun sonu raporu yalnizca yoneticiye

/**
 * Raporun toplamlarina hangi kayitlar girer.
 *
 *   superseded_by IS NULL   Degistirilmis kayit sayilmaz; gecerli olan
 *                           yerine gecen kayittir.
 *
 *   cancelled_at IS NULL    Iptal edilen satis sayilmaz...
 *   OR cancel_late = 1      ...AMA gec iptal edilmisse sayilir.
 *
 * Gec iptal (satis donemi kapandiktan sonra yapilan iptal) kapanmis
 * gunun raporunu DEGISTIRMEZ: o gun sigara gercekten satilmisti. Iade
 * cari doneme duzeltme olarak duser. Kapanmis raporun sayilarini geriye
 * donuk oynatmak "gun kapandi" kavramini anlamsizlastirirdi.
 * Ayrinti: services/cancellation.js
 */
const AKTIF = 'superseded_by IS NULL AND (cancelled_at IS NULL OR cancel_late = 1)';

/**
 * Rapor kapsamini cozer.
 *   ?closure=<id>       belirli bir kapanmis donem
 *   ?dayKey=YYYY-MM-DD  etikete gore donem
 *   ?from=&to=          takvim araligi (birden cok donem birlestirilir)
 *   (bos)               acik donem
 */
function resolveScope(query) {
  if (query.closure) {
    const p = periodById(query.closure);
    if (!p) return null;
    return { from: p.from, to: p.to, period: p, periods: [p] };
  }

  if (query.dayKey) {
    const p = periodByKey(query.dayKey);
    if (!p) return null;
    return { from: p.from, to: p.to, period: p, periods: [p] };
  }

  if (query.from || query.to) {
    const r = periodsBetween(query.from, query.to);
    if (!r) return null;
    return { from: r.from, to: r.to, period: null, periods: r.periods };
  }

  const acik = openPeriod();
  return { from: acik.from, to: acik.to, period: acik, periods: [acik] };
}

/** Kapsam bulunamadiginda ortak yanit. */
function bosKapsam(res) {
  return res.status(404).json({
    ok: false,
    error: 'Seçilen aralıkta kapanmış bir gün bulunamadı. Gün sonu raporu alınmamış olabilir.'
  });
}

/** GET /api/reports/daily */
router.get('/daily', asyncHandler((req, res) => {
  const kapsam = resolveScope(req.query);
  if (!kapsam) return bosKapsam(res);

  const { from, to } = kapsam;
  const p = { from, to };

  /* --- Genel ozet --- */
  const ozet = db.prepare(`
    SELECT COUNT(*) AS islem,
           COALESCE(SUM(quantity), 0) AS paket,
           COUNT(DISTINCT player_id) AS oyuncu,
           COUNT(DISTINCT waiter_name) AS garson,
           COUNT(DISTINCT username) AS sigaraci
    FROM records WHERE created_at BETWEEN @from AND @to AND ${AKTIF}
  `).get(p);

  /* --- Marka bazli dagitim --- */
  const markalar = db.prepare(`
    SELECT cigarette_type AS name,
           COUNT(*) AS islem,
           COALESCE(SUM(quantity), 0) AS paket
    FROM records WHERE created_at BETWEEN @from AND @to AND ${AKTIF}
    GROUP BY cigarette_type
    ORDER BY paket DESC, name COLLATE NOCASE
  `).all(p);

  /* --- Garson bazli dagilim --- */
  const garsonlar = db.prepare(`
    SELECT waiter_name AS name,
           COUNT(*) AS islem,
           COALESCE(SUM(quantity), 0) AS paket,
           COUNT(DISTINCT player_id) AS oyuncu
    FROM records WHERE created_at BETWEEN @from AND @to AND ${AKTIF}
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
    FROM records WHERE created_at BETWEEN @from AND @to AND ${AKTIF}
    GROUP BY username
    ORDER BY islem DESC, name COLLATE NOCASE
  `).all(p);

  /* --- Ozel onay/uyari ile gecen islemler (Modul 7) --- */
  const onaylilar = db.prepare(`
    SELECT id, player_id, cigarette_type, quantity, waiter_name, username,
           flag_level, flag_note, approved_by, approval_note, created_at
    FROM records
    WHERE created_at BETWEEN @from AND @to AND ${AKTIF} AND flag_level IS NOT NULL
    ORDER BY created_at DESC
  `).all(p).map((r) => ({ ...r, flag_label: LEVEL_LABELS[r.flag_level] || r.flag_level }));

  /* --- Erken alimlar: 4 saat dolmadan yetkili onayiyla verilenler --- */
  const erkenler = db.prepare(`
    SELECT id, player_id, cigarette_type, quantity, waiter_name, username,
           early_remaining_ms, early_approved_by, early_note, created_at
    FROM records
    WHERE created_at BETWEEN @from AND @to AND ${AKTIF} AND early_release = 1
    ORDER BY created_at DESC
  `).all(p);

  /* --- Sigara degisimleri --- */
  const degisimler = exchangesInRange(from, to);

  /* --- Tek seferlik ("liste disi") sigaralar ---
     Stok karti olmadigi icin mutabakat tablosunda SATIRI YOKTUR ama
     dagitilan paket toplamina girerler. Iki sayi arasindaki farkin
     nedeni budur; arayuz bunu mutabakatin altinda acikca yazar. */
  const ozelTurler = db.prepare(`
    SELECT cigarette_type AS name,
           COUNT(*) AS islem,
           COALESCE(SUM(quantity), 0) AS paket
    FROM records
    WHERE created_at BETWEEN @from AND @to AND ${AKTIF} AND custom_type = 1
    GROUP BY cigarette_type
    ORDER BY paket DESC, name COLLATE NOCASE
  `).all(p);

  /* --- Bu donemde YAPILAN iptaller ---
     Gec iptaller de burada gorunur: satis baska bir gune ait olsa da
     iade bu donemde islenmistir (sale_day_key farkli olur). */
  const iptaller = cancellationsInRange(from, to);

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
    period: kapsam.period,
    periods: kapsam.periods,
    summary: {
      islem: ozet.islem,
      paket: ozet.paket,
      oyuncu: ozet.oyuncu,
      garson: ozet.garson,
      sigaraci: ozet.sigaraci,
      onayli: onaylilar.length,
      erken: erkenler.length,
      degisim: degisimler.length,
      // Geri alinmis iptaller sayilari sismesin: islem o donemde
      // yapildi ama sonucu ortadan kalkti. Listede izleri kalir.
      iptal: iptaller.filter((x) => !x.reverted_at).length,
      iptalPaket: iptaller.reduce((t, x) => t + (x.reverted_at ? 0 : x.quantity), 0),
      iptalGeriAlinan: iptaller.filter((x) => x.reverted_at).length,
      ozelIslem: ozelTurler.reduce((t, x) => t + x.islem, 0),
      ozelPaket: ozelTurler.reduce((t, x) => t + x.paket, 0),
      stokGiris: stokHareket.giris,
      stokCikis: stokHareket.cikis
    },
    brands: markalar,
    waiters: garsonlar,
    operators: sigaracilar,
    approvals: onaylilar,
    earlyReleases: erkenler,
    exchanges: degisimler,
    cancellations: iptaller,
    customTypes: ozelTurler,
    restocks: ikmaller,
    // Kalan stok raporu her zaman ANLIK durumu gosterir
    stock: { cards: listStock(), summary: stockSummary() },
    generatedAt: new Date().toISOString()
  });
}));

/* ------------------------------------------------------------------ */
/* GET /api/reports/closures - kapanmis gunlerin listesi               */
/* ------------------------------------------------------------------ */
router.get('/closures', asyncHandler((req, res) => {
  const limit = Number.parseInt(req.query.limit, 10) || 60;
  res.json({
    ok: true,
    open: openPeriod(),
    closures: closedPeriods({ limit }),
    total: closedCount()
  });
}));

/* ------------------------------------------------------------------ */
/* POST /api/reports/close — GUN SONU RAPORUNU AL                      */
/*                                                                     */
/* Raporun alinmasi ile gun degisimi AYNI islemdir: bu cagri acik      */
/* donemi kapatir, yeni donem tam o an baslar. Raporu yalnizca         */
/* goruntulemek (GET /daily) gunu KAPATMAZ.                            */
/*                                                                     */
/* Govde: { note?: string, allowEmpty?: boolean }                      */
/* ------------------------------------------------------------------ */
router.post('/close', asyncHandler((req, res) => {
  const note = String(req.body.note || '').trim() || null;
  if (note && note.length > 255) {
    return res.status(400).json({ ok: false, error: 'Kapanış notu en fazla 255 karakter olabilir.' });
  }

  const kapanan = closeDay({
    user: req.session.user,
    note,
    allowEmpty: req.body.allowEmpty === true
  });

  res.status(201).json({
    ok: true,
    closed: kapanan,
    next: openPeriod(),
    reconciliation: buildReconciliation(kapanan)
  });
}));

/* ------------------------------------------------------------------ */
/* GET /api/reports/reconciliation?dayKey=|closure=                    */
/* Gun sonu stok mutabakati: DEVIR / GIRIS / TUKETIM / KALAN / SAYIM   */
/* ------------------------------------------------------------------ */
router.get('/reconciliation', asyncHandler((req, res) => {
  const kapsam = resolveScope(req.query);
  if (!kapsam) return bosKapsam(res);

  // Mutabakat her zaman TEK donem icindir; aralik secilmisse sonuncusu alinir.
  const donem = kapsam.period || kapsam.periods[kapsam.periods.length - 1];
  res.json({ ok: true, ...buildReconciliation(donem) });
}));

/* ------------------------------------------------------------------ */
/* POST /api/reports/counts - fiziksel sayimi kaydet                   */
/* Govde: { dayKey?: string, counts: [{type_id, counted}, ...] }        */
/* dayKey verilmezse acik doneme yazilir.                              */
/* ------------------------------------------------------------------ */
router.post('/counts', asyncHandler((req, res) => {
  const donem = req.body.dayKey ? periodByKey(String(req.body.dayKey)) : openPeriod();
  if (!donem) {
    return res.status(404).json({ ok: false, error: 'Sayımın yazılacağı dönem bulunamadı.' });
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

  const sonuc = saveCounts({ period: donem, counts, user: req.session.user });
  res.json({ ok: true, ...sonuc, ...buildReconciliation(donem) });
}));

/* ------------------------------------------------------------------ */
/* GET /api/reports/reconciliation.csv?dayKey=  - Excel'e aktar        */
/* ------------------------------------------------------------------ */
router.get('/reconciliation.csv', asyncHandler((req, res) => {
  const kapsam = resolveScope(req.query);
  if (!kapsam) return bosKapsam(res);

  const donem = kapsam.period || kapsam.periods[kapsam.periods.length - 1];
  const rapor = buildReconciliation(donem);

  // Turkce Excel noktali virgul bekler; ondalik ayraci virguldur.
  const sayi = (n) => String(n ?? '').replace('.', ',');
  const alan = (v) => {
    const s = String(v ?? '');
    return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const baslik = rapor.closed
    ? `GUN SONU STOK MUTABAKATI - ${rapor.day} (kapandi: ${rapor.period.closedAt})`
    : `GUN SONU STOK MUTABAKATI - ${rapor.day} (ACIK DONEM - henuz kapatilmadi)`;

  const satirlar = [
    [baslik],
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

  // Dosya adinda '#' olmasin (URL'de sorun cikarir)
  const adGuvenli = String(rapor.day).replace(/#/g, '-');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sigara-sayim-${adGuvenli}.csv"`);
  res.send('﻿' + csv);   // BOM: Excel Turkce karakterleri dogru acsin
}));

module.exports = router;
