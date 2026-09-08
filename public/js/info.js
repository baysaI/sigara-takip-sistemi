/* ============================================================
   İNFO VERENLER sayfası — filtreleme + sayfalama + Excel dökümü

   `info` alanı eskiden tek serbest metindi ve hem KİMİN info verdiğini
   hem NEDENİNİ aynı cümlede taşıyordu; "kim, kaç kez, neden info verdi"
   ancak metinler gözle taranarak cevaplanabiliyordu. Artık ikisi ayrı
   (info_by / info) ve bu sayfa ikisini birlikte listeler.

   Eski kayıtlarda info_by boştur: serbest metin NEDEN sütununda görünür
   ve kişi bazlı özette "(ad girilmemiş)" altında toplanır.
   ============================================================ */
'use strict';

const $ = (id) => document.getElementById(id);

const state = { page: 1, pageSize: 25 };

/** Filtre degisince ilk sayfaya don ve yeniden yukle. */
const refilter = () => { state.page = 1; loadInfo(); };

App.ready(async () => {
  const not = $('infoNote');
  if (not) not.textContent = '· Yalnızca info girilmiş kayıtlar listelenir.';

  fillHourOptions();
  await loadFilterOptions();
  await loadInfo();
  bindEvents();
});

/* ------------------------- Saat aralığı -------------------------
 * Arşivdekiyle aynı: tarih aralığından BAĞIMSIZ, her güne ayrı ayrı
 * uygulanan saat süzgeci. İki uç da dahildir ve saatin tamamını kapsar.
 */
function fillHourOptions() {
  const secenekler = '<option value="">Tümü</option>' +
    Array.from({ length: 24 }, (_, s) =>
      `<option value="${s}">${String(s).padStart(2, '0')}:00</option>`).join('');

  $('fHourFrom').innerHTML = secenekler;
  $('fHourTo').innerHTML = secenekler;
}

/** Seçilen saat aralığını insan diline çevirir (boşsa ''). */
function hourRangeLabel() {
  const bas = $('fHourFrom').value;
  const bit = $('fHourTo').value;
  if (bas === '' && bit === '') return '';

  const b = Number(bas === '' ? bit : bas);
  const s = Number(bit === '' ? bas : bit);
  const ss = (n) => `${String(n).padStart(2, '0')}:00`;
  const bitis = `${String(s).padStart(2, '0')}:59`;

  return b <= s
    ? `Her gün ${ss(b)}–${bitis} arası kayıtlar.`
    : `Her gün ${ss(b)}–${bitis} arası (gece yarısını aşan aralık) kayıtlar.`;
}

function updateFilterHint() {
  const saat = hourRangeLabel();
  $('filterHint').innerHTML = saat
    ? `<b>${esc(saat)}</b> Tarih aralığı da seçilirse ikisi birlikte uygulanır.`
    : 'Tarih saatleri tek bir sürekli aralık kurar. Her güne ayrı uygulanan ' +
      'bir saat süzgeci için <b>Saat aralığı</b> alanını kullanın.';
}

/** Filtre acilir menulerini doldur. */
async function loadFilterOptions() {
  const [kisiler, users] = await Promise.all([
    API.get('/api/records/info-providers').catch(() => ({ names: [] })),
    API.get('/api/users').catch(() => ({ users: [] }))
  ]);

  $('fBy').innerHTML = '<option value="">Tümü</option>' +
    (kisiler.names || []).map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');

  $('fUser').innerHTML = '<option value="">Tümü</option>' +
    (users.users || []).map((u) => `<option value="${esc(u.username)}">${esc(u.username)}</option>`).join('');
}

function currentFilters() {
  /* Tarih + saat. Saat bos birakilirsa gun siniri kullanilir —
     arsiv sayfasiyla ayni davranis. */
  const from = localDateTimeToISO($('fFrom').value, $('fFromTime').value, false);
  const to = localDateTimeToISO($('fTo').value || $('fFrom').value, $('fToTime').value, true);

  return {
    by: $('fBy').value,
    playerId: $('fPlayer').value.trim(),
    user: $('fUser').value,
    from,
    to,
    hourFrom: $('fHourFrom').value,
    hourTo: $('fHourTo').value,
    page: state.page,
    pageSize: state.pageSize
  };
}

async function loadInfo() {
  const body = $('infoBody');
  try {
    const data = await API.get('/api/records/info', currentFilters());
    render(data);
  } catch (err) {
    body.innerHTML = `<tr><td colspan="8" class="empty">Liste yüklenemedi: ${esc(err.message)}</td></tr>`;
  }
}

