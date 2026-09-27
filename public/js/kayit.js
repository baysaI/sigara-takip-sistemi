/* ============================================================
   Hizli Kayit sayfasi — 4 saat kurali + kayit olusturma
   ============================================================ */
'use strict';

const $ = (id) => document.getElementById(id);

/** Aktif geri sayim durumu */
const cd = {
  playerId: '', allowed: false, deadline: 0, lastAt: null, lastRecord: null,
  totalRecords: 0, flag: null,
  // Gonder dugmesinin son durumu — on kosullar degisince yeniden uygulanir
  submitEnabled: false, submitHint: ''
};
let timer = null;

/** Garson otomatik tamamlama bileseni */
let waiterAC = null;

/** Sistemde hic garson veya sigara turu tanimli degilse kayit yapilamaz. */
let waitersReady = false;
let typesReady = false;

/**
 * Bu adetin UZERINDE kayit dogrudan acilmaz, once onay ekrani cikar.
 * 1 = "birden fazla paket her zaman sorulsun". Buyutmek isterseniz
 * (ornegin 2 paket normalse) tek yer burasi.
 */
const ADET_ONAY_ESIGI = 1;

App.ready(async () => {
  showDayInfo();
  await Promise.all([loadTypes(), loadWaiters()]);
  await Promise.all([loadStats(), loadRecent(), loadInfoProviders()]);
  bindEvents();
});

/**
 * INFO VEREN KISI — Alan Garson ile AYNI bilesen, LISTEDEN secim.
 *
 * Serbest metin kabul edilmez (custom secenegi YOK): isimleri yonetici
 * tanimlar, boylece ayni kisi "Ahmet / ahmet / Ahmet Bey" diye uce
 * bolunmez ve Info Verenler listesi duzgun toplanir.
 *
 * Alan OPSIYONELDIR: bos birakilabilir, o zaman kayitta info veren olmaz.
 */
let infoAC = null;

async function loadInfoProviders() {
  let providers = [];
  try {
    providers = (await API.get('/api/info-providers')).providers || [];
  } catch { /* liste alinamadi; alan bos kalir, kayit yine acilabilir */ }

  $('noInfoProviders').classList.toggle('hidden', providers.length > 0);
  $('infoBySearch').placeholder = providers.length
    ? 'İsim yazın...'
    : 'Tanımlı info veren yok';

  if (infoAC) return infoAC.setItems(providers);

  infoAC = createAutocomplete({
    input: $('infoBySearch'),
    hidden: $('infoById'),
    list: $('infoByList'),
    items: providers,
    emptyText: 'Eşleşen kişi yok'
  });
}

/**
 * Hangi is gunundeyiz — gun degisimi SAATE bagli degil.
 * Acik donem, yonetici Gun Sonu Raporu'nu alana kadar surer.
 */
function showDayInfo() {
  const el = $('dayInfo');
  if (!el || !App.period) return;

  // openedAt bakir sistemde null gelir: "1970'ten beri acik" yazilmasin
  const sure = App.period.openedAt
    ? periodDuration(App.period.openedAt, App.period.asOf)
    : '';

  el.textContent =
    `· İş günü: ${periodLabel(App.period.dayKey)}` +
    (sure ? ` — ${sure} önce açıldı` : '') +
    ' (gün sonu raporu alınınca değişir)';
}

/* ---------------------- Referans listeler ---------------------- */

/**
 * TEK SEFERLIK ("liste disi") GARSON — "Yeni Garson Ekle".
 *
 * O gun ekstra calisan, kadroda olmayan biri icin. Yazilan ad garson
 * listesine EKLENMEZ; yalnizca o kayda islenir. Tek seferlik sigarada
 * (custom_type) oldugu gibi: kalici tanim listesi bir kerelik girdilerle
 * sismesin.
 *
 * Garson listesi BOSKEN de kullanilabilir olmali — bu yuzden
 * waitersReady kontrolu tek seferlik secime bagli olarak gevsetilir.
 */
const ozelGarsonSecili = () => !!waiterAC?.selected?.custom;

async function loadWaiters() {
  const { waiters } = await API.get('/api/waiters');
  waitersReady = waiters.length > 0;

  $('waiterSearch').disabled = false;
  $('waiterSearch').placeholder = waitersReady
    ? 'Garson adı yazın...'
    : 'Garson adı yazın (liste boş — tek seferlik girilebilir)';

  if (waitersReady) $('noWaiters')?.remove();
  else showNoWaiters();

  if (waiterAC) return waiterAC.setItems(waiters);

  waiterAC = createAutocomplete({
    input: $('waiterSearch'),
    hidden: $('waiterId'),
    list: $('waiterList'),
    items: waiters,
    // Listede olmayan ad yazilinca en altta cikan secenek
    custom: {
      label: (ad) => `➕ "${ad}" — tek seferlik garson`,
      hint: 'Bu ad garson listesine eklenmez.'
    },
    onSelect: () => {
      $('customWaiterNote').classList.toggle('hidden', !ozelGarsonSecili());
      applySubmit();
    }
  });
}

