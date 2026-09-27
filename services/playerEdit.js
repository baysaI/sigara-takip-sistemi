/**
 * OYUNCU ID DUZELTME — "yanlis ID yazildi".
 *
 * Sigaraci ID'yi yanlis yazabiliyor ya da garson tezgaha yanlis ID
 * getirebiliyor. Kayit SILINIP yeniden acilmaz: silmek stogu iade edip
 * sayaci bosaltmak, sonra yeni kayitla ikisini de geri koymak demekti —
 * arada stok hareket gecmisi iki gereksiz satirla kirlenirdi. Bunun
 * yerine kaydin uzerinde YALNIZCA player_id degisir.
 *
 * ── Neyi degistirir, neyi degistirmez ────────────────────────────────
 *
 *   DEGISIR   kaydin sahibi (player_id) ve dolayisiyla 4 SAAT SAYACI:
 *             eski ID'nin sayaci serbest kalir, yeni ID'ninki bu kayittan
 *             itibaren isler. Zaten dogru olan da budur — sigara gercekte
 *             yeni ID'ye verilmistir.
 *
 *   DEGISMEZ  adet, sigara turu, garson, sigaraci, saat ve STOK.
 *             Hicbir stok hareketi yazilmaz; donemin tuketimi, marka
 *             dokumu ve mutabakat tablosu aynen kalir.
 *
 * ── Kapanmis donem ───────────────────────────────────────────────────
 * Degisim (exchange) kapanmis donemde YASAKTIR cunku stogu cari doneme,
 * kaydi eski doneme dusurur. ID duzeltmesinde boyle bir sey yok: tek
 * kelime degisir, hicbir sayi donem degistirmez. Bu yuzden engellenmez —
 * ama `late` olarak isaretlenir ve arayuz onay ekraninda acikca yazar.
 * Yanlis ID'yi "muhurlu defter" adina sonsuza kadar yanlis birakmak
 * kimseye hizmet etmezdi.
 *
 * Kapanmis gunun raporunda degisebilecek TEK sey oyuncu SAYISIdir
 * (COUNT DISTINCT player_id) — o da zaten yanlis ID yuzunden yanlisti.
 *
 * ── Degisim zinciri ──────────────────────────────────────────────────
 * Sigara degistirilmis bir kaydin ID'si duzeltilirse ZINCIRIN TAMAMI
 * birlikte duzeltilir. Aksi halde orijinal kayit A oyuncusunda, yerine
 * gecen kayit B oyuncusunda kalir ve gecmis okunamaz hale gelirdi.
 */
'use strict';

const { db } = require('../db/database');
const { normalizePlayerId } = require('./cooldown');
const { periodOf, isOpen } = require('./businessDay');

const recordByIdStmt = db.prepare('SELECT * FROM records WHERE id = ?');

const insertEditStmt = db.prepare(`
  INSERT INTO record_player_edits
    (record_id, old_player_id, new_player_id, reason, late, sale_day_key,
     user_id, username, created_at)
  VALUES
    (@record_id, @old_player_id, @new_player_id, @reason, @late, @sale_day_key,
     @user_id, @username, @created_at)
`);

function hata(mesaj, status = 400, ek = {}) {
  const err = new Error(mesaj);
  err.status = status;
  Object.assign(err, ek);
  return err;
}

/**
 * Bir kaydin ait oldugu DEGISIM ZINCIRI (koktan uca, sirali).
 * Degisim yapilmamis kayit icin tek elemanli dizi doner.
 *
 * routes/records.js'teki ayni isimli yardimciyla ayni isi yapar; burada
 * durmasinin sebebi servisin rota katmanina bagimli olmamasidir.
 */
function exchangeChain(id) {
  const gorulen = new Set();

  let kok = recordByIdStmt.get(id);
  while (kok && kok.exchanged_from && !gorulen.has(kok.id)) {
    gorulen.add(kok.id);
    const onceki = recordByIdStmt.get(kok.exchanged_from);
    if (!onceki) break;
    kok = onceki;
  }

  const zincir = [];
  const ileri = new Set();
  let cur = kok;
  while (cur && !ileri.has(cur.id)) {
    ileri.add(cur.id);
    zincir.push(cur);
    cur = cur.superseded_by ? recordByIdStmt.get(cur.superseded_by) : null;
  }

  return zincir;
}

