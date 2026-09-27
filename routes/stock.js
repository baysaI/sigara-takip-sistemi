/**
 * MODUL 8 — Stok paneli uclari.
 * Stok isleri tezgahta yurur: goruntuleme, ikmal, sayim duzeltmesi, toplu
 * giris, birim fiyat ve kritik esik — hepsi oturum acmis her kullaniciya
 * acik. Yonetici ayrimi yok.
 */
'use strict';

const express = require('express');
const { db } = require('../db/database');
const { requireAuth, requireRoot, asyncHandler } = require('../middleware/auth');
const {
  listStock, stockSummary, addStock, setStock, recentMovements, applyMovement
} = require('../services/stock');
const { deleteMovement } = require('../services/silentEdit');

const router = express.Router();
router.use(requireAuth);

/** GET /api/stock - stok kartlari + ozet */
router.get('/', asyncHandler((req, res) => {
  res.json({
    ok: true,
    cards: listStock({ includeInactive: req.query.all === '1' }),
    summary: stockSummary()
  });
}));

/** GET /api/stock/movements - son hareketler */
router.get('/movements', asyncHandler((req, res) => {
  res.json({ ok: true, movements: recentMovements(Number(req.query.limit) || 30) });
}));

/** POST /api/stock/add - ikmal (koli/paket girisi) */
router.post('/add', asyncHandler((req, res) => {
  const typeId = Number.parseInt(req.body.type_id, 10);
  const amount = Number.parseInt(req.body.amount, 10);
  const note = String(req.body.note || '').trim() || null;

  if (!Number.isInteger(typeId)) {
    return res.status(400).json({ ok: false, error: 'Sigara turu secilmelidir.' });
  }
  if (!Number.isInteger(amount) || amount < 1 || amount > 100000) {
    return res.status(400).json({ ok: false, error: 'Eklenecek miktar 1-100000 arasinda olmalidir.' });
  }

  const sonuc = addStock({ typeId, amount, note, user: req.session.user });
  res.status(201).json({
    ok: true,
    type: sonuc.type.name,
    balance: sonuc.balanceAfter,
    state: sonuc.state
  });
}));

/** POST /api/stock/set - sayim duzeltmesi (mevcudu hedef degere getirir) */
router.post('/set', asyncHandler((req, res) => {
  const typeId = Number.parseInt(req.body.type_id, 10);
  const target = Number.parseInt(req.body.target, 10);
  const note = String(req.body.note || '').trim() || null;

  if (!Number.isInteger(typeId)) {
    return res.status(400).json({ ok: false, error: 'Sigara turu secilmelidir.' });
  }
  if (!Number.isInteger(target) || target < 0 || target > 100000) {
    return res.status(400).json({ ok: false, error: 'Hedef miktar 0-100000 arasinda olmalidir.' });
  }

  const sonuc = setStock({ typeId, target, note, user: req.session.user });
  res.json({ ok: true, type: sonuc.type.name, balance: sonuc.balanceAfter, state: sonuc.state });
}));

/** PATCH /api/stock/:id/critical - kritik esik */
router.patch('/:id/critical', asyncHandler((req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const level = Number.parseInt(req.body.critical_level, 10);

  if (!Number.isInteger(level) || level < 0 || level > 10000) {
    return res.status(400).json({ ok: false, error: 'Kritik esik 0-10000 arasinda olmalidir.' });
  }

  const info = db.prepare('UPDATE cigarette_types SET critical_level = ? WHERE id = ?').run(level, id);
  if (!info.changes) return res.status(404).json({ ok: false, error: 'Sigara turu bulunamadi.' });
  res.json({ ok: true });
}));

/** PATCH /api/stock/:id/price - birim fiyat */
router.patch('/:id/price', asyncHandler((req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const price = Number(req.body.unit_price);

  if (!Number.isFinite(price) || price < 0 || price > 1000000) {
    return res.status(400).json({ ok: false, error: 'Birim fiyat 0-1000000 arasinda olmalidir.' });
  }

  const info = db.prepare('UPDATE cigarette_types SET unit_price = ? WHERE id = ?')
    .run(Math.round(price * 100) / 100, id);
  if (!info.changes) return res.status(404).json({ ok: false, error: 'Sigara turu bulunamadi.' });
  res.json({ ok: true });
}));

/**
 * POST /api/stock/prices - toplu birim fiyat
 * Govde: { items: [{ name: 'CAMEL YELLOW', price: 104.65 }, ...] }
 * Ad eslesmesi buyuk/kucuk harf duyarsizdir (COLLATE NOCASE).
 */
