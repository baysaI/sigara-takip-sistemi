/**
 * Isletme gunu ("is gunu") hesaplari.
 *
 * Gun degisimi gece yarisinda degil, config.DAY_START_HOUR saatinde olur.
 * Varsayilan 06:00: 25 Agustos 06:00 ile 26 Agustos 05:59:59.999 arasindaki
 * her islem "25 Agustos" is gunune aittir.
 */
'use strict';

const { DAY_START_HOUR } = require('../config');

/**
 * Verilen anin ait oldugu is gununun takvim tarihini dondurur.
 * Saat gun baslangicindan onceyse bir onceki takvim gunune sayilir.
 * @param {Date|string|number} [an]
 * @returns {Date} o is gununu temsil eden tarih (saat bilgisi anlamsiz)
 */
function businessDayOf(an = new Date()) {
  const d = new Date(an);
  if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Bir is gununun baslangic/bitis damgalari (ISO, yerel saate gore hesaplanir).
 * @param {Date|string|number} [an]  Bu ana denk gelen is gunu
 * @returns {{from:string, to:string, day:Date}}
 */
function businessDayRange(an = new Date()) {
  const gun = businessDayOf(an);

  const bas = new Date(gun.getFullYear(), gun.getMonth(), gun.getDate(), DAY_START_HOUR, 0, 0, 0);
  const son = new Date(bas);
  son.setDate(son.getDate() + 1);
  son.setMilliseconds(son.getMilliseconds() - 1);   // ertesi gun 05:59:59.999

  return { from: bas.toISOString(), to: son.toISOString(), day: gun };
}

/**
 * Takvim tarihi araligini is gunu araligina cevirir.
 * fromDay 25 Agustos, toDay 26 Agustos verilirse
 * 25 Agustos 06:00 - 27 Agustos 05:59:59.999 doner.
 * @param {Date} fromDay
 * @param {Date} toDay
 */
function rangeBetweenDays(fromDay, toDay) {
  const bas = new Date(fromDay.getFullYear(), fromDay.getMonth(), fromDay.getDate(), DAY_START_HOUR, 0, 0, 0);
  const son = new Date(toDay.getFullYear(), toDay.getMonth(), toDay.getDate(), DAY_START_HOUR, 0, 0, 0);
  son.setDate(son.getDate() + 1);
  son.setMilliseconds(son.getMilliseconds() - 1);
  return { from: bas.toISOString(), to: son.toISOString() };
}

module.exports = { businessDayOf, businessDayRange, rangeBetweenDays, DAY_START_HOUR };
