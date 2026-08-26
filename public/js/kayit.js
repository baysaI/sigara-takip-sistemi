/* ============================================================
   Hizli Kayit sayfasi — 4 saat kurali + kayit olusturma
   ============================================================ */
'use strict';

const $ = (id) => document.getElementById(id);

/** Aktif geri sayim durumu */
const cd = { playerId: '', allowed: false, deadline: 0, lastAt: null, lastRecord: null, totalRecords: 0, flag: null };
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

/** Hangi is gunundeyiz — gun degisimi gece yarisi degil (varsayilan 06:00). */
function showDayInfo() {
  const el = $('dayInfo');
  if (!el) return;
  const gun = currentBusinessDay(App.dayStartHour);
  const saat = String(App.dayStartHour).padStart(2, '0');
  el.textContent = `· İş günü: ${gun.toLocaleDateString('tr-TR')} (${saat}:00'da değişir)`;
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

async function loadTypes() {
  const { types } = await API.get('/api/cigarette-types');
  typesReady = types.length > 0;

  const sel = $('cigaretteType');
  sel.disabled = !typesReady;
  sel.innerHTML = typesReady
    ? '<option value="">— Seçiniz —</option>' +
      types.map((t) => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('')
    : '<option value="">Önce sigara türü eklenmeli</option>';
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
      body.innerHTML = '<tr><td colspan="6" class="empty">Henüz kayıt yok.</td></tr>';
      return;
    }
    // data-label: telefonda satirlar karta donusunce etiket olarak gorunur
    body.innerHTML = records.map((r) => `
      <tr>
        <td data-label="Tarih" class="mono">${formatDateTime(r.created_at)}</td>
        <td data-label="Oyuncu ID">
          <span class="pill player">${esc(r.player_id)}</span>
          ${r.early_release ? '<span class="pill early">ERKEN</span>' : ''}
        </td>
        <td data-label="Sigara Türü">${esc(r.cigarette_type)}</td>
        <td data-label="Adet"><span class="pill qty">${r.quantity}</span></td>
        <td data-label="Garson">${esc(r.waiter_name)}</td>
        <td data-label="Sigaracı">${esc(r.username)}</td>
      </tr>`).join('');
  } catch (err) {
    body.innerHTML = `<tr><td colspan="6" class="empty">Yüklenemedi: ${esc(err.message)}</td></tr>`;
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

function setSubmit(enabled, hint) {
  // On kosullar: 4 saat kurali uygun olsa bile garson ve tur tanimli olmali
  const hazir = waitersReady && typesReady;
  $('submitBtn').disabled = !(enabled && hazir);

  const eksik = [
    !waitersReady ? 'garson' : null,
    !typesReady ? 'sigara türü' : null
  ].filter(Boolean).join(' ve ');

  const metin = (enabled && eksik)
    ? `Önce sisteme ${eksik} eklenmeli.`
    : (hint || '');

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

  const payload = {
    player_id: $('playerId').value.trim(),
    cigarette_type: $('cigaretteType').value,
    quantity: Number($('quantity').value),
    waiter_id: Number($('waiterId').value),
    info: $('info').value.trim()
  };

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

    // Garson secimi vardiya boyunca ayni kaldigi icin korunur
    $('cigaretteType').value = '';
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

  $('recordForm').addEventListener('submit', submitRecord);
  setInterval(loadStats, 60000);
}
