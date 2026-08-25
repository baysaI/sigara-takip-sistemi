/* ============================================================
   MODUL 9 — Gun Sonu Raporu
   ============================================================ */
'use strict';

const $ = (id) => document.getElementById(id);

const DURUM = {
  ok:       { etiket: 'YETERLİ', sinif: 'free' },
  critical: { etiket: 'KRİTİK',  sinif: 'locked' },
  out:      { etiket: 'TÜKENDİ', sinif: 'locked' }
};

/** YYYY-MM-DD (yerel) */
const gunStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

App.ready(async () => {
  const bugun = new Date();
  $('rFrom').value = gunStr(bugun);
  $('rTo').value = gunStr(bugun);

  await loadReport();
  bindEvents();
});

async function loadReport() {
  try {
    const rapor = await API.get('/api/reports/daily', {
      from: localDateToISO($('rFrom').value, false),
      to: localDateToISO($('rTo').value, true)
    });
    render(rapor);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function render(r) {
  const bas = formatDateTime(r.range.from), son = formatDateTime(r.range.to);
  $('rangeLabel').textContent = `${bas} — ${son} arası döküm`;

  /* --- Özet --- */
  $('sIslem').textContent    = r.summary.islem;
  $('sPaket').textContent    = r.summary.paket;
  $('sOyuncu').textContent   = r.summary.oyuncu;
  $('sGarson').textContent   = r.summary.garson;
  $('sSigaraci').textContent = r.summary.sigaraci;
  $('sOnayli').textContent   = r.summary.onayli;
  $('sErken').textContent    = r.summary.erken;

  /* --- Marka bazlı --- */
  $('brandBody').innerHTML = r.brands.length
    ? r.brands.map((b) => `
        <tr>
          <td data-label="Sigara Türü"><b>${esc(b.name)}</b></td>
          <td data-label="Paket"><span class="pill qty">${b.paket}</span></td>
          <td data-label="İşlem">${b.islem}</td>
        </tr>`).join('')
    : '<tr><td colspan="3" class="empty">Bu aralıkta dağıtım yok.</td></tr>';

  /* --- Garson bazlı --- */
  $('waiterBody').innerHTML = r.waiters.length
    ? r.waiters.map((w) => `
        <tr>
          <td data-label="Garson"><b>${esc(w.name)}</b></td>
          <td data-label="Paket"><span class="pill qty">${w.paket}</span></td>
          <td data-label="İşlem">${w.islem}</td>
          <td data-label="Oyuncu">${w.oyuncu}</td>
        </tr>`).join('')
    : '<tr><td colspan="4" class="empty">Bu aralıkta dağıtım yok.</td></tr>';

  /* --- Sigaracı bazlı --- */
  $('operatorBody').innerHTML = r.operators.length
    ? r.operators.map((o) => `
        <tr>
          <td data-label="Sigaracı"><b>${esc(o.name)}</b></td>
          <td data-label="İşlem">${o.islem}</td>
          <td data-label="Paket"><span class="pill qty">${o.paket}</span></td>
          <td data-label="İlk İşlem" class="mono">${formatDateTime(o.ilk)}</td>
          <td data-label="Son İşlem" class="mono">${formatDateTime(o.son)}</td>
        </tr>`).join('')
    : '<tr><td colspan="5" class="empty">Bu aralıkta işlem yok.</td></tr>';

  /* --- Özel onaylı işlemler --- */
  $('approvalCount').textContent = `${r.approvals.length} işlem`;
  $('approvalBody').innerHTML = r.approvals.length
    ? r.approvals.map((a) => `
        <tr>
          <td data-label="Saat" class="mono">${formatDateTime(a.created_at)}</td>
          <td data-label="Oyuncu"><span class="pill player">${esc(a.player_id)}</span></td>
          <td data-label="Durum"><span class="pill locked">${esc(a.flag_label)}</span></td>
          <td data-label="Uyarı Notu" class="info-cell">${esc(a.flag_note || '—')}</td>
          <td data-label="Onaylayan"><b>${a.approved_by ? esc(a.approved_by) : '<span class="muted">okundu onayı</span>'}</b></td>
          <td data-label="Onay Notu" class="info-cell">${a.approval_note ? esc(a.approval_note) : '—'}</td>
          <td data-label="Sigaracı">${esc(a.username)}</td>
        </tr>`).join('')
    : '<tr><td colspan="7" class="empty">Bu aralıkta özel onayla verilen sigara yok.</td></tr>';

  /* --- Erken alımlar --- */
  const erken = r.earlyReleases || [];
  $('earlyCount').textContent = `${erken.length} işlem`;
  $('earlyBody').innerHTML = erken.length
    ? erken.map((e) => `
        <tr>
          <td data-label="Saat" class="mono">${formatDateTime(e.created_at)}</td>
          <td data-label="Oyuncu"><span class="pill player">${esc(e.player_id)}</span></td>
          <td data-label="Kalan Süreydi"><span class="pill locked">${formatDuration(e.early_remaining_ms)}</span></td>
          <td data-label="Onaylayan"><b>${esc(e.early_approved_by || '—')}</b></td>
          <td data-label="Gerekçe" class="info-cell">${e.early_note ? esc(e.early_note) : '—'}</td>
          <td data-label="Tür / Adet">${esc(e.cigarette_type)} ×${e.quantity}</td>
          <td data-label="Sigaracı">${esc(e.username)}</td>
        </tr>`).join('')
    : '<tr><td colspan="7" class="empty">Bu aralıkta süresi dolmadan verilen sigara yok.</td></tr>';

  /* --- Kalan stok (anlık) --- */
  $('stockCount').textContent = `${r.stock.summary.totalPackets} paket · ${r.stock.summary.critical} kritik`;
  $('stockBody').innerHTML = r.stock.cards.length
    ? r.stock.cards.map((c) => {
        const d = DURUM[c.state];
        return `
        <tr>
          <td data-label="Sigara Türü"><b>${esc(c.name)}</b></td>
          <td data-label="Kalan Paket">
            <b class="stock-pill stock-${c.state}" style="font-size:16px">${c.stock}</b>
          </td>
          <td data-label="Kritik Eşik" class="muted">${c.critical_level}</td>
          <td data-label="Durum"><span class="pill ${d.sinif}">${d.etiket}</span></td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="4" class="empty">Tanımlı sigara türü yok.</td></tr>';

  $('restockInfo').textContent = r.restocks.length
    ? 'Dönem içi ikmal: ' + r.restocks.map((x) => `${x.type_name} +${x.miktar}`).join(', ')
    : 'Bu aralıkta ikmal girilmemiş.';
}

function bindEvents() {
  ['rFrom', 'rTo'].forEach((id) => $(id).addEventListener('change', loadReport));

  const ayarla = (from, to) => {
    $('rFrom').value = gunStr(from);
    $('rTo').value = gunStr(to);
    loadReport();
  };

  $('todayBtn').addEventListener('click', () => { const d = new Date(); ayarla(d, d); });

  $('yesterdayBtn').addEventListener('click', () => {
    const d = new Date(); d.setDate(d.getDate() - 1); ayarla(d, d);
  });

  $('week7Btn').addEventListener('click', () => {
    const son = new Date(), bas = new Date();
    bas.setDate(bas.getDate() - 6);
    ayarla(bas, son);
  });

  $('printBtn').addEventListener('click', () => window.print());
}
