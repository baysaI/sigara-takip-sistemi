/* ============================================================
   IPTAL EDILENLER / ARSIV

   Iptal veya iade edilen satislar. Kayit silinmez: aktif arsivden
   cikar ve tum gecmisiyle burada durur.

   "Gec iptal" rozeti onemli: satisin ait oldugu gun KAPANDIKTAN sonra
   yapilan iptaldir. Kapanmis gunun raporu degismez (sigara o gun
   gercekten satilmisti), iade cari doneme duzeltme olarak islenir.
   Ayrinti: services/cancellation.js
   ============================================================ */
'use strict';

const $ = (id) => document.getElementById(id);

/** Tablo sutun sayisi — yoneticide "Islem" sutunu da var. */
const SUTUN = () => 9;   // Islem sutunu artik herkeste var

const state = { page: 1 };
const refilter = () => { state.page = 1; loadCancellations(); };

App.ready(async () => {
  // Geri alma sigaraciya da acik; sutun herkese eklenir
  document.querySelector('#cancelBody')
    .closest('table').querySelector('thead tr')
    .insertAdjacentHTML('beforeend', '<th>İşlem</th>');
  await loadFilterOptions();
  await loadCancellations();
  bindEvents();
});

/** Filtre acilir menulerini doldur. */
async function loadFilterOptions() {
  const [{ types }, users] = await Promise.all([
    API.get('/api/cigarette-types'),
    // Sigaraci hesabinda /api/users kapali; filtre bos kalir, sayfa calisir
    API.get('/api/users').catch(() => ({ users: [] }))
  ]);

  $('fType').innerHTML = '<option value="">Tümü</option>' +
    types.map((t) => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('');

  $('fUser').innerHTML = '<option value="">Tümü</option>' +
    (users.users || []).map((u) => `<option value="${esc(u.username)}">${esc(u.username)}</option>`).join('');
}

function currentFilters() {
  return {
    playerId: $('fPlayer').value.trim(),
    type: $('fType').value,
    user: $('fUser').value,
    late: $('fLate').value,
    // Tarih filtresi IPTAL anina gore (takvim gunu, 00:00-23:59)
    from: localDateToISO($('fFrom').value, false),
    to: localDateToISO($('fTo').value || $('fFrom').value, true),
    page: state.page,
    pageSize: 50
  };
}

async function loadCancellations() {
  const body = $('cancelBody');
  body.innerHTML = `<tr><td colspan="${SUTUN()}" class="empty">Yükleniyor...</td></tr>`;

  let veri;
  try {
    veri = await API.get('/api/records/cancelled', currentFilters());
  } catch (err) {
    body.innerHTML = `<tr><td colspan="${SUTUN()}" class="empty">Yüklenemedi: ${esc(err.message)}</td></tr>`;
    return;
  }

  const { records, summary, pagination } = veri;

  $('sTotal').textContent = summary.total;
  $('sQty').textContent   = summary.totalQuantity;
  $('sLate').textContent  = summary.late;

  if (!records.length) {
    body.innerHTML = `<tr><td colspan="${SUTUN()}" class="empty">İptal edilmiş satış yok.</td></tr>`;
  } else {
    body.innerHTML = records.map((r) => `
      <tr>
        <td data-label="İptal Tarihi" class="mono">${formatDateTime(r.cancelled_at)}</td>
        <td data-label="Oyuncu ID">
          <span class="pill player">${esc(r.player_id)}</span>
          ${r.late ? '<span class="pill locked" title="Satışın günü kapandıktan sonra iptal edildi; o günün raporu değişmedi, iade bu döneme işlendi">GEÇ İPTAL</span>' : ''}
          ${r.exchanged_from ? '<span class="pill swap" title="Sigara değişimi sonucu oluşan kayıt">DEĞİŞİM</span>' : ''}
          ${r.early_release ? '<span class="pill early" title="Süresi dolmadan verilmişti">ERKEN</span>' : ''}
        </td>
        <td data-label="Sigara Türü">
          ${esc(r.cigarette_type)}
          ${r.restocked ? '' : '<span class="pill locked" title="Stok iadesi yapılmadı">İADESİZ</span>'}
        </td>
        <td data-label="Adet"><span class="pill qty">${r.quantity}</span></td>
        <td data-label="Satış Tarihi" class="mono muted">${formatDateTime(r.created_at)}</td>
        <td data-label="Neden" class="info-cell">${r.cancel_reason ? esc(r.cancel_reason) : '—'}</td>
        <td data-label="İptal Eden"><b>${esc(r.cancelled_by)}</b></td>
        <td data-label="Garson" class="muted">${waiterCellHTML(r)}</td>
        <td data-label="İşlem">
          <div class="row-actions">
            ${r.canUndo
              ? `<button class="btn-ghost btn-sm" data-undo="${r.id}">Geri Al</button>`
              : `<span class="muted" title="Satışın günü kapandı — geri almak kapanmış raporu değiştirirdi">kilitli</span>`}
            ${kokHesap() ? `<button class="btn-danger btn-sm" data-del="${r.id}" title="Kaydı kalıcı olarak siler — yalnızca kök hesap">Sil</button>` : ''}
          </div>
        </td>
      </tr>`).join('');

    /* KALICI SILME — yalnizca kok hesap. Iptal edilmis kaydin stogu
       zaten geri donmustu; sunucu tekrar eklemez. */
    body.querySelectorAll('[data-del]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const kayit = records.find((x) => String(x.id) === btn.dataset.del);
        if (!kayit) return;
        btn.disabled = true;
        const silindi = await handleRecordDelete(kayit);
        btn.disabled = false;
        if (silindi) await loadCancellations();
      }));

    body.querySelectorAll('[data-undo]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const kayit = records.find((x) => String(x.id) === btn.dataset.undo);
        if (kayit) geriAl(kayit);
      }));
  }

  $('cancelCount').textContent = `${summary.total} iptal · ${summary.totalQuantity} paket iade`;
  $('pagerInfo').textContent =
    `Sayfa ${pagination.page} / ${pagination.totalPages} — toplam ${pagination.total} kayıt`;
  $('prevPage').disabled = pagination.page <= 1;
  $('nextPage').disabled = pagination.page >= pagination.totalPages;
  state.page = pagination.page;
}

