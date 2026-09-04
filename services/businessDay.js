/**
 * ISLETME GUNU — KAPANIS TABANLI.
 *
 * Gun degisimi duvar saatine bagli DEGILDIR. Gun, yonetici gun sonu
 * raporunu ALANA kadar acik kalir; raporun alindigi an donem kapanir ve
 * yeni donem tam o saniye baslar.
 *
 *   ... ── [ kapanmis donem ] ──┬── [ ACIK DONEM ] ── simdi ...
 *                          closed_at
 *
 * Kapanmis her donem day_closures tablosunda bir satirdir. ACIK donemin
 * satiri YOKTUR: son kapanistan simdiye kadar olan araliktir, yoklugundan
 * anlasilir. Hic kapanis yoksa acik donem ilk veriden itibaren surer.
 *
 * Donem etiketi (day_key) donemin ACILIS tarihidir. Ayni takvim gununde
 * ikinci kez kapanis yapilirsa '#2', '#3' soneki alir; daily_counts bu
 * anahtara baglidir.
 */
'use strict';

const { db } = require('../db/database');

/**
 * Acik donemin bitisi icin ust sinir. created_at ISO metin olarak
 * saklandigi icin leksikografik karsilastirma kronolojiktir; bu deger
 * "heniz gelmemis her an" anlamina gelir. Simdiki zamani kullanmak
 * ayni milisaniyede acilan kaydi disarida birakabilirdi.
 */
const OPEN_END = '9999-12-31T23:59:59.999Z';

/** Hic kapanis ve hic veri yoksa donem buradan baslar. */
const EPOCH = '1970-01-01T00:00:00.000Z';

/* --------------------------- Sorgular --------------------------- */

const sonKapanisStmt = db.prepare(
  'SELECT * FROM day_closures ORDER BY closed_at DESC, id DESC LIMIT 1'
);

const kapanisByIdStmt = db.prepare('SELECT * FROM day_closures WHERE id = ?');
const kapanisByKeyStmt = db.prepare('SELECT * FROM day_closures WHERE day_key = ?');

const ilkVeriStmt = db.prepare(`
  SELECT MIN(t) AS ilk FROM (
    SELECT MIN(created_at) AS t FROM records
    UNION ALL
    SELECT MIN(created_at) AS t FROM stock_movements
  ) WHERE t IS NOT NULL
`);

/* --------------------------- Yardimcilar --------------------------- */

/** Bir ani YYYY-MM-DD yerel tarihe cevirir. */
function tarihAnahtari(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Acilis tarihinden benzersiz bir donem anahtari uretir.
 * Ayni gunde ikinci kapanis '#2', ucuncusu '#3' olur.
 */
function benzersizAnahtar(acilisIso) {
  const taban = tarihAnahtari(acilisIso) || tarihAnahtari(new Date().toISOString());
  if (!kapanisByKeyStmt.get(taban)) return taban;

  for (let n = 2; n < 1000; n++) {
    const aday = `${taban}#${n}`;
    if (!kapanisByKeyStmt.get(aday)) return aday;
  }
  // Pratikte ulasilmaz; yine de benzersizlik garanti edilir.
  return `${taban}#${Date.now()}`;
}

/**
 * Bir andan 1 ms sonra.
 *
 * Donem sinirlari BETWEEN ile sorgulanir ve BETWEEN iki ucu da kapsar.
 * Kapanan donem kapanis anini ICERIR — "gunu kapat" diyen kisi "su ana
 * kadar olan her sey bugune aittir" demektedir. Cakismayi onlemek icin
 * yeni donem bu andan 1 ms SONRA baslar:
 *
 *   [ ... kapanan donem ... closed_at ][ closed_at+1ms ... acik donem ... ]
 */
function birMsSonra(iso) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t + 1).toISOString();
}

/** Kapanis satirini disari acilan donem nesnesine cevirir. */
function kapanisiDoneme(row) {
  return {
    closureId: row.id,
    dayKey: row.day_key,
    from: row.opened_at,
    to: row.closed_at,          // kapanis ani DAHIL
    open: false,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
    note: row.note || null
  };
}

/* --------------------------- Genel API --------------------------- */

