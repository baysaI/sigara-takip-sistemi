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
  /* Islem sutunu HERKESE gorunur: sigara degisimi yonetici yetkisi
     istemez (sigaraci da yapabilir), iptal ise yalnizca yoneticide. */
  document.querySelector('#archiveBody')
    .closest('table').querySelector('thead tr')
    .insertAdjacentHTML('beforeend', '<th>İşlem</th>');
  /*
   * Tarih filtresi TAKVIM gunune gore calisir; saat girilirse o saatten
   * o saate. Is gunu artik saatle degil, gun sonu raporunun alinmasiyla
   * degistigi icin bir takvim tarihini sabit bir donem araligina cevirmek
   * mumkun degil — donem bazli dokum icin Gun Sonu Raporu sayfasi var.
   */
  const not = $('dayNote');
  if (not) not.textContent = '· Tarih aralığı ve/veya günden bağımsız saat aralığı ile filtrelenir.';

  fillHourOptions();
  await loadFilterOptions();
  await loadArchive();
  bindEvents();
});

/** Filtre acilir menulerini doldur. */
async function loadFilterOptions() {
  const [{ waiters }, { types }, users, ozel] = await Promise.all([
    API.get('/api/waiters'),
    API.get('/api/cigarette-types'),
    API.get('/api/users').catch(() => ({ users: [] })),
    // Tek seferlik tur adlari cigarette_types'ta YOK; ayri uctan gelir
    API.get('/api/records/custom-types').catch(() => ({ names: [] }))
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

  /* Tur suzgeci: once kayitli turler, sonra ayri bir grupta tek seferlik
     olanlar. Ayni acilir menude durmalari, "liste disi" bir markanin
     kayitlarini gormek icin ayri bir arayuz gerektirmemesini sagliyor. */
  $('fType').innerHTML = '<option value="">Tümü</option>' +
    types.map((t) => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('') +
    (ozel.names?.length
      ? `<optgroup label="Tek seferlik (liste dışı)">${
          ozel.names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')
        }</optgroup>`
      : '');

  $('fUser').innerHTML = '<option value="">Tümü</option>' +
    (users.users || []).map((u) => `<option value="${esc(u.username)}">${esc(u.username)}</option>`).join('');
}

/* ------------------------- Saat aralığı -------------------------
 * Tarih aralığından BAĞIMSIZ süzgeç: "hangi gün olursa olsun 22:00–04:00".
 *
 * Tarih+saat kutuları tek bir sürekli aralık kurar ("1 Eylül 22:00'dan
 * 2 Eylül 04:00'a"). Aranan çoğu zaman bu değil — gece vardiyasının bir
 * aylık dökümü gibi. Burası her güne ayrı ayrı uygulanır; ikisi birlikte
 * de kullanılabilir.
 *
 * İki uç da DAHİLDİR ve saatin tamamını kapsar: 14 → 14 seçimi
 * 14:00–14:59 arasıdır ("belirli bir saat"). Sunucu aynı kuralı uygular.
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

  // Tek uç seçilmişse tek saat aranıyor demektir — sunucu da böyle yorumlar.
  const b = Number(bas === '' ? bit : bas);
  const s = Number(bit === '' ? bas : bit);

  const ss = (n) => `${String(n).padStart(2, '0')}:00`;
  const bitis = `${String(s).padStart(2, '0')}:59`;

  if (b === s) return `Her gün ${ss(b)}–${bitis} arası kayıtlar.`;
  return b < s
    ? `Her gün ${ss(b)}–${bitis} arası kayıtlar.`
    : `Her gün ${ss(b)}–${bitis} arası (gece yarısını aşan aralık) kayıtlar.`;
}

/** Filtre kutusunun altındaki açıklamayı seçime göre günceller. */
function updateFilterHint() {
  const saat = hourRangeLabel();
  $('filterHint').innerHTML = saat
    ? `<b>${esc(saat)}</b> Tarih aralığı da seçilirse ikisi birlikte uygulanır.`
    : 'Tarih saatleri tek bir sürekli aralık kurar (ör. <b>dün 22:00</b> → <b>bugün 04:00</b>). ' +
      'Her güne ayrı uygulanan bir saat süzgeci için <b>Saat aralığı</b> alanını kullanın.';
}

function currentFilters() {
  /* Tarih + saat. Saat bos birakilirsa gun siniri kullanilir
     (baslangic 00:00, bitis 23:59:59.999) — eski davranis korunur.
     Saat girilince vardiya araligi kurulabilir: dun 22:00 → bugun 04:00. */
  const from = localDateTimeToISO($('fFrom').value, $('fFromTime').value, false);
  const to = localDateTimeToISO($('fTo').value || $('fFrom').value, $('fToTime').value, true);

  return {
    playerId: $('fPlayer').value.trim(),
    waiter: $('fWaiter').value,
    type: $('fType').value,
    user: $('fUser').value,
    from,
    to,
    // Bos string API.get tarafinda zaten elenir
    hourFrom: $('fHourFrom').value,
    hourTo: $('fHourTo').value,
    page: state.page,
    pageSize: state.pageSize
  };
}

async function loadArchive() {
  const body = $('archiveBody');
  try {
    const data = await API.get('/api/records', currentFilters());
    renderArchive(data);
    renderCustomTypes(data.customTypes);
  } catch (err) {
    body.innerHTML = `<tr><td colspan="8" class="empty">Arşiv yüklenemedi: ${esc(err.message)}</td></tr>`;
  }
}

/**
 * TEK SEFERLİK ("liste dışı") SİGARALAR kartı.
 *
 * Bu türlerin stok kartı yoktur; Stok panelinde ve mutabakat tablosunda
 * satırları olmaz. Hangi markaların bu şekilde alındığı yalnızca arşivi
 * satır satır tarayarak görülebiliyordu — kart bunu özetler.
 *
 * Sayılar sayfalamadan bağımsızdır: yürürlükteki filtreye uyan TÜM
 * kayıtları kapsar. Hiç yoksa kart gizlenir; bu özelliği kullanmayan
 * kurulumda sayfa boş bir kartla dolmasın.
 */
function renderCustomTypes(liste) {
  const kart = $('customCard');
  if (!kart) return;

  if (!liste?.length) {
    kart.classList.add('hidden');
    $('customBody').innerHTML = '';
    return;
  }

  const toplamPaket = liste.reduce((t, c) => t + c.paket, 0);
  $('customCount').textContent = `${liste.length} marka · ${toplamPaket} paket`;

  $('customBody').innerHTML = liste.map((c) => `
    <tr>
      <td data-label="Sigara">
        <b>${esc(c.name)}</b>
        <span class="pill custom" title="Ana listede yok, stoktan düşülmedi">LİSTE DIŞI</span>
      </td>
      <td data-label="İşlem">${c.islem}</td>
      <td data-label="Paket"><span class="pill qty">${c.paket}</span></td>
      <td data-label="İlk Alım" class="mono">${formatDateTime(c.ilk)}</td>
      <td data-label="Son Alım" class="mono">${formatDateTime(c.son)}</td>
      <td data-label="İşlem">
        <button class="btn-ghost btn-sm" data-ctype="${esc(c.name)}">Kayıtları göster</button>
      </td>
    </tr>`).join('');

  kart.classList.remove('hidden');
}

function renderArchive({ records, pagination, summary }) {
  const body = $('archiveBody');

  if (!records.length) {
    body.innerHTML = '<tr><td colspan="8" class="empty">Bu filtrelerle kayıt bulunamadı.</td></tr>';
  } else {
    // data-label: telefonda satirlar karta donusunce etiket olarak gorunur
    body.innerHTML = records.map((r) => {
      /*
       * Degisim yalnizca ACIK donemin, henuz degistirilmemis kaydi icin.
       * Kapanmis gunun kaydini degistirmek stogu cari doneme, kaydi eski
       * doneme dusururdu (sunucu da ayni kurali uygular).
       *
       * Iptal ise kapanmis gunde de yapilabilir — "gec iptal" olarak cari
       * doneme iade islenir; o yuzden acik donem sarti aranmaz.
       */
      const acikDonemde = !App.period || r.created_at >= App.period.from;
      const degisebilir = !r.superseded_by && acikDonemde;
      // Iptal sigaraciya da acik: iadeyi tezgahta alan kisi o.
      const iptalEdilebilir = !r.superseded_by;

      return `
      <tr${r.superseded_by ? ' class="row-superseded"' : ''}>
        <td data-label="Tarih" class="mono">${formatDateTime(r.created_at)}</td>
        <td data-label="Oyuncu ID">
          <span class="pill player">${esc(r.player_id)}</span>
          ${r.early_release ? '<span class="pill early" title="Süresi dolmadan, yetkili onayıyla verildi">ERKEN</span>' : ''}
          ${r.flag_level ? '<span class="pill locked" title="Özel uyarı/onay ile verildi">ONAYLI</span>' : ''}
          ${r.superseded_by ? '<span class="pill locked" title="Bu kayıt değiştirildi; geçerli olan yerine geçen kayıttır">DEĞİŞTİRİLDİ</span>' : ''}
        </td>
        <td data-label="Sigara Türü">
          ${esc(r.cigarette_type)}
          ${r.exchanged_from ? '<span class="pill swap" title="Sigara değişimi sonucu oluşan kayıt">DEĞİŞİM</span>' : ''}
          ${r.custom_type ? '<span class="pill custom" title="Tek seferlik sigara — ana listede yok, stok kartı olmadığı için stoktan düşülmedi">LİSTE DIŞI</span>' : ''}
        </td>
        <td data-label="Adet"><span class="pill qty">${r.quantity}</span></td>
        <td data-label="Garson">${waiterCellHTML(r)}</td>
        <td data-label="Sigaracı">${esc(r.username)}</td>
        <td data-label="Info" class="info-cell">${recordDetailHTML(r)}</td>
        <td data-label="İşlem">
          <div class="row-actions">
            ${degisebilir
              ? `<button class="btn-ghost btn-sm" data-swap="${r.id}">Değiştir</button>`
              : (!r.superseded_by
                  ? '<span class="muted" title="Bu kaydın günü kapandı — değişim yapılamaz">gün kapalı</span>'
                  : '')}
            ${iptalEdilebilir ? `<button class="btn-danger btn-sm" data-cancel="${r.id}">İptal Et</button>` : ''}
            <button class="btn-ghost btn-sm" data-pid="${r.id}">ID Düzelt</button>
            <button class="btn-ghost btn-sm" data-info="${r.id}">${r.info_by || r.info ? 'İnfo Düzenle' : 'İnfo Ekle'}</button>
            ${!degisebilir && !iptalEdilebilir && r.superseded_by ? '<span class="muted">—</span>' : ''}
          </div>
        </td>
      </tr>`;
    }).join('');

    const bul = (id) => records.find((x) => String(x.id) === id);

    body.querySelectorAll('[data-swap]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const kayit = bul(btn.dataset.swap);
        if (kayit) degistir(kayit);
      }));

    body.querySelectorAll('[data-cancel]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const kayit = bul(btn.dataset.cancel);
        if (kayit) iptalEt(kayit);
      }));

    /* ID duzeltme kapanmis donemde de yapilabilir: stok ve adet degismez,
       yalnizca kaydin sahibi degisir (bkz. services/playerEdit.js). */
    /* Sonradan info ekleme: sigara verildi, info veren sonra belli oldu. */
    body.querySelectorAll('[data-info]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const kayit = bul(btn.dataset.info);
        if (!kayit) return;
        btn.disabled = true;
        const degisti = await handleInfoEdit(kayit);
        btn.disabled = false;
        if (degisti) await loadArchive();
      }));

    body.querySelectorAll('[data-pid]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const kayit = bul(btn.dataset.pid);
        if (!kayit) return;
        btn.disabled = true;
        const gec = !!App.period && kayit.created_at < App.period.from;
        const degisti = await handlePlayerIdEdit(kayit, gec);
        btn.disabled = false;
        if (degisti) await loadArchive();
      }));
  }

  $('archiveCount').textContent = `${summary.total} kayıt · ${summary.totalQuantity} adet`;
  $('pagerInfo').textContent =
    `Sayfa ${pagination.page} / ${pagination.totalPages} — toplam ${pagination.total} kayıt`;
  $('prevPage').disabled = pagination.page <= 1;
  $('nextPage').disabled = pagination.page >= pagination.totalPages;
  state.page = pagination.page;
}

