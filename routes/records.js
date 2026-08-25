'use strict';

const express = require('express');
const { db } = require('../db/database');
const { requireAuth, requireAdmin, asyncHandler } = require('../middleware/auth');
const { getCooldownStatus, normalizePlayerId } = require('../services/cooldown');
const { getFlag, checkApproval } = require('../services/flags');
const { applyMovement, typeByNameStmt } = require('../services/stock');
const { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, COOLDOWN_HOURS } = require('../config');

const router = express.Router();
router.use(requireAuth);

const waiterByIdStmt = db.prepare('SELECT id, name FROM waiters WHERE id = ? AND is_active = 1');

const insertRecordStmt = db.prepare(`
  INSERT INTO records
    (player_id, cigarette_type, cigarette_type_id, quantity, waiter_id, waiter_name,
     user_id, username, info, created_at, flag_level, flag_note, approved_by, approval_note,
     early_release, early_remaining_ms, early_approved_by, early_note)
  VALUES
    (@player_id, @cigarette_type, @cigarette_type_id, @quantity, @waiter_id, @waiter_name,
     @user_id, @username, @info, @created_at, @flag_level, @flag_note, @approved_by, @approval_note,
     @early_release, @early_remaining_ms, @early_approved_by, @early_note)
`);

const recordByIdStmt = db.prepare('SELECT * FROM records WHERE id = ?');

/* ------------------------------------------------------------------ */
/* GET /api/records/check?playerId=XYZ                                 */
/* Oyuncu ID inputuna yazildikca cagrilir (canli 4 saat kontrolu).      */
/* ------------------------------------------------------------------ */
router.get('/check', asyncHandler((req, res) => {
  const playerId = normalizePlayerId(req.query.playerId);
  if (!playerId) {
    return res.status(400).json({ ok: false, error: 'playerId parametresi zorunludur.' });
  }
  // 4 saat kurali yaninda ozel uyari kaydi da dondurulur; sigaraci
  // ID yazar yazmaz durumu gorur (Modul 7).
  res.json({ ok: true, status: getCooldownStatus(playerId), flag: getFlag(playerId) });
}));

