/* ============================================================
   Yonetim sayfasi (admin)
     · Garsonlar        — ekle / toplu ekle / aktif-pasif
     · Sigara turleri   — ekle / toplu ekle / aktif-pasif
     · Sigaraci hesaplari — olustur / sifre sifirla / aktif-pasif
   ============================================================ */
'use strict';

const $ = (id) => document.getElementById(id);

App.ready(async () => {
  if (App.user.role !== 'admin') return showDenied();

  await Promise.all([loadWaiters(), loadTypes(), loadUsers(), loadSettings(), loadOverview()]);
  bindEvents();
});

function showDenied() {
  document.querySelector('.container').innerHTML =
    '<div class="card"><div class="card-body center">' +
    '<p>Bu sayfa için yönetici yetkisi gerekli.</p>' +
    '<a href="/kayit.html" class="btn-ghost btn-sm mt" style="display:inline-block;' +
    'text-decoration:none;padding:9px 16px">Hızlı Kayıt sayfasına dön</a>' +
    '</div></div>';
}

/* ============================================================
   Ortak yardimcilar
   ============================================================ */

/** Metin kutusundaki satirlari benzersiz, bosluksuz listeye cevirir. */
function parseBulk(textarea) {
  return [...new Set(textarea.value.split('\n').map((s) => s.trim()).filter(Boolean))];
}

/**
 * Listeyi tek tek gonderir, sonucu ozetler.
 * @returns {Promise<{eklenen:number, mevcut:number, hatali:number}>}
 */
async function bulkPost(url, adlar, btn, etiket) {
  btn.disabled = true;
  let eklenen = 0, mevcut = 0, hatali = 0;

  for (const [i, name] of adlar.entries()) {
    btn.textContent = `Ekleniyor... (${i + 1}/${adlar.length})`;
    try {
      await API.post(url, { name });
      eklenen++;
    } catch (err) {
      if (err.status === 409) mevcut++; else hatali++;
    }
  }

  btn.disabled = false;
  btn.textContent = etiket;
  return { eklenen, mevcut, hatali };
}

function ozetBildir({ eklenen, mevcut, hatali }) {
  const ozet = [
    `${eklenen} eklendi`,
    mevcut ? `${mevcut} zaten kayıtlı` : null,
    hatali ? `${hatali} hatalı` : null
  ].filter(Boolean).join(', ');
  toast(ozet, hatali ? 'error' : 'success');
}

/* ============================================================
   GARSONLAR
   ============================================================ */
async function loadWaiters() {
  const body = $('waiterBody');
  try {
    const { waiters } = await API.get('/api/waiters', { all: '1' });
    $('waiterCount').textContent = waiters.length ? `${waiters.length} garson` : 'boş';

    if (!waiters.length) {
      body.innerHTML = `<tr><td colspan="2" class="empty">
        Henüz garson eklenmemiş.<br />
        <span class="muted">Yukarıdaki alandan tek tek, ya da toplu ekleme ile oluşturun.</span>
      </td></tr>`;
      return;
    }

    body.innerHTML = waiters.map((w) => `
      <tr>
        <td data-label="Garson"><b>${esc(w.name)}</b></td>
        <td data-label="İşlem">
          <button class="btn-danger btn-sm" data-waiter-del="${w.id}" data-name="${esc(w.name)}">Sil</button>
        </td>
      </tr>`).join('');

    body.querySelectorAll('[data-waiter-del]').forEach((btn) =>
      btn.addEventListener('click', () => silGarson(btn.dataset.waiterDel, btn.dataset.name)));
  } catch (err) {
    body.innerHTML = `<tr><td colspan="2" class="empty">Yüklenemedi: ${esc(err.message)}</td></tr>`;
  }
}