/**
 * Sigara degisimi — arsiv satirindan.
 * Ilk kayit silinmez; arsivde DEGISTIRILDI olarak kalir ve yerine gecen
 * kayda baglanir. 4 saat sayaci degisimden etkilenmez.
 */
async function degistir(kayit) {
  let turler;
  try {
    // Stok anlik alinir: ekrandaki liste bayat olabilir
    turler = (await API.get('/api/stock')).cards;
  } catch (err) {
    return toast(`Değişim ekranı açılamadı: ${err.message}`, 'error');
  }

  const secim = await showExchangeDialog({ record: kayit, types: turler });
  if (!secim) return;

  try {
    const res = await API.post(`/api/records/${kayit.id}/exchange`, secim);
    await loadArchive();

    toast(
      `${res.replacement.player_id} — ${res.exchange.from_type_name} → ` +
      `${res.exchange.to_type_name} ×${res.exchange.quantity} değiştirildi.`,
      'success', 5000
    );
    if (res.stock.returned) {
      toast(`↩️ ${res.stock.returned.name}: ${res.stock.returned.balance} paket (iade edildi)`, 'info', 4500);
    }
    if (res.stock.issued.state === 'critical') {
      toast(`⚠️ ${res.stock.issued.name} kritik seviyede (${res.stock.issued.balance} paket).`, 'error', 6000);
    }
    if (res.stock.issued.state === 'out') {
      toast(`⛔ ${res.stock.issued.name} tükendi.`, 'error', 6000);
    }
  } catch (err) {
    toast(err.message, 'error', 6000);
    await loadArchive();
  }
}

