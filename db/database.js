/**
 * SQLite baglantisi + sema kurulumu.
 * better-sqlite3 senkron calisir; Express handler'lari icinde dogrudan cagrilabilir.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_DIR = process.env.DB_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DB_DIR, 'sigara.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// WAL: es zamanli okuma/yazma performansi; foreign_keys: iliskisel butunluk.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
-- ---------------------------------------------------------------
-- users: sisteme giren sigaracilar (ve yoneticiler)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  full_name     TEXT,
  role          TEXT    NOT NULL DEFAULT 'sigaraci' CHECK (role IN ('sigaraci','admin')),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------
-- waiters: onceden tanimli garsonlar (form dropdown kaynagi)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS waiters (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------
-- cigarette_types: sigara turleri (form dropdown kaynagi)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cigarette_types (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------
-- records: sigara dagitim arsivi (asil is tablosu)
--   created_at ISO-8601 UTC ('2026-08-23T15:04:05.123Z') olarak tutulur;
--   bu format hem leksikografik hem kronolojik siralanir -> araligi
--   BETWEEN ile filtrelemek guvenlidir.
--   waiter_name / username alanlari "snapshot"tir: garson veya sigaraci
--   sonradan silinse/yeniden adlandirilsa bile arsiv kaydi bozulmaz.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS records (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id       TEXT    NOT NULL,
  cigarette_type  TEXT    NOT NULL,
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  waiter_id       INTEGER REFERENCES waiters(id) ON DELETE SET NULL,
  waiter_name     TEXT    NOT NULL,
  user_id         INTEGER REFERENCES users(id)   ON DELETE SET NULL,
  username        TEXT    NOT NULL,
  info            TEXT,
  created_at      TEXT    NOT NULL
);

-- Filtreleme / 4 saat sorgusu icin indeksler
CREATE INDEX IF NOT EXISTS idx_records_player_time ON records (player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_created     ON records (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_waiter      ON records (waiter_name);
CREATE INDEX IF NOT EXISTS idx_records_type        ON records (cigarette_type);

-- ---------------------------------------------------------------
-- player_flags: oyuncu bazli ozel uyari / onay / bloke tanimlari
--   level:
--     warning  -> uyari gosterilir, sigaraci okudugunu onaylar
--     approval -> yetkili onayi sart; onaylayan adi kayda islenir
--     blocked  -> hicbir sekilde sigara verilemez
--   Her oyuncu icin tek satir tutulur (player_id UNIQUE); gecmis
--   flag_history tablosunda saklanir.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_flags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id  TEXT    NOT NULL UNIQUE,
  level      TEXT    NOT NULL CHECK (level IN ('warning','approval','blocked')),
  note       TEXT    NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_by TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  updated_by TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_flags_player ON player_flags (player_id);

-- ---------------------------------------------------------------
-- stock_movements: her stok hareketi (ikmal, cikis, duzeltme)
--   delta > 0 giris, delta < 0 cikis. balance_after o andaki bakiye.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_movements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type_id       INTEGER REFERENCES cigarette_types(id) ON DELETE SET NULL,
  type_name     TEXT    NOT NULL,
  delta         INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason        TEXT    NOT NULL CHECK (reason IN ('ikmal','kayit','duzeltme')),
  record_id     INTEGER REFERENCES records(id) ON DELETE SET NULL,
  note          TEXT,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username      TEXT    NOT NULL,
  created_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_created ON stock_movements (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_type    ON stock_movements (type_id);

-- ---------------------------------------------------------------
-- daily_counts: gun sonu fiziksel sayim (stok mutabakati)
--   business_day  is gunu (YYYY-MM-DD)
--   counted       fiziksel sayimda bulunan paket
--   expected      o an sistemin hesapladigi kalan (fark takibi icin)
--   Her is gunu + tur icin tek kayit tutulur; tekrar girilirse guncellenir.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_counts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  business_day TEXT    NOT NULL,
  type_id      INTEGER REFERENCES cigarette_types(id) ON DELETE CASCADE,
  type_name    TEXT    NOT NULL,
  counted      INTEGER NOT NULL,
  expected     INTEGER NOT NULL,
  note         TEXT,
  username     TEXT    NOT NULL,
  created_at   TEXT    NOT NULL,
  UNIQUE (business_day, type_id)
);
CREATE INDEX IF NOT EXISTS idx_counts_day ON daily_counts (business_day);

-- ---------------------------------------------------------------
-- day_closures: gun sonu raporu alindiginda islenen KAPANIS kaydi
--   Is gunu artik duvar saatinden hesaplanmaz; gun, raporu alan
--   yonetici kapatana kadar acik kalir. Her satir kapanmis bir donemdir:
--     opened_at  donem baslangici (bir onceki kapanisin closed_at'i)
--     closed_at  raporun alindigi an
--   Acik donem = son kapanisin closed_at'inden simdiye kadar; ayri bir
--   satiri yoktur, yoklugundan anlasilir.
--
--   day_key      donemin etiketi (YYYY-MM-DD, donemin ACILIS tarihi).
--                Ayni takvim gununde ikinci kez kapanis yapilirsa
--                '#2', '#3' soneki alir; daily_counts bu anahtara baglidir.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS day_closures (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  day_key    TEXT    NOT NULL UNIQUE,
  opened_at  TEXT    NOT NULL,
  closed_at  TEXT    NOT NULL,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  closed_by  TEXT    NOT NULL,
  note       TEXT
);
CREATE INDEX IF NOT EXISTS idx_closures_closed ON day_closures (closed_at DESC);

-- ---------------------------------------------------------------
-- record_exchanges: sigara degisimi (Hizli Kayit -> "Sigara Degistir")
--   Misafir aldigi sigarayi baska bir turle degistirdiginde ilk kayit
--   SILINMEZ; superseded_by ile yeni kayda baglanir ve arsivde kalir.
--   Bu tablo degisimin kendi olayidir: neyin neyle, ne zaman, kim
--   tarafindan degistirildigi.
--
--   Not: yeni kayit orijinalin created_at'ini devralir (4 saat sayaci
--   bozulmasin diye). Degisimin GERCEK ani bu tablodaki created_at'tir.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS record_exchanges (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id      INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  new_record_id  INTEGER REFERENCES records(id) ON DELETE SET NULL,
  player_id      TEXT    NOT NULL,
  from_type_id   INTEGER REFERENCES cigarette_types(id) ON DELETE SET NULL,
  from_type_name TEXT    NOT NULL,
  to_type_id     INTEGER REFERENCES cigarette_types(id) ON DELETE SET NULL,
  to_type_name   TEXT    NOT NULL,
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  note           TEXT,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username       TEXT    NOT NULL,
  created_at     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exchanges_created ON record_exchanges (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exchanges_record  ON record_exchanges (record_id);
CREATE INDEX IF NOT EXISTS idx_exchanges_player  ON record_exchanges (player_id);

-- ---------------------------------------------------------------
-- record_cancellations: IPTAL EDILEN SATISLAR
--   Musteri sigarayi aldiktan sonra iade ederse satis aktif
--   kayitlardan cikar ama SILINMEZ; records.cancelled_at doldurulur
--   ve olayin detayi buraya yazilir.
--
--   late = iptal, satisin ait oldugu donem KAPANDIKTAN sonra mi yapildi?
--     0 -> ayni donem icinde iptal. Satis o donemde hic olmamis sayilir;
--          stok iadesi reason='kayit' (+adet) yazilir, donemin TUKETIMI
--          kendiliginden sifirlanir.
--     1 -> gec iptal. Kapanmis gunun raporu DEGISMEZ (satis orada kalir);
--          iade cari doneme reason='duzeltme' olarak duser. Muhasebedeki
--          "gecmis defteri duzeltme, cari doneme iade fisi kes" kurali.
--
--   sale_day_key / cancel_day_key: satisin ve iptalin donem etiketleri.
--   Ikisi farkliysa gec iptaldir; raporda hangi gune ait oldugu gorunur.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS record_cancellations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id      INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  player_id      TEXT    NOT NULL,
  cigarette_type TEXT    NOT NULL,
  type_id        INTEGER REFERENCES cigarette_types(id) ON DELETE SET NULL,
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  reason         TEXT,
  sale_day_key   TEXT,
  cancel_day_key TEXT,
  late           INTEGER NOT NULL DEFAULT 0 CHECK (late IN (0,1)),
  restocked      INTEGER NOT NULL DEFAULT 1 CHECK (restocked IN (0,1)),
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username       TEXT    NOT NULL,
  created_at     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cancel_created ON record_cancellations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cancel_record  ON record_cancellations (record_id);
CREATE INDEX IF NOT EXISTS idx_cancel_player  ON record_cancellations (player_id);
`;

db.exec(SCHEMA);

/* ------------------------------------------------------------------
   Migrasyon: mevcut kurulumlara sonradan eklenen sutunlar.
   ALTER TABLE ... ADD COLUMN "IF NOT EXISTS" desteklemedigi icin
   once tablo bilgisi okunur.
   ------------------------------------------------------------------ */
function addColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

// Modul 8 - stok alanlari
addColumn('cigarette_types', 'stock', 'INTEGER NOT NULL DEFAULT 0');
addColumn('cigarette_types', 'critical_level', 'INTEGER NOT NULL DEFAULT 5');

// Birim fiyat: gun sonu raporunda tuketim tutarini hesaplamak icin
addColumn('cigarette_types', 'unit_price', 'REAL NOT NULL DEFAULT 0');

// Modul 7 - kayit anindaki onay bilgisi (arsivde snapshot olarak kalir)
addColumn('records', 'flag_level', 'TEXT');
addColumn('records', 'flag_note', 'TEXT');
addColumn('records', 'approved_by', 'TEXT');
addColumn('records', 'approval_note', 'TEXT');

// Stok dususunu dogru karta islemek icin tur kimligi
addColumn('records', 'cigarette_type_id', 'INTEGER');

// Erken alim: 4 saat dolmadan, yetkili onayiyla verilen sigaralar.
// Kural delinmez, izlenebilir olur — kimin onayiyla ve ne kadar sure
// kalmisken verildigi kayda islenir.
addColumn('records', 'early_release', 'INTEGER NOT NULL DEFAULT 0');
addColumn('records', 'early_remaining_ms', 'INTEGER');
addColumn('records', 'early_approved_by', 'TEXT');
addColumn('records', 'early_note', 'TEXT');

