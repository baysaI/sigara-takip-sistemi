/**
 * Baslangic verisi. Idempotent: birden fazla calistirilabilir, mevcut kayitlari bozmaz.
 *   node db/seed.js            -> eksik kayitlari ekler
 *   node db/seed.js --reset    -> records tablosunu temizler (arsivi siler!)
 */
'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db } = require('./database');

// Garsonlar bilerek bos baslar: kendi ekibinizi Yonetim sayfasindan
// (tek tek veya toplu olarak) siz eklersiniz. Buraya ad yazarsaniz
// "npm run seed" calistirildiginda otomatik eklenir.
const DEFAULT_WAITERS = [];

// Sigara turleri de bos baslar: kendi urun listenizi Yonetim sayfasindan
// eklersiniz. Buraya ad yazarsaniz "npm run seed" ile otomatik eklenir.
const DEFAULT_CIGARETTE_TYPES = [];

// Ilk kurulum hesaplari - CANLIDA SIFRELERI MUTLAKA DEGISTIRIN.
// Yalnizca ilk yonetici hesabi olusturulur. Sigaraci hesaplarini
// bu hesapla girip Yonetim sayfasindan siz olusturursunuz.
// Sifre .env icindeki ADMIN_PASSWORD'den alinir; tanimli degilse rastgele
// bir sifre uretilir ve ilk kurulumda bir kez ekrana yazdirilir.
const GENERATED_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
  ? null
  : require('crypto').randomBytes(9).toString('base64url');
const DEFAULT_USERS = [
  { username: 'admin', password: process.env.ADMIN_PASSWORD || GENERATED_ADMIN_PASSWORD, full_name: 'Sistem Yoneticisi', role: 'admin' }
];

const insertWaiter = db.prepare('INSERT OR IGNORE INTO waiters (name) VALUES (?)');
const insertType   = db.prepare('INSERT OR IGNORE INTO cigarette_types (name) VALUES (?)');
const insertUser   = db.prepare(`
  INSERT OR IGNORE INTO users (username, password_hash, full_name, role)
  VALUES (@username, @password_hash, @full_name, @role)
`);

const seed = db.transaction(() => {
  for (const name of DEFAULT_WAITERS) insertWaiter.run(name);
  for (const name of DEFAULT_CIGARETTE_TYPES) insertType.run(name);
  for (const u of DEFAULT_USERS) {
    insertUser.run({
      username: u.username,
      password_hash: bcrypt.hashSync(u.password, 10),
      full_name: u.full_name,
      role: u.role
    });
  }
});

if (process.argv.includes('--reset')) {
  db.prepare('DELETE FROM records').run();
  console.log('! records tablosu temizlendi.');
}

const adminVardi = !!db.prepare("SELECT 1 FROM users WHERE username = 'admin'").get();
seed();
if (!adminVardi && GENERATED_ADMIN_PASSWORD) {
  console.log('\n! Yonetici hesabi olusturuldu: admin / ' + GENERATED_ADMIN_PASSWORD);
  console.log('  Bu sifre bir daha gosterilmeyecek; giris yapip degistirin.');
}

console.log('Seed tamamlandi.');

const garsonSayisi = db.prepare('SELECT COUNT(*) c FROM waiters').get().c;
if (garsonSayisi === 0) {
  console.log('\n! Sistemde henuz garson yok.');
  console.log('  Giris yapip Yonetim sayfasindan ekleyin (tek tek veya toplu).');
} else {
  console.table(db.prepare('SELECT id, name, is_active FROM waiters ORDER BY id').all());
}
console.table(db.prepare('SELECT id, username, role, is_active FROM users ORDER BY id').all());
const turSayisi = db.prepare('SELECT COUNT(*) c FROM cigarette_types').get().c;
console.log(`Sigara turu sayisi: ${turSayisi}`);
if (turSayisi === 0) console.log('  ! Sigara turlerini de Yonetim sayfasindan ekleyin.');
console.log('\nGiris bilgileri (ilk kurulum):');
for (const u of DEFAULT_USERS) console.log(`  ${u.username} / ${u.password}  (${u.role})`);
