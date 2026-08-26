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

/** Aktif kapsam: tek gun (varsayilan) veya tarih araligi */
let mode = 'day';

App.ready(async () => {
  const saat = String(App.dayStartHour).padStart(2, '0');
  const bitis = String((App.dayStartHour + 23) % 24).padStart(2, '0');
  $('dayRule').textContent =
    `Gün ${saat}:00'da değişir — seçtiğiniz gün, o günün ${saat}:00'ından ` +
    `ertesi gün ${bitis}:59'una kadar sürer.`;

  // Varsayilan: icinde bulundugumuz is gunu
  const bugun = currentBusinessDay(App.dayStartHour);
  $('rDay').value = gunStr(bugun);
  $('rFrom').value = gunStr(bugun);
  $('rTo').value = gunStr(bugun);

  await loadReport();
  bindEvents();
});

/** Secili kapsamin ISO aralig|i. */
function currentRange() {
  return mode === 'day'
    ? businessRangeISO($('rDay').value, $('rDay').value, App.dayStartHour)
    : businessRangeISO($('rFrom').value, $('rTo').value, App.dayStartHour);
}

async function loadReport() {
  try {
    const rapor = await API.get('/api/reports/daily', currentRange());
    render(rapor);
  } catch (err) {
    toast(err.message, 'error');
  }
  await loadReconciliation();
}

/* ============================================================
   GUN SONU STOK SAYIMI (mutabakat)
   Isletmenin Excel tablosunun karsiligi:
   DEVIR + GIRIS - TUKETIM = KALAN, sayim girilince FARK cikar.
   ============================================================ */
let recon = null;

async function loadReconciliation() {
  const body = $('reconBody');
  // Mutabakat her zaman TEK GUN icindir; aralik modunda bitis gunu alinir.
  const gun = mode === 'day' ? $('rDay').value : $('rTo').value;

  try {
    recon = await API.get('/api/reports/reconciliation', { day: gun });
    renderReconciliation();
  } catch (err) {
    body.innerHTML = `<tr><td colspan="9" class="empty">Yüklenemedi: ${esc(err.message)}</td></tr>`;
  }
}

function renderReconciliation() {
  const body = $('reconBody');
  const t = recon.totals;

  $('reconInfo').textContent =
    `${recon.day} · ${recon.rows.length} tür · ${t.sayilan} sayıldı` +
    (t.farkli ? ` · ${t.farkli} farklı` : '');

  if (!recon.rows.length) {
    body.innerHTML = '<tr><td colspan="9" class="empty">Tanımlı sigara türü yok.</td></tr>';
    $('reconFoot').innerHTML = '';
    return;
  }

  body.innerHTML = recon.rows.map((r) => {
    const farkSinif = r.fark === null ? '' : (r.fark === 0 ? 'free' : 'locked');
    const farkMetin = r.fark === null ? '—' : (r.fark > 0 ? `+${r.fark}` : String(r.fark));

    return `
      <tr${r.drift ? ' title="Stok kartı ile hareket geçmişi ayrışmış"' : ''}>
        <td data-label="NO" class="muted">${r.no}</td>
        <td data-label="Sigara Adı"><b>${esc(r.name)}</b>${r.drift ? ' <span class="pill locked">?</span>' : ''}</td>
        <td data-label="Devir" class="mono">${r.devir}</td>
        <td data-label="Giriş" class="mono">${r.giris ? '+' + r.giris : '0'}</td>
        <td data-label="Tüketim" class="mono">${r.tuketim ? '-' + r.tuketim : '0'}</td>
        <td data-label="Kalan"><b class="mono">${r.kalan}</b></td>
        <td data-label="Sayım">
          <input type="number" class="count-input" min="0" max="1000000"
                 data-type="${r.typeId}" value="${r.sayim ?? ''}" placeholder="—" />
        </td>
        <td data-label="Fark">
          <span class="pill ${farkSinif}" data-fark="${r.typeId}">${farkMetin}</span>
        </td>
        <td data-label="Tutar" class="mono muted">${r.tutar ? r.tutar.toFixed(2) + ' ₺' : '—'}</td>
      </tr>`;
  }).join('');

  $('reconFoot').innerHTML = `
    <tr>
      <td colspan="2"><b>TOPLAM</b></td>
      <td class="mono"><b>${t.devir}</b></td>
      <td class="mono"><b>${t.giris}</b></td>
      <td class="mono"><b>${t.tuketim}</b></td>
      <td class="mono"><b>${t.kalan}</b></td>
      <td colspan="2"></td>
      <td class="mono"><b>${t.tutar ? t.tutar.toFixed(2) + ' ₺' : '—'}</b></td>
    </tr>`;

  // Sayim girildikce farki anlik goster
  body.querySelectorAll('.count-input').forEach((inp) =>
    inp.addEventListener('input', () => {
      const satir = recon.rows.find((x) => String(x.typeId) === inp.dataset.type);
      const rozet = body.querySelector(`[data-fark="${inp.dataset.type}"]`);
      if (!satir || !rozet) return;

      if (inp.value === '') {
        rozet.textContent = '—';
        rozet.className = 'pill';
        return;
      }
      const fark = Number(inp.value) - satir.kalan;
      rozet.textContent = fark > 0 ? `+${fark}` : String(fark);
      rozet.className = `pill ${fark === 0 ? 'free' : 'locked'}`;
    }));

  $('reconNote').textContent = t.kayan
    ? `${t.kayan} türde stok kartı ile hareket geçmişi ayrışmış — sayım girip düzeltin.`
    : 'DEVİR + GİRİŞ − TÜKETİM = KALAN. Sayım girince fark otomatik hesaplanır.';
}