/* ------------------------------------------------------------------ */
/* POST /api/records - hizli kayit                                     */
/* ------------------------------------------------------------------ */
router.post('/', asyncHandler((req, res) => {
  const playerId = normalizePlayerId(req.body.player_id);
  const cigaretteType = String(req.body.cigarette_type || '').trim();
  const quantity = Number.parseInt(req.body.quantity, 10);
  const waiterId = Number.parseInt(req.body.waiter_id, 10);
  const info = String(req.body.info || '').trim() || null;

  // --- Zorunlu alan dogrulamalari ---
  const errors = [];
  if (!playerId) errors.push('Oyuncu ID zorunludur.');
  else if (playerId.length > 40) errors.push('Oyuncu ID en fazla 40 karakter olabilir.');
  if (!cigaretteType) errors.push('Sigara turu zorunludur.');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    errors.push('Adet 1-100 arasinda bir tam sayi olmalidir.');
  }
  if (!Number.isInteger(waiterId)) errors.push('Alan garson secilmelidir.');
  if (info && info.length > 255) errors.push('Info alani en fazla 255 karakter olabilir.');

  if (errors.length) {
    return res.status(400).json({ ok: false, error: errors.join(' ') });
  }

  const waiter = waiterByIdStmt.get(waiterId);
  if (!waiter) {
    return res.status(400).json({ ok: false, error: 'Secilen garson gecersiz veya pasif durumda.' });
  }

  /* --- 4 SAAT KURALI ---
     Sure dolmadiysa kayit dogrudan reddedilmez: yuksek oynama miktariyla
     hak kazanan oyuncular icin yetkili onayiyla erken alim yapilabilir.
     Onay yoksa 409, onaylayan adi eksikse 428 doner. */
  const status = getCooldownStatus(playerId);
  let early = null;

  if (!status.allowed) {
    const onaylandi = req.body.early_approved === true;
    const onaylayan = String(req.body.early_approved_by || '').trim();

    if (!onaylandi) {
      return res.status(409).json({
        ok: false,
        error: `${playerId} icin ${COOLDOWN_HOURS} saat kurali dolmadi.`,
        status,
        canOverride: true            // arayuz onay ekrani acabilir
      });
    }
    if (onaylayan.length < 2) {
      return res.status(428).json({
        ok: false,
        error: 'Erken alim icin onayi veren yetkilinin adi girilmelidir.',
        status,
        canOverride: true
      });
    }
    if (onaylayan.length > 60) {
      return res.status(400).json({ ok: false, error: 'Onaylayan adi cok uzun.' });
    }

    const not = String(req.body.early_note || '').trim();
    if (not.length > 255) {
      return res.status(400).json({ ok: false, error: 'Erken alim notu en fazla 255 karakter olabilir.' });
    }

    early = { remainingMs: status.remainingMs, by: onaylayan, note: not || null };
  }

  // --- MODUL 7: ozel uyari / onay kontrolu ---
  // 4 saat dolmus ve yesil yaniyor olsa bile burada durdurulabilir.
  const onay = checkApproval(playerId, {
    approved: req.body.approved === true,
    approved_by: req.body.approved_by,
    approval_note: req.body.approval_note
  });

  if (!onay.ok) {
    return res.status(onay.status).json({
      ok: false, error: onay.error, flag: onay.flag, status, requiresApproval: true
    });
  }

  // --- MODUL 8: stok kontrolu ---
  const type = typeByNameStmt.get(cigaretteType);
  if (!type || !type.is_active) {
    return res.status(400).json({ ok: false, error: 'Secilen sigara turu gecersiz veya pasif durumda.' });
  }
  if (type.stock < quantity) {
    return res.status(409).json({
      ok: false,
      error: `${type.name} stogu yetersiz. Mevcut: ${type.stock} paket, istenen: ${quantity} paket.`,
      stock: { name: type.name, available: type.stock, requested: quantity }
    });
  }

  const created_at = new Date().toISOString();
  const flag = onay.flag;

  /* Kayit ve stok dususu tek transaction: biri basarisiz olursa digeri de geri alinir. */
  const kaydet = db.transaction(() => {
    const result = insertRecordStmt.run({
      player_id: playerId,
      cigarette_type: type.name,
      cigarette_type_id: type.id,
      quantity,
      waiter_id: waiter.id,
      waiter_name: waiter.name,
      user_id: req.session.user.id,
      username: req.session.user.username,   // islemi yapan sigaraci otomatik kaydedilir
      info,
      created_at,
      // Modul 7 snapshot'i: uyari sonradan silinse de arsivde kalir
      flag_level: flag ? flag.level : null,
      flag_note: flag ? flag.note : null,
      approved_by: flag ? (String(req.body.approved_by || '').trim() || null) : null,
      approval_note: flag ? (String(req.body.approval_note || '').trim() || null) : null,
      // Erken alim snapshot'i
      early_release: early ? 1 : 0,
      early_remaining_ms: early ? early.remainingMs : null,
      early_approved_by: early ? early.by : null,
      early_note: early ? early.note : null
    });

    const recordId = result.lastInsertRowid;
    const hareket = applyMovement({
      typeId: type.id,
      delta: -quantity,
      reason: 'kayit',
      recordId,
      note: `${playerId} — ${waiter.name}`,
      user: req.session.user
    });

    return { recordId, hareket };
  });

  const { recordId, hareket } = kaydet();

  res.status(201).json({
    ok: true,
    record: recordByIdStmt.get(recordId),
    status: getCooldownStatus(playerId),   // yeni geri sayim durumu
    stock: {
      name: type.name,
      remaining: hareket.balanceAfter,
      state: hareket.state,
      critical: type.critical_level
    },
    early: early ? { remainingMs: early.remainingMs, by: early.by } : null
  });
}));

