/**
 * GUN SONU STOK MUTABAKATI
 *
 * Isletmenin Excel'de tuttugu gun sonu sayim tablosunun karsiligi:
 *
 *   NO | SIGARA ADI | DEVIR | GIRIS | TUKETIM | KALAN | SAYIM | FARK
 *
 * Denklem:  DEVIR + GIRIS - TUKETIM (+/- DUZELTME) = KALAN
 *   DEVIR    is gunu baslamadan onceki son stok bakiyesi
 *   GIRIS    gun ici ikmal (koli/paket girisi)
 *   TUKETIM  gun ici kayitlardan cikan paket
 *   DUZELTME gun ici sayim duzeltmesi / kayit silme iadesi
 *   KALAN    sistemin hesapladigi bakiye
 *   SAYIM    fiziksel sayimda bulunan (elle girilir)
 *   FARK     SAYIM - KALAN  (eksi ise kayip, arti ise fazla)
 */
'use strict';

const { db } = require('../db/database');
const { businessDayRange, businessDayOf } = require('./businessDay');

/** Is gununu YYYY-MM-DD olarak anahtarlar (daily_counts icin). */
function dayKey(date) {
  const d = businessDayOf(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* --- Bir turun is gunu baslangicindaki bakiyesi (DEVIR) --- */
const devirStmt = db.prepare(`
  SELECT balance_after FROM stock_movements
  WHERE type_id = ? AND created_at < ?
  ORDER BY created_at DESC, id DESC
  LIMIT 1
`);

/* --- Gun ici hareketler, sebebe gore --- */
const hareketStmt = db.prepare(`
  SELECT
    COALESCE(SUM(CASE WHEN reason = 'ikmal'    THEN delta ELSE 0 END), 0) AS giris,
    COALESCE(SUM(CASE WHEN reason = 'kayit'    THEN -delta ELSE 0 END), 0) AS tuketim,
    COALESCE(SUM(CASE WHEN reason = 'duzeltme' THEN delta ELSE 0 END), 0) AS duzeltme
  FROM stock_movements
  WHERE type_id = ? AND created_at BETWEEN ? AND ?
`);

/* --- O gun icin girilmis fiziksel sayim --- */
const sayimStmt = db.prepare(
  'SELECT counted, expected, note, username, created_at FROM daily_counts WHERE business_day = ? AND type_id = ?'
);

/**
 * Secilen is gunu icin tur bazinda mutabakat tablosu.
 * @param {Date|string} [an] Bu ana denk gelen is gunu
 */
function buildReconciliation(an = new Date()) {
  const { from, to } = businessDayRange(an);
  const gun = dayKey(an);
  const bugununGunu = dayKey(new Date());
  const gunBitmis = gun !== bugununGunu;   // gecmis bir gun mu raporlaniyor

  const turler = db.prepare(`
    SELECT id, name, stock, unit_price, critical_level
    FROM cigarette_types
    ORDER BY name COLLATE NOCASE
  `).all();

  const satirlar = turler.map((t, i) => {
    const devir = devirStmt.get(t.id, from)?.balance_after ?? 0;
    const h = hareketStmt.get(t.id, from, to);

    // Sistem kalanini hareketlerden hesapla; boylece gecmis gunler de dogru cikar
    const kalan = devir + h.giris - h.tuketim + h.duzeltme;

    const sayimKaydi = sayimStmt.get(gun, t.id);
    const sayim = sayimKaydi ? sayimKaydi.counted : null;

    return {
      no: i + 1,
      typeId: t.id,
      name: t.name,
      devir,
      giris: h.giris,
      tuketim: h.tuketim,
      duzeltme: h.duzeltme,
      kalan,
      sayim,
      fark: sayim === null ? null : sayim - kalan,
      unitPrice: t.unit_price || 0,
      tutar: (t.unit_price || 0) * h.tuketim,
      countedBy: sayimKaydi ? sayimKaydi.username : null,
      countedAt: sayimKaydi ? sayimKaydi.created_at : null,
      // Bugunun raporunda anlik stok da dondurulur. Hareketlerden hesaplanan
      // kalan ile stok kartindaki deger ayrisirsa (ornegin veritabanina elle
      // mudahale edilmisse) bu tutarsizlik gorunur olsun.
      currentStock: gunBitmis ? null : t.stock,
      drift: gunBitmis ? 0 : t.stock - kalan
    };
  });

  const toplam = satirlar.reduce((a, s) => ({
    devir: a.devir + s.devir,
    giris: a.giris + s.giris,
    tuketim: a.tuketim + s.tuketim,
    duzeltme: a.duzeltme + s.duzeltme,
    kalan: a.kalan + s.kalan,
    tutar: a.tutar + s.tutar,
    sayilan: a.sayilan + (s.sayim === null ? 0 : 1),
    farkli: a.farkli + (s.fark ? 1 : 0),
    kayan: a.kayan + (s.drift ? 1 : 0)
  }), { devir: 0, giris: 0, tuketim: 0, duzeltme: 0, kalan: 0, tutar: 0, sayilan: 0, farkli: 0, kayan: 0 });

  return { day: gun, range: { from, to }, rows: satirlar, totals: toplam, closed: gunBitmis };
}

/**
 * Fiziksel sayimi kaydeder (ayni gun/tur icin tekrar girilirse gunceller).
 * @param {object} p
 * @param {string} p.day        YYYY-MM-DD is gunu
 * @param {Array<{type_id:number, counted:number}>} p.counts
 * @param {{id:number, username:string}} p.user
 * @returns {{saved:number}}
 */
const saveCounts = db.transaction(({ day, counts, user }) => {
  const now = new Date().toISOString();
  const mevcut = buildReconciliation(new Date(`${day}T12:00:00`));
  const kalanHarita = new Map(mevcut.rows.map((r) => [r.typeId, r.kalan]));

  const upsert = db.prepare(`
    INSERT INTO daily_counts (business_day, type_id, type_name, counted, expected, username, created_at)
    VALUES (@business_day, @type_id, @type_name, @counted, @expected, @username, @created_at)
    ON CONFLICT (business_day, type_id) DO UPDATE SET
      counted = excluded.counted,
      expected = excluded.expected,
      username = excluded.username,
      created_at = excluded.created_at
  `);

  let kaydedilen = 0;
  for (const c of counts) {
    const tur = db.prepare('SELECT id, name FROM cigarette_types WHERE id = ?').get(c.type_id);
    if (!tur) continue;

    upsert.run({
      business_day: day,
      type_id: tur.id,
      type_name: tur.name,
      counted: c.counted,
      expected: kalanHarita.get(tur.id) ?? 0,
      username: user.username,
      created_at: now
    });
    kaydedilen++;
  }

  return { saved: kaydedilen };
});

module.exports = { buildReconciliation, saveCounts, dayKey };
