/**
 * Yonetici bakim uclari — toplu silme ve sifirlama.
 *
 * Bu islemler GERI ALINAMAZ. Kazayla tetiklenmemesi icin istek govdesinde
 * confirm alani zorunludur ve tam olarak CONFIRM_WORD olmalidir.
 */
'use strict';

const express = require('express');
const { db } = require('../db/database');
const { requireAuth, requireAdmin, asyncHandler } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);

const CONFIRM_WORD = 'SIFIRLA';

/**
 * Silinebilir kapsamlar. Her biri kac satir etkiledigini dondurur.
 * Sira onemli: bagimli tablolar once temizlenir.
 */
const SCOPES = {
  records: {
    label: 'Kayıt arşivi',
    count: () => db.prepare('SELECT COUNT(*) c FROM records').get().c,
    run: () => {
      // Kayda bagli stok hareketlerinin bagini kopar, hareket gecmisi kalsin
      db.prepare('UPDATE stock_movements SET record_id = NULL WHERE record_id IS NOT NULL').run();
      const n = db.prepare('DELETE FROM records').run().changes;
      db.prepare("DELETE FROM sqlite_sequence WHERE name = 'records'").run();
      return n;
    }
  },
  movements: {
    label: 'Stok hareket geçmişi',
    count: () => db.prepare('SELECT COUNT(*) c FROM stock_movements').get().c,
    run: () => {
      const n = db.prepare('DELETE FROM stock_movements').run().changes;
      db.prepare("DELETE FROM sqlite_sequence WHERE name = 'stock_movements'").run();
      return n;
    }
  },
  stock: {
    label: 'Stok sayaçları (sıfırlanır)',
    count: () => db.prepare('SELECT COUNT(*) c FROM cigarette_types WHERE stock > 0').get().c,
    run: () => db.prepare('UPDATE cigarette_types SET stock = 0 WHERE stock > 0').run().changes
  },
  flags: {
    label: 'Oyuncu uyarıları',
    count: () => db.prepare('SELECT COUNT(*) c FROM player_flags').get().c,
    run: () => {
      const n = db.prepare('DELETE FROM player_flags').run().changes;
      db.prepare("DELETE FROM sqlite_sequence WHERE name = 'player_flags'").run();
      return n;
    }
  },
  waiters: {
    label: 'Garsonlar',
    count: () => db.prepare('SELECT COUNT(*) c FROM waiters').get().c,
    run: () => {
      const n = db.prepare('DELETE FROM waiters').run().changes;
      db.prepare("DELETE FROM sqlite_sequence WHERE name = 'waiters'").run();
      return n;
    }
  },
  types: {
    label: 'Sigara türleri',
    count: () => db.prepare('SELECT COUNT(*) c FROM cigarette_types').get().c,
    run: () => {
      const n = db.prepare('DELETE FROM cigarette_types').run().changes;
      db.prepare("DELETE FROM sqlite_sequence WHERE name = 'cigarette_types'").run();
      return n;
    }
  },
  users: {
    /*
     * KOK HESAP HARIC TUTULUR (is_root = 0 sarti).
     * Aksi halde baska bir yonetici, veri sifirlama ekranindan korumali
     * hesabi komple silebilirdi — sifre korumasini anlamsiz kilan bir
     * arka kapi olurdu.
     */
    label: 'Sigaracı hesapları (kendi hesabınız ve kök hesap hariç)',
    count: (userId) =>
      db.prepare('SELECT COUNT(*) c FROM users WHERE id != ? AND is_root = 0').get(userId).c,
    run: (userId) =>
      db.prepare('DELETE FROM users WHERE id != ? AND is_root = 0').run(userId).changes
  }
};

/** GET /api/admin/overview - her kapsamda kac kayit var */
router.get('/overview', asyncHandler((req, res) => {
  const scopes = Object.entries(SCOPES).map(([key, s]) => ({
    key,
    label: s.label,
    count: s.count(req.session.user.id)
  }));

  const dbInfo = db.prepare('SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()').get();

  res.json({ ok: true, scopes, confirmWord: CONFIRM_WORD, dbSize: dbInfo.bytes });
}));

/**
 * POST /api/admin/reset
 * Govde: { scopes: ['records','stock',...], confirm: 'SIFIRLA' }
 */
router.post('/reset', asyncHandler((req, res) => {
  const istenen = Array.isArray(req.body.scopes) ? req.body.scopes : [];
  const confirm = String(req.body.confirm || '');

  if (confirm !== CONFIRM_WORD) {
    return res.status(428).json({
      ok: false,
      error: `Bu islem geri alinamaz. Onaylamak icin "${CONFIRM_WORD}" yazmalisiniz.`
    });
  }
  if (!istenen.length) {
    return res.status(400).json({ ok: false, error: 'Silinecek en az bir kapsam secilmelidir.' });
  }

  const gecersiz = istenen.filter((k) => !SCOPES[k]);
  if (gecersiz.length) {
    return res.status(400).json({ ok: false, error: `Gecersiz kapsam: ${gecersiz.join(', ')}` });
  }

  // Bagimlilik sirasi: once kayitlar/hareketler, sonra tanimlar
  const sira = ['records', 'movements', 'flags', 'stock', 'waiters', 'types', 'users'];
  const secili = sira.filter((k) => istenen.includes(k));

  const sonuc = {};
  db.transaction(() => {
    for (const key of secili) {
      sonuc[key] = { label: SCOPES[key].label, deleted: SCOPES[key].run(req.session.user.id) };
    }
  })();

  db.pragma('wal_checkpoint(TRUNCATE)');

  console.log(`[SIFIRLAMA] ${req.session.user.username} -> ${secili.join(', ')}`);
  res.json({ ok: true, result: sonuc });
}));

module.exports = router;