/**
 * Su an acik olan donem. Kapanmadigi icin bitisi yoktur;
 * `to` sorgu ust siniridir, `asOf` ekranda gosterilecek "su an"dir.
 * @returns {{closureId:null, dayKey:string, from:string, to:string,
 *            open:true, openedAt:string, asOf:string, previousClosedAt:string|null}}
 */
function openPeriod() {
  const son = sonKapanisStmt.get();
  const ilkVeri = son ? null : ilkVeriStmt.get().ilk;
  const simdi = new Date().toISOString();

  // Kapanis ani kapanan doneme aittir; acik donem 1 ms sonra baslar.
  // Hic kapanis yoksa donem ilk veriden baslar.
  const from = son ? birMsSonra(son.closed_at) : (ilkVeri || EPOCH);

  /*
   * Bakir sistem: ne kapanis ne veri var. Sorgu alt siniri EPOCH kalmali
   * (bundan sonra girilecek her kayit araliga dussun) ama ETIKET bugun
   * olmali — aksi halde arayuz "01.01.1970, 20787 gun once acildi" yazardi.
   */
  const bakir = !son && !ilkVeri;

  /*
   * Etiket, donem KAPANDIGINDA alacagi anahtarin AYNISIDIR: closeDay da
   * benzersizAnahtar(acik.from) cagirir ve arada yeni kapanis olusmadigi
   * icin ikisi ayni degeri uretir.
   *
   * Duz tarih kullanmak iki sorun cikariyordu — bir donem ayni takvim
   * gununde acilip kapaninca (vardiya kapatilip ayni gun yenisi
   * baslayinca) acik donemin etiketi kapanmis olaninkiyle AYNI oluyordu:
   *
   *   · daily_counts UNIQUE(business_day, type_id) yuzunden iki donemin
   *     fiziksel sayimi ayni satiri paylasiyor, biri digerini eziyordu,
   *   · vardiya sirasinda girilen sayim, gun '#2' anahtariyla kapaninca
   *     oksuz kaliyor ve kapanmis raporda gorunmuyordu.
   *
   * Anahtari simdiden benzersizlestirmek ikisini de kokten cozer.
   */
  return {
    closureId: null,
    dayKey: bakir ? tarihAnahtari(simdi) : benzersizAnahtar(from),
    from,
    to: OPEN_END,
    open: true,
    pristine: bakir,
    openedAt: bakir ? null : from,
    asOf: simdi,
    previousClosedAt: son ? son.closed_at : null
  };
}