/** Garsonu tamamen siler. Gecmis kayitlarda adi snapshot olarak kalir. */
async function silGarson(id, ad) {
  const onay = await confirmDelete({
    title: 'Garsonu sil',
    body: `<b>${esc(ad)}</b> garson listesinden tamamen silinecek.<br />
           Geçmiş kayıtlarda adı görünmeye devam eder, arşiv bozulmaz.`
  });
  if (!onay) return;

  try {
    const r = await API.request(`/api/waiters/${id}`, { method: 'DELETE' });
    await Promise.all([loadWaiters(), loadOverview()]);
    toast(`${r.deleted} silindi.`, 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function addWaiter() {
  const name = $('newWaiter').value.trim();
  if (!name) return toast('Garson adı girin.', 'error');
  try {
    await API.post('/api/waiters', { name });
    $('newWaiter').value = '';
    await loadWaiters();
    toast(`${name} eklendi.`, 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function bulkAddWaiters() {
  const adlar = parseBulk($('bulkWaiters'));
  if (!adlar.length) return toast('Eklenecek ad bulunamadı.', 'error');

  const sonuc = await bulkPost('/api/waiters', adlar, $('bulkAddBtn'), 'Listeyi Ekle');
  $('bulkWaiters').value = '';
  await loadWaiters();
  ozetBildir(sonuc);
}

/* ============================================================
   SIGARA TURLERI
   ============================================================ */
async function loadTypes() {
  const body = $('typeBody');
  try {
    const { types } = await API.get('/api/cigarette-types', { all: '1' });
    $('typeCount').textContent = types.length
      ? `${types.filter((t) => t.is_active).length} aktif / ${types.length} toplam`
      : 'boş';

    if (!types.length) {
      body.innerHTML = `<tr><td colspan="3" class="empty">
        Henüz sigara türü eklenmemiş.<br />
        <span class="muted">Kayıt açılabilmesi için en az bir tür gerekir.</span>
      </td></tr>`;
      return;
    }

    body.innerHTML = types.map((t) => `
      <tr>
        <td data-label="Tür"><b>${esc(t.name)}</b></td>
        <td data-label="Durum">
          <span class="pill ${t.is_active ? 'free' : 'locked'}">${t.is_active ? 'AKTİF' : 'PASİF'}</span>
        </td>
        <td data-label="İşlem">
          <button class="btn-ghost btn-sm" data-type="${t.id}" data-active="${t.is_active ? 0 : 1}">
            ${t.is_active ? 'Pasife al' : 'Aktifleştir'}
          </button>
          <button class="btn-danger btn-sm" data-type-del="${t.id}" data-name="${esc(t.name)}">Sil</button>
        </td>
      </tr>`).join('');

    body.querySelectorAll('[data-type]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          await API.patch(`/api/cigarette-types/${btn.dataset.type}`, { is_active: btn.dataset.active === '1' });
          await loadTypes();
          toast(btn.dataset.active === '1' ? 'Tür aktifleştirildi.' : 'Tür pasife alındı.', 'success');
        } catch (err) { toast(err.message, 'error'); }
      }));
    body.querySelectorAll('[data-type-del]').forEach((btn) =>
      btn.addEventListener('click', () => silTur(btn.dataset.typeDel, btn.dataset.name)));
  } catch (err) {
    body.innerHTML = `<tr><td colspan="3" class="empty">Yüklenemedi: ${esc(err.message)}</td></tr>`;
  }
}

/** Sigara turunu siler - stok karti da gider. */
async function silTur(id, ad) {
  const onay = await confirmDelete({
    title: 'Sigara türünü sil',
    body: `<b>${esc(ad)}</b> silinecek. <b>Stok kartı ve kalan paket sayısı da gider.</b><br />
           Geçmiş kayıtlarda tür adı görünmeye devam eder.`
  });
  if (!onay) return;

  try {
    const r = await API.request(`/api/cigarette-types/${id}`, { method: 'DELETE' });
    await Promise.all([loadTypes(), loadOverview()]);
    toast(`${r.deleted} silindi.`, 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function addType() {
  const name = $('newType').value.trim();
  if (!name) return toast('Sigara türü girin.', 'error');
  try {
    await API.post('/api/cigarette-types', { name });
    $('newType').value = '';
    await loadTypes();
    toast(`${name} eklendi.`, 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function bulkAddTypes() {
  const adlar = parseBulk($('bulkTypes'));
  if (!adlar.length) return toast('Eklenecek tür bulunamadı.', 'error');

  const sonuc = await bulkPost('/api/cigarette-types', adlar, $('bulkTypeBtn'), 'Listeyi Ekle');
  $('bulkTypes').value = '';
  await loadTypes();
  ozetBildir(sonuc);
}

/* ============================================================
   SIGARACI HESAPLARI
   ============================================================ */
async function loadUsers() {
  const body = $('userBody');
  try {
    const { users } = await API.get('/api/users');
    $('userCount').textContent =
      `${users.filter((u) => u.is_active).length} aktif / ${users.length} toplam`;

    body.innerHTML = users.map((u) => {
      const kendisi = u.id === App.user.id;
      return `
      <tr>
        <td data-label="Kullanıcı"><b>${esc(u.username)}</b>${kendisi ? ' <span class="muted">(siz)</span>' : ''}</td>
        <td data-label="Ad Soyad">${u.full_name ? esc(u.full_name) : '—'}</td>
        <td data-label="Yetki">
          ${kendisi
            /* Kendi yetkini degistiremezsin: son yoneticinin kendini
               sigaraciya alip sistemi yonetimsiz birakmasini onler.
               Sunucu da ayni kurali uygular. */
            ? `<span class="pill">${u.role === 'admin' ? 'YÖNETİCİ' : 'SİGARACI'}</span>`
            : `<select class="role-select" data-role="${u.id}" data-current="${u.role}">
                 <option value="admin"    ${u.role === 'admin'    ? 'selected' : ''}>Yönetici</option>
                 <option value="sigaraci" ${u.role === 'sigaraci' ? 'selected' : ''}>Sigaracı</option>
               </select>`}
        </td>
        <td data-label="Durum">
          <span class="pill ${u.is_active ? 'free' : 'locked'}">${u.is_active ? 'AKTİF' : 'PASİF'}</span>
        </td>
        <td data-label="İşlem">
          <button class="btn-ghost btn-sm" data-pw="${u.id}" data-username="${esc(u.username)}">Şifre</button>
          ${kendisi ? '' : `
            <button class="btn-ghost btn-sm" data-user="${u.id}" data-active="${u.is_active ? 0 : 1}">
              ${u.is_active ? 'Pasife al' : 'Aktifleştir'}
            </button>
            <button class="btn-danger btn-sm" data-user-del="${u.id}" data-name="${esc(u.username)}">Sil</button>`}
        </td>
      </tr>`;
    }).join('');

    /* Yetki degisimi — secim degisince onay sorulur, vazgecilirse
       acilir liste eski degerine dondurulur. */
    body.querySelectorAll('[data-role]').forEach((sel) =>
      sel.addEventListener('change', () => degistirYetki(sel)));

    body.querySelectorAll('[data-user]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          await API.patch(`/api/users/${btn.dataset.user}`, { is_active: btn.dataset.active === '1' });
          await loadUsers();
          toast(btn.dataset.active === '1' ? 'Hesap aktifleştirildi.' : 'Hesap pasife alındı.', 'success');
        } catch (err) { toast(err.message, 'error'); }
      }));

    body.querySelectorAll('[data-pw]').forEach((btn) =>
      btn.addEventListener('click', () => showPasswordReset(btn)));

    body.querySelectorAll('[data-user-del]').forEach((btn) =>
      btn.addEventListener('click', () => silKullanici(btn.dataset.userDel, btn.dataset.name)));
  } catch (err) {
    body.innerHTML = `<tr><td colspan="5" class="empty">Yüklenemedi: ${esc(err.message)}</td></tr>`;
  }
}

/** Hesabi tamamen siler. Gecmis kayitlarda kullanici adi snapshot olarak kalir. */
async function silKullanici(id, ad) {
  const onay = await confirmDelete({
    title: 'Hesabı sil',
    body: `<b>${esc(ad)}</b> hesabı tamamen silinecek ve bir daha giriş yapamayacak.<br />
           Bu kişinin açtığı kayıtlar arşivde adıyla kalır.`
  });
  if (!onay) return;

  try {
    const r = await API.request(`/api/users/${id}`, { method: 'DELETE' });
    await Promise.all([loadUsers(), loadOverview()]);
    toast(`${r.deleted} hesabı silindi.`, 'success');
  } catch (err) { toast(err.message, 'error'); }
}

/** Satirin altinda kucuk bir sifre sifirlama formu acar. */
function showPasswordReset(btn) {
  const hucre = btn.closest('td');
  if (hucre.querySelector('.inline-form')) return;   // zaten acik

  const form = document.createElement('div');
  form.className = 'inline-form';
  form.innerHTML = `
    <input type="text" placeholder="Yeni şifre (en az 6)" maxlength="72" />
    <button class="btn-primary btn-sm" style="width:auto">Kaydet</button>
    <button class="btn-ghost btn-sm">İptal</button>`;
  hucre.appendChild(form);

  const [input, kaydet, iptal] = [
    form.querySelector('input'),
    form.querySelectorAll('button')[0],
    form.querySelectorAll('button')[1]
  ];
  input.focus();

  iptal.addEventListener('click', () => form.remove());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') kaydet.click(); });

  kaydet.addEventListener('click', async () => {
    const password = input.value;
    if (password.length < 6) return toast('Şifre en az 6 karakter olmalıdır.', 'error');

    kaydet.disabled = true;
    try {
      await API.patch(`/api/users/${btn.dataset.pw}`, { password });
      form.remove();
      toast(`${btn.dataset.username} şifresi güncellendi.`, 'success');
    } catch (err) {
      toast(err.message, 'error');
      kaydet.disabled = false;
    }
  });
}

async function addUser() {
  const username = $('newUsername').value.trim();
  const password = $('newPassword').value;
  const full_name = $('newFullName').value.trim();
  const role = $('newRole').value;

  if (!username) return toast('Kullanıcı adı girin.', 'error');
  if (password.length < 6) return toast('Şifre en az 6 karakter olmalıdır.', 'error');

  const btn = $('addUserBtn');
  btn.disabled = true;
  btn.textContent = 'Oluşturuluyor...';

  try {
    await API.post('/api/users', { username, password, full_name, role });
    ['newUsername', 'newFullName', 'newPassword'].forEach((id) => ($(id).value = ''));
    $('newRole').value = 'sigaraci';
    await loadUsers();
    toast(`${username} hesabı oluşturuldu.`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Hesap Oluştur';
  }
}


/**
 * Kullanicinin yetkisini degistirir.
 * Sunucu iki kurali ayrica uygular: kendi yetkini kaldiramazsin ve
 * sistemde en az bir aktif yonetici kalmalidir.
 */
async function degistirYetki(sel) {
  const id = sel.dataset.role;
  const eski = sel.dataset.current;
  const yeni = sel.value;
  if (eski === yeni) return;

  const ad = sel.closest('tr').querySelector('td b')?.textContent || 'Kullanıcı';
  const yoneticiOluyor = yeni === 'admin';

  const onay = await confirmDelete({
    title: 'Yetkiyi değiştir',
    icon: '🔑',
    body: `<b>${esc(ad)}</b> kullanıcısının yetkisi ` +
      `<b>${eski === 'admin' ? 'Yönetici' : 'Sigaracı'}</b> → ` +
      `<b>${yoneticiOluyor ? 'Yönetici' : 'Sigaracı'}</b> olacak.<br /><br />` +
      (yoneticiOluyor
        ? 'Yönetici olunca <b>hesap yönetimi, veri sıfırlama ve sigara kuralı</b> ayarlarına erişir.'
        : 'Sigaracı olunca Yönetim sayfasına erişemez. Kayıt, arşiv, stok, rapor ve uyarılar açık kalır.'),
    warning: 'Kullanıcının açık oturumu varsa değişikliği görmesi için sayfayı yenilemesi gerekir.',
    confirmText: 'Yetkiyi Değiştir'
  });

  if (!onay) { sel.value = eski; return; }

  sel.disabled = true;
  try {
    await API.patch(`/api/users/${id}`, { role: yeni });
    await loadUsers();
    toast(`${ad} artık ${yoneticiOluyor ? 'yönetici' : 'sigaracı'}.`, 'success', 5000);
  } catch (err) {
    toast(err.message, 'error', 6000);
    sel.value = eski;
    sel.disabled = false;
  }
}

/* ============================================================
   SIGARA KURALI — calisma aninda degisen ayar
   ============================================================ */
let ayarlar = null;

async function loadSettings() {
  try {
    ayarlar = await API.get('/api/settings');
    $('cooldownHours').value = ayarlar.cooldownHours;

    const m = ayarlar.meta?.cooldown_hours;
    $('cooldownInfo').textContent = m?.updatedAt
      ? `Şu an ${ayarlar.cooldownHours} saat · son değişiklik ${formatDateTime(m.updatedAt)} (${m.updatedBy || '—'})`
      : `Şu an ${ayarlar.cooldownHours} saat · henüz değiştirilmedi`;
  } catch (err) {
    $('cooldownInfo').textContent = `Ayarlar yüklenemedi: ${err.message}`;
  }
}

async function saveCooldown() {
  const saat = Number($('cooldownHours').value);
  const sinir = ayarlar?.limits?.cooldownHours || { min: 0.25, max: 72 };

  if (!Number.isFinite(saat) || saat < sinir.min || saat > sinir.max) {
    return toast(`Süre ${sinir.min} ile ${sinir.max} saat arasında olmalıdır.`, 'error');
  }

  const eski = ayarlar?.cooldownHours;
  if (saat === eski) return toast('Süre zaten bu değerde.', 'info');

  /* Kural degisimi bekleyen oyuncularin durumunu aninda degistirir;
     yonetici ne olacagini bilerek onaylasin. */
  const onay = await confirmDelete({
    title: 'Sigara kuralını değiştir',
    icon: '⏱️',
    body: `Süre <b>${eski} saat</b> → <b>${saat} saat</b> olarak değişecek.<br /><br />` +
      (saat < eski
        ? 'Süre <b>kısalıyor</b>: şu an bekleyen oyuncuların bir kısmı anında uygun hale gelecek.'
        : 'Süre <b>uzuyor</b>: şu an uygun olan oyuncuların bir kısmı yeniden beklemeye düşecek.'),
    warning: 'Değişiklik anında geçerli olur. Açık sayfalarda güncel değerin görünmesi için yenilenmeleri gerekir.',
    confirmText: 'Süreyi Değiştir'
  });
  if (!onay) return;

  const btn = $('saveCooldownBtn');
  btn.disabled = true; btn.textContent = 'Kaydediliyor...';
  try {
    await API.patch('/api/settings', { cooldownHours: saat });
    await loadSettings();
    App.cooldownHours = saat;
    App.cooldownMs = saat * 60 * 60 * 1000;
    toast(`Sigara kuralı ${saat} saat olarak güncellendi.`, 'success', 5000);
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Süreyi Kaydet'; }
}

/* ============================================================
   OLAYLAR
   ============================================================ */
function bindEvents() {
  $('addWaiterBtn').addEventListener('click', addWaiter);
  $('bulkAddBtn').addEventListener('click', bulkAddWaiters);
  $('newWaiter').addEventListener('keydown', (e) => { if (e.key === 'Enter') addWaiter(); });

  $('addTypeBtn').addEventListener('click', addType);
  $('bulkTypeBtn').addEventListener('click', bulkAddTypes);
  $('newType').addEventListener('keydown', (e) => { if (e.key === 'Enter') addType(); });

  $('addUserBtn').addEventListener('click', addUser);
  $('saveCooldownBtn').addEventListener('click', saveCooldown);
  document.querySelectorAll('[data-hours]').forEach((b) =>
    b.addEventListener('click', () => { $('cooldownHours').value = b.dataset.hours; }));

  // Tehlikeli bolge
  $('resetPickBtn')?.addEventListener('click', () => runReset([]));
  $('resetAllBtn')?.addEventListener('click', () => runReset(resetScopes.map((s) => s.key)));
  $('newPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') addUser(); });

  $('showPassword').addEventListener('change', (e) => {
    $('newPassword').type = e.target.checked ? 'text' : 'password';
  });
}

/* ============================================================
   VERI SIFIRLAMA (tehlikeli bolge)
   ============================================================ */
let resetScopes = [];
let resetWord = 'SIFIRLA';

/** Hangi veriden kac kayit var — sifirlama karti icin. */
async function loadOverview() {
  const body = $('overviewBody');
  if (!body) return;

  try {
    const { scopes, confirmWord, dbSize } = await API.get('/api/admin/overview');
    resetScopes = scopes;
    resetWord = confirmWord;

    $('dbSize').textContent = `veritabanı ${Math.round(dbSize / 1024)} KB`;
    body.innerHTML = scopes.map((s) => `
      <tr>
        <td data-label="Veri">${esc(s.label)}</td>
        <td data-label="Kayıt">
          <span class="pill ${s.count ? 'player' : ''}">${s.count}</span>
        </td>
      </tr>`).join('');
  } catch (err) {
    body.innerHTML = `<tr><td colspan="2" class="empty">Yüklenemedi: ${esc(err.message)}</td></tr>`;
  }
}

/** Sifirlama penceresini acar; preselect ile bastan isaretli gelir. */
async function runReset(preselect) {
  const secim = await confirmReset(resetScopes, resetWord, preselect);
  if (!secim) return;

  try {
    const r = await API.post('/api/admin/reset', secim);
    const ozet = Object.values(r.result)
      .filter((x) => x.deleted > 0)
      .map((x) => `${x.label}: ${x.deleted}`)
      .join(' · ');

    await Promise.all([loadWaiters(), loadTypes(), loadUsers(), loadSettings(), loadOverview()]);
    toast(ozet ? `Silindi — ${ozet}` : 'Silinecek kayıt bulunamadı.', 'success', 7000);
  } catch (err) {
    toast(err.message, 'error', 6000);
  }
}
