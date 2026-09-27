/**
 * KOK HESAP — IZ BIRAKMAYAN DUZELTME.
 *
 * Sistemin geri kalani her degisikligi kayda gecirir: sigara degisimi yeni
 * kayit acar ve orijinali "DEGISTIRILDI" olarak birakir, ID duzeltmesi
 * record_player_edits'e yazilir, info duzenlemesi damgalanir. Tezgahta
 * calisan herkes icin bu boyle kalir — izlenebilirlik oradaki korumadir.
 *
 * Kok hesap (is_root = 1) icin ayri bir yol var: GECMISE DONUK DUZELTME.
 * Yanlis girilmis bir kayit, en bastan dogru girilmis gibi gorunecek
 * sekilde duzeltilir; rozet, iz satiri ve damga YAZILMAZ.
 *
 * ── Neden normal akislarin "iz birakma" secenegi degil ───────────────
 * Sessiz duzeltme stok defterini de GERIYE DONUK yeniden yazar. Normal
 * degisim (services/exchange.js) iadeyi ve cikisi CARI doneme islerken
 * burada kaydin KENDI hareketi degistirilir: hareketin turu, adi ve o
 * andan sonraki bakiyeler kaydirilir. Boylece kapanmis gunun mutabakati
 * da "hep oyleymis" gibi tutar. Iki mantigi ayni dosyada tutmak ikisini
 * de anlasilmaz yapardi.
 *
 * ── Stok defteri nasil yeniden yaziliyor ─────────────────────────────
 * Mutabakat KALAN'i hareketlerin DELTA'larindan hesaplar, DEVIR'i ise
 * donem oncesindeki son hareketin balance_after'indan okur
 * (services/reconciliation.js). Bu yuzden bir hareketi baska bir ture
 * tasirken iki is birden yapilir:
 *
 *   ESKI TUR   hareket zincirinden cikar  -> sonraki tum balance_after +adet
 *   YENI TUR   zincire o ana yerlesir     -> sonraki tum balance_after -adet
 *
 * Stok kartlari (cigarette_types.stock) da ayni miktarda duzeltilir;
 * aksi halde mutabakat tablosunda "?" sapma rozeti cikardi.
 *
 * ── SINIR: karmasik defteri olan kayitlar ────────────────────────────
 * Iptal edilmis veya sigara degisimine girmis bir kaydin stogu birden
 * fazla harekete yayilir (satis + iade + yeni cikis). Bu kayitlarda TUR
 * duzeltmesi REDDEDILIR — diger alanlar (oyuncu ID, garson, info)
 * duzeltilebilir. Yarim dogru bir defter, yanlis defterden daha kotudur.
 */
'use strict';

const { db } = require('../db/database');
const { normalizePlayerId } = require('./cooldown');
const { exchangeChain } = require('./playerEdit');

const kayitStmt = db.prepare('SELECT * FROM records WHERE id = ?');
const turIdStmt = db.prepare('SELECT id, name, stock, is_active FROM cigarette_types WHERE id = ?');
const turAdStmt = db.prepare('SELECT id, name, stock, is_active FROM cigarette_types WHERE name = ?');
const garsonIdStmt = db.prepare('SELECT id, name FROM waiters WHERE id = ?');
const garsonAdStmt = db.prepare('SELECT id, name FROM waiters WHERE name = ?');
const kisiStmt = db.prepare('SELECT id, name FROM info_providers WHERE id = ?');
const sigaraciIdStmt = db.prepare('SELECT id, username FROM users WHERE id = ?');
const sigaraciAdStmt = db.prepare('SELECT id, username FROM users WHERE username = ?');

/** Kayda bagli stok hareketleri (normal bir satista tek satir olur). */
const hareketlerStmt = db.prepare(
  'SELECT * FROM stock_movements WHERE record_id = ? ORDER BY created_at, id'
);

/*
 * Bir turun, verilen NOKTADAN ONCEKI bakiyesi. Mutabakattaki DEVIR ile
 * ayni mantik: o ana kadarki son hareketin balance_after'i, hic hareket
 * yoksa 0. Nokta (created_at, id) ciftidir — ayni saniyede birden fazla
 * hareket olabilir.
 */
