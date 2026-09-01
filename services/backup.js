/**
 * OTOMATIK YEDEKLEME
 *
 * Veritabani belirli araliklarla (varsayilan 6 saat) kopyalanir ve eski
 * kopyalar temizlenir.
 *
 * NEDEN DOSYA KOPYALAMA DEGIL:
 * Veritabani WAL modunda calisiyor. Sunucu acikken sigara.db dosyasini
 * oldugu gibi kopyalamak, henuz ana dosyaya islenmemis islemleri disarida
 * birakir; elde tutarsiz — hatta acilmayan — bir kopya kalir. Bunun yerine
 * better-sqlite3'un ONLINE BACKUP API'si kullanilir: es zamanli yazma
 * altinda bile butunluklu bir kopya uretir.
 *
 * SINIRI ACIKCA SOYLEMEK GEREKIR: yedekler AYNI DISKTE durur. Bu, yanlislikla
 * silmeye ve bozulmaya karsi korur; disk arizasina veya sunucu kaybina karsi
 * KORUMAZ. Duzenli olarak dosyayi indirip baska bir yerde saklayin
 * (Yonetim > Yedekleme > Indir).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { db, DB_PATH } = require('../db/database');

const KLASOR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');

/** Kac saatte bir yedek alinacak (0 = kapali). */
const ARALIK_SAAT = Math.max(0, Number(process.env.BACKUP_INTERVAL_HOURS ?? 6));

/** Kac yedek saklanacak; fazlasi en eskiden silinir. */
const SAKLANACAK = Math.max(1, Number(process.env.BACKUP_KEEP ?? 28));

const ONEK = 'sigara-';
const UZANTI = '.db';

/** Dosya adindan tarih uretir: sigara-20260830-143005.db */
function dosyaAdi(an = new Date()) {
  const p = (n, u = 2) => String(n).padStart(u, '0');
  return `${ONEK}${an.getFullYear()}${p(an.getMonth() + 1)}${p(an.getDate())}` +
         `-${p(an.getHours())}${p(an.getMinutes())}${p(an.getSeconds())}${UZANTI}`;
}

/**
 * Dosya adinin bize ait bir yedek oldugunu dogrular.
 * Indirme/silme uclari kullanicidan ad aldigi icin yol gezintisine
 * (../../.env gibi) karsi tek savunma budur.
 */
function gecerliAd(ad) {
  return typeof ad === 'string' &&
         /^sigara-\d{8}-\d{6}\.db$/.test(ad) &&
         !ad.includes('/') && !ad.includes('\\');
}

function klasoruHazirla() {
  fs.mkdirSync(KLASOR, { recursive: true });
}

/** Bir yedegin yaninda kalmis -wal / -shm dosyalarini siler. */
function yanDosyalariSil(dbYolu) {
  for (const ek of ['-wal', '-shm']) {
    try { fs.unlinkSync(dbYolu + ek); } catch { /* yoksa sorun degil */ }
  }
}