/**
 * Satisi IPTAL eder — silmez.
 * Kayit aktif arsivden cikar, "Iptaller" bolumune gecmisiyle tasinir,
 * sigara stoga doner ve oyuncunun sayaci serbest kalir.
 */
async function iptalEt(kayit) {
  // Satisin donemi kapanmis mi? Kapanmissa iade cari doneme duzeltme
  // olarak duser ve kapanmis raporun sayilari degismez — kullaniciya
  // bunu ONCEDEN soyleyebilmek icin burada hesaplaniyor.
  const gec = !!App.period && kayit.created_at < App.period.from;

  const onay = await confirmCancel({ record: kayit, late: gec });
  if (!onay) return;

  try {
    const r = await API.post(`/api/records/${kayit.id}/cancel`, { reason: onay.reason });
    await loadArchive();

    toast(
      r.restocked
        ? `Satış iptal edildi. ${r.restocked.name} stoğu ${r.restocked.balance} pakete çıktı.`
        : 'Satış iptal edildi.',
      'success', 5000
    );
    if (r.late) {
      toast(
        `${periodLabel(r.saleDayKey)} tarihli satıştı — o günün raporu değişmedi, ` +
        'iade bugünün dönemine düzeltme olarak işlendi.',
        'info', 7000
      );
    }
  } catch (err) { toast(err.message, 'error', 6000); }
}