/* ------------------------------------------------------------------ */
/* GET /api/records - filtreli arsiv                                   */
/* Parametreler: playerId, waiter, type, user, from, to, page, pageSize */
/* from/to: ISO tarih-saat (frontend yerel tarihi ISO'ya cevirir)       */
/* ------------------------------------------------------------------ */
router.get('/', asyncHandler((req, res) => {
  const where = [];
  const params = {};

  if (req.query.playerId) {
    where.push('player_id LIKE @playerId');
    params.playerId = `%${normalizePlayerId(req.query.playerId)}%`;
  }
  if (req.query.waiter) {
    where.push('waiter_name = @waiter');
    params.waiter = String(req.query.waiter).trim();
  }
  if (req.query.type) {
    where.push('cigarette_type = @type');
    params.type = String(req.query.type).trim();
  }
  if (req.query.user) {
    where.push('username = @user');
    params.user = String(req.query.user).trim();
  }
  if (req.query.from) {
    where.push('created_at >= @from');
    params.from = String(req.query.from);
  }
  if (req.query.to) {
    where.push('created_at <= @to');
    params.to = String(req.query.to);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(req.query.pageSize, 10) || DEFAULT_PAGE_SIZE)
  );
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const offset = (page - 1) * pageSize;

  const summary = db.prepare(`
    SELECT COUNT(*) AS total, COALESCE(SUM(quantity), 0) AS totalQuantity
    FROM records ${whereSql}
  `).get(params);

  const rows = db.prepare(`
    SELECT id, player_id, cigarette_type, quantity, waiter_name, username, info, created_at,
           flag_level, approved_by, early_release, early_remaining_ms, early_approved_by
    FROM records
    ${whereSql}
    ORDER BY created_at DESC, id DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit: pageSize, offset });

  res.json({
    ok: true,
    records: rows,
    pagination: {
      page,
      pageSize,
      total: summary.total,
      totalPages: Math.max(1, Math.ceil(summary.total / pageSize))
    },
    summary: { total: summary.total, totalQuantity: summary.totalQuantity },
    serverTime: new Date().toISOString()
  });
}));

/* ------------------------------------------------------------------ */
/* GET /api/records/stats - dashboard ozet kartlari                    */
/* ------------------------------------------------------------------ */
router.get('/stats', asyncHandler((req, res) => {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const cooldownStart = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();

  const last24h = db.prepare(`
    SELECT COUNT(*) AS records, COALESCE(SUM(quantity),0) AS quantity,
           COUNT(DISTINCT player_id) AS players
    FROM records WHERE created_at >= ?
  `).get(dayAgo);

  const activeCooldowns = db.prepare(`
    SELECT COUNT(DISTINCT player_id) AS c FROM records WHERE created_at >= ?
  `).get(cooldownStart).c;

  const topWaiter = db.prepare(`
    SELECT waiter_name, COUNT(*) AS c
    FROM records WHERE created_at >= ?
    GROUP BY waiter_name ORDER BY c DESC LIMIT 1
  `).get(dayAgo);

  res.json({
    ok: true,
    stats: {
      last24hRecords: last24h.records,
      last24hQuantity: last24h.quantity,
      last24hPlayers: last24h.players,
      activeCooldowns,
      topWaiter: topWaiter ? `${topWaiter.waiter_name} (${topWaiter.c})` : '-',
      allTime: db.prepare('SELECT COUNT(*) AS c FROM records').get().c
    }
  });
}));

/* ------------------------------------------------------------------ */
/* DELETE /api/records/:id - kaydi sil (admin)                         */
/* Varsayilan olarak stok iade edilir: yanlis girilen kayit silinince  */
/* sigara da verilmemis sayilir. ?restock=0 ile iade kapatilabilir.    */
/* ------------------------------------------------------------------ */
router.delete('/:id', requireAdmin, asyncHandler((req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const record = recordByIdStmt.get(id);
  if (!record) return res.status(404).json({ ok: false, error: 'Kayit bulunamadi.' });

  const iade = req.query.restock !== '0';
  let stokSonuc = null;

  const sil = db.transaction(() => {
    // Kayda bagli stok hareketinin bagi kopar (kayit gecmisi bozulmasin)
    db.prepare('UPDATE stock_movements SET record_id = NULL WHERE record_id = ?').run(id);
    db.prepare('DELETE FROM records WHERE id = ?').run(id);

    if (iade && record.cigarette_type_id) {
      const tur = db.prepare('SELECT id FROM cigarette_types WHERE id = ?').get(record.cigarette_type_id);
      if (tur) {
        stokSonuc = applyMovement({
          typeId: record.cigarette_type_id,
          delta: record.quantity,
          reason: 'duzeltme',
          note: `Kayit silindi (#${id}, ${record.player_id}) — stok iadesi`,
          user: req.session.user
        });
      }
    }
  });

  sil();

  res.json({
    ok: true,
    deleted: { id, player_id: record.player_id, quantity: record.quantity },
    restocked: stokSonuc ? { type: stokSonuc.type.name, balance: stokSonuc.balanceAfter } : null
  });
}));

module.exports = router;