/**
 * Hic garson tanimli degilken kullaniciya ne yapacagini soyle.
 *
 * Alan ARTIK KILITLENMEZ: liste bos olsa da tek seferlik ad girilerek
 * kayit acilabilir. Uyari yine gosterilir — kalici ekibin Yonetim'den
 * tanimlanmasi dogru olandir, tek seferlik giris gecici cozumdur.
 */
function showNoWaiters() {
  if ($('noWaiters')) return;

  const uyari = document.createElement('div');
  uyari.id = 'noWaiters';
  uyari.className = 'cooldown-box show blocked';
  uyari.innerHTML = `
    <div class="cooldown-head">⚠️ Sistemde kayıtlı garson yok</div>
    <div class="cooldown-meta" style="margin-top:5px">
      Adı yazıp <b>tek seferlik garson</b> olarak kaydedebilirsiniz.<br />
      Kalıcı ekip için ${App.user.role === 'admin'
        ? `<a href="/yonetim.html" style="color:var(--accent);font-weight:600">Yönetim sayfasından ekleyin →</a>`
        : 'yöneticinizin garson tanımlaması gerekir.'}
    </div>`;

  $('waiterSearch').closest('.field').appendChild(uyari);
}

/**
 * SIGARA TURU — Alan Garson ile AYNI bilesen.
 *
 * Eskiden acilir liste (<select>) idi ve tek seferlik tur icin ayri bir
 * metin kutusu aciliyordu. Liste uzadikca acilir menude aranan marka
 * bulunmaz oldu; garson alaninda coktan cozulmus olan sey burada da
 * gerekiyordu. Artik ikisi de yazarak secim alani:
 *   · adi yazdikca liste daralir, Turkce karakterlere duyarli
 *   · listede olmayan ad, en altta "tek seferlik" secenegi olarak cikar
 *
 * Secilen turun id'si gizli alanda tutulur ama sunucuya AD gonderilir
 * (POST /api/records `cigarette_type` bekler); id yalnizca secimin
 * listeden mi geldigini bilmek icin.
 */
let typeAC = null;

/** Su an tek seferlik (liste disi) sigara mi giriliyor? */
const ozelTurSecili = () => !!typeAC?.selected?.custom;

/**
 * Sigara listesi POPULERLIGE gore gelir (alfabetik degil): vardiyada en cok
 * verilenler ustte, elin oraya gitsin. Sunucu son 30 gunun satisina bakar ve
 * ilk 10'a popular bayragi dusurur.
 *
 * Bilesen items sirasini KORUDUGU icin alani acar acmaz bu sira gorunur;
 * yazmaya baslayinca eslesme sirasina gecer.
 */
async function loadTypes() {
  const { types } = await API.get('/api/cigarette-types', { sort: 'popular' });
  typesReady = types.length > 0;

  $('typeSearch').placeholder = typesReady
    ? 'Sigara adı yazın...'
    : 'Sigara adı yazın (liste boş — tek seferlik girilebilir)';

  if (typeAC) return typeAC.setItems(types);

  typeAC = createAutocomplete({
    input: $('typeSearch'),
    hidden: $('cigaretteTypeId'),
    list: $('typeList'),
    items: types,
    emptyText: 'Eşleşen sigara yok',
    // Rozet yalnizca gercekten satisi olanlarda; sunucu bunu zaten hesaplar
    meta: (t) => (t.popular ? '🔥 POPÜLER' : ''),
    // Listede olmayan ad yazilinca en altta cikan secenek
    custom: {
      label: (ad) => `➕ "${ad}" — tek seferlik sigara`,
      hint: 'Bu sigara listeye eklenmez, stoktan düşülmez.'
    },
    onSelect: () => {
      $('customTypeNote').classList.toggle('hidden', !ozelTurSecili());
      applySubmit();
    }
  });
}

async function loadStats() {
  try {
    const { stats } = await API.get('/api/records/stats');
    $('stRecords').textContent  = stats.last24hRecords;
    $('stQty').textContent      = stats.last24hQuantity;
    $('stPlayers').textContent  = stats.last24hPlayers;
    $('stCooldown').textContent = stats.activeCooldowns;
    $('stWaiter').textContent   = stats.topWaiter;
    $('stAll').textContent      = stats.allTime;
  } catch { /* istatistik kritik degil */ }
}

/** "Son 24 saat" penceresinin baslangici — duvar saatinden, donemden bagimsiz. */
const SON_24_SAAT = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

/**
 * Son Kayitlar listesinin sorgusu.
 *
 *   ID YOKKEN   tum kayitlarin sonu (genel gorunum)
 *   ID VARKEN   yalnizca o oyuncunun SON 24 SAATI
 *
 * Eslesme ID varken TAM: playerExact kullanilir. Kismi arama olsaydi
 * 1247 ararken 112478'in kayitlari da listeye karisirdi.
 *
 * kaydiBul da AYNI sorguyu kullanir — ekranda gorunen her satir islem
 * ekranlarinda da bulunabilsin, aksi halde "kayit bulunamadi" derdi.
 */
