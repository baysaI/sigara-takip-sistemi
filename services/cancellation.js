/**
 * IPTAL EDILEN SATISLAR — "Iptal Edilenler / Arsiv".
 *
 * Musteri sigarayi aldiktan sonra iade ederse satis aktif kayitlardan
 * cikar ama SILINMEZ: records.cancelled_at doldurulur, olayin detayi
 * record_cancellations tablosuna yazilir, kayit /iptal.html sayfasinda
 * tum gecmisiyle durmaya devam eder.
 *
 * ── Kritik ayrim: AYNI DONEM mi, GEC IPTAL mi? ───────────────────────
 *
 * Kapanmis bir gunun raporu DEGISMEZ. Bu, "gun sonu raporu alindi"
 * kavraminin tum anlamidir; kapanmis gunun toplamlarini geriye donuk
 * oynatmak defteri sonradan kurcalamak olurdu. Bu yuzden iptal, satisin
 * donemi hala acik mi degil mi diye ikiye ayrilir:
 *
 *   AYNI DONEM (late = 0)
 *     Satis o donemde hic olmamis sayilir. Stok iadesi reason='kayit'
 *     (+adet) yazilir; mutabakat tuketimi SUM(-delta) ile hesapladigi
 *     icin donemin TUKETIMI kendiliginden sifirlanir. Kayit raporun
 *     toplamlarindan da cikar.
 *
 *   GEC IPTAL (late = 1)
 *     Satis kapanmis gunun raporunda KALIR (o gun gercekten satilmisti).
 *     Iade CARI doneme reason='duzeltme' (+adet) olarak duser ve bugunun
 *     mutabakatinda DUZELTME sutununda gorunur. Muhasebedeki "gecmis
 *     defteri duzeltilmez, cari doneme iade fisi kesilir" kurali.
 *
 * ── 4 saat sayaci ────────────────────────────────────────────────────
 * Iptal edilen kayit sayactan HER IKI durumda da cikar: satis iptal
 * edildiyse oyuncu hakkini kullanmamistir, olmamis bir satis icin
 * bekletilmez. Raporun (muhasebe) ve sayacin (hak) farkli davranmasi
 * kasitlidir.
 */
'use strict';

const { db } = require('../db/database');
const { applyMovement, typeByIdStmt } = require('./stock');
const { openPeriod, periodOf, isOpen } = require('./businessDay');

const recordByIdStmt = db.prepare('SELECT * FROM records WHERE id = ?');

const insertCancelStmt = db.prepare(`
  INSERT INTO record_cancellations
    (record_id, player_id, cigarette_type, type_id, quantity, reason,
     sale_day_key, cancel_day_key, late, restocked, user_id, username, created_at)
  VALUES
    (@record_id, @player_id, @cigarette_type, @type_id, @quantity, @reason,
     @sale_day_key, @cancel_day_key, @late, @restocked, @user_id, @username, @created_at)
`);

function hata(mesaj, status = 400, ek = {}) {
  const err = new Error(mesaj);
  err.status = status;
  Object.assign(err, ek);
  return err;
}

/**
 * Iptal edilebilecek kaydi dogrular ve dondurur.
 * @throws {Error} uygun degilse
 */
function assertCancellable(recordId) {
  const kayit = recordByIdStmt.get(Number(recordId));
  if (!kayit) throw hata('Kayıt bulunamadı.', 404);

  if (kayit.cancelled_at) {
    throw hata('Bu satış zaten iptal edilmiş.', 409, { cancelledAt: kayit.cancelled_at });
  }

  // Degistirilmis kayit zaten toplamlarin disinda; gecerli olan yerine
  // gecen kayittir. Iptal onun uzerinden yapilmali ki stok dogru donsun.
  if (kayit.superseded_by) {
    throw hata(
      'Bu kayıt sigara değişimiyle güncellenmiş. İptali, yerine geçen güncel kayıt üzerinden yapın.',
      409, { supersededBy: kayit.superseded_by }
    );
  }

  return kayit;
}

/**
 * Satisi iptal eder (yumusak): kayit silinmez, aktif kayitlardan cikar.
 *
 * @param {object} p
 * @param {number} p.recordId
 * @param {string} [p.reason]        Iptal nedeni (iade, yanlis kayit, ...)
 * @param {boolean} [p.restock=true] Stok iadesi yapilsin mi
 * @param {{id:number, username:string}} p.user
 */
