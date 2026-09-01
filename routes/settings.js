/**
 * Calisma anindaki sistem ayarlari.
 *
 * GET   /api/settings   okuma — her oturum (arayuz kurali gostermeli)
 * PATCH /api/settings   yazma — yalnizca yonetici
 *
 * Sigara kurali burada degistirilir ve degisiklik ANINDA gecerli olur;
 * sunucuyu yeniden baslatmak gerekmez (bkz. services/settings.js).
 */
'use strict';

const express = require('express');
const { requireAuth, requireAdmin, asyncHandler } = require('../middleware/auth');
const settings = require('../services/settings');

const router = express.Router();
router.use(requireAuth);

router.get('/', asyncHandler((req, res) => {
  res.json({ ok: true, ...settings.all() });
}));

router.patch('/', requireAdmin, asyncHandler((req, res) => {
  const degisen = [];

  if (Object.prototype.hasOwnProperty.call(req.body, 'cooldownHours')) {
    const yeni = settings.set('cooldown_hours', req.body.cooldownHours, req.session.user);
    degisen.push({ key: 'cooldownHours', value: yeni });
  }

  if (!degisen.length) {
    return res.status(400).json({ ok: false, error: 'Değiştirilecek ayar belirtilmedi.' });
  }

  res.json({ ok: true, changed: degisen, ...settings.all() });
}));

module.exports = router;
