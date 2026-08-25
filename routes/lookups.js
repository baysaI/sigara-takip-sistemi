/**
 * Form dropdown kaynaklari: garsonlar ve sigara turleri.
 */
'use strict';

const express = require('express');
const { db } = require('../db/database');
const { requireAuth, requireAdmin, asyncHandler } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const listWaiters = db.prepare('SELECT id, name, is_active FROM waiters WHERE is_active = 1 ORDER BY name COLLATE NOCASE');
const listAllWaiters = db.prepare('SELECT id, name, is_active FROM waiters ORDER BY is_active DESC, name COLLATE NOCASE');
const listTypes = db.prepare('SELECT id, name FROM cigarette_types WHERE is_active = 1 ORDER BY name COLLATE NOCASE');

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

/** GET /api/cigarette-types */
router.get('/cigarette-types', asyncHandler((req, res) => {
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