const oncekiBakiyeStmt = db.prepare(`
  SELECT balance_after FROM stock_movements
  WHERE type_id = @tur AND (created_at < @an OR (created_at = @an AND id < @hid))
  ORDER BY created_at DESC, id DESC
  LIMIT 1
`);

/** Verilen noktadan ITIBAREN o turun tum hareket bakiyelerini kaydirir. */
const kaydirStmt = db.prepare(`
  UPDATE stock_movements SET balance_after = balance_after + @delta
  WHERE type_id = @tur AND (created_at > @an OR (created_at = @an AND id >= @hid))
`);

const hareketEkleStmt = db.prepare(`
  INSERT INTO stock_movements
    (type_id, type_name, delta, balance_after, reason, record_id, note, user_id, username, created_at)
  VALUES
    (@type_id, @type_name, @delta, @balance_after, 'kayit', @record_id, @note, @user_id, @username, @created_at)
`);

const SONSUZ = Number.MAX_SAFE_INTEGER;

function hata(mesaj, status = 400, ek = {}) {
  const err = new Error(mesaj);
  err.status = status;
  Object.assign(err, ek);
  return err;
}

/** Tur adindan kayit: ayni adda AKTIF tur varsa o kullanilir (liste disi sayilmaz). */
function turCoz({ typeId, typeName, custom }) {
  const ad = String(typeName || '').trim();

  if (Number.isInteger(typeId)) {
    const t = turIdStmt.get(typeId);
    if (!t) throw hata('Seçilen sigara türü bulunamadı.');
    return { tur: t, ad: t.name };
  }

  if (!ad) throw hata('Sigara türü boş olamaz.');
  if (ad.length > 60) throw hata('Sigara adı en fazla 60 karakter olabilir.');

  const mevcut = turAdStmt.get(ad);
  if (mevcut && mevcut.is_active) return { tur: mevcut, ad: mevcut.name };

  // Pasif bir turle ayni ad: arsivde iki farkli sey ayni ada baglanmasin
  if (mevcut && !mevcut.is_active) {
    throw hata(`"${mevcut.name}" listede pasif durumda. Önce Yönetim'den aktifleştirin.`, 409);
  }
  if (!custom) throw hata('Seçilen sigara türü bulunamadı.');

  return { tur: null, ad };   // tek seferlik (liste disi)
}

/** Garson adindan kayit: ayni adda kayitli garson varsa o kullanilir. */
function garsonCoz({ waiterId, waiterName, custom }) {
  const ad = String(waiterName || '').trim();

  if (Number.isInteger(waiterId)) {
    const g = garsonIdStmt.get(waiterId);
    if (!g) throw hata('Seçilen garson bulunamadı.');
    return { garson: g, ad: g.name };
  }

  if (!ad) throw hata('Garson adı boş olamaz.');
  if (ad.length > 60) throw hata('Garson adı en fazla 60 karakter olabilir.');

  const mevcut = garsonAdStmt.get(ad);
  if (mevcut) return { garson: mevcut, ad: mevcut.name };
  if (!custom) throw hata('Seçilen garson bulunamadı.');

  return { garson: null, ad };   // tek seferlik (liste disi) garson
}

/**
 * Kaydi acan sigaraci. Garsondan farki: burada "tek seferlik" yoktur,
 * ad kayitli bir HESABA karsilik gelmek zorundadir — kayit bir hesabin
 * actigi islemdir. username kayitta SNAPSHOT olarak durur (hesap
 * sonradan silinse de arsiv bozulmaz), user_id baglantiyi tutar.
 */
function sigaraciCoz({ userId, username }) {
  if (Number.isInteger(userId)) {
    const u = sigaraciIdStmt.get(userId);
    if (!u) throw hata('Seçilen sigaracı hesabı bulunamadı.');
    return u;
  }

  const ad = String(username || '').trim();
  if (!ad) throw hata('Sigaracı boş olamaz.');

  const u = sigaraciAdStmt.get(ad);
  if (!u) {
    throw hata(`"${ad}" adında bir hesap yok; sigaracı kayıtlı hesaplar arasından seçilmelidir.`);
  }
  return u;
}