function render({ records, providers, pagination, summary }) {
  const body = $('infoBody');

  if (!records.length) {
    body.innerHTML = '<tr><td colspan="8" class="empty">Bu filtrelerle info kaydı bulunamadı.</td></tr>';
  } else {
    // data-label: telefonda satirlar karta donusunce etiket olarak gorunur
    body.innerHTML = records.map((r) => `
      <tr${r.superseded_by || r.cancelled_at ? ' class="row-superseded"' : ''}>
        <td data-label="Tarih" class="mono">${formatDateTime(r.created_at)}</td>
        <td data-label="İnfo Veren">
          ${r.info_by
            ? `<b>${esc(r.info_by)}</b>`
            : '<span class="muted" title="Eski kayıt: ad ayrı alanda tutulmuyordu">— ad yok</span>'}
        </td>
        <td data-label="Neden" class="info-cell">
          ${r.info ? esc(r.info) : '<span class="muted">—</span>'}
        </td>
        <td data-label="Oyuncu ID"><span class="pill player">${esc(r.player_id)}</span></td>
        <td data-label="Sigara Türü">
          ${esc(r.cigarette_type)}
          ${r.custom_type ? '<span class="pill custom" title="Tek seferlik sigara">LİSTE DIŞI</span>' : ''}
        </td>
        <td data-label="Adet"><span class="pill qty">${r.quantity}</span></td>
        <td data-label="Garson">${waiterCellHTML(r)}</td>
        <td data-label="Sigaracı">
          ${esc(r.username)}
          ${r.cancelled_at ? '<span class="pill locked" title="Bu satış iptal edildi">İPTAL</span>' : ''}
          ${r.superseded_by ? '<span class="pill locked" title="Bu kayıt değiştirildi">DEĞİŞTİRİLDİ</span>' : ''}
        </td>
      </tr>`).join('');
  }

  $('infoCount').textContent =
    `${summary.total} kayıt · ${summary.providers} kişi · ${summary.totalQuantity} paket`;
  $('pagerInfo').textContent =
    `Sayfa ${pagination.page} / ${pagination.totalPages} — toplam ${pagination.total} kayıt`;
  $('prevPage').disabled = pagination.page <= 1;
  $('nextPage').disabled = pagination.page >= pagination.totalPages;
  state.page = pagination.page;

  renderProviders(providers);
}

/**
 * Kişi bazlı özet. Kayıt listesi olayları tek tek gösterir; bu kart
 * onları kişiye göre toplar — "kim kaç kez info vermiş".
 * Hiç kayıt yoksa gizlenir.
 */
function renderProviders(liste) {
  const kart = $('providerCard');
  if (!kart) return;

  if (!liste?.length) {
    kart.classList.add('hidden');
    $('providerBody').innerHTML = '';
    return;
  }

  $('providerCount').textContent = `${liste.length} kişi`;
  $('providerBody').innerHTML = liste.map((k) => `
    <tr>
      <td data-label="İnfo Veren"><b>${esc(k.name)}</b></td>
      <td data-label="İşlem">${k.islem}</td>
      <td data-label="Paket"><span class="pill qty">${k.paket}</span></td>
      <td data-label="İlk" class="mono">${formatDateTime(k.ilk)}</td>
      <td data-label="Son" class="mono">${formatDateTime(k.son)}</td>
      <td data-label="İşlem">
        <button class="btn-ghost btn-sm" data-by="${esc(k.name)}">Kayıtları göster</button>
      </td>
    </tr>`).join('');

  kart.classList.remove('hidden');
}

function bindEvents() {
  const ALANLAR = ['fBy', 'fUser', 'fFrom', 'fTo', 'fFromTime', 'fToTime', 'fHourFrom', 'fHourTo'];

  $('fPlayer').addEventListener('input', debounce(refilter, 350));
  ALANLAR.forEach((id) => $(id).addEventListener('change', () => {
    updateFilterHint();
    refilter();
  }));

  $('clearFilters').addEventListener('click', () => {
    ['fPlayer', ...ALANLAR].forEach((id) => ($(id).value = ''));
    updateFilterHint();
    refilter();
  });

  /*
   * Excel'e aktar — ekrandaki filtrelerin AYNISIYLA, sayfalama olmadan.
   * Sunucu dosyayi Content-Disposition ile gonderdigi icin adres
   * degistirmek yeterli: sayfa yerinde kalir, tarayici indirmeyi baslatir.
   */
  $('csvBtn').addEventListener('click', () => {
    const { page, pageSize, ...suzgec } = currentFilters();
    const qs = new URLSearchParams(
      Object.entries(suzgec).filter(([, v]) => v !== '' && v != null)
    );
    window.location.href = `/api/records/info.csv?${qs}`;
    toast('Excel dosyası hazırlanıyor — indirilenler klasörüne düşecek.', 'info');
  });

  /* Ozet satirindaki "Kayitlari goster": kisi suzgecini o ada ceker.
     "(ad girilmemis)" gercek bir ad degil, suzgece cevrilemez. */
  $('providerBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-by]');
    if (!btn) return;

    const ad = btn.dataset.by;
    const sel = $('fBy');
    if (![...sel.options].some((o) => o.value === ad)) {
      return toast('Bu satır adı girilmemiş kayıtları toplar; süzgece çevrilemez.', 'info', 5000);
    }
    sel.value = ad;
    updateFilterHint();
    refilter();
    sel.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  // Sayfa degisince listenin basina don (telefonda onemli)
  const go = (delta) => {
    state.page += delta;
    loadInfo().then(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  };
  $('prevPage').addEventListener('click', () => go(-1));
  $('nextPage').addEventListener('click', () => go(1));

  updateFilterHint();
}
