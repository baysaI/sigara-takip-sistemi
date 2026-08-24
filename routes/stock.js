/**
 * MODUL 8 — Stok paneli uclari.
 * Goruntuleme tum kullanicilara acik (sigaraci stogu gormeli),
 * ikmal ve duzeltme oturum acmis herkese; kritik esik degisikligi yoneticiye.
 */
'use strict';

const express = require('express');
const { db } = require('../db/database');
const { requireAuth, requireAdmin, asyncHandler } = require('../middleware/auth');
const { listStock, stockSummary, addStock, setStock, recentMovements } = require('../services/stock');

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

/** PATCH /api/stock/:id/critical - kritik esik (admin) */
router.patch('/:id/critical', requireAdmin, asyncHandler((req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const level = Number.parseInt(req.body.critical_level, 10);

  if (!Number.isInteger(level) || level < 0 || level > 10000) {
    return res.status(400).json({ ok: false, error: 'Kritik esik 0-10000 arasinda olmalidir.' });
  }

  const info = db.prepare('UPDATE cigarette_types SET critical_level = ? WHERE id = ?').run(level, id);
  if (!info.changes) return res.status(404).json({ ok: false, error: 'Sigara turu bulunamadi.' });
  res.json({ ok: true });
}));

module.exports = router;
