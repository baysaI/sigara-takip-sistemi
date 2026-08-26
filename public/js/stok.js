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
    $('stOut').textContent      = summary.out;
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

function bindEvents() {
  $('addStockBtn').addEventListener('click', addStock);
  $('setStockBtn').addEventListener('click', setStock);
  $('addAmount').addEventListener('keydown', (e) => { if (e.key === 'Enter') addStock(); });
}
