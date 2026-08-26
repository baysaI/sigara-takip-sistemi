'use strict';
require('dotenv').config();

const COOLDOWN_HOURS = Number(process.env.COOLDOWN_HOURS || 4);

module.exports = {
  PORT: Number(process.env.PORT || 3000),
  SESSION_SECRET: process.env.SESSION_SECRET || 'sigara-takip-gizli-anahtar-degistir',
  NODE_ENV: process.env.NODE_ENV || 'development',

  /** 4 saat kurali - .env icinden COOLDOWN_HOURS ile degistirilebilir. */
  COOLDOWN_HOURS,
  COOLDOWN_MS: COOLDOWN_HOURS * 60 * 60 * 1000,

  /**
   * Gun degisimi saati. Isletme gunu 00:00'da degil bu saatte baslar:
   * 06:00 verilirse 25 Agustos 06:00 ile 26 Agustos 05:59 arasi
   * "25 Agustos" is gunu sayilir.
   */
  DAY_START_HOUR: Math.min(23, Math.max(0, Number(process.env.DAY_START_HOUR ?? 6))),

  /** Arsiv sayfa boyutu */
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 500
};
