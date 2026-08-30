/* ============================================================
   MODUL 8 — Stok Paneli
   ============================================================ */
'use strict';

const $ = (id) => document.getElementById(id);

const DURUM = {
  ok:       { etiket: 'YETERLİ',  sinif: 'free' },
  critical: { etiket: 'KRİTİK',   sinif: 'locked' },
  out:      { etiket: 'TÜKENDİ',  sinif: 'locked' }
};

App.ready(async () => {
  // Fiyat belirleme yonetici isi; sigaraciya bu kart gosterilmez
  if (App.user.role !== 'admin') $('priceCard')?.remove();

  await Promise.all([loadStock(), loadMovements()]);
  bindEvents();
});

async function loadStock() {
  const body = $('stockBody');
  try {
    const { cards, summary } = await API.get('/api/stock');

    $('stTypes').textContent    = summary.types;
    $('stTotal').textContent    = summary.totalPackets;
    $('stCritical').textContent = summary.critical;
    // "Tükenen" karti kaldirildi. summary.out API'de duruyor: stok
    // kartlarinin TÜKENDİ rozeti ve kayit anindaki stok uyarilari onu
    // kullanmaya devam ediyor.
    $('cardCount').textContent  = `${cards.length} tür · ${summary.totalPackets} paket`;

    // İkmal ve düzeltme açılır menülerini doldur
    const secenekler = '<option value="">— Seçiniz —</option>' +
      cards.map((c) => `<option value="${c.id}">${esc(c.name)} (${c.stock} paket)</option>`).join('');
    ['addType', 'setType'].forEach((id) => {
      const sel = $(id), keep = sel.value;
      sel.innerHTML = secenekler;
      if (keep) sel.value = keep;
    });

    if (!cards.length) {
      body.innerHTML = `<tr><td colspan="5" class="empty">
        Henüz sigara türü tanımlanmamış.<br />
        <span class="muted">Yönetim sayfasından tür ekleyin.</span></td></tr>`;
      return;
    }

    body.innerHTML = cards.map((c) => {
      const d = DURUM[c.state];
      return `
      <tr>
        <td data-label="Sigara Türü"><b>${esc(c.name)}</b></td>
        <td data-label="Kalan">
          <b class="stock-pill stock-${c.state}" style="font-size:16px">${c.stock}</b>
          <span class="muted">paket</span>
        </td>
        <td data-label="Birim Fiyat">
          <span class="muted price-view" data-id="${c.id}" data-price="${c.unit_price || 0}">
            ${(c.unit_price || 0).toFixed(2)} ₺ ${App.user.role === 'admin' ? '<b style="color:var(--accent)">✎</b>' : ''}
          </span>
        </td>
        <td data-label="Kritik Eşik">
          <span class="muted crit-view" data-id="${c.id}" data-level="${c.critical_level}">
            ${c.critical_level} paket ${App.user.role === 'admin' ? '<b style="color:var(--accent)">✎</b>' : ''}
          </span>
        </td>
        <td data-label="Durum"><span class="pill ${d.sinif}">${d.etiket}</span></td>
      </tr>`;
    }).join('');

    if (App.user.role === 'admin') {
      body.querySelectorAll('.crit-view').forEach((el) =>
        el.addEventListener('click', () => editCritical(el)));
      body.querySelectorAll('.price-view').forEach((el) =>
        el.addEventListener('click', () => editPrice(el)));
    }
  } catch (err) {
    body.innerHTML = `<tr><td colspan="5" class="empty">Yüklenemedi: ${esc(err.message)}</td></tr>`;
  }
}