/** Mevcut yedekler — en yeni once. */
function list() {
  klasoruHazirla();
  return fs.readdirSync(KLASOR)
    .filter(gecerliAd)
    .map((ad) => {
      const st = fs.statSync(path.join(KLASOR, ad));
      return { name: ad, size: st.size, createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** Saklama sinirinin disinda kalanlari sil. */
function temizle() {
  const hepsi = list();
  const silinecek = hepsi.slice(SAKLANACAK);
  for (const y of silinecek) {
    const yol = path.join(KLASOR, y.name);
    try { fs.unlinkSync(yol); } catch { /* yoksa sorun degil */ }
    yanDosyalariSil(yol);   // oksuz -wal/-shm birakma
  }
  return silinecek.map((y) => y.name);
}

/**
 * Yedek alir.
 * @param {string} [sebep] 'otomatik' | 'elle' | 'acilis'
 * @returns {Promise<{name, size, createdAt, deleted:string[]}>}
 */
async function runBackup(sebep = 'otomatik') {
  klasoruHazirla();

  const ad = dosyaAdi();
  const hedef = path.join(KLASOR, ad);

  // Online backup: es zamanli yazma altinda butunluklu kopya
  await db.backup(hedef);

  /* Kopya gercekten acilabiliyor mu? Sessiz bozulmayi burada yakalariz;
     acilmayan bir yedek, yedek degildir. */
  const Database = require('better-sqlite3');
  const kontrol = new Database(hedef, { readonly: true });
  try {
    const sonuc = kontrol.pragma('integrity_check', { simple: true });
    if (sonuc !== 'ok') throw new Error(`Yedek dogrulanamadi: ${sonuc}`);
    kontrol.prepare('SELECT COUNT(*) c FROM records').get();   // sema yerinde mi
  } finally {
    kontrol.close();
  }

  /*
   * Dogrulama icin acilan SALT-OKUNUR baglanti yaninda -wal/-shm birakir
   * ve kapanirken silemez (silmek yazma yetkisi ister). Yedek db.backup()
   * ile alindigi icin butunluklu ve kendi kendine yeter; yan dosyalar
   * gereksiz yer kaplar ve geri yuklerken kafa karistirir.
   */
  yanDosyalariSil(hedef);

  const silinen = temizle();
  const st = fs.statSync(hedef);

  console.log(`[yedek] ${ad} (${(st.size / 1024).toFixed(0)} KB, ${sebep})` +
              (silinen.length ? ` — ${silinen.length} eski yedek silindi` : ''));

  return { name: ad, size: st.size, createdAt: st.mtime.toISOString(), deleted: silinen };
}

/** En son yedegin yasi (ms); hic yoksa Infinity. */
function sonYedekYasi() {
  const [son] = list();
  if (!son) return Infinity;
  return Date.now() - Date.parse(son.createdAt);
}

let zamanlayici = null;

/**
 * Zamanlayiciyi baslatir.
 * Acilista hemen yedek ALINMAZ; yalnizca en son yedek aralik kadar
 * eskiyse alinir. Boylece sik yeniden baslatma yedek klasorunu doldurmaz.
 */
function start() {
  if (ARALIK_SAAT === 0) {
    console.log('[yedek] Otomatik yedekleme kapali (BACKUP_INTERVAL_HOURS=0).');
    return null;
  }
  if (zamanlayici) return zamanlayici;

  const aralikMs = ARALIK_SAAT * 60 * 60 * 1000;

  const calistir = (sebep) => {
    runBackup(sebep).catch((err) => console.error('[yedek] HATA:', err.message));
  };

  if (sonYedekYasi() >= aralikMs) calistir('acilis');

  zamanlayici = setInterval(() => calistir('otomatik'), aralikMs);
  if (zamanlayici.unref) zamanlayici.unref();

  console.log(`[yedek] Otomatik yedekleme acik: ${ARALIK_SAAT} saatte bir, ` +
              `son ${SAKLANACAK} kopya saklanir -> ${KLASOR}`);
  return zamanlayici;
}

function stop() {
  if (zamanlayici) clearInterval(zamanlayici);
  zamanlayici = null;
}

/** Durum ozeti (Yonetim ekrani icin). */
function status() {
  const yedekler = list();
  const [son] = yedekler;
  return {
    enabled: ARALIK_SAAT > 0,
    intervalHours: ARALIK_SAAT,
    keep: SAKLANACAK,
    dir: KLASOR,
    dbPath: DB_PATH,
    count: yedekler.length,
    totalSize: yedekler.reduce((t, y) => t + y.size, 0),
    latest: son || null,
    nextAt: ARALIK_SAAT && son
      ? new Date(Date.parse(son.createdAt) + ARALIK_SAAT * 3600000).toISOString()
      : null
  };
}

module.exports = { runBackup, list, status, start, stop, temizle, gecerliAd, KLASOR };