/**
 * Duzeltilebilecek kaydi ve hedefi dogrular.
 *
 * @param {number} recordId
 * @param {string} rawNewId
 * @returns {{kayit:object, zincir:object[], yeniId:string, gec:boolean, satisDonemi:object}}
 * @throws {Error} uygun degilse
 */
function assertEditable(recordId, rawNewId) {
  const kayit = recordByIdStmt.get(Number(recordId));
  if (!kayit) throw hata('Kayıt bulunamadı.', 404);

  const yeniId = normalizePlayerId(rawNewId);

  if (!yeniId) throw hata('Yeni oyuncu ID zorunludur.');
  if (yeniId.length > 40) throw hata('Oyuncu ID en fazla 40 karakter olabilir.');
  if (yeniId === kayit.player_id) {
    throw hata('Yeni ID mevcut ID ile aynı — değiştirilecek bir şey yok.', 409);
  }

  const satisDonemi = periodOf(kayit.created_at);

  return {
    kayit,
    zincir: exchangeChain(kayit.id),
    yeniId,
    gec: !isOpen(kayit.created_at),
    satisDonemi
  };
}

/**
 * Oyuncu ID'sini duzeltir.
 *
 * @param {object} p
 * @param {number} p.recordId
 * @param {string} p.newPlayerId
 * @param {string} [p.reason]  Duzeltme gerekcesi
 * @param {{id:number, username:string}} p.user
 * @returns {{records:object[], edits:object[], oldPlayerId:string,
 *            newPlayerId:string, late:boolean, chain:boolean}}
 */
const editPlayerId = db.transaction(({ recordId, newPlayerId, reason = null, user, sessiz = false }) => {
  const { kayit, zincir, yeniId, gec, satisDonemi } = assertEditable(recordId, newPlayerId);

  const simdi = new Date().toISOString();
  const eskiId = kayit.player_id;

  const guncelle = db.prepare(`
    UPDATE records
    SET player_id = ?, player_edited_at = ?, player_edited_by = ?
    WHERE id = ?
  `);

  /* SESSIZ (kok hesap): yalnizca sahibi degisir — damga konmaz, iz satiri
     yazilmaz. Kayit en bastan boyleymis gibi gorunur. */
  const sessizGuncelle = db.prepare('UPDATE records SET player_id = ? WHERE id = ?');

  const izler = [];

  /* Zincirin TAMAMI birlikte duzeltilir: yarim duzeltilmis bir zincir,
     ayni sigaranin iki oyuncuya ait gorunmesi demek olurdu. */
  for (const r of zincir) {
    if (sessiz) {
      sessizGuncelle.run(yeniId, r.id);
      continue;
    }

    guncelle.run(yeniId, simdi, user.username, r.id);

    const iz = insertEditStmt.run({
      record_id: r.id,
      // Her halkanin KENDI eski ID'si yazilir; zincirde farkli olabilir
      // (ornegin daha once ayri ayri duzeltilmis olsaydi).
      old_player_id: r.player_id,
      new_player_id: yeniId,
      reason,
      late: gec ? 1 : 0,
      sale_day_key: satisDonemi.dayKey,
      user_id: user.id,
      username: user.username,
      created_at: simdi
    });

    izler.push(db.prepare('SELECT * FROM record_player_edits WHERE id = ?').get(iz.lastInsertRowid));
  }

  return {
    records: zincir.map((r) => recordByIdStmt.get(r.id)),
    edits: izler,
    oldPlayerId: eskiId,
    newPlayerId: yeniId,
    late: gec,
    saleDayKey: satisDonemi.dayKey,
    chain: zincir.length > 1
  };
});

/** Bir kaydin duzeltme gecmisi (eskiden yeniye). */
function editsForRecord(recordId) {
  return db.prepare(`
    SELECT id, old_player_id, new_player_id, reason, late, sale_day_key,
           username, created_at
    FROM record_player_edits
    WHERE record_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(Number(recordId));
}

/** Bir donemde YAPILAN duzeltmeler (gun sonu raporu icin). */
function editsInRange(from, to) {
  return db.prepare(`
    SELECT e.id, e.record_id, e.old_player_id, e.new_player_id, e.reason,
           e.late, e.sale_day_key, e.username, e.created_at,
           r.cigarette_type, r.quantity, r.waiter_name
    FROM record_player_edits e
    LEFT JOIN records r ON r.id = e.record_id
    WHERE e.created_at BETWEEN ? AND ?
    ORDER BY e.created_at DESC
  `).all(from, to);
}

module.exports = { editPlayerId, assertEditable, editsForRecord, editsInRange, exchangeChain };