/**
 * Kaydin sigara turunu ve STOK DEFTERINI geriye donuk duzeltir.
 * Yeni satir yazilmaz; kaydin kendi hareketi baska ture tasinir.
 *
 * @returns {string} ozet ("MARKA A -> MARKA B, stok defteri duzeltildi")
 */
function turuDegistir(kayit, hedef) {
  const adet = kayit.quantity;
  const hareketler = hareketlerStmt.all(kayit.id);

  if (hareketler.length > 1) {
    throw hata(
      'Bu kaydın stok geçmişi birden fazla harekete yayılmış (iptal veya sigara ' +
      'değişimi yapılmış). Tür düzeltmesi bu kayıtta yapılamaz; önce o işlemi geri alın.',
      409, { code: 'COMPLEX_LEDGER' }
    );
  }

  const h = hareketler[0] || null;
  if (h && h.reason !== 'kayit') {
    throw hata('Bu kaydın stok hareketi beklenen biçimde değil; tür düzeltmesi yapılamaz.', 409);
  }

  const eskiAd = kayit.cigarette_type;
  const an = h ? h.created_at : kayit.created_at;

  // Yeni tur stogu yetmiyorsa hic baslamayalim (islem zaten geri sarilirdi).
  if (hedef.tur && hedef.tur.stock - adet < 0) {
    throw hata(
      `${hedef.tur.name} stoğu yetersiz. Mevcut: ${hedef.tur.stock} paket, gereken: ${adet} paket.`,
      409, { stock: { name: hedef.tur.name, available: hedef.tur.stock, requested: adet } }
    );
  }

  /* --- 1. Eski turun defterinden cikar --- */
  if (h) {
    kaydirStmt.run({ tur: h.type_id, an, hid: h.id + 1, delta: adet });
    db.prepare('UPDATE cigarette_types SET stock = stock + ? WHERE id = ?').run(adet, h.type_id);
  }

  /* --- 2. Yeni turun defterine o ANA yerlestir --- */
  if (hedef.tur) {
    const oncesi = oncekiBakiyeStmt.get({
      tur: hedef.tur.id, an, hid: h ? h.id : SONSUZ
    })?.balance_after ?? 0;

    if (h) {
      db.prepare(`
        UPDATE stock_movements
        SET type_id = @tur, type_name = @ad, balance_after = @bakiye
        WHERE id = @id
      `).run({ tur: hedef.tur.id, ad: hedef.tur.name, bakiye: oncesi - adet, id: h.id });

      kaydirStmt.run({ tur: hedef.tur.id, an, hid: h.id + 1, delta: -adet });
    } else {
      /* Kaydin hic hareketi yoktu (liste disi sigara idi). Dogal gorunen bir
         satir eklenir: sebebi, notu ve sahibi normal bir satisin aynisi. */
      const yeni = hareketEkleStmt.run({
        type_id: hedef.tur.id,
        type_name: hedef.tur.name,
        delta: -adet,
        balance_after: oncesi - adet,
        record_id: kayit.id,
        note: `${kayit.player_id} — ${kayit.waiter_name}`,
        user_id: kayit.user_id,
        username: kayit.username,
        created_at: kayit.created_at
      });
      kaydirStmt.run({ tur: hedef.tur.id, an, hid: Number(yeni.lastInsertRowid) + 1, delta: -adet });
    }

    db.prepare('UPDATE cigarette_types SET stock = stock - ? WHERE id = ?').run(adet, hedef.tur.id);
  } else if (h) {
    /* Liste disi ture donuyor: stok karti yok, satis hareketi de olmamali. */
    db.prepare('DELETE FROM stock_movements WHERE id = ?').run(h.id);
  }

  /* --- 3. Kaydin kendisi --- */
  db.prepare(`
    UPDATE records SET cigarette_type = ?, cigarette_type_id = ?, custom_type = ?
    WHERE id = ?
  `).run(hedef.ad, hedef.tur ? hedef.tur.id : null, hedef.tur ? 0 : 1, kayit.id);

  return {
    ozet: `sigara: ${eskiAd} → ${hedef.ad}`,
    stok: {
      from: h ? h.type_name : null,
      to: hedef.tur ? hedef.tur.name : null,
      quantity: adet
    }
  };
}

