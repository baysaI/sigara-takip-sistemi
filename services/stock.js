/**
 * MODUL 8 — Stok yonetimi.
 *
 * Her sigara turu bir stok kartidir. Kayit acildiginda verilen adet kadar
 * stok otomatik duser; ikmal girilince eklenir. Her hareket stock_movements
 * tablosuna yazilir, boylece bakiye her an gecmisten dogrulanabilir.
 *
 * Onemli: stok dususu kayit ekleme ile AYNI transaction icinde yapilir
 * (routes/records.js). Kayit basarisiz olursa stok da dusmez.
 */
'use strict';

const { db } = require('../db/database');

const moveStmt = db.prepare(`
  INSERT INTO stock_movements
    (type_id, type_name, delta, balance_after, reason, record_id, note, user_id, username, created_at)
  VALUES
    (@type_id, @type_name, @delta, @balance_after, @reason, @record_id, @note, @user_id, @username, @created_at)
`);

const typeByIdStmt = db.prepare('SELECT id, name, stock, critical_level, is_active FROM cigarette_types WHERE id = ?');
const typeByNameStmt = db.prepare('SELECT id, name, stock, critical_level, is_active FROM cigarette_types WHERE name = ?');

/** Stok durumu etiketi: kritik esigin altinda mi, tukendi mi? */
function stockState(stock, critical) {
  if (stock <= 0) return 'out';        // tukendi
  if (stock <= critical) return 'critical';
  return 'ok';
}

/**
 * Tum stok kartlari (Stok Paneli listesi).
 *
 * Her kart, o turun SON stok hareketini de tasir: kim, ne zaman, ne kadar.
 * "Bu stogu kim ekledi" sorusunun cevabi hareket gecmisini tarayarak
 * degil, karta bakarak bulunsun diye.
 */
function listStock({ includeInactive = false } = {}) {
  const rows = db.prepare(`
    SELECT t.id, t.name, t.stock, t.critical_level, t.is_active, t.unit_price,
           m.username   AS last_by,
           m.created_at AS last_at,
           m.delta      AS last_delta,
           m.reason     AS last_reason,
           m.note       AS last_note
    FROM cigarette_types t
    LEFT JOIN stock_movements m ON m.id = (
      SELECT id FROM stock_movements
      WHERE type_id = t.id
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    )
    ${includeInactive ? '' : 'WHERE t.is_active = 1'}
    ORDER BY t.name COLLATE NOCASE
  `).all();

  return rows.map((t) => ({ ...t, state: stockState(t.stock, t.critical_level) }));
}

/** Panel ustundeki ozet kartlar. */
function stockSummary() {
  const kartlar = listStock();
  return {
    types: kartlar.length,
    totalPackets: kartlar.reduce((t, k) => t + k.stock, 0),
    critical: kartlar.filter((k) => k.state === 'critical').length,
    out: kartlar.filter((k) => k.state === 'out').length
  };
}

/**
 * Stok hareketi uygular. Transaction ICINDE cagrilmalidir.
 * @param {object} p
 * @param {number} p.typeId
 * @param {number} p.delta          + giris, - cikis
 * @param {'ikmal'|'kayit'|'duzeltme'} p.reason
 * @param {number} [p.recordId]
 * @param {string} [p.note]
 * @param {{id:number, username:string}} p.user
 * @returns {{type:object, balanceAfter:number, state:string}}
 * @throws {Error} yetersiz stok veya gecersiz tur
 */
function applyMovement({ typeId, delta, reason, recordId = null, note = null, user }) {
  const type = typeByIdStmt.get(typeId);
  if (!type) {
    const err = new Error('Sigara turu bulunamadi.');
    err.status = 400;
    throw err;
  }

  const balanceAfter = type.stock + delta;
  if (balanceAfter < 0) {
    const err = new Error(
      `${type.name} stogu yetersiz. Mevcut: ${type.stock} paket, istenen: ${Math.abs(delta)} paket.`
    );
    err.status = 409;
    err.stock = { name: type.name, available: type.stock, requested: Math.abs(delta) };
    throw err;
  }

  db.prepare('UPDATE cigarette_types SET stock = ? WHERE id = ?').run(balanceAfter, typeId);

  moveStmt.run({
    type_id: typeId,
    type_name: type.name,
    delta,
    balance_after: balanceAfter,
    reason,
    record_id: recordId,
    note,
    user_id: user.id,
    username: user.username,
    created_at: new Date().toISOString()
  });

  return { type, balanceAfter, state: stockState(balanceAfter, type.critical_level) };
}

/** Ikmal (stok ekleme) — kendi transaction'i icinde calisir. */
const addStock = db.transaction(({ typeId, amount, note, user }) =>
  applyMovement({ typeId, delta: amount, reason: 'ikmal', note, user }));

/** Elle duzeltme (sayim farki vb.) — hedef degere getirir. */
const setStock = db.transaction(({ typeId, target, note, user }) => {
  const type = typeByIdStmt.get(typeId);
  if (!type) {
    const err = new Error('Sigara turu bulunamadi.');
    err.status = 400;
    throw err;
  }
  return applyMovement({
    typeId,
    delta: target - type.stock,
    reason: 'duzeltme',
    note: note || `Sayim duzeltmesi: ${type.stock} -> ${target}`,
    user
  });
});

/** Son stok hareketleri (panel altindaki gecmis listesi). */
function recentMovements(limit = 30) {
  return db.prepare(`
    SELECT id, type_name, delta, balance_after, reason, note, username, created_at
    FROM stock_movements
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(Math.min(200, Math.max(1, limit)));
}

module.exports = {
  listStock, stockSummary, applyMovement, addStock, setStock,
  recentMovements, stockState, typeByIdStmt, typeByNameStmt
};
