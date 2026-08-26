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

module.exports = { db, DB_PATH };