const cancelRecord = db.transaction(({ recordId, reason = null, restock = true, user }) => {
  const kayit = assertCancellable(recordId);

  const simdi = new Date().toISOString();
  const acik = openPeriod();
  const satisDonemi = periodOf(kayit.created_at);

  // Satisin donemi kapanmis mi? Iptalin nasil muhasebelesecegini bu belirler.
  const gec = !isOpen(kayit.created_at);

  const etiket = `İptal: ${kayit.cigarette_type} ×${kayit.quantity} (${kayit.player_id})`;

  /* --- Stok iadesi --- */
  let iade = null;
  if (restock && kayit.cigarette_type_id && typeByIdStmt.get(kayit.cigarette_type_id)) {
    iade = applyMovement({
      typeId: kayit.cigarette_type_id,
      delta: kayit.quantity,
      // Ayni donem: tuketimi sifirla. Gec iptal: cari doneme duzeltme.
      reason: gec ? 'duzeltme' : 'kayit',
      recordId: kayit.id,
      note: gec
        ? `${etiket} — ${satisDonemi.dayKey} tarihli satışın geç iadesi`
        : `${etiket} — iade`,
      user
    });
  }

  /* --- Kaydi iptal olarak isaretle (SILME yok) --- */
  db.prepare(`
    UPDATE records
    SET cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, cancel_late = ?
    WHERE id = ?
  `).run(simdi, user.username, reason, gec ? 1 : 0, kayit.id);

  /* --- Iptal olayinin kendisi --- */
  const olay = insertCancelStmt.run({
    record_id: kayit.id,
    player_id: kayit.player_id,
    cigarette_type: kayit.cigarette_type,
    type_id: kayit.cigarette_type_id,
    quantity: kayit.quantity,
    reason,
    sale_day_key: satisDonemi.dayKey,
    cancel_day_key: acik.dayKey,
    late: gec ? 1 : 0,
    restocked: iade ? 1 : 0,
    user_id: user.id,
    username: user.username,
    created_at: simdi
  });

  return {
    record: recordByIdStmt.get(kayit.id),
    cancellation: db.prepare('SELECT * FROM record_cancellations WHERE id = ?')
      .get(olay.lastInsertRowid),
    late: gec,
    saleDayKey: satisDonemi.dayKey,
    restocked: iade
      ? { name: iade.type.name, balance: iade.balanceAfter, state: iade.state }
      : null
  };
});

/**
 * Geri alinabilecek iptali dogrular ve {kayit, iptal} dondurur.
 *
 * TEK ENGEL — kapanmis raporu degistirecek geri almalar:
 *
 *   Ayni donemde iptal edilmis (late=0) bir satis, o donemin
 *   raporundan CIKARILMISTI. Donem kapandiktan sonra iptali geri
 *   almak satisi kapanmis rapora GERI EKLER — tam da mühürlü defteri
 *   korumak icin engelledigimiz sey. Bu durumda geri alma reddedilir.
 *
 *   Gec iptalde (late=1) boyle bir sorun yoktur: satis kapanmis
 *   raporda zaten SAYILIYORDU, geri almak orayi hic etkilemez.
 *   Iade cari doneme duzeltme olarak islenmisti, geri alinmasi da
 *   cari doneme ters duzeltme olarak isler.
 *
 * @throws {Error} uygun degilse
 */
