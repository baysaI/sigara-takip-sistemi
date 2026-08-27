/**
 * SIGARA DEGISIMI — "Hizli Kayit -> Sigara Degistir".
 *
 * Misafir aldigi sigarayi baska bir turle degistirmek istediginde
 * kullanilir. Kural: ILK KAYIT SILINMEZ.
 *
 *   R1 (Marlboro x1)  ──superseded_by──>  R2 (Parliament x1)
 *        ^ arsivde "DEGISTIRILDI" olarak kalir      ^ gecerli kayit
 *
 * Neden yeni kayit, neden guncelleme degil:
 * kaydin uzerine yazsaydik "hangi sigara neyle degistirildi" bilgisi
 * kaybolurdu. Iki satir tutulur, toplamlar `superseded_by IS NULL`
 * suzgeciyle tek kez sayilir.
 *
 * ZAMAN DAMGASI — dikkat:
 * R2, R1'in created_at degerini DEVRALIR. Boylece
 *   · 4 saat sayaci degisimden etkilenmez (degisim yeni bir hak degildir),
 *   · kayit hangi doneme aitse orada kalir, rapor araligi kaymaz.
 * Degisimin gercek ani `exchanged_at` ve record_exchanges.created_at'tir.
 *
 * STOK — iki bacak da reason='kayit' yazilir:
 *   eski tur  +adet   (geri geldi)
 *   yeni tur  -adet   (verildi)
 * Mutabakat tuketimi SUM(-delta) WHERE reason='kayit' diye hesapladigi
 * icin eski turun tuketimi kendiliginden sifirlanir, yeni turunki artar.
 * Boylece stock_movements'taki CHECK kisitina dokunmak gerekmez.
 */
'use strict';

const { db } = require('../db/database');
const { applyMovement, typeByIdStmt } = require('./stock');
const { isOpen, openPeriod } = require('./businessDay');

const recordByIdStmt = db.prepare('SELECT * FROM records WHERE id = ?');

const insertExchangedRecordStmt = db.prepare(`
  INSERT INTO records
    (player_id, cigarette_type, cigarette_type_id, quantity, waiter_id, waiter_name,
     user_id, username, info, created_at,
     flag_level, flag_note, approved_by, approval_note,
     early_release, early_remaining_ms, early_approved_by, early_note,
     exchanged_from, exchanged_at, exchanged_by)
  VALUES
    (@player_id, @cigarette_type, @cigarette_type_id, @quantity, @waiter_id, @waiter_name,
     @user_id, @username, @info, @created_at,
     @flag_level, @flag_note, @approved_by, @approval_note,
     @early_release, @early_remaining_ms, @early_approved_by, @early_note,
     @exchanged_from, @exchanged_at, @exchanged_by)
`);

const insertExchangeStmt = db.prepare(`
  INSERT INTO record_exchanges
    (record_id, new_record_id, player_id, from_type_id, from_type_name,
     to_type_id, to_type_name, quantity, note, user_id, username, created_at)
  VALUES
    (@record_id, @new_record_id, @player_id, @from_type_id, @from_type_name,
     @to_type_id, @to_type_name, @quantity, @note, @user_id, @username, @created_at)
`);

/** Islem hatalarini HTTP durumuyla birlikte firlatir. */
function hata(mesaj, status = 400, ek = {}) {
  const err = new Error(mesaj);
  err.status = status;
  Object.assign(err, ek);
  return err;
}

/**
 * Degistirilebilecek kaydi dogrular ve dondurur.
 * Rotalar hem on kontrol (GET) hem islem (POST) icin ayni kurallari kullansin diye ayri.
 * @param {number} recordId
 * @returns {object} records satiri
 * @throws {Error} uygun degilse
 */
function assertExchangeable(recordId) {
  const kayit = recordByIdStmt.get(Number(recordId));
  if (!kayit) throw hata('Kayıt bulunamadı.', 404);

  if (kayit.superseded_by) {
    throw hata(
      'Bu kayıt zaten değiştirilmiş. Geçerli olan, yerine geçen kayıttır.',
      409, { supersededBy: kayit.superseded_by }
    );
  }

  // Kapanmis bir donemin kaydi degistirilemez: kayit eski doneme, stok
  // hareketi yeni doneme duserdi ve iki gunun mutabakati da bozulurdu.
  if (!isOpen(kayit.created_at)) {
    throw hata(
      'Bu kayıt kapanmış bir güne ait — gün sonu raporu alındıktan sonra değişim yapılamaz.',
      409, { code: 'PERIOD_CLOSED' }
    );
  }

  return kayit;
}

/**
 * Degisimi uygular.
 *
 * @param {object} p
 * @param {number} p.recordId              Degistirilecek (orijinal) kayit
 * @param {number} p.toTypeId              Yeni sigara turu
 * @param {string} [p.note]                Degisim gerekcesi
 * @param {{id:number, username:string}} p.user  Islemi yapan sigaraci
 * @returns {{original:object, replacement:object, exchange:object, stock:object}}
 */