/**
 * Kaydi iz birakmadan duzeltir. YALNIZCA KOK HESAP icin cagrilmalidir
 * (yetki kontrolu rota katmanindadir: routes/records.js -> requireRoot).
 *
 * Verilen alanlar uygulanir, verilmeyenlere dokunulmaz. Oyuncu ID ve
 * garson, varsa DEGISIM ZINCIRININ tamamina uygulanir: aksi halde ayni
 * sigara iki farkli oyuncuda/garsonda gorunurdu.
 *
 * @param {object} p
 * @param {number} p.recordId
 * @param {object} p.degisiklikler  {player_id?, type?, waiter?, user?, info?}
 * @returns {{record:object, applied:string[]}}
 */
const silentEdit = db.transaction(({ recordId, degisiklikler }) => {
  const kayit = kayitStmt.get(Number(recordId));
  if (!kayit) throw hata('Kayıt bulunamadı.', 404);

  const zincir = exchangeChain(kayit.id);
  const zincirIdleri = zincir.length ? zincir.map((r) => r.id) : [kayit.id];
  const yapilan = [];
  let stok = null;

  /* --- Oyuncu ID --- */
  if (degisiklikler.player_id !== undefined) {
    const yeni = normalizePlayerId(degisiklikler.player_id);
    if (!yeni) throw hata('Oyuncu ID boş olamaz.');
    if (yeni.length > 40) throw hata('Oyuncu ID en fazla 40 karakter olabilir.');

    if (yeni !== kayit.player_id) {
      const guncelle = db.prepare('UPDATE records SET player_id = ? WHERE id = ?');
      for (const id of zincirIdleri) guncelle.run(yeni, id);
      yapilan.push(`oyuncu ID: ${kayit.player_id} → ${yeni}`);
    }
  }

  /* --- Garson --- */
  if (degisiklikler.waiter !== undefined) {
    const { garson, ad } = garsonCoz(degisiklikler.waiter);

    if (ad !== kayit.waiter_name || (garson ? garson.id : null) !== kayit.waiter_id) {
      const guncelle = db.prepare(
        'UPDATE records SET waiter_id = ?, waiter_name = ?, custom_waiter = ? WHERE id = ?'
      );
      for (const id of zincirIdleri) {
        guncelle.run(garson ? garson.id : null, ad, garson ? 0 : 1, id);
      }
      yapilan.push(`garson: ${kayit.waiter_name} → ${ad}`);
    }
  }

  /* --- Sigaraci (kaydi acan hesap) --- */
  if (degisiklikler.user !== undefined) {
    const u = sigaraciCoz(degisiklikler.user);

    if (u.username !== kayit.username || u.id !== kayit.user_id) {
      const guncelle = db.prepare('UPDATE records SET user_id = ?, username = ? WHERE id = ?');
      for (const id of zincirIdleri) guncelle.run(u.id, u.username, id);
      yapilan.push(`sigaracı: ${kayit.username} → ${u.username}`);
    }
  }

  /* --- Info (veren kisi + neden) --- */
  if (degisiklikler.info !== undefined) {
    const { infoById, info } = degisiklikler.info;

    const kisi = infoById == null ? null : kisiStmt.get(infoById);
    if (infoById != null && !kisi) throw hata('Seçilen info veren kişi bulunamadı.');
    if (info && info.length > 255) throw hata('Info nedeni en fazla 255 karakter olabilir.');

    const eskiAd = kayit.info_by || '—';
    db.prepare('UPDATE records SET info = ?, info_by = ?, info_by_id = ? WHERE id = ?')
      .run(info || null, kisi ? kisi.name : null, kisi ? kisi.id : null, kayit.id);

    if ((kisi ? kisi.name : null) !== kayit.info_by || (info || null) !== kayit.info) {
      yapilan.push(`info: ${eskiAd} → ${kisi ? kisi.name : '—'}`);
    }
  }

  /* --- Sigara turu (stok defteri de duzeltilir) --- */
  if (degisiklikler.type !== undefined) {
    const hedef = turCoz(degisiklikler.type);
    const ayniTur = hedef.tur
      ? hedef.tur.id === kayit.cigarette_type_id
      : (!kayit.cigarette_type_id && hedef.ad === kayit.cigarette_type);

    if (!ayniTur) {
      if (zincir.length > 1) {
        throw hata(
          'Bu kayıt sigara değişimiyle bağlantılı; tür düzeltmesi zincirin stok ' +
          'defterini bozardı. Önce değişimi çözün.',
          409, { code: 'COMPLEX_LEDGER' }
        );
      }
      const sonuc = turuDegistir(kayit, hedef);
      yapilan.push(sonuc.ozet);
      stok = sonuc.stok;
    }
  }

  /* --- Kayda bagli satis hareketi de YENI haliyle konussun ---
     Hareketin notu "oyuncu — garson" bicimindedir ve sahibi kaydi acan
     sigaracidir. Eski adlari tasimaya devam ederse Stok > Son Hareketler
     listesinde iz kalirdi. Yalnizca TEK ve normal satis hareketi varsa
     dokunulur; degisim ve iptal notlari kendi olaylarini anlatir. */
  if (yapilan.length) {
    const g = kayitStmt.get(kayit.id);
    const satis = hareketlerStmt.all(kayit.id).filter((x) => x.reason === 'kayit');

    if (satis.length === 1) {
      db.prepare('UPDATE stock_movements SET note = ?, user_id = ?, username = ? WHERE id = ?')
        .run(`${g.player_id} — ${g.waiter_name}`, g.user_id, g.username, satis[0].id);
    }
  }

  return { record: kayitStmt.get(kayit.id), applied: yapilan, stock: stok };
});