router.post('/prices', asyncHandler((req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) {
    return res.status(400).json({ ok: false, error: 'Islenecek satir bulunamadi.' });
  }
  if (items.length > 2000) {
    return res.status(400).json({ ok: false, error: 'Tek seferde en fazla 2000 satir islenebilir.' });
  }

  const bul = db.prepare('SELECT id, name FROM cigarette_types WHERE name = ?');
  const guncelle = db.prepare('UPDATE cigarette_types SET unit_price = ? WHERE id = ?');

  const guncellenen = [];
  const bulunamayan = [];
  const hatali = [];

  db.transaction(() => {
    for (const it of items) {
      const ad = String(it.name || '').trim();
      const fiyat = Number(it.price);

      if (!ad) continue;
      if (!Number.isFinite(fiyat) || fiyat < 0 || fiyat > 1000000) {
        hatali.push(ad);
        continue;
      }

      const tur = bul.get(ad);
      if (!tur) { bulunamayan.push(ad); continue; }

      guncelle.run(Math.round(fiyat * 100) / 100, tur.id);
      guncellenen.push(tur.name);
    }
  })();

  res.json({
    ok: true,
    updated: guncellenen.length,
    notFound: bulunamayan,
    invalid: hatali
  });
}));

/**
 * POST /api/stock/bulk - TOPLU STOK GIRISI
 * Govde: { items: [{ name: 'CAMEL YELLOW', amount: 20 }, ...], mode: 'add'|'set' }
 *
 *   mode='add'  girilen adet mevcut stoga EKLENIR  -> hareket sebebi 'ikmal'
 *   mode='set'  stok girilen adede AYARLANIR       -> hareket sebebi 'duzeltme'
 *
 * Ad eslesmesi buyuk/kucuk harf duyarsizdir (COLLATE NOCASE). Her satir
 * gercek bir stok hareketi yazar; boylece gun sonu mutabakati ve DEVIR
 * hesabi bozulmaz — dogrudan cigarette_types.stock guncellenmez.
 *
 * Tumu TEK transaction: bir satir patlarsa hicbiri islenmez, yarim
 * uygulanmis toplu giris kalmaz.
 */
router.post('/bulk', asyncHandler((req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const mode = req.body.mode === 'set' ? 'set' : 'add';

  if (!items.length) {
    return res.status(400).json({ ok: false, error: 'Islenecek satir bulunamadi.' });
  }
  if (items.length > 2000) {
    return res.status(400).json({ ok: false, error: 'Tek seferde en fazla 2000 satir islenebilir.' });
  }

  const bul = db.prepare('SELECT id, name, stock FROM cigarette_types WHERE name = ?');

  const islenen = [];
  const bulunamayan = [];
  const hatali = [];

  db.transaction(() => {
    for (const it of items) {
      const ad = String(it.name || '').trim();
      const adet = Number(it.amount);

      if (!ad) continue;
      if (!Number.isInteger(adet) || adet < 0 || adet > 1000000) {
        hatali.push(ad);
        continue;
      }

      const tur = bul.get(ad);
      if (!tur) { bulunamayan.push(ad); continue; }

      const delta = mode === 'set' ? adet - tur.stock : adet;
      if (delta === 0) { islenen.push({ name: tur.name, delta: 0, balance: tur.stock }); continue; }

      const h = applyMovement({
        typeId: tur.id,
        delta,
        reason: mode === 'set' ? 'duzeltme' : 'ikmal',
        note: mode === 'set'
          ? `Toplu stok ayari: ${tur.stock} -> ${adet}`
          : `Toplu ikmal: +${adet}`,
        user: req.session.user
      });

      islenen.push({ name: tur.name, delta, balance: h.balanceAfter });
    }
  })();

  res.json({
    ok: true,
    mode,
    updated: islenen.length,
    items: islenen,
    notFound: bulunamayan,
    invalid: hatali,
    summary: stockSummary()
  });
}));

/* ------------------------------------------------------------------ */
/* DELETE /api/stock/movements/:id — HAREKETI IZ BIRAKMADAN SIL        */
/*                                                                     */
/* YALNIZCA KOK HESAP. Stok paneli normalde hicbir hareketi silmez;    */
/* yanlis girilen ikmal "duzeltme" satiriyla dengelenir ve ikisi de    */
/* gecmiste durur. Burada satir tamamen kalkar, yerine yeni satir      */
/* YAZILMAZ: sonraki bakiyeler ve stok karti sessizce kaydirilir       */
/* (ayrinti: services/silentEdit.js -> deleteMovement).                */
/* ------------------------------------------------------------------ */
router.delete('/movements/:id', requireRoot, asyncHandler((req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ ok: false, error: 'Gecersiz hareket kimligi.' });
  }

  const sonuc = deleteMovement({ movementId: id });
  res.json({ ok: true, ...sonuc, summary: stockSummary() });
}));

module.exports = router;
