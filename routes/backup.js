/**
 * Yedekleme uclari — yalnizca yonetici.
 *
 * GET    /api/backup           durum + yedek listesi
 * POST   /api/backup           simdi yedek al
 * GET    /api/backup/:file     yedegi indir (makineden disari cikarmak icin)
 * DELETE /api/backup/:file     yedegi sil
 *
 * :file kullanicidan gelir; her seferinde gecerliAd() ile dogrulanir.
 * Aksi halde "../../.env" gibi bir adla sunucudaki baska dosyalar
 * indirilebilirdi.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const { requireAuth, requireAdmin, asyncHandler } = require('../middleware/auth');
const backup = require('../services/backup');

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);

router.get('/', asyncHandler((req, res) => {
  res.json({ ok: true, ...backup.status(), backups: backup.list() });
}));

router.post('/', asyncHandler(async (req, res) => {
  const sonuc = await backup.runBackup('elle');
  res.status(201).json({ ok: true, backup: sonuc, ...backup.status() });
}));

/** Ad dogrulama + dosya varligi; iki uc de ayni kontrolu kullanir. */
function dosyaYolu(ad, res) {
  if (!backup.gecerliAd(ad)) {
    res.status(400).json({ ok: false, error: 'Gecersiz yedek adi.' });
    return null;
  }
  const yol = path.join(backup.KLASOR, ad);
  if (!fs.existsSync(yol)) {
    res.status(404).json({ ok: false, error: 'Yedek bulunamadi.' });
    return null;
  }
  return yol;
}

router.get('/:file', asyncHandler((req, res) => {
  const yol = dosyaYolu(req.params.file, res);
  if (!yol) return;

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.file}"`);
  fs.createReadStream(yol).pipe(res);
}));

router.delete('/:file', asyncHandler((req, res) => {
  const yol = dosyaYolu(req.params.file, res);
  if (!yol) return;

  // En son yedegi silmeye izin verme: elde hic kopya kalmamasin
  const hepsi = backup.list();
  if (hepsi.length === 1) {
    return res.status(400).json({ ok: false, error: 'Tek kalan yedek silinemez.' });
  }

  fs.unlinkSync(yol);
  // Varsa yaninda kalmis -wal/-shm de gitsin, oksuz dosya kalmasin
  for (const ek of ['-wal', '-shm']) {
    try { fs.unlinkSync(yol + ek); } catch { /* yoksa sorun degil */ }
  }

  res.json({ ok: true, deleted: req.params.file, ...backup.status() });
}));

module.exports = router;