/** Girilen sayimlari kaydeder (bos birakilanlar atlanir). */
async function saveCounts() {
  const counts = [...document.querySelectorAll('.count-input')]
    .filter((i) => i.value !== '')
    .map((i) => ({ type_id: Number(i.dataset.type), counted: Number(i.value) }));

  if (!counts.length) return toast('Önce en az bir sayım girin.', 'error');

  const btn = $('saveCountBtn');
  btn.disabled = true; btn.textContent = 'Kaydediliyor...';
  try {
    recon = await API.post('/api/reports/counts', { day: recon.day, counts });
    renderReconciliation();
    const farkli = recon.totals.farkli;
    toast(
      farkli ? `${counts.length} sayım kaydedildi — ${farkli} türde fark var.`
             : `${counts.length} sayım kaydedildi, fark yok.`,
      farkli ? 'error' : 'success', 6000
    );
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Sayımı Kaydet'; }
}


/** Tek gun <-> aralik gecisi. */
function setMode(yeni) {
  mode = yeni;
  const tekGun = yeni === 'day';

  $('modeDay').classList.toggle('active', tekGun);
  $('modeRange').classList.toggle('active', !tekGun);
  $('dayPane').classList.toggle('hidden', !tekGun);
  $('rangePane').classList.toggle('hidden', tekGun);

  // Aralik moduna gecerken secili gunu baslangic yap
  if (!tekGun && $('rDay').value) {
    $('rFrom').value = $('rDay').value;
    if (!$('rTo').value) $('rTo').value = $('rDay').value;
  }
  loadReport();
}

function render(r) {
  const bas = new Date(r.range.from), son = new Date(r.range.to);
  const saatBicim = { hour: '2-digit', minute: '2-digit' };

  $('rangeLabel').textContent = mode === 'day'
    ? `${bas.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })} günü — ` +
      `${bas.toLocaleTimeString('tr-TR', saatBicim)} / ${son.toLocaleTimeString('tr-TR', saatBicim)}`
    : `${formatDateTime(r.range.from)} — ${formatDateTime(r.range.to)} arası döküm`;

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
  $('modeDay').addEventListener('click', () => setMode('day'));
  $('modeRange').addEventListener('click', () => setMode('range'));

  $('rDay').addEventListener('change', loadReport);
  ['rFrom', 'rTo'].forEach((id) => $(id).addEventListener('change', loadReport));

  $('todayBtn').addEventListener('click', () => {
    $('rDay').value = gunStr(currentBusinessDay(App.dayStartHour));
    loadReport();
  });

  $('yesterdayBtn').addEventListener('click', () => {
    const d = currentBusinessDay(App.dayStartHour);
    d.setDate(d.getDate() - 1);
    $('rDay').value = gunStr(d);
    loadReport();
  });

  /** Son N is gunu (bugun dahil). */
  const sonGunler = (adet) => {
    const son = currentBusinessDay(App.dayStartHour);
    const bas = new Date(son);
    bas.setDate(bas.getDate() - (adet - 1));
    $('rFrom').value = gunStr(bas);
    $('rTo').value = gunStr(son);
    loadReport();
  };

  $('week7Btn').addEventListener('click', () => sonGunler(7));
  $('month30Btn').addEventListener('click', () => sonGunler(30));

  $('printBtn').addEventListener('click', () => window.print());
  $('saveCountBtn').addEventListener('click', saveCounts);
  $('csvBtn').addEventListener('click', () => {
    window.location.href = `/api/reports/reconciliation.csv?day=${encodeURIComponent(recon.day)}`;
  });
}