/** Kritik esigi satir icinde duzenle (admin). */
function editCritical(el) {
  if (el.dataset.editing) return;
  el.dataset.editing = '1';

  const eski = el.innerHTML;
  el.innerHTML = `<span class="inline-form">
      <input type="number" min="0" max="10000" value="${el.dataset.level}" style="max-width:90px" />
      <button class="btn-primary btn-sm" style="width:auto">✓</button>
      <button class="btn-ghost btn-sm">✕</button>
    </span>`;

  const input = el.querySelector('input');
  const [kaydet, iptal] = el.querySelectorAll('button');
  input.focus();

  const geriAl = () => { el.innerHTML = eski; delete el.dataset.editing;
                         el.addEventListener('click', () => editCritical(el), { once: true }); };
  iptal.addEventListener('click', (e) => { e.stopPropagation(); geriAl(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') kaydet.click(); });

  kaydet.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await API.patch(`/api/stock/${el.dataset.id}/critical`, { critical_level: Number(input.value) });
      delete el.dataset.editing;
      await loadStock();
      toast('Kritik eşik güncellendi.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
}

/** Birim fiyati satir icinde duzenle (admin). Gun sonu raporunda tutar hesabinda kullanilir. */
function editPrice(el) {
  if (el.dataset.editing) return;
  el.dataset.editing = '1';

  const eski = el.innerHTML;
  el.innerHTML = `<span class="inline-form">
      <input type="number" min="0" step="0.01" value="${el.dataset.price}" style="max-width:110px" />
      <button class="btn-primary btn-sm" style="width:auto">✓</button>
      <button class="btn-ghost btn-sm">✕</button>
    </span>`;

  const input = el.querySelector('input');
  const [kaydet, iptal] = el.querySelectorAll('button');
  input.focus();

  const geriAl = () => {
    el.innerHTML = eski; delete el.dataset.editing;
    el.addEventListener('click', () => editPrice(el), { once: true });
  };
  iptal.addEventListener('click', (e) => { e.stopPropagation(); geriAl(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') kaydet.click(); });

  kaydet.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await API.patch(`/api/stock/${el.dataset.id}/price`, { unit_price: Number(input.value) });
      delete el.dataset.editing;
      await loadStock();
      toast('Birim fiyat güncellendi.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function loadMovements() {
  const body = $('moveBody');
  try {
    const { movements } = await API.get('/api/stock/movements', { limit: 30 });

    if (!movements.length) {
      body.innerHTML = '<tr><td colspan="7" class="empty">Henüz stok hareketi yok.</td></tr>';
      return;
    }

    body.innerHTML = movements.map((m) => `
      <tr>
        <td data-label="Tarih" class="mono">${formatDateTime(m.created_at)}</td>
        <td data-label="Tür">${esc(m.type_name)}</td>
        <td data-label="Hareket">
          <b style="color:${m.delta > 0 ? 'var(--ok)' : 'var(--danger)'}">
            ${m.delta > 0 ? '+' : ''}${m.delta}
          </b>
        </td>
        <td data-label="Kalan">${m.balance_after}</td>
        <td data-label="Sebep"><span class="pill">${esc(m.reason.toUpperCase())}</span></td>
        <td data-label="Kullanıcı">${esc(m.username)}</td>
        <td data-label="Not" class="info-cell">${m.note ? esc(m.note) : '—'}</td>
      </tr>`).join('');
  } catch (err) {
    body.innerHTML = `<tr><td colspan="7" class="empty">Yüklenemedi: ${esc(err.message)}</td></tr>`;
  }
}

async function addStock() {
  const typeId = Number($('addType').value);
  const amount = Number($('addAmount').value);

  if (!typeId) return toast('Sigara türü seçin.', 'error');
  if (!Number.isInteger(amount) || amount < 1) return toast('Geçerli bir paket adedi girin.', 'error');

  const btn = $('addStockBtn');
  btn.disabled = true; btn.textContent = 'Ekleniyor...';
  try {
    const r = await API.post('/api/stock/add', {
      type_id: typeId, amount, note: $('addNote').value.trim()
    });
    $('addNote').value = '';
    await Promise.all([loadStock(), loadMovements()]);
    toast(`${r.type}: +${amount} paket eklendi, toplam ${r.balance} paket.`, 'success');
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Stoğa Ekle'; }
}

async function setStock() {
  const typeId = Number($('setType').value);
  const target = Number($('setTarget').value);

  if (!typeId) return toast('Sigara türü seçin.', 'error');
  if (!Number.isInteger(target) || target < 0) return toast('Geçerli bir miktar girin.', 'error');

  const btn = $('setStockBtn');
  btn.disabled = true;
  try {
    const r = await API.post('/api/stock/set', { type_id: typeId, target });
    await Promise.all([loadStock(), loadMovements()]);
    toast(`${r.type} stoğu ${r.balance} pakete ayarlandı.`, 'success');
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; }
}

/**
 * Yapistirilan metni {name, price} listesine cevirir.
 * Satirin SONUNDAKI sayi fiyat, oncesi urun adi sayilir; boylece
 * ayrac sekme, noktali virgul veya bosluk olabilir. Ondalik icin
 * virgul de nokta da kabul edilir.
 */
function parsePriceLines(metin) {
  const satirlar = metin.split('\n').map((x) => x.trim()).filter(Boolean);
  const items = [];
  const okunamayan = [];

  for (const satir of satirlar) {
    // Sondaki sayiyi yakala: "CAMEL YELLOW\t104,65" veya "MARLBORO;125.00"
    const m = satir.match(/^(.*?)[\t;,\s]+([0-9]+(?:[.,][0-9]+)?)\s*(?:₺|TL)?$/i);
    if (!m) { okunamayan.push(satir); continue; }

    const ad = m[1].replace(/[;\t]+$/, '').trim();
    const fiyat = Number(m[2].replace(',', '.'));

    if (!ad || !Number.isFinite(fiyat)) { okunamayan.push(satir); continue; }
    items.push({ name: ad, price: fiyat });
  }
  return { items, okunamayan };
}

/* ============================================================
   TOPLU STOK GIRISI
   ============================================================ */

/** Aktif mod: 'add' mevcut stoga ekler, 'set' verilen degere sabitler. */
let bulkMode = 'add';

function setBulkMode(mod) {
  bulkMode = mod;
  const ekle = mod === 'add';
  $('bulkModeAdd').classList.toggle('active', ekle);
  $('bulkModeSet').classList.toggle('active', !ekle);
  $('bulkModeHint').innerHTML = ekle
    ? 'Girilen adet <b>mevcut stoğun üstüne eklenir</b> (ikmal hareketi yazılır).'
    : 'Stok <b>girilen adede sabitlenir</b> (düzeltme hareketi yazılır). ' +
      'Sayım sonrası stoğu gerçek değere çekmek için kullanın.';
  $('bulkStockBtn').textContent = ekle ? 'Stokları Uygula' : 'Stokları Belirle';
}

/**
 * "AD  ADET" satirlarini ayristirir.
 * Fiyattan farki: adet TAM SAYI olmali — "20,5 paket" diye bir sey yok.
 */
function parseStockLines(metin) {
  const satirlar = metin.split('\n').map((x) => x.trim()).filter(Boolean);
  const items = [];
  const okunamayan = [];

  for (const satir of satirlar) {
    const m = satir.match(/^(.*?)[\t;,\s]+([0-9]+)\s*(?:adet|paket)?$/i);
    if (!m) { okunamayan.push(satir); continue; }

    const ad = m[1].replace(/[;\t]+$/, '').trim();
    const adet = Number.parseInt(m[2], 10);

    if (!ad || !Number.isInteger(adet)) { okunamayan.push(satir); continue; }
    items.push({ name: ad, amount: adet });
  }
  return { items, okunamayan };
}

async function applyBulkStock() {
  const { items, okunamayan } = parseStockLines($('bulkStock').value);

  if (!items.length) {
    return toast('Okunabilir satır bulunamadı. Örnek: CAMEL YELLOW  20', 'error', 6000);
  }

  const btn = $('bulkStockBtn');
  const eskiMetin = btn.textContent;
  btn.disabled = true; btn.textContent = 'Uygulanıyor...';

  try {
    const r = await API.post('/api/stock/bulk', { items, mode: bulkMode });
    await loadStock();

    const parcalar = [`${r.updated} ürün işlendi`];
    if (r.notFound.length) parcalar.push(`${r.notFound.length} ürün sistemde yok`);
    if (r.invalid.length) parcalar.push(`${r.invalid.length} geçersiz adet`);
    if (okunamayan.length) parcalar.push(`${okunamayan.length} satır okunamadı`);

    $('bulkStockResult').innerHTML = [
      parcalar.join(' · '),
      r.notFound.length ? `<br /><b>Bulunamayan:</b> ${esc(r.notFound.slice(0, 12).join(', '))}` +
        (r.notFound.length > 12 ? ` (+${r.notFound.length - 12})` : '') : '',
      okunamayan.length ? `<br /><b>Okunamayan:</b> ${esc(okunamayan.slice(0, 5).join(' | '))}` : ''
    ].join('');

    if (r.updated) $('bulkStock').value = '';
    toast(parcalar.join(' · '),
      r.notFound.length || okunamayan.length || r.invalid.length ? 'error' : 'success', 6000);
  } catch (err) { toast(err.message, 'error', 6000); }
  finally { btn.disabled = false; btn.textContent = eskiMetin; }
}

async function applyBulkPrices() {
  const { items, okunamayan } = parsePriceLines($('bulkPrices').value);

  if (!items.length) {
    return toast('Okunabilir satır bulunamadı. Örnek: CAMEL YELLOW  104,65', 'error', 6000);
  }

  const btn = $('bulkPriceBtn');
  btn.disabled = true; btn.textContent = 'Uygulanıyor...';
  try {
    const r = await API.post('/api/stock/prices', { items });
    await loadStock();

    const parcalar = [`${r.updated} ürün güncellendi`];
    if (r.notFound.length) parcalar.push(`${r.notFound.length} ürün sistemde yok`);
    if (okunamayan.length) parcalar.push(`${okunamayan.length} satır okunamadı`);

    $('priceResult').innerHTML = [
      parcalar.join(' · '),
      r.notFound.length ? `<br /><b>Bulunamayan:</b> ${esc(r.notFound.slice(0, 12).join(', '))}` +
        (r.notFound.length > 12 ? ` (+${r.notFound.length - 12})` : '') : '',
      okunamayan.length ? `<br /><b>Okunamayan:</b> ${esc(okunamayan.slice(0, 5).join(' | '))}` : ''
    ].join('');

    if (r.updated) $('bulkPrices').value = '';
    toast(parcalar.join(' · '), r.notFound.length || okunamayan.length ? 'error' : 'success', 6000);
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Fiyatları Uygula'; }
}

function bindEvents() {
  $('addStockBtn').addEventListener('click', addStock);
  $('setStockBtn').addEventListener('click', setStock);
  $('addAmount').addEventListener('keydown', (e) => { if (e.key === 'Enter') addStock(); });
  $('bulkPriceBtn')?.addEventListener('click', applyBulkPrices);

  $('bulkStockBtn')?.addEventListener('click', applyBulkStock);
  $('bulkModeAdd')?.addEventListener('click', () => setBulkMode('add'));
  $('bulkModeSet')?.addEventListener('click', () => setBulkMode('set'));
}