function assertUncancellable(recordId) {
  const kayit = recordByIdStmt.get(Number(recordId));
  if (!kayit) throw hata('Kayıt bulunamadı.', 404);

  if (!kayit.cancelled_at) {
    throw hata('Bu satış zaten iptal edilmemiş — geri alınacak bir işlem yok.', 409);
  }

  const iptal = db.prepare(`
    SELECT * FROM record_cancellations
    WHERE record_id = ? AND reverted_at IS NULL
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).get(kayit.id);

  if (!iptal) throw hata('İptal kaydı bulunamadı.', 404);

  if (!iptal.late && !isOpen(kayit.created_at)) {
    throw hata(
      `Bu iptal geri alınamaz: satış ${iptal.sale_day_key} dönemine aitti ve o gün ` +
      'kapandı. Geri almak kapanmış günün raporuna satışı geri eklerdi. ' +
      'Gerekiyorsa satışı yeni bir kayıt olarak açın.',
      409, { code: 'PERIOD_CLOSED', saleDayKey: iptal.sale_day_key }
    );
  }

  return { kayit, iptal };
}

/**
 * Iptali geri alir: satis yeniden aktif kayit olur.
 *
 * Stok yeniden dusurulur — sigara tekrar disari cikmis sayilir. Iadenin
 * hangi sebeple yazildiysa tersi ayni sebeple yazilir ki donem
 * matematigi simetrik kalsin:
 *   late=0 -> reason='kayit'    (-adet), donemin tuketimi geri gelir
 *   late=1 -> reason='duzeltme' (-adet), cari donemde ters duzeltme
 *
 * @param {object} p
 * @param {number} p.recordId
 * @param {{id:number, username:string}} p.user
 */
const uncancelRecord = db.transaction(({ recordId, user }) => {
  const { kayit, iptal } = assertUncancellable(recordId);
  const simdi = new Date().toISOString();

  /* --- Stok yeniden dusurulur (yetersizse applyMovement 409 firlatir) --- */
  let cikis = null;
  if (iptal.restocked && kayit.cigarette_type_id && typeByIdStmt.get(kayit.cigarette_type_id)) {
    cikis = applyMovement({
      typeId: kayit.cigarette_type_id,
      delta: -kayit.quantity,
      reason: iptal.late ? 'duzeltme' : 'kayit',
      recordId: kayit.id,
      note: `İptal geri alındı: ${kayit.cigarette_type} ×${kayit.quantity} (${kayit.player_id})`,
      user
    });
  }

  /* --- Kayit yeniden aktif --- */
  db.prepare(`
    UPDATE records
    SET cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL, cancel_late = 0
    WHERE id = ?
  `).run(kayit.id);

  /* --- Iptal satiri SILINMEZ: geri alindi olarak isaretlenir --- */
  db.prepare('UPDATE record_cancellations SET reverted_at = ?, reverted_by = ? WHERE id = ?')
    .run(simdi, user.username, iptal.id);

  return {
    record: recordByIdStmt.get(kayit.id),
    cancellation: db.prepare('SELECT * FROM record_cancellations WHERE id = ?').get(iptal.id),
    stock: cikis
      ? { name: cikis.type.name, balance: cikis.balanceAfter, state: cikis.state,
          critical: cikis.type.critical_level }
      : null
  };
});

/**
 * Iptal edilen satislar — /iptal.html sayfasinin kaynagi.
 * Kayit ve iptal olayi birlestirilerek dondurulur.
 */
function listCancellations({
  playerId = '', type = '', user = '', from = '', to = '',
  late = '', page = 1, pageSize = 50
} = {}) {
  const where = ['r.cancelled_at IS NOT NULL'];
  const params = {};

  if (playerId) { where.push('r.player_id LIKE @playerId'); params.playerId = `%${playerId}%`; }
  if (type)     { where.push('r.cigarette_type = @type');   params.type = type; }
  if (user)     { where.push('c.username = @user');         params.user = user; }
  // Tarih filtresi IPTAL anina gore: "bu tarihte hangi iptaller yapildi"
  if (from)     { where.push('c.created_at >= @from');      params.from = from; }
  if (to)       { where.push('c.created_at <= @to');        params.to = to; }
  if (late === '0' || late === '1') { where.push('c.late = @late'); params.late = Number(late); }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const limit = Math.min(500, Math.max(1, Number(pageSize) || 50));
  const offset = (Math.max(1, Number(page) || 1) - 1) * limit;

  const ozet = db.prepare(`
    SELECT COUNT(*) AS total, COALESCE(SUM(r.quantity), 0) AS totalQuantity,
           COALESCE(SUM(c.late), 0) AS lateCount
    FROM records r
    JOIN record_cancellations c ON c.record_id = r.id AND c.reverted_at IS NULL
    ${whereSql}
  `).get(params);

  const rows = db.prepare(`
    SELECT r.id, r.player_id, r.cigarette_type, r.quantity, r.waiter_name, r.custom_waiter,
           r.username, r.info, r.created_at, r.exchanged_from,
           r.flag_level, r.early_release,
           c.id AS cancel_id, c.reason AS cancel_reason, c.username AS cancelled_by,
           c.created_at AS cancelled_at, c.late, c.restocked,
           c.sale_day_key, c.cancel_day_key
    FROM records r
    JOIN record_cancellations c ON c.record_id = r.id AND c.reverted_at IS NULL
    ${whereSql}
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset });

  /*
   * canUndo: bu iptal geri alinabilir mi? Ayni donemde iptal edilmis
   * (late=0) bir satis, donemi kapandiysa geri alinamaz — kapanmis
   * rapora satisi geri eklerdi. Arayuz dugmeyi buna gore gosterir;
   * sunucu ayni kurali assertUncancellable icinde tekrar uygular.
   */
  const zenginRows = rows.map((r) => ({
    ...r,
    canUndo: !!r.late || isOpen(r.created_at)
  }));

  return {
    records: zenginRows,
    summary: {
      total: ozet.total,
      totalQuantity: ozet.totalQuantity,
      late: ozet.lateCount
    },
    pagination: {
      page: Math.max(1, Number(page) || 1),
      pageSize: limit,
      total: ozet.total,
      totalPages: Math.max(1, Math.ceil(ozet.total / limit))
    }
  };
}

/**
 * Bir donemde YAPILAN iptaller (gun sonu raporu icin).
 * Geri alinmis olanlar da dondurulur (reverted_at dolu): o donemde
 * gercekten bir iptal islemi yapilmisti, raporda izi kalmali.
 */
function cancellationsInRange(from, to) {
  return db.prepare(`
    SELECT id, record_id, player_id, cigarette_type, quantity, reason,
           sale_day_key, cancel_day_key, late, restocked, username, created_at,
           reverted_at, reverted_by
    FROM record_cancellations
    WHERE created_at BETWEEN ? AND ?
    ORDER BY created_at DESC
  `).all(from, to);
}

module.exports = {
  cancelRecord,
  uncancelRecord,
  assertCancellable,
  assertUncancellable,
  listCancellations,
  cancellationsInRange
};
