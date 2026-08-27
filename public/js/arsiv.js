/* ============================================================
   Arsiv sayfasi — filtreleme + sayfalama
   ============================================================ */
'use strict';

const $ = (id) => document.getElementById(id);

const state = { page: 1, pageSize: 25 };

/** Garson filtresi otomatik tamamlama */
let waiterAC = null;

/** Filtre degisince ilk sayfaya don ve yeniden yukle. */
const refilter = () => { state.page = 1; loadArchive(); };

App.ready(async () => {
  // Yonetici satir basina silme yapabilir; basligi ona gore ekle
  if (App.user.role === 'admin') {
    document.querySelector('#archiveBody')
      .closest('table').querySelector('thead tr')
      .insertAdjacentHTML('beforeend', '<th>İşlem</th>');
  }
  /*
   * Tarih filtresi TAKVIM gunune gore calisir (00:00-23:59). Is gunu artik
   * saatle degil, gun sonu raporunun alinmasiyla degistigi icin bir takvim
   * tarihini sabit bir donem araligina cevirmek mumkun degil — donem bazli
   * dokum icin Gun Sonu Raporu sayfasi kullanilir.
   */
  const not = $('dayNote');
  if (not) not.textContent = '· Tarih filtresi takvim gününe göredir (00:00–23:59).';

  await loadFilterOptions();
  await loadArchive();
  bindEvents();
});

/** Filtre acilir menulerini doldur. */
async function loadFilterOptions() {
  const [{ waiters }, { types }, users] = await Promise.all([
    API.get('/api/waiters'),
    API.get('/api/cigarette-types'),
    API.get('/api/users').catch(() => ({ users: [] }))
  ]);

  // Arsiv garson adina gore filtrelenir (kayitlarda ad snapshot olarak tutulur),
  // bu yuzden secim degeri olarak id degil ismin kendisi kullanilir.
  waiterAC = createAutocomplete({
    input: $('fWaiterSearch'),
    hidden: $('fWaiter'),
    list: $('fWaiterList'),
    items: waiters.map((w) => ({ id: w.name, name: w.name })),
    onSelect: refilter
  });

  $('fType').innerHTML = '<option value="">Tümü</option>' +
    types.map((t) => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('');

  $('fUser').innerHTML = '<option value="">Tümü</option>' +
    (users.users || []).map((u) => `<option value="${esc(u.username)}">${esc(u.username)}</option>`).join('');
}

function currentFilters() {
  // Takvim gunu siniri: baslangic 00:00, bitis 23:59:59.999 (yerel saat)
  const from = localDateToISO($('fFrom').value, false);
  const to = localDateToISO($('fTo').value || $('fFrom').value, true);

  return {
    playerId: $('fPlayer').value.trim(),
    waiter: $('fWaiter').value,
    type: $('fType').value,
    user: $('fUser').value,
    from,
    to,
    page: state.page,
    pageSize: state.pageSize
  };
}

async function loadArchive() {
  const body = $('archiveBody');
  try {
    const data = await API.get('/api/records', currentFilters());
    renderArchive(data);
  } catch (err) {
    body.innerHTML = `<tr><td colspan="8" class="empty">Arşiv yüklenemedi: ${esc(err.message)}</td></tr>`;
  }
}

function renderArchive({ records, pagination, summary }) {
  const body = $('archiveBody');

  if (!records.length) {
    body.innerHTML = `<tr><td colspan="${App.user.role === 'admin' ? 8 : 7}" class="empty">Bu filtrelerle kayıt bulunamadı.</td></tr>`;
  } else {
    // data-label: telefonda satirlar karta donusunce etiket olarak gorunur
    body.innerHTML = records.map((r) => `
      <tr>
        <td data-label="Tarih" class="mono">${formatDateTime(r.created_at)}</td>
        <td data-label="Oyuncu ID">
          <span class="pill player">${esc(r.player_id)}</span>
          ${r.early_release ? '<span class="pill early" title="Süresi dolmadan, yetkili onayıyla verildi">ERKEN</span>' : ''}
          ${r.flag_level ? '<span class="pill locked" title="Özel uyarı/onay ile verildi">ONAYLI</span>' : ''}
        </td>
        <td data-label="Sigara Türü">${esc(r.cigarette_type)}</td>
        <td data-label="Adet"><span class="pill qty">${r.quantity}</span></td>
        <td data-label="Garson">${esc(r.waiter_name)}</td>
        <td data-label="Sigaracı">${esc(r.username)}</td>
        <td data-label="Info" class="info-cell">${r.info ? esc(r.info) : '—'}</td>
        ${App.user.role === 'admin' ? `
        <td data-label="İşlem">
          <button class="btn-danger btn-sm" data-del="${r.id}"
                  data-ozet="${esc(r.player_id)} — ${esc(r.cigarette_type)} ×${r.quantity}">Sil</button>
        </td>` : ''}
      </tr>`).join('');

    if (App.user.role === 'admin') {
      body.querySelectorAll('[data-del]').forEach((btn) =>
        btn.addEventListener('click', () => silKayit(btn.dataset.del, btn.dataset.ozet)));
    }
  }

  $('archiveCount').textContent = `${summary.total} kayıt · ${summary.totalQuantity} adet`;
  $('pagerInfo').textContent =
    `Sayfa ${pagination.page} / ${pagination.totalPages} — toplam ${pagination.total} kayıt`;
  $('prevPage').disabled = pagination.page <= 1;
  $('nextPage').disabled = pagination.page >= pagination.totalPages;
  state.page = pagination.page;
}

/** Tek kaydi siler. Varsayilan olarak stok iade edilir. */
async function silKayit(id, ozet) {
  const onay = await confirmDelete({
    title: 'Kaydı sil',
    body: `<b>${esc(ozet)}</b> kaydı arşivden silinecek.<br />
           Verilen paketler <b>stoğa geri eklenir</b> ve bu bir düzeltme hareketi olarak loglanır.`
  });
  if (!onay) return;

  try {
    const r = await API.request(`/api/records/${id}`, { method: 'DELETE' });
    await loadArchive();
    toast(
      r.restocked
        ? `Kayıt silindi. ${r.restocked.type} stoğu ${r.restocked.balance} pakete çıktı.`
        : 'Kayıt silindi.',
      'success'
    );
  } catch (err) { toast(err.message, 'error'); }
}

function bindEvents() {
  $('fPlayer').addEventListener('input', debounce(refilter, 350));
  // Garson filtresi kendi onSelect'i ile tetiklenir
  ['fType', 'fUser', 'fFrom', 'fTo'].forEach((id) =>
    $(id).addEventListener('change', refilter));

  $('clearFilters').addEventListener('click', () => {
    ['fPlayer', 'fType', 'fUser', 'fFrom', 'fTo'].forEach((id) => ($(id).value = ''));
    waiterAC.reset();
    refilter();
  });

  // Sayfa degisince listenin basina don (telefonda onemli)
  const go = (delta) => {
    state.page += delta;
    loadArchive().then(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  };
  $('prevPage').addEventListener('click', () => go(-1));
  $('nextPage').addEventListener('click', () => go(1));
}