function recentQuery() {
  return cd.playerId
    ? { playerExact: cd.playerId, from: SON_24_SAAT(), pageSize: 50, page: 1 }
    : { pageSize: 10, page: 1 };
}

/**
 * Listedeki bir kaydin GUNCEL halini sunucudan alir.
 *
 * Ekrandaki satir bayat olabilir (baska bir sigaraci ayni kaydi
 * duzeltmis olabilir); islem ekranlari taze veriyle acilmali.
 * Hata durumunda kullaniciya soyler ve null doner.
 */
async function kaydiBul(id) {
  try {
    const { records } = await API.get('/api/records', recentQuery());
    const kayit = records.find((r) => r.id === id);
    if (!kayit) toast('Kayıt bulunamadı, listeyi yenileyin.', 'error');
    return kayit || null;
  } catch (err) {
    toast(`Kayıt alınamadı: ${err.message}`, 'error');
    return null;
  }
}

/**
 * SON KAYITLAR — iki modu var.
 *
 *   ID YOKKEN   genel gorunum: tum kayitlarin sonu
 *   ID VARKEN   yalnizca o oyuncunun SON 24 SAATI
 *
 * Oyuncu ID'si yazilir yazilmaz liste o oyuncuya daralir; ID silinince
 * genel gorunume doner. Boylece sigaraci hem tezgahin geneline hem de
 * onundeki misafirin gecmisine ayni yerden bakar.
 */
