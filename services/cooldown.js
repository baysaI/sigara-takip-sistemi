/**
 * 4 SAAT KURALI - tek kaynak.
 * Hem GET /api/records/check hem de POST /api/records ayni fonksiyonu kullanir;
 * boylece frontend engellemesi bypass edilse bile sunucu tarafinda kural korunur.
 */
'use strict';

const { db } = require('../db/database');
const { COOLDOWN_MS, COOLDOWN_HOURS } = require('../config');

/** Bosluk/buyuk-kucuk harf farkindan dolayi ayni oyuncunun iki kayda bolunmesini engeller. */
function normalizePlayerId(raw) {
  return String(raw ?? '').trim().toUpperCase();
}

/*
 * Sayac yalnizca GECERLI kayitlara bakar:
 *
 *   superseded_by  Sigara degisiminde orijinal kayit arsivde kalir ama
 *                  gecerli olan yerine gecen kayittir. Yeni kayit
 *                  orijinalin created_at'ini devraldigi icin sayac
 *                  degisimden etkilenmez — degisim yeni hak degildir.
 *
 *   cancelled_at   Iptal edilen satis hic olmamis sayilir; oyuncu hakkini
 *                  kullanmamistir, olmamis bir satis icin bekletilmez.
 *                  Gec iptalde bile sayac serbest kalir — rapor (muhasebe)
 *                  ile sayacin (hak) farkli davranmasi kasitlidir,
 *                  bkz. services/cancellation.js.
 */
const AKTIF = 'superseded_by IS NULL AND cancelled_at IS NULL';

const lastRecordStmt = db.prepare(`
  SELECT id, player_id, cigarette_type, quantity, waiter_name, username, info, created_at
  FROM records
  WHERE player_id = ? AND ${AKTIF}
  ORDER BY created_at DESC, id DESC
  LIMIT 1
`);

const totalCountStmt = db.prepare(
  `SELECT COUNT(*) AS c FROM records WHERE player_id = ? AND ${AKTIF}`
);

/** Bir oyuncunun son kaydini dondurur (yoksa undefined). */
function getLastRecord(playerId) {
  return lastRecordStmt.get(normalizePlayerId(playerId));
}

/**
 * Oyuncunun su anki 4 saat durumu.
 * @returns {{
 *   playerId: string, allowed: boolean, firstTime: boolean,
 *   remainingMs: number, lastAt: string|null, nextAvailableAt: string|null,
 *   lastRecord: object|null, totalRecords: number,
 *   serverTime: string, cooldownHours: number
 * }}
 */
function getCooldownStatus(rawPlayerId) {
  const playerId = normalizePlayerId(rawPlayerId);
  const now = Date.now();

  const base = {
    playerId,
    cooldownHours: COOLDOWN_HOURS,
    serverTime: new Date(now).toISOString()
  };

  if (!playerId) {
    return { ...base, allowed: false, firstTime: false, remainingMs: 0,
             lastAt: null, nextAvailableAt: null, lastRecord: null, totalRecords: 0 };
  }

  const last = lastRecordStmt.get(playerId);
  const totalRecords = totalCountStmt.get(playerId).c;

  if (!last) {
    return { ...base, allowed: true, firstTime: true, remainingMs: 0,
             lastAt: null, nextAvailableAt: null, lastRecord: null, totalRecords: 0 };
  }

  const lastMs = Date.parse(last.created_at);
  const nextMs = lastMs + COOLDOWN_MS;
  const remainingMs = Math.max(0, nextMs - now);

  return {
    ...base,
    allowed: remainingMs === 0,
    firstTime: false,
    remainingMs,
    lastAt: last.created_at,
    nextAvailableAt: new Date(nextMs).toISOString(),
    lastRecord: last,
    totalRecords
  };
}

module.exports = { getCooldownStatus, getLastRecord, normalizePlayerId };
