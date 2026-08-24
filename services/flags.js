/**
 * MODUL 7 — Ozel onay ve uyari mekanizmasi.
 *
 * Bazi oyuncular icin onceden uyari/kisitlama tanimlanir. 4 saat kurali dolmus
 * ve sistem yesil yaniyor olsa bile, bu oyuncularda kayit acilmadan once
 * sigaracinin onunde bir engel ekrani cikar.
 *
 * Seviyeler:
 *   warning  -> uyari metni gosterilir, sigaraci okudugunu onaylar
 *   approval -> yetkili onayi sart; onaylayan kisinin adi kayda islenir
 *   blocked  -> hicbir sekilde sigara verilemez
 */
'use strict';

const { db } = require('../db/database');
const { normalizePlayerId } = require('./cooldown');

const LEVELS = ['warning', 'approval', 'blocked'];

/** Arayuzde gosterilecek etiketler (buyuk harf, dikkat cekici). */
const LEVEL_LABELS = {
  warning:  'DİKKAT — UYARI KAYDI VAR',
  approval: 'YETKİLİ ONAYI GEREKLİ',
  blocked:  'BLOKE — SİGARA VERİLEMEZ'
};

const getFlagStmt = db.prepare(
  'SELECT * FROM player_flags WHERE player_id = ? AND is_active = 1'
);

/** Bir oyuncunun aktif uyari kaydi (yoksa null). */
function getFlag(rawPlayerId) {
  const row = getFlagStmt.get(normalizePlayerId(rawPlayerId));
  if (!row) return null;
  return { ...row, label: LEVEL_LABELS[row.level] };
}

/**
 * Kayit oncesi onay kontrolu.
 * @param {string} playerId
 * @param {{approved:boolean, approved_by:string, approval_note:string}} onay
 * @returns {{ok:true, flag:object|null} | {ok:false, status:number, error:string, flag:object}}
 */
function checkApproval(playerId, onay = {}) {
  const flag = getFlag(playerId);
  if (!flag) return { ok: true, flag: null };

  if (flag.level === 'blocked') {
    return {
      ok: false,
      status: 423,                       // Locked
      error: `${flag.playerId || playerId} BLOKE durumda, sigara verilemez.`,
      flag
    };
  }

  // warning ve approval icin sigaracinin uyariyi gordugunu onaylamasi sart
  if (!onay.approved) {
    return {
      ok: false,
      status: 428,                       // Precondition Required
      error: 'Bu oyuncu icin ozel uyari var; onay ekrani tamamlanmadan kayit acilamaz.',
      flag
    };
  }

  // approval seviyesinde onayi veren yetkilinin adi zorunlu
  if (flag.level === 'approval') {
    const kim = String(onay.approved_by || '').trim();
    if (kim.length < 2) {
      return {
        ok: false,
        status: 428,
        error: 'Onayi veren yetkilinin adi girilmelidir.',
        flag
      };
    }
    if (kim.length > 60) {
      return { ok: false, status: 400, error: 'Onaylayan adi cok uzun.', flag };
    }
  }

  return { ok: true, flag };
}

/* ------------------------------------------------------------------ */
/* Yonetim islemleri                                                   */
/* ------------------------------------------------------------------ */

/** Uyari olustur veya mevcut olani guncelle (oyuncu basina tek kayit). */
function upsertFlag({ playerId, level, note, username }) {
  const id = normalizePlayerId(playerId);
  const now = new Date().toISOString();

  const mevcut = db.prepare('SELECT id FROM player_flags WHERE player_id = ?').get(id);

  if (mevcut) {
    db.prepare(`
      UPDATE player_flags
      SET level = ?, note = ?, is_active = 1, updated_by = ?, updated_at = ?
      WHERE player_id = ?
    `).run(level, note, username, now, id);
  } else {
    db.prepare(`
      INSERT INTO player_flags (player_id, level, note, created_by, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, level, note, username, now);
  }

  return db.prepare('SELECT * FROM player_flags WHERE player_id = ?').get(id);
}

module.exports = { getFlag, checkApproval, upsertFlag, LEVELS, LEVEL_LABELS };