async function loadRecent() {
  const body = $('recentBody');
  const oyuncuModu = !!cd.playerId;

  // Liste altindaki aciklama hangi modda oldugumuzu soyler
  const etiket = $('recentScope');
  if (etiket) {
    etiket.textContent = oyuncuModu
      ? `${cd.playerId} — son 24 saat`
      : 'Son 10 kayıt (tümü)';
  }

  try {
    const { records, summary } = await API.get('/api/records', recentQuery());
    $('recentCount').textContent = oyuncuModu
      ? `${cd.playerId} · ${summary.total} kayıt`
      : `${summary.total} kayıt`;

    if (!records.length) {
      body.innerHTML = `<tr><td colspan="8" class="empty">${
        oyuncuModu ? `${esc(cd.playerId)} için son 24 saatte kayıt yok.` : 'Henüz kayıt yok.'
      }</td></tr>`;
      return;
    }
    // data-label: telefonda satirlar karta donusunce etiket olarak gorunur
    body.innerHTML = records.map((r) => {
      /* Degisim yalnizca ACIK donemin, henuz degistirilmemis kaydi icin.
         Kapanmis gunun kaydini degistirmek stogu ve raporu ayri donemlere
         dusururdu (sunucu da ayni kurali uygular). */
      const acikDonemde = !App.period || r.created_at >= App.period.from;
      const degistirilebilir = !r.superseded_by && acikDonemde;
      /* Iptal KAPANMIS gunde de yapilabilir: "gec iptal" olarak cari doneme
         iade islenir, kapanmis gunun raporu degismez. Bu yuzden degisimden
         farkli olarak acik donem sarti aranmaz — arsivdeki kuralin aynisi.
         Degistirilmis kaydin iptali yerine gecen guncel kayit uzerinden
         yapilir; sunucu da bunu reddeder. */
      const iptalEdilebilir = !r.superseded_by;

      return `
      <tr${r.superseded_by ? ' class="row-superseded"' : ''}>
        <td data-label="Tarih" class="mono">${formatDateTime(r.created_at)}</td>
        <td data-label="Oyuncu ID">
          <span class="pill player">${esc(r.player_id)}</span>
          ${r.early_release ? '<span class="pill early">ERKEN</span>' : ''}
        </td>
        <td data-label="Sigara Türü">
          ${esc(r.cigarette_type)}
          ${r.exchanged_from ? '<span class="pill swap" title="Değişim sonucu">DEĞİŞİM</span>' : ''}
          ${r.custom_type ? '<span class="pill custom" title="Tek seferlik sigara — ana listede yok, stoktan düşülmedi">LİSTE DIŞI</span>' : ''}
        </td>
        <td data-label="Adet"><span class="pill qty">${r.quantity}</span></td>
        <td data-label="Garson">${waiterCellHTML(r)}</td>
        <td data-label="Sigaracı">${esc(r.username)}</td>
        <td data-label="Info" class="info-cell">${recordDetailHTML(r)}</td>
        <td data-label="İşlem">
          <div class="row-actions">
            ${r.superseded_by
              ? '<span class="pill locked" title="Bu kayıt değiştirildi, arşivde kalır">DEĞİŞTİRİLDİ</span>'
              : degistirilebilir
                ? `<button class="btn-ghost btn-sm" data-swap="${r.id}">Değiştir</button>`
                : ''}
            ${iptalEdilebilir
              ? `<button class="btn-danger btn-sm" data-cancel="${r.id}">İptal Et</button>`
              : ''}
            <button class="btn-ghost btn-sm" data-pid="${r.id}">ID Düzelt</button>
            <button class="btn-ghost btn-sm" data-info="${r.id}">${r.info_by || r.info ? 'İnfo Düzenle' : 'İnfo Ekle'}</button>
            ${kokHesap() ? `<button class="btn-ghost btn-sm" data-fix="${r.id}" title="Kaydı iz bırakmadan düzelt — yalnızca kök hesap">Düzelt</button>` : ''}
            ${kokHesap() ? `<button class="btn-danger btn-sm" data-del="${r.id}" title="Kaydı kalıcı olarak siler — yalnızca kök hesap">Sil</button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');
  } catch (err) {
    body.innerHTML = `<tr><td colspan="8" class="empty">Yüklenemedi: ${esc(err.message)}</td></tr>`;
  }
}

/* ============================================================
   SIGARA DEGISTIR
   Misafir aldigi sigarayi baska bir turle degistirmek istediginde.
   Ilk kayit silinmez; arsivde kalir ve yerine gecen kayda baglanir.
   ============================================================ */
async function handleExchange(recordId) {
  let kayit, turler;

  try {
    // Kaydin ve stogun GUNCEL hali alinir: ekranda bayat veri olabilir
    const [liste, stok] = await Promise.all([
      API.get('/api/records', { pageSize: 50, page: 1 }),
      API.get('/api/stock')
    ]);
    kayit = liste.records.find((r) => r.id === recordId);
    turler = stok.cards;
  } catch (err) {
    return toast(`Değişim ekranı açılamadı: ${err.message}`, 'error');
  }

  if (!kayit) return toast('Kayıt bulunamadı, listeyi yenileyin.', 'error');
  if (kayit.superseded_by) return toast('Bu kayıt zaten değiştirilmiş.', 'error');

  const secim = await showExchangeDialog({ record: kayit, types: turler });
  if (!secim) return;   // vazgecildi

  try {
    const res = await API.post(`/api/records/${recordId}/exchange`, secim);

    const st = res.stock;
    toast(
      `${res.replacement.player_id} — ${res.exchange.from_type_name} → ` +
      `${res.exchange.to_type_name} ×${res.exchange.quantity} değiştirildi.`,
      'success', 5000
    );
    if (st.returned) {
      toast(`↩️ ${st.returned.name}: ${st.returned.balance} paket (iade edildi)`, 'info', 4500);
    }
    if (st.issued.state === 'critical') {
      toast(`⚠️ ${st.issued.name} kritik seviyede (${st.issued.balance} paket).`, 'error', 7000);
    }
    if (st.issued.state === 'out') {
      toast(`⛔ ${st.issued.name} tükendi.`, 'error', 7000);
    }

    // Sayac degismemis olmali; ekrandaki oyuncu buysa durumu tazele
    if (cd.playerId && cd.playerId === res.replacement.player_id) {
      applyStatus(res.status);
    }

    await Promise.all([loadStats(), loadRecent(), loadTypes()]);
  } catch (err) {
    toast(err.message, 'error', 6000);
    await loadRecent();
  }
}

/* ============================================================
   4 SAAT KURALI
   ============================================================ */
const box = () => $('cooldownBox');

const checkPlayer = debounce(async (raw) => {
  const id = raw.trim().toUpperCase();
  if (!id) return resetCooldown();

  stopTimer();
  box().className = 'cooldown-box show loading';
  box().innerHTML = `<div class="cooldown-head">⏳ ${esc(id)} kontrol ediliyor...</div>`;
  setSubmit(false, 'Kontrol ediliyor...');

  try {
    const { status, flag } = await API.get('/api/records/check', { playerId: id });
    // Kullanici bu arada baska ID yazdiysa gec gelen yaniti yok say
    if ($('playerId').value.trim().toUpperCase() !== status.playerId) return;
    cd.flag = flag || null;
    applyStatus(status);
    renderFlagBanner();
    // Liste artik bu oyuncuya ait; ID degistiginde yenilenmeli
    loadRecent();
  } catch (err) {
    stopTimer();
    box().className = 'cooldown-box show blocked';
    box().innerHTML = `<div class="cooldown-head">⚠️ Kontrol edilemedi</div>
                       <div class="cooldown-meta">${esc(err.message)}</div>`;
    setSubmit(false, 'Durum doğrulanamadı, kayıt engellendi.');
  }
}, 350);

/**
 * Sunucudan gelen remainingMs, yerel saat eksenine cevrilir; boylece
 * istemci-sunucu saat farki geri sayimi bozmaz.
 */
function applyStatus(status) {
  cd.playerId = status.playerId;
  cd.allowed = status.allowed;
  cd.deadline = Date.now() + status.remainingMs;
  cd.lastAt = status.lastAt;
  cd.lastRecord = status.lastRecord;
  cd.totalRecords = status.totalRecords || 0;

  if (status.allowed) {
    stopTimer();
    renderAllowed(status);
  } else {
    renderBlocked();
    startTimer();
  }
}

function renderAllowed(status) {
  const detail = status.firstTime
    ? 'Bu ID ile ilk kayıt. Sigara verilebilir.'
    : `Son alım: <b>${formatDateTime(status.lastAt)}</b> (${timeAgo(status.lastAt)})<br />
       ${App.cooldownHours} saat doldu, yeniden alabilir.
       ${status.totalRecords ? `Toplam <b>${status.totalRecords}</b> kayıt.` : ''}`;

  box().className = 'cooldown-box show ok';
  box().innerHTML = `<div class="cooldown-head">✅ Uygun — kayıt oluşturulabilir</div>
                     <div class="cooldown-meta" style="margin-top:5px">${detail}</div>`;
  setSubmit(true, '');
}

function renderBlocked() {
  const remaining = Math.max(0, cd.deadline - Date.now());
  const pct = Math.min(100, ((App.cooldownMs - remaining) / App.cooldownMs) * 100);
  const r = cd.lastRecord;

  const last = r
    ? `Son alım: <b>${formatDateTime(cd.lastAt)}</b><br />
       ${esc(r.cigarette_type)} ×${r.quantity} — garson <b>${esc(r.waiter_name)}</b><br />
       Kaydı yapan: <b>${esc(r.username)}</b>` : '';

  box().className = 'cooldown-box show blocked';
  box().innerHTML = `
    <div class="cooldown-head">⏳ ${App.cooldownHours} saat dolmadı — yetkili onayı gerekir</div>
    <div class="cooldown-timer" id="cdTimer">${formatCountdown(remaining)}</div>
    <div class="progress"><i id="cdBar" style="width:${pct}%"></i></div>
    <div class="cooldown-meta" style="margin-top:7px">
      Tekrar alabileceği saat: <b>${formatDateTime(new Date(cd.deadline).toISOString())}</b><br />
      ${last}
    </div>`;
  // Sure dolmadi ama kayit tamamen engellenmiyor: yuksek oynama miktari gibi
  // gerekcelerle yetkili onayiyla erken alim yapilabilir (onay ekrani cikar).
  setSubmit(true, 'Süre dolmadı — kaydetmek isterseniz yetkili onayı istenecek.');
}

function startTimer() {
  stopTimer();
  timer = setInterval(() => {
    const remaining = cd.deadline - Date.now();
    if (remaining <= 0) {
      stopTimer();
      checkPlayer($('playerId').value);   // sure doldu: sunucudan teyit al
      return;
    }
    const t = $('cdTimer'), bar = $('cdBar');
    if (t) t.textContent = formatCountdown(remaining);
    if (bar) bar.style.width = `${((App.cooldownMs - remaining) / App.cooldownMs) * 100}%`;
  }, 1000);
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

function resetCooldown() {
  stopTimer();
  cd.playerId = ''; cd.allowed = false; cd.deadline = 0; cd.flag = null;
  $('flagBanner')?.remove();
  loadRecent();          // ID silindi: liste genel gorunume doner
  box().className = 'cooldown-box';
  box().innerHTML = '';
  setSubmit(false, 'Başlamak için Oyuncu ID girin.');
}

/**
 * Gonder dugmesinin durumu iki kaynaktan belirlenir:
 *   · 4 saat kurali (setSubmit ile gelir, cd.submitEnabled'da saklanir)
 *   · on kosullar (garson/tur tanimli mi) — bunlar sonradan degisebilir
 * Bu yuzden karar applySubmit'te toplanir; tur secimi degistiginde
 * sayac durumunu kaybetmeden yeniden hesaplanabilsin.
 */
function setSubmit(enabled, hint) {
  cd.submitEnabled = enabled;
  cd.submitHint = hint || '';
  applySubmit();
}

function applySubmit() {
  // Tek seferlik sigara/garsonda listenin dolu olmasi gerekmez: girilen ad
  // zaten listede olmayan bir kayittir.
  const turHazir = typesReady || ozelTurSecili();
  const garsonHazir = waitersReady || ozelGarsonSecili();
  const hazir = garsonHazir && turHazir;

  $('submitBtn').disabled = !(cd.submitEnabled && hazir);

  const eksik = [
    !garsonHazir ? 'garson' : null,
    !turHazir ? 'sigara türü' : null
  ].filter(Boolean).join(' ve ');

  const metin = (cd.submitEnabled && eksik)
    ? `Önce sisteme ${eksik} eklenmeli.`
    : cd.submitHint;

  $('formHint').textContent = metin;
  $('formHint').style.display = metin ? 'block' : 'none';
}

/**
 * MODUL 7 — oyuncunun uyari kaydi varsa formda kalici serit gosterilir.
 * Bloke ise kayit dugmesi 4 saat kurali uygun olsa bile acilmaz.
 */
function renderFlagBanner() {
  $('flagBanner')?.remove();
  if (!cd.flag) return;

  const kap = document.createElement('div');
  kap.innerHTML = flagBannerHTML(cd.flag);
  const serit = kap.firstElementChild;
  serit.id = 'flagBanner';                 // id serit uzerinde olmali ki tekrar bulunabilsin
  $('playerId').closest('.field').appendChild(serit);

  // Bloke oyuncuda dugme acik birakilir: sigaraci bastiginda engel ekrani
  // acilir ve nedeni buyuk harflerle onune gelir. Kayit yine de olusmaz.
  if (cd.flag.level === 'blocked' && !$('submitBtn').disabled) {
    setSubmit(true, 'Bu oyuncu BLOKE — kayıt oluşturulamaz.');
  }
}

/* ============================================================
   KAYIT GONDERIMI
   ============================================================ */
async function submitRecord(e) {
  e.preventDefault();

  /*
   * Once yazilanlari secime cevir.
   *
   * Kullanici adi yazip acilir listeden tiklamadan dogrudan Kaydet'e
   * basabiliyor — telefonda liste dugmenin onunu kapattigi icin en dogal
   * davranis bu. Bilesenin blur'daki otomatik commit'i 120 ms gecikmeli
   * oldugundan gonderim ona yetisiyor ve ad dogru yazilmisken bile
   * "listeden secin" hatasi cikiyordu.
   */
  typeAC?.commit();
  waiterAC?.commit();
  infoAC?.commit();

  /* Sunucuya her iki durumda da tur ADI gonderilir; custom_type bayragi
     "bu ad listede yok, stoktan dusme" der. Sunucu ayni adda AKTIF bir tur
     bulursa bayragi yok sayip normal yola duser (stok takibi atlanmasin). */
  const ozel = ozelTurSecili();
  const turAdi = typeAC?.selected?.name?.trim() || '';

  /* Tek seferlik garson: listeden secilmedigi icin id yok, ad gonderilir.
     Sunucu ayni adda kayitli bir garson bulursa onu kullanir. */
  const ozelGarson = ozelGarsonSecili();

  const payload = {
    player_id: $('playerId').value.trim(),
    cigarette_type: turAdi,
    quantity: Number($('quantity').value),
    waiter_id: Number($('waiterId').value),
    info: $('info').value.trim(),
    // Bos birakilabilir; sunucu gecersiz id'yi zaten reddeder
    info_by_id: $('infoById').value || undefined
  };
  if (ozel) payload.custom_type = true;
  if (ozelGarson) {
    payload.custom_waiter = true;
    payload.waiter_name = waiterAC.selected.name;
  }

  /* Buraya dusmek icin alanda KISMEN eslesen bir metin olmali: commit()
     tam eslemeyi de, hic eslesmeyen adi da (tek seferlik) coktan secmis
     olurdu. Yani kullanici "MARL" gibi yarim bir sey yazmis — hangisini
     kastettigine kendisi karar vermeli. */
  if (!turAdi) {
    $('typeSearch').classList.add('ac-invalid');
    $('typeSearch').focus();
    return toast(
      'Sigara türünü listeden seçin — listede yoksa "tek seferlik sigara" seçeneğini kullanın.',
      'error', 5500
    );
  }

  // Tur alanindaki ile ayni durum: yarim yazilmis, kismen eslesen bir ad.
  if (!ozelGarson && !payload.waiter_id) {
    $('waiterSearch').classList.add('ac-invalid');
    $('waiterSearch').focus();
    return toast(
      'Garsonu listeden seçin — listede yoksa "tek seferlik garson" seçeneğini kullanın.',
      'error', 5500
    );
  }
  if (!payload.player_id || !payload.cigarette_type || !payload.quantity) {
    return toast('Oyuncu ID, sigara türü ve adet zorunludur.', 'error');
  }
  if (cd.playerId !== payload.player_id.toUpperCase()) {
    return toast('Oyuncu ID doğrulanmadı, lütfen tekrar girin.', 'error');
  }

  /* --- STOK DISI SIGARA ONAYI ---
     Listede olmayan bir tur elle girildiyse kayit dogrudan acilmaz. Bu
     kayit stoktan DUSMEZ ve mutabakat tablosunda satiri olmaz; yanlislikla
     secilirse stok defteri sessizce eksik kalirdi.
     Adet onayindan ONCE gelir: once NE veriliyor, sonra NE KADAR. */
  if (ozel) {
    const devam = await showCustomTypeGate(turAdi);
    if (!devam) {
      $('typeSearch').focus();
      $('typeSearch').select();
      return toast('Kayit olusturulmadi.', 'error');
    }
  }

  /* --- ADET ONAYI ---
     Tek seferde birden fazla paket kaydediliyorsa once sorulur. Diger
     onay ekranlarindan ONCE gelir: erken alim ve uyari ekranlari YETKI
     sorar, bu ise "bunu mu demek istediniz" diye sorar. Yanlis adet
     yazan kisiyi once yetkili onayindan gecirip sonra adeti sormak
     bosuna emek olurdu; en ucuz duzeltme once. */
  if (payload.quantity > ADET_ONAY_ESIGI) {
    const onaylandi = await showQuantityGate({
      playerId: cd.playerId,
      typeName: turAdi,
      quantity: payload.quantity,
      waiterName: ozelGarson ? waiterAC.selected.name : $('waiterSearch').value.trim(),
      customType: ozel,
      customWaiter: ozelGarson
    });

    if (!onaylandi) {
      $('quantity').focus();
      $('quantity').select();
      return toast('Adet onaylanmadı, kayıt oluşturulmadı.', 'error');
    }
  }

  /* --- 4 saat dolmadiysa: erken alim onayi --- */
  if (!cd.allowed) {
    const erken = await showEarlyGate({
      playerId: cd.playerId,
      remainingMs: Math.max(0, cd.deadline - Date.now()),
      nextAvailableAt: new Date(cd.deadline).toISOString(),
      lastAt: cd.lastAt,
      lastRecord: cd.lastRecord,
      totalRecords: cd.totalRecords
    });

    if (!erken) return toast('Erken alım onaylanmadı, kayıt oluşturulmadı.', 'error');

    // Ekran acikken sure dolduysa onaya gerek kalmaz
    if (!erken.expired) {
      payload.early_approved = true;
      payload.early_approved_by = erken.early_approved_by;
      payload.early_note = erken.early_note;
    }
  }

  /* --- MODUL 7: uyari kaydi varsa once onay ekrani --- */
  if (cd.flag) {
    if (cd.flag.level === 'blocked') {
      await showApprovalGate(cd.flag);           // bilgilendirme ekrani, kayit yok
      return;
    }
    const onay = await showApprovalGate(cd.flag);
    if (!onay) return toast('Onay verilmedi, kayıt oluşturulmadı.', 'error');

    payload.approved = true;
    payload.approved_by = onay.approved_by;
    payload.approval_note = onay.approval_note;
  }

  const btn = $('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Kaydediliyor...';

  try {
    const res = await API.post('/api/records', payload);

    // MODUL 8: kalan stok bildirimi; kritik/tukendi ise dikkat cek
    const st = res.stock;
    const stokMetni = st ? ` · ${st.name}: ${st.remaining} paket kaldı` : '';
    toast(
      `${res.record.player_id} — ${res.record.cigarette_type} ×${res.record.quantity} kaydedildi.${stokMetni}`,
      st && st.state !== 'ok' ? 'error' : 'success',
      st && st.state !== 'ok' ? 6000 : 3800
    );
    if (st && st.state === 'critical') {
      toast(`⚠️ ${st.name} kritik seviyede (${st.remaining} paket). İkmal gerekiyor.`, 'error', 7000);
    }
    if (st && st.state === 'out') {
      toast(`⛔ ${st.name} tükendi. Stok girilmeden yeni kayıt açılamaz.`, 'error', 7000);
    }
    if (res.early) {
      toast(`⏳ Erken alım — ${res.early.by} onayıyla kaydedildi.`, 'info', 6000);
    }
    if (res.customType) {
      toast(
        `➕ "${res.record.cigarette_type}" tek seferlik kaydedildi — listeye eklenmedi, ` +
        'stoktan düşülmedi.',
        'info', 6500
      );
    }
    if (res.customWaiter) {
      toast(
        `➕ Garson "${res.record.waiter_name}" tek seferlik kaydedildi — garson listesine eklenmedi.`,
        'info', 6500
      );
    }
    // Yazilan ad zaten kayitli bir garsona denk geldi: tek seferlik sayilmadi
    if (res.waiterMatched) {
      toast(
        `"${res.waiterMatched}" zaten kayıtlı bir garson — tek seferlik değil, listedeki kayda işlendi.`,
        'info', 6500
      );
    }

    // Garson secimi vardiya boyunca ayni kaldigi icin korunur; sigara turu
    // her misafirde degistigi icin temizlenir.
    typeAC.reset();
    $('customTypeNote').classList.add('hidden');
    $('quantity').value = 1;
    $('info').value = '';
    infoAC?.reset();

    applyStatus(res.status);
    await Promise.all([loadStats(), loadRecent(), loadTypes()]);
  } catch (err) {
    toast(err.message, 'error');

    // Sunucu erken alim onayi istiyorsa durumu tazele
    if (err.payload?.canOverride && err.payload?.status) {
      applyStatus(err.payload.status);
    }
    // Sunucu onay sarti dondurduyse ekrani ac (istemci engeli atlanmis olabilir)
    if (err.payload?.flag && err.status === 428) {
      cd.flag = err.payload.flag;
      renderFlagBanner();
    }
    if (err.payload?.status) applyStatus(err.payload.status);
  } finally {
    btn.textContent = 'Kaydı Oluştur';
    // Sure dolmamis olsa bile dugme acik kalir; basildiginda erken alim
    // onay ekrani cikar. Yalnizca garson/tur eksikse kilitli birakilir —
    // karar applySubmit'te toplandigi icin tek seferlik secimler de sayilir.
    applySubmit();
  }
}

/* ------------------------- Olaylar ------------------------- */
function bindEvents() {
  $('playerId').addEventListener('input', (e) => {
    const v = e.target.value.trim();
    if (!v) return resetCooldown();
    setSubmit(false, 'Kontrol ediliyor...');
    checkPlayer(v);
  });

  // Sigara turu ve garson secimi kendi onSelect'leriyle tetiklenir
  $('recordForm').addEventListener('submit', submitRecord);

  // Son Kayitlar tablosu her yenilendiginde yeniden baglanmasin diye
  // dinleyici govdeye bir kez kurulur (olay delegasyonu).
  $('recentBody').addEventListener('click', async (e) => {
    const swapBtn = e.target.closest('[data-swap]');
    if (swapBtn) {
      swapBtn.disabled = true;
      handleExchange(Number(swapBtn.dataset.swap)).finally(() => { swapBtn.disabled = false; });
      return;
    }

    /* SATIS IPTALI — iadeyi tezgahta alan kisi sigaracidir; bunun icin
       arsiv sayfasina gitmek gereksiz bir adimdi. Kayit SILINMEZ: aktif
       listeden cikar, Iptaller bolumune gecmisiyle tasinir, stok geri
       doner ve oyuncunun sayaci serbest kalir. */
    const cancelBtn = e.target.closest('[data-cancel]');
    if (cancelBtn) {
      const kayit = await kaydiBul(Number(cancelBtn.dataset.cancel));
      if (!kayit) return;

      cancelBtn.disabled = true;
      const sonuc = await handleCancel(kayit);
      cancelBtn.disabled = false;

      if (sonuc) {
        await Promise.all([loadStats(), loadRecent(), loadTypes()]);
        // Iptal edilen satis hak kullanimi sayilmaz: ekranda o oyuncu
        // aciksa serbest kalan sayaci beklemeden goster.
        if (cd.playerId && cd.playerId === sonuc.record.player_id) applyStatus(sonuc.status);
      }
      return;
    }

    /* IZ BIRAKMADAN DUZELTME — yalnizca kok hesap. Gecmisteki bir kayit
       en bastan dogru girilmis gibi duzeltilir; tur degisirse o gunun stok
       hareketi de duzeltilir (bkz. services/silentEdit.js). */
    const fixBtn = e.target.closest('[data-fix]');
    if (fixBtn) {
      const kayit = await kaydiBul(Number(fixBtn.dataset.fix));
      if (!kayit) return;

      fixBtn.disabled = true;
      const degisti = await handleSilentEdit(kayit);
      fixBtn.disabled = false;

      if (degisti) {
        await Promise.all([loadStats(), loadRecent(), loadTypes()]);
        // Oyuncu ID degismis olabilir: ekrandaki sayaci tazele
        if (cd.playerId) checkPlayer(cd.playerId);
      }
      return;
    }

    /* KALICI SILME — yalnizca kok hesap. Dugme zaten gizli, sunucu da
       requireRoot ile ayrica dogrular. */
    const delBtn = e.target.closest('[data-del]');
    if (delBtn) {
      const kayit = await kaydiBul(Number(delBtn.dataset.del));
      if (!kayit) return;
      delBtn.disabled = true;
      const silindi = await handleRecordDelete(kayit);
      delBtn.disabled = false;
      if (silindi) await Promise.all([loadStats(), loadRecent()]);
      return;
    }

    /* Sonradan info ekleme: sigara verildi, info veren sonra belli oldu. */
    const infoBtn = e.target.closest('[data-info]');
    if (infoBtn) {
      const kayit = await kaydiBul(Number(infoBtn.dataset.info));
      if (!kayit) return;
      infoBtn.disabled = true;
      const degisti = await handleInfoEdit(kayit);
      infoBtn.disabled = false;
      if (degisti) await loadRecent();
      return;
    }

    /* ID duzeltme: yanlis yazilan ID'yi hemen tezgahta duzeltebilmek icin
       Son Kayitlar'da da duruyor — hata cogunlukla burada fark ediliyor. */
    const pidBtn = e.target.closest('[data-pid]');
    if (!pidBtn) return;

    const kayit = await kaydiBul(Number(pidBtn.dataset.pid));
    if (!kayit) return;

    pidBtn.disabled = true;
    const gec = !!App.period && kayit.created_at < App.period.from;
    const degisti = await handlePlayerIdEdit(kayit, gec);
    pidBtn.disabled = false;

    if (degisti) {
      await Promise.all([loadStats(), loadRecent()]);
      // Ekranda o oyuncu aciksa sayaci tazele: hak durumu degismis olabilir
      if (cd.playerId) checkPlayer(cd.playerId);
    }
  });

  setInterval(loadStats, 60000);
}