/**
 * Iptali geri alir: satis yeniden aktif kayit olur.
 * Sigara tekrar stoktan duser, oyuncunun sayaci yeniden isler.
 */
async function geriAl(kayit) {
  const onay = await confirmDelete({
    title: 'İptali geri al',
    icon: '↩️',
    body:
      `<b>${esc(kayit.player_id)}</b> — ${esc(kayit.cigarette_type)} ×${kayit.quantity}<br />` +
      `İptal eden: <b>${esc(kayit.cancelled_by)}</b> · ${formatDateTime(kayit.cancelled_at)}` +
      (kayit.cancel_reason ? `<br />Neden: ${esc(kayit.cancel_reason)}` : '') +
      '<br /><br />Satış <b>yeniden aktif kayıt</b> olacak: sigara tekrar stoktan ' +
      `düşecek ve oyuncunun ${App.cooldownHours} saat sayacı yeniden işleyecek.`,
    warning: 'İptal kaydı silinmez, "geri alındı" olarak işaretlenir.',
    confirmText: 'İptali Geri Al'
  });
  if (!onay) return;

  try {
    const r = await API.post(`/api/records/${kayit.id}/uncancel`, {});
    await loadCancellations();

    toast(
      r.stock
        ? `İptal geri alındı. ${r.stock.name} stoğu ${r.stock.balance} pakete indi.`
        : 'İptal geri alındı.',
      'success', 5000
    );
    if (r.stock && r.stock.state === 'critical') {
      toast(`⚠️ ${r.stock.name} kritik seviyede (${r.stock.balance} paket).`, 'error', 6000);
    }
  } catch (err) { toast(err.message, 'error', 7000); }
}

function bindEvents() {
  $('fPlayer').addEventListener('input', debounce(refilter, 350));
  ['fType', 'fUser', 'fLate', 'fFrom', 'fTo'].forEach((id) =>
    $(id).addEventListener('change', refilter));

  $('clearFilters').addEventListener('click', () => {
    ['fPlayer', 'fType', 'fUser', 'fLate', 'fFrom', 'fTo'].forEach((id) => ($(id).value = ''));
    refilter();
  });

  // Sayfa degisince listenin basina don (telefonda onemli)
  const git = (delta) => {
    state.page += delta;
    loadCancellations().then(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  };
  $('prevPage').addEventListener('click', () => git(-1));
  $('nextPage').addEventListener('click', () => git(1));
}