function bindEvents() {
  const ALANLAR = ['fType', 'fUser', 'fFrom', 'fTo', 'fFromTime', 'fToTime', 'fHourFrom', 'fHourTo'];

  $('fPlayer').addEventListener('input', debounce(refilter, 350));
  // Garson filtresi kendi onSelect'i ile tetiklenir
  ALANLAR.forEach((id) => $(id).addEventListener('change', () => {
    updateFilterHint();
    refilter();
  }));

  $('clearFilters').addEventListener('click', () => {
    ['fPlayer', ...ALANLAR].forEach((id) => ($(id).value = ''));
    waiterAC.reset();
    updateFilterHint();
    refilter();
  });

  /*
   * Excel'e aktar — ekrandaki filtrelerin AYNISIYLA, sayfalama olmadan.
   * Sunucu dosyayi Content-Disposition ile gonderdigi icin adres degistirmek
   * yeterli: sayfa yerinde kalir, tarayici indirmeyi baslatir.
   * (Gun sonu raporundaki "Excel'e Aktar" ile ayni yontem.)
   */
  $('csvBtn').addEventListener('click', () => {
    const { page, pageSize, ...suzgec } = currentFilters();   // dokum sayfalanmaz
    const qs = new URLSearchParams(
      Object.entries(suzgec).filter(([, v]) => v !== '' && v != null)
    );
    window.location.href = `/api/records/export.csv?${qs}`;
    toast('Excel dosyası hazırlanıyor — indirilenler klasörüne düşecek.', 'info');
  });

  /* Kart satirindaki "Kayitlari goster": tur suzgecini o markaya ceker.
     Ad, acilir menude "Tek seferlik" grubunda zaten var; olmadigi tek
     durum kaydin bu oturum acikken girilmis olmasidir — o zaman secenek
     ekleyip devam ederiz, kullanici sayfayi yenilemek zorunda kalmasin. */
  $('customBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ctype]');
    if (!btn) return;

    const ad = btn.dataset.ctype;
    const sel = $('fType');
    if (![...sel.options].some((o) => o.value === ad)) {
      sel.insertAdjacentHTML('beforeend', `<option value="${esc(ad)}">${esc(ad)}</option>`);
    }
    sel.value = ad;

    updateFilterHint();
    refilter();
    sel.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  updateFilterHint();   // acilistaki metin

  // Sayfa degisince listenin basina don (telefonda onemli)
  const go = (delta) => {
    state.page += delta;
    loadArchive().then(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  };
  $('prevPage').addEventListener('click', () => go(-1));
  $('nextPage').addEventListener('click', () => go(1));
}