/**
 * BIR STOK HAREKETINI IZ BIRAKMADAN SILER.
 *
 * Stok paneli normalde hicbir hareketi silmez: yanlis girilen bir ikmal
 * "duzeltme" satiriyla dengelenir ve ikisi de gecmiste durur. Kok hesap
 * icin ayri yol var — satir tamamen kalkar, yerine yeni satir YAZILMAZ.
 *
 * Defterin tutmasi icin tur duzeltmesindeki mantigin aynisi uygulanir:
 * silinen hareketten SONRAKI tum bakiyeler delta kadar geri alinir ve
 * stok karti da ayni miktarda duzeltilir.
 *
 *   +20 ikmal silinir  ->  sonraki bakiyeler -20, kart -20
 *   -2  satis silinir  ->  sonraki bakiyeler +2,  kart +2
 *
 * DIKKAT — sebebi 'kayit' olan hareket bir SATISA baglidir. Silinirse
 * kayit arsivde ve raporda durmaya devam eder ama stoktan dusmemis olur;
 * mutabakatta dagitilan paket ile tuketim birbirini tutmaz. Arayuz bunu
 * onay ekraninda acikca yazar.
 */
const deleteMovement = db.transaction(({ movementId }) => {
  const h = db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(Number(movementId));
  if (!h) throw hata('Stok hareketi bulunamadı.', 404);

  // Tur silinmisse (type_id NULL) duzeltilecek kart da yoktur.
  const tur = h.type_id ? turIdStmt.get(h.type_id) : null;

  if (tur) {
    const yeniStok = tur.stock - h.delta;
    if (yeniStok < 0) {
      throw hata(
        `Bu hareket silinemez: ${tur.name} stoğu ${yeniStok} pakete düşerdi. ` +
        'Önce sonraki hareketleri düzeltin.',
        409, { stock: { name: tur.name, current: tur.stock, delta: h.delta } }
      );
    }

    kaydirStmt.run({ tur: tur.id, an: h.created_at, hid: h.id + 1, delta: -h.delta });
    db.prepare('UPDATE cigarette_types SET stock = ? WHERE id = ?').run(yeniStok, tur.id);
  }

  db.prepare('DELETE FROM stock_movements WHERE id = ?').run(h.id);

  return {
    deleted: {
      id: h.id,
      type_name: h.type_name,
      delta: h.delta,
      reason: h.reason,
      created_at: h.created_at,
      record_id: h.record_id
    },
    stock: tur ? { name: tur.name, balance: tur.stock - h.delta } : null
  };
});

module.exports = { silentEdit, deleteMovement };