const exchangeRecord = db.transaction(({ recordId, toTypeId, note = null, user }) => {
  const kayit = assertExchangeable(recordId);

  const yeniTur = typeByIdStmt.get(Number(toTypeId));
  if (!yeniTur) throw hata('Seçilen sigara türü bulunamadı.');
  if (!yeniTur.is_active) throw hata('Seçilen sigara türü pasif durumda.');

  if (yeniTur.id === kayit.cigarette_type_id) {
    throw hata('Yeni tür, mevcut türle aynı olamaz.');
  }
  if (yeniTur.stock < kayit.quantity) {
    throw hata(
      `${yeniTur.name} stoğu yetersiz. Mevcut: ${yeniTur.stock} paket, gereken: ${kayit.quantity} paket.`,
      409,
      { stock: { name: yeniTur.name, available: yeniTur.stock, requested: kayit.quantity } }
    );
  }

  const simdi = new Date().toISOString();
  const etiket = `Değişim: ${kayit.cigarette_type} → ${yeniTur.name} (${kayit.player_id})`;

  /* --- 1. Yerine gecen kayit. created_at DEVRALINIR (bkz. dosya basi). --- */
  const yeni = insertExchangedRecordStmt.run({
    player_id: kayit.player_id,
    cigarette_type: yeniTur.name,
    cigarette_type_id: yeniTur.id,
    quantity: kayit.quantity,
    waiter_id: kayit.waiter_id,
    waiter_name: kayit.waiter_name,
    // Sigaraci alani orijinal kaydi acan kisidir; degisimi yapan
    // exchanged_by'da tutulur ki islem dokumu carpitilmasin.
    user_id: kayit.user_id,
    username: kayit.username,
    info: kayit.info,
    created_at: kayit.created_at,
    // Modul 7 / erken alim snapshot'lari da tasinir: yeni kayit
    // orijinalin tum baglamini taşır.
    flag_level: kayit.flag_level,
    flag_note: kayit.flag_note,
    approved_by: kayit.approved_by,
    approval_note: kayit.approval_note,
    early_release: kayit.early_release,
    early_remaining_ms: kayit.early_remaining_ms,
    early_approved_by: kayit.early_approved_by,
    early_note: kayit.early_note,
    exchanged_from: kayit.id,
    exchanged_at: simdi,
    exchanged_by: user.username
  });

  const yeniId = yeni.lastInsertRowid;

  /* --- 2. Orijinali yeni kayda bagla (silinmez, arsivde kalir) --- */
  db.prepare('UPDATE records SET superseded_by = ? WHERE id = ?').run(yeniId, kayit.id);

  /* --- 3. Stok: eski tur geri geldi, yeni tur verildi --- */
  let iade = null;
  if (kayit.cigarette_type_id && typeByIdStmt.get(kayit.cigarette_type_id)) {
    iade = applyMovement({
      typeId: kayit.cigarette_type_id,
      delta: kayit.quantity,
      reason: 'kayit',
      recordId: kayit.id,
      note: `${etiket} — iade`,
      user
    });
  }

  const cikis = applyMovement({
    typeId: yeniTur.id,
    delta: -kayit.quantity,
    reason: 'kayit',
    recordId: yeniId,
    note: `${etiket} — çıkış`,
    user
  });

  /* --- 4. Degisim olayinin kendisi --- */
  const olay = insertExchangeStmt.run({
    record_id: kayit.id,
    new_record_id: yeniId,
    player_id: kayit.player_id,
    from_type_id: kayit.cigarette_type_id,
    from_type_name: kayit.cigarette_type,
    to_type_id: yeniTur.id,
    to_type_name: yeniTur.name,
    quantity: kayit.quantity,
    note,
    user_id: user.id,
    username: user.username,
    created_at: simdi
  });

  return {
    original: recordByIdStmt.get(kayit.id),
    replacement: recordByIdStmt.get(yeniId),
    exchange: db.prepare('SELECT * FROM record_exchanges WHERE id = ?').get(olay.lastInsertRowid),
    stock: {
      returned: iade ? { name: iade.type.name, balance: iade.balanceAfter } : null,
      issued: { name: cikis.type.name, balance: cikis.balanceAfter, state: cikis.state,
                critical: cikis.type.critical_level }
    }
  };
});

/**
 * Bir oyuncunun acik donemdeki, halen gecerli (degistirilmemis) kayitlari.
 * "Sigara Degiştir" ekrani hangi kaydin degistirilecegini buradan secer.
 */
function exchangeableRecords(playerId, { limit = 10 } = {}) {
  const acik = openPeriod();

  return db.prepare(`
    SELECT id, player_id, cigarette_type, cigarette_type_id, quantity,
           waiter_name, username, created_at, exchanged_from
    FROM records
    WHERE player_id = ?
      AND superseded_by IS NULL
      AND created_at BETWEEN ? AND ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(String(playerId), acik.from, acik.to, Math.min(50, Math.max(1, limit)));
}

/** Bir donemdeki degisimler (gun sonu raporu icin). */
function exchangesInRange(from, to) {
  return db.prepare(`
    SELECT id, record_id, new_record_id, player_id, from_type_name, to_type_name,
           quantity, note, username, created_at
    FROM record_exchanges
    WHERE created_at BETWEEN ? AND ?
    ORDER BY created_at DESC
  `).all(from, to);
}

module.exports = {
  exchangeRecord,
  exchangeableRecords,
  exchangesInRange,
  assertExchangeable
};
