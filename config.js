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

  /*
   * DAY_START_HOUR ARTIK KULLANILMIYOR.
   *
   * Gun degisimi saate bagli degildir: acik donem, yonetici gun sonu
   * raporunu ALANA kadar surer (POST /api/reports/close). Sinirlar
   * day_closures tablosundan gelir — bkz. services/businessDay.js.
   *
   * .env'deki eski deger yalnizca BIR KEZ, mevcut kurulumlarin gecmisini
   * kapanis kayitlarina cevirirken okunur (db/database.js backfillClosures).
   * Yeni kurulumlarda hicbir etkisi yoktur.
   */

  /** Arsiv sayfa boyutu */
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 500
};
