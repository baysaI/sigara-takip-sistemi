/**
 * MODUL 7 — Oyuncu uyari / onay kayitlarinin yonetimi.
 * Okuma tum kullanicilara acik (sigaraci uyariyi gormeli),
 * yazma yalnizca yoneticiye.
 */
'use strict';

const express = require('express');
const { db } = require('../db/database');
const { requireAuth, requireAdmin, asyncHandler } = require('../middleware/auth');
const { getFlag, upsertFlag, LEVELS, LEVEL_LABELS } = require('../services/flags');
const { normalizePlayerId } = require('../services/cooldown');

const router = express.Router();
router.use(requireAuth);

/** GET /api/flags - tanimli tum uyarilar */
router.get('/', asyncHandler((req, res) => {
  const sadeceAktif = req.query.all !== '1';
  const rows = db.prepare(`
    SELECT * FROM player_flags
    ${sadeceAktif ? 'WHERE is_active = 1' : ''}
    ORDER BY
      CASE level WHEN 'blocked' THEN 0 WHEN 'approval' THEN 1 ELSE 2 END,
      player_id
  `).all();

  res.json({
    ok: true,
    flags: rows.map((f) => ({ ...f, label: LEVEL_LABELS[f.level] })),
    levels: LEVELS
  });
}));

/** GET /api/flags/:playerId - tek oyuncunun aktif uyarisi */
router.get('/:playerId', asyncHandler((req, res) => {
  res.json({ ok: true, flag: getFlag(req.params.playerId) });
}));

/** POST /api/flags - uyari olustur / guncelle (admin) */
router.post('/', asyncHandler((req, res) => {
  const playerId = normalizePlayerId(req.body.player_id);
  const level = String(req.body.level || '').trim();
  const note = String(req.body.note || '').trim();

  if (!playerId) return res.status(400).json({ ok: false, error: 'Oyuncu ID zorunludur.' });
  if (playerId.length > 40) return res.status(400).json({ ok: false, error: 'Oyuncu ID cok uzun.' });
  if (!LEVELS.includes(level)) {
    return res.status(400).json({ ok: false, error: 'Gecersiz uyari seviyesi.' });
  }
  if (note.length < 3) {
    return res.status(400).json({ ok: false, error: 'Uyari notu en az 3 karakter olmalidir.' });
  }
  if (note.length > 500) {
    return res.status(400).json({ ok: false, error: 'Uyari notu en fazla 500 karakter olabilir.' });
  }

  const flag = upsertFlag({ playerId, level, note, username: req.session.user.username });
  res.status(201).json({ ok: true, flag: { ...flag, label: LEVEL_LABELS[flag.level] } });
}));

/** PATCH /api/flags/:id - uyariyi kaldir / geri getir (admin) */
router.patch('/:id', asyncHandler((req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const isActive = req.body.is_active ? 1 : 0;

  const info = db.prepare(
    'UPDATE player_flags SET is_active = ?, updated_by = ?, updated_at = ? WHERE id = ?'
  ).run(isActive, req.session.user.username, new Date().toISOString(), id);

  if (!info.changes) return res.status(404).json({ ok: false, error: 'Uyari kaydi bulunamadi.' });
  res.json({ ok: true });
}));

/** DELETE /api/flags/:id - uyari kaydini tamamen sil (admin) */
router.delete('/:id', asyncHandler((req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const flag = db.prepare('SELECT player_id FROM player_flags WHERE id = ?').get(id);
  if (!flag) return res.status(404).json({ ok: false, error: 'Uyari kaydi bulunamadi.' });

  db.prepare('DELETE FROM player_flags WHERE id = ?').run(id);
  res.json({ ok: true, deleted: flag.player_id });
}));

module.exports = router;
