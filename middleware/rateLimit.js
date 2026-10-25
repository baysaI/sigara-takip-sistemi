/**
 * GIRIS DENEMESI SINIRI — kaba kuvvet korumasi.
 *
 * Sistem internete acik bir sunucuda calisiyor ve yonetici kullanici adi
 * (admin) herkesce biliniyor. Sinirsiz deneme hakki, zayif sifreli bir
 * kurulumu dakikalar icinde acar.
 *
 * Bellekte tutulur; yeni bagimlilik istemez. Tek surecli bir uygulama
 * icin yeterli — sunucu yeniden baslayinca sayaclar sifirlanir, bu da
 * kabul edilebilir (saldirgan yeniden baslatmayi tetikleyemez).
 *
 * Sayac IP + kullanici adi ciftine baglidir: ayni agdan calisan iki
 * sigaraci birbirinin hakkini yemez, ama tek bir hesaba yapilan
 * denemeler birikir.
 */
'use strict';

/** @type {Map<string, {sayac:number, ilk:number, blokBitis:number}>} */
const kayitlar = new Map();

const PENCERE_MS = 15 * 60 * 1000;   // deneme sayaci bu surede sifirlanir
const SINIR = 8;                     // pencere icinde izin verilen basarisiz deneme
const BLOK_MS = 15 * 60 * 1000;      // sinir asilinca bekleme suresi
const TEMIZLIK_MS = 30 * 60 * 1000;  // olu kayitlarin toplanma araligi

const anahtar = (req) =>
  `${req.ip || 'bilinmiyor'}|${String(req.body?.username || '').trim().toLowerCase()}`;

/** Suresi gecmis kayitlari at; Map sinirsiz buyumesin. */
function temizle() {
  const simdi = Date.now();
  for (const [k, v] of kayitlar) {
    if (v.blokBitis < simdi && simdi - v.ilk > PENCERE_MS) kayitlar.delete(k);
  }
}
const zamanlayici = setInterval(temizle, TEMIZLIK_MS);
if (zamanlayici.unref) zamanlayici.unref();   // testlerde sureci acik tutmasin

/**
 * Giris rotasindan ONCE calisir: blokluysa 429 doner.
 * Basarili giriste kayit temizlensin diye rota `loginBasarili` cagirir.
 */
function loginRateLimit(req, res, next) {
  const k = anahtar(req);
  const simdi = Date.now();
  const kayit = kayitlar.get(k);

  if (kayit && kayit.blokBitis > simdi) {
    const kalanSn = Math.ceil((kayit.blokBitis - simdi) / 1000);
    res.set('Retry-After', String(kalanSn));
    return res.status(429).json({
      ok: false,
      error: `Çok fazla hatalı deneme. ${Math.ceil(kalanSn / 60)} dakika sonra tekrar deneyin.`,
      retryAfter: kalanSn
    });
  }

  next();
}

/** Basarisiz denemeyi isle. */
function loginBasarisiz(req) {
  const k = anahtar(req);
  const simdi = Date.now();
  const kayit = kayitlar.get(k);

  if (!kayit || simdi - kayit.ilk > PENCERE_MS) {
    kayitlar.set(k, { sayac: 1, ilk: simdi, blokBitis: 0 });
    return;
  }

  kayit.sayac++;
  if (kayit.sayac >= SINIR) {
    kayit.blokBitis = simdi + BLOK_MS;
    kayit.sayac = 0;
    kayit.ilk = simdi;
  }
}

/** Basarili giriste sayaci sifirla. */
function loginBasarili(req) {
  kayitlar.delete(anahtar(req));
}

module.exports = { loginRateLimit, loginBasarisiz, loginBasarili, SINIR, BLOK_MS };
