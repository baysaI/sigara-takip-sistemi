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

App.ready(async () => {
  showDayInfo();
  await Promise.all([loadTypes(), loadWaiters()]);
  await Promise.all([loadStats(), loadRecent()]);
  bindEvents();
});

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
async function loadWaiters() {
  const { waiters } = await API.get('/api/waiters');
  waitersReady = waiters.length > 0;

  if (!waitersReady) return showNoWaiters();

  $('waiterSearch').disabled = false;
  $('waiterSearch').placeholder = 'Garson adı yazın...';
  $('noWaiters')?.remove();

  if (waiterAC) return waiterAC.setItems(waiters);

  waiterAC = createAutocomplete({
    input: $('waiterSearch'),
    hidden: $('waiterId'),
    list: $('waiterList'),
    items: waiters
  });
}

/** Hic garson tanimli degilken kullaniciya ne yapacagini soyle. */
function showNoWaiters() {
  const input = $('waiterSearch');
  input.disabled = true;
  input.placeholder = 'Önce garson eklenmeli';
  input.value = '';
  $('waiterId').value = '';

  if ($('noWaiters')) return;

  const uyari = document.createElement('div');
  uyari.id = 'noWaiters';
  uyari.className = 'cooldown-box show blocked';
  uyari.innerHTML = App.user.role === 'admin'
    ? `<div class="cooldown-head">⚠️ Sistemde kayıtlı garson yok</div>
       <div class="cooldown-meta" style="margin-top:5px">
         Kayıt açabilmek için önce garson eklemelisiniz.<br />
         <a href="/yonetim.html" style="color:var(--accent);font-weight:600">
           Yönetim sayfasından ekle →</a>
       </div>`
    : `<div class="cooldown-head">⚠️ Sistemde kayıtlı garson yok</div>
       <div class="cooldown-meta" style="margin-top:5px">
         Kayıt açabilmek için yöneticinizin garson eklemesi gerekiyor.
       </div>`;

  input.closest('.field').appendChild(uyari);
}

/**
 * "Yeni Sigara Ekle" secenegi icin ayrac deger.
 * Bir sigara adiyla cakismasin diye alt cizgili: tur adlari serbest metin.
 */
const YENI_TUR = '__yeni_sigara__';

/** Su an tek seferlik (liste disi) sigara mi giriliyor? */
const ozelTurSecili = () => $('cigaretteType').value === YENI_TUR;

/**
 * Sigara listesi POPULERLIGE gore siralanir (alfabetik degil): vardiyada
 * en cok verilen sigaralar ustte, elin oraya gitsin. Sunucu son 30 gunun
 * satisina bakar ve ilk 10'a popular bayragi dusurur.
 *
 * Kalanlar "Diğer sigaralar" grubunda alfabetik durur — bilinen bir adi
 * ararken listenin geri kalani duzenli kalsin.
 */
async function loadTypes() {
  const { types } = await API.get('/api/cigarette-types', { sort: 'popular' });
  typesReady = types.length > 0;

  const sel = $('cigaretteType');
  const onceki = sel.value;

  const secenek = (t) =>
    `<option value="${esc(t.name)}">${esc(t.name)}${t.popular ? ' 🔥 POPÜLER' : ''}</option>`;

  const populer = types.filter((t) => t.popular);
  const digerleri = types.filter((t) => !t.popular);

  let govde;
  if (!typesReady) {
    govde = '<option value="">— Listede sigara yok —</option>';
  } else if (!populer.length) {
    // Henuz satis yoksa rozet dagitmanin anlami yok; duz liste
    govde = '<option value="">— Seçiniz —</option>' + types.map(secenek).join('');
  } else {
    govde = '<option value="">— Seçiniz —</option>' +
      populer.map(secenek).join('') +
      (digerleri.length
        ? `<optgroup label="Diğer sigaralar">${digerleri.map(secenek).join('')}</optgroup>`
        : '');
  }

  // "Yeni Sigara Ekle" listeden BAGIMSIZDIR: liste bos olsa da secilebilir,
  // cunku tek seferlik sigaranin listede karsiligi zaten yoktur.
  sel.disabled = false;
  sel.innerHTML = govde + `<option value="${YENI_TUR}">➕ Yeni Sigara Ekle</option>`;

  // Liste tazelendiginde secim korunur (kayit sonrasi loadTypes cagriliyor)
  if (onceki && [...sel.options].some((o) => o.value === onceki)) sel.value = onceki;
  toggleCustomType();
}

