/**
 * CALISMA ANINDA DEGISTIRILEBILEN AYARLAR
 *
 * Sigara kurali (kac saatte bir) eskiden .env'den okunup modul
 * yuklenirken sabitleniyordu; degistirmek icin sunucuyu yeniden
 * baslatmak gerekiyordu. Artik settings tablosunda tutulur, yonetici
 * Yonetim sayfasindan degistirir ve degisiklik ANINDA gecerli olur.
 *
 * ONEMLI — kullanim sekli:
 *   Degeri modul basinda `const X = cooldownMs()` diye YAKALAMAYIN.
 *   Fonksiyonu her ihtiyac aninda cagirin, yoksa eski deger donar.
 *
 * .env'deki COOLDOWN_HOURS yalnizca ILK kurulumda tohum degeridir;
 * tablo doldurulduktan sonra dikkate alinmaz.
 */
'use strict';

const { db } = require('../db/database');
const config = require('../config');

/** Ayar tanimlari: sinir ve donusturucu tek yerde. */
const TANIMLAR = {
  cooldown_hours: {
    varsayilan: config.COOLDOWN_HOURS,
    min: 0.25,          // 15 dakika — pratikte en kisa anlamli sure
    max: 72,
    ayrist: (v) => Number(v),
    dogrula: (n) => Number.isFinite(n) && n >= 0.25 && n <= 72
  }
};

/* Okuma cok sik (her kayit, her sorgu); tabloyu her seferinde dolasmayalim. */
let onbellek = null;

const okuStmt = db.prepare('SELECT key, value FROM settings');
const yazStmt = db.prepare(`
  INSERT INTO settings (key, value, updated_at, updated_by)
  VALUES (@key, @value, @updated_at, @updated_by)
  ON CONFLICT (key) DO UPDATE SET
    value = excluded.value,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by
`);

function yukle() {
  if (onbellek) return onbellek;

  const satirlar = Object.fromEntries(okuStmt.all().map((r) => [r.key, r.value]));
  onbellek = {};

  for (const [ad, t] of Object.entries(TANIMLAR)) {
    const ham = satirlar[ad];
    const deger = ham == null ? t.varsayilan : t.ayrist(ham);
    onbellek[ad] = t.dogrula(deger) ? deger : t.varsayilan;
  }
  return onbellek;
}

/** Tek bir ayari dondurur. */
function get(ad) {
  return yukle()[ad];
}

/** Disari acilan tum ayarlar + meta bilgi. */
function all() {
  const degerler = yukle();
  const meta = Object.fromEntries(
    db.prepare('SELECT key, updated_at, updated_by FROM settings').all()
      .map((r) => [r.key, { updatedAt: r.updated_at, updatedBy: r.updated_by }])
  );

  return {
    cooldownHours: degerler.cooldown_hours,
    limits: { cooldownHours: { min: TANIMLAR.cooldown_hours.min, max: TANIMLAR.cooldown_hours.max } },
    meta
  };
}

/**
 * Ayari degistirir.
 * @param {string} ad
 * @param {*} deger
 * @param {{username:string}} user
 * @throws {Error} tanimsiz ayar veya sinir disi deger
 */
function set(ad, deger, user) {
  const t = TANIMLAR[ad];
  if (!t) {
    const e = new Error(`Bilinmeyen ayar: ${ad}`);
    e.status = 400;
    throw e;
  }

  const n = t.ayrist(deger);
  if (!t.dogrula(n)) {
    const e = new Error(`Değer ${t.min} ile ${t.max} arasında olmalıdır.`);
    e.status = 400;
    throw e;
  }

  yazStmt.run({
    key: ad,
    value: String(n),
    updated_at: new Date().toISOString(),
    updated_by: user?.username || null
  });

  onbellek = null;   // sonraki okumada tazelensin
  return n;
}

/* ------------------------- Kisayollar ------------------------- */
/** Sigara kurali — SAAT. Her cagrida guncel deger. */
const cooldownHours = () => get('cooldown_hours');

/** Sigara kurali — MILISANIYE. Her cagrida guncel deger. */
const cooldownMs = () => get('cooldown_hours') * 60 * 60 * 1000;

/** Sunucu icinde ayar degistiyse onbellegi dusur (testler icin de). */
function invalidate() { onbellek = null; }

module.exports = { get, set, all, cooldownHours, cooldownMs, invalidate };