// Sigara degisimi. Ilk kayit silinmez: superseded_by ile yerine gecen kayda
// baglanir ve arsivde "DEGISTIRILDI" olarak gorunur. Rapor/istatistik
// toplamlari superseded_by IS NULL suzgecini kullanir ki adet iki kez sayilmasin.
addColumn('records', 'superseded_by', 'INTEGER REFERENCES records(id) ON DELETE SET NULL');
addColumn('records', 'exchanged_from', 'INTEGER REFERENCES records(id) ON DELETE SET NULL');
addColumn('records', 'exchanged_at', 'TEXT');
addColumn('records', 'exchanged_by', 'TEXT');

// Iptal edilen satis. Kayit silinmez; aktif kayitlardan cikar ve
// "Iptal Edilenler" bolumunde arsivlenir. cancel_late, iptalin satis
// donemi kapandiktan SONRA yapilip yapilmadigini soyler — raporlarin
// hangi donemde neyi sayacagi buna bagli (bkz. services/cancellation.js).
addColumn('records', 'cancelled_at', 'TEXT');
addColumn('records', 'cancelled_by', 'TEXT');
addColumn('records', 'cancel_reason', 'TEXT');
addColumn('records', 'cancel_late', 'INTEGER NOT NULL DEFAULT 0');

// Indeksler sutunlar eklendikten SONRA kurulur (SCHEMA icinde olamaz).
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_records_superseded ON records (superseded_by);
  CREATE INDEX IF NOT EXISTS idx_records_exchfrom   ON records (exchanged_from);
  CREATE INDEX IF NOT EXISTS idx_records_cancelled  ON records (cancelled_at);
`);

/* ------------------------------------------------------------------
   Migrasyon: gun kavrami saat tabanlidan KAPANIS tabanlina gecti.

   Eski kurulumda is gunu duvar saatinden hesaplaniyordu (DAY_START_HOUR,
   varsayilan 06:00). Gecmis veriyi oldugu gibi birakirsak tum arsiv tek
   bir devasa "acik donem" gorunur, eski gun sonu raporlari ve kaydedilmis
   fiziksel sayimlar anlamini yitirirdi.

   Bu yuzden gecmis gunler eski kurala gore geriye donuk KAPANIS satirlarina
   cevrilir. Icinde bulunulan gun kapatilmaz — acik kalir, ilk raporu
   yonetici aldiginda kapanir.

   Yalnizca day_closures bosken ve gercekten gecmis veri varken calisir.
   ------------------------------------------------------------------ */
function backfillClosures() {
  const varMi = db.prepare('SELECT COUNT(*) AS c FROM day_closures').get().c;
  if (varMi > 0) return 0;

  const ilk = db.prepare(`
    SELECT MIN(t) AS ilk FROM (
      SELECT MIN(created_at) AS t FROM records
      UNION ALL
      SELECT MIN(created_at) AS t FROM stock_movements
    ) WHERE t IS NOT NULL
  `).get().ilk;

  if (!ilk) return 0;   // temiz kurulum: kapatilacak gecmis yok

  const saat = Math.min(23, Math.max(0, Number(process.env.DAY_START_HOUR ?? 6)));

  /** Eski kural: saat gun baslangicindan onceyse bir onceki takvim gunu. */
  const isGunu = (an) => {
    const d = new Date(an);
    if (d.getHours() < saat) d.setDate(d.getDate() - 1);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  };
  const anahtar = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const baslangic = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), saat, 0, 0, 0);

  const ilkGun = isGunu(ilk);
  const buGun = isGunu(new Date());

  const ekle = db.prepare(`
    INSERT INTO day_closures (day_key, opened_at, closed_at, user_id, closed_by, note)
    VALUES (?, ?, ?, NULL, 'sistem', ?)
  `);

  let sayac = 0;
  const aktar = db.transaction(() => {
    for (let g = new Date(ilkGun); g < buGun; g.setDate(g.getDate() + 1)) {
      const acilis = baslangic(g);
      const kapanis = new Date(acilis);
      kapanis.setDate(kapanis.getDate() + 1);

      ekle.run(
        anahtar(g),
        acilis.toISOString(),
        kapanis.toISOString(),
        `Gecmis aktarim: eski ${String(saat).padStart(2, '0')}:00 kuralindan uretildi`
      );
      sayac++;
    }
  });
  aktar();

  return sayac;
}

const aktarilan = backfillClosures();
if (aktarilan) {
  console.log(`[migrasyon] ${aktarilan} gecmis is gunu kapanis kaydina donusturuldu.`);
}

module.exports = { db, DB_PATH };