/** Ad alanini yalnizca "Yeni Sigara Ekle" secildiginde goster. */
function toggleCustomType() {
  const kutu = $('customTypeBox');
  if (!kutu) return;

  const acik = ozelTurSecili();
  kutu.classList.toggle('hidden', !acik);
  if (acik) $('customTypeName').focus();
  else $('customTypeName').value = '';

  // On kosullar degisti (liste bosken bile tek seferlik kayit acilabilir):
  // dugmeyi son duruma gore yeniden degerlendir.
  applySubmit();
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

async function loadRecent() {
  const body = $('recentBody');
  try {
    const { records, summary } = await API.get('/api/records', { pageSize: 10, page: 1 });
    $('recentCount').textContent = `${summary.total} kayıt`;

    if (!records.length) {
      body.innerHTML = '<tr><td colspan="7" class="empty">Henüz kayıt yok.</td></tr>';
      return;
    }
    // data-label: telefonda satirlar karta donusunce etiket olarak gorunur
    body.innerHTML = records.map((r) => {
      /* Degisim yalnizca ACIK donemin, henuz degistirilmemis kaydi icin.
         Kapanmis gunun kaydini degistirmek stogu ve raporu ayri donemlere
         dusururdu (sunucu da ayni kurali uygular). */
      const acikDonemde = !App.period || r.created_at >= App.period.from;
      const degistirilebilir = !r.superseded_by && acikDonemde;

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
        <td data-label="Garson">${esc(r.waiter_name)}</td>
        <td data-label="Sigaracı">${esc(r.username)}</td>
        <td data-label="İşlem">
          ${r.superseded_by
            ? '<span class="pill locked" title="Bu kayıt değiştirildi, arşivde kalır">DEĞİŞTİRİLDİ</span>'
            : degistirilebilir
              ? `<button class="btn-ghost btn-sm" data-swap="${r.id}">Değiştir</button>`
              : '<span class="muted">—</span>'}
        </td>
      </tr>`;
    }).join('');
  } catch (err) {
    body.innerHTML = `<tr><td colspan="7" class="empty">Yüklenemedi: ${esc(err.message)}</td></tr>`;
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
  // Tek seferlik sigarada listenin dolu olmasi gerekmez: girilen tur
  // zaten listede olmayan bir sigaradir.
  const turHazir = typesReady || ozelTurSecili();
  const hazir = waitersReady && turHazir;

  $('submitBtn').disabled = !(cd.submitEnabled && hazir);

  const eksik = [
    !waitersReady ? 'garson' : null,
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

  /* Tek seferlik sigara: tur adi listeden degil, elle yazilan alandan gelir
     ve custom_type bayragiyla gonderilir. Sunucu bu kaydi stoktan dusmez. */
  const ozel = ozelTurSecili();
  const turAdi = ozel ? $('customTypeName').value.trim() : $('cigaretteType').value;

  const payload = {
    player_id: $('playerId').value.trim(),
    cigarette_type: turAdi,
    quantity: Number($('quantity').value),
    waiter_id: Number($('waiterId').value),
    info: $('info').value.trim()
  };
  if (ozel) payload.custom_type = true;

  if (ozel && !turAdi) {
    $('customTypeName').focus();
    return toast('Sigara adını yazın.', 'error');
  }

  if (!payload.waiter_id) {
    // Alana isim yazilmis ama listeden secilmemis olabilir
    $('waiterSearch').classList.add('ac-invalid');
    $('waiterSearch').focus();
    return toast('Alan garson listeden seçilmelidir.', 'error');
  }
  if (!payload.player_id || !payload.cigarette_type || !payload.quantity) {
    return toast('Oyuncu ID, sigara türü ve adet zorunludur.', 'error');
  }
  if (cd.playerId !== payload.player_id.toUpperCase()) {
    return toast('Oyuncu ID doğrulanmadı, lütfen tekrar girin.', 'error');
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

    // Garson secimi vardiya boyunca ayni kaldigi icin korunur
    $('cigaretteType').value = '';
    toggleCustomType();          // ad alanini kapat ve temizle
    $('quantity').value = 1;
    $('info').value = '';

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
    // onay ekrani cikar. Yalnizca garson/tur eksikse kilitli birakilir.
    btn.disabled = !(waitersReady && typesReady);
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

  // "Yeni Sigara Ekle" secilince ad alani acilir/kapanir
  $('cigaretteType').addEventListener('change', toggleCustomType);

  $('recordForm').addEventListener('submit', submitRecord);

  // Son Kayitlar tablosu her yenilendiginde yeniden baglanmasin diye
  // dinleyici govdeye bir kez kurulur (olay delegasyonu).
  $('recentBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-swap]');
    if (!btn) return;
    btn.disabled = true;
    handleExchange(Number(btn.dataset.swap)).finally(() => { btn.disabled = false; });
  });

  setInterval(loadStats, 60000);
}