/** Gecmis kapanmis donemler (en yeni once). */
function closedPeriods({ limit = 60, offset = 0 } = {}) {
  return db.prepare(`
    SELECT * FROM day_closures
    ORDER BY closed_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(Math.min(500, Math.max(1, limit)), Math.max(0, offset)).map(kapanisiDoneme);
}

/** Toplam kapanmis donem sayisi. */
function closedCount() {
  return db.prepare('SELECT COUNT(*) AS c FROM day_closures').get().c;
}

/** Kapanis kimligine gore donem (yoksa null). */
function periodById(id) {
  const row = kapanisByIdStmt.get(Number(id));
  return row ? kapanisiDoneme(row) : null;
}

/**
 * Etikete gore donem.
 *
 * DIKKAT — etiket TEK BASINA benzersiz DEGILDIR. Bir donem ayni takvim
 * gununde acilip kapanirsa (vardiya kapatilip ayni gun yenisi baslarsa)
 * kapanis satirinin day_key'i ile ACIK donemin etiketi ayni olur:
 *
 *   [ 02:00 — 06:00 kapandi ]  day_key = 2026-09-04
 *   [ 06:00 — ... ACIK      ]  dayKey  = 2026-09-04   <-- ayni
 *
 * Bu durumda ACIK DONEM dondurulur. Kapanmis olani vermek, "bugunu
 * goster" diyen cagriya muhurlu bir defteri vermek olurdu; gun sonu
 * Excel'inin ekrandan farkli cikmasinin sebebi tam olarak buydu.
 * Kapanmis donemler kesin olarak closure id'siyle adreslenir
 * (?closure=<id> / periodById) — belirsizlik orada yoktur.
 *
 * @param {string} dayKey YYYY-MM-DD veya YYYY-MM-DD#n
 */
function periodByKey(dayKey) {
  const anahtar = String(dayKey);

  const acik = openPeriod();
  if (acik.dayKey === anahtar) return acik;

  const row = kapanisByKeyStmt.get(anahtar);
  return row ? kapanisiDoneme(row) : null;
}

/**
 * Verilen an hangi doneme dusuyor? (arsiv/degisim kontrolleri icin)
 * @returns {object} kapanmis donem veya acik donem
 */
function periodOf(iso) {
  const row = db.prepare(`
    SELECT * FROM day_closures
    WHERE closed_at >= ? AND opened_at <= ?
    ORDER BY closed_at ASC
    LIMIT 1
  `).get(String(iso), String(iso));

  return row ? kapanisiDoneme(row) : openPeriod();
}

/** Bir an hala acik donemde mi? */
function isOpen(iso) {
  const acik = openPeriod();
  return String(iso) >= acik.from;
}

/**
 * Takvim tarihi araligini donem araligina cevirir (cok gunluk rapor).
 * Secilen tarihlerde etiketlenmis TUM donemler birlestirilir.
 * @param {string} fromKey YYYY-MM-DD
 * @param {string} toKey   YYYY-MM-DD (bossa fromKey)
 */
function periodsBetween(fromKey, toKey) {
  const bas = String(fromKey || '');
  const son = String(toKey || fromKey || '');
  if (!bas) return null;

  // '2026-08-25#2' gibi sonekli anahtarlar da araliga girsin diye
  // ust sinir '￿' ile genisletilir.
  const rows = db.prepare(`
    SELECT * FROM day_closures
    WHERE day_key >= ? AND day_key <= ?
    ORDER BY opened_at ASC
  `).all(bas, `${son}￿`);

  const donemler = rows.map(kapanisiDoneme);

  // Acik donem de secilen araliga denk geliyorsa dahil edilir.
  // Ust sinir yine '￿' ile genisletilir: acik donemin etiketi de artik
  // '2026-09-04#2' gibi sonek alabiliyor (bkz. openPeriod).
  const acik = openPeriod();
  if (acik.dayKey >= bas && acik.dayKey <= `${son}￿`) donemler.push(acik);

  if (!donemler.length) return null;

  return {
    from: donemler[0].from,
    to: donemler[donemler.length - 1].to,
    periods: donemler,
    open: donemler.some((d) => d.open)
  };
}

/**
 * GUNU KAPAT — gun sonu raporunun alindigi an.
 * Acik donemi kapanis satirina donusturur; yeni donem ayni saniyede baslar.
 *
 * @param {{id:number, username:string}} user
 * @param {string} [note]
 * @returns {{closure:object, period:object}} kapanan donem
 * @throws {Error} kapatilacak bir sey yoksa (donemde hic hareket olmamissa)
 */
const closeDay = db.transaction(({ user, note = null, allowEmpty = false }) => {
  const acik = openPeriod();
  const kapanisAni = new Date().toISOString();

  if (!allowEmpty) {
    // Donemin sahip olacagi aralikla ayni: [from, kapanisAni] — iki uc da dahil
    const hareket = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM records         WHERE created_at BETWEEN ? AND ?) AS kayit,
        (SELECT COUNT(*) FROM stock_movements WHERE created_at BETWEEN ? AND ?) AS stok
    `).get(acik.from, kapanisAni, acik.from, kapanisAni);

    if (!hareket.kayit && !hareket.stok) {
      const err = new Error(
        'Bu dönemde hiç işlem yok — kapatılacak bir gün bulunamadı. ' +
        'Boş günü yine de kapatmak istiyorsanız onay kutusunu işaretleyin.'
      );
      err.status = 409;
      err.code = 'EMPTY_PERIOD';
      throw err;
    }
  }

  const dayKey = benzersizAnahtar(acik.from);

  const sonuc = db.prepare(`
    INSERT INTO day_closures (day_key, opened_at, closed_at, user_id, closed_by, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(dayKey, acik.from, kapanisAni, user.id, user.username, note);

  return periodById(sonuc.lastInsertRowid);
});

module.exports = {
  OPEN_END,
  openPeriod,
  closedPeriods,
  closedCount,
  periodById,
  periodByKey,
  periodOf,
  periodsBetween,
  isOpen,
  closeDay,
  tarihAnahtari
};
