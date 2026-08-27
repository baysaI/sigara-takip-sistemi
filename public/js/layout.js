/* ============================================================
   Ortak kabuk — her korumali sayfa bunu yukler.
     · Oturum dogrulama ve kullanici bilgisi
     · Ust bar + gezinme (telefonda alt sekme cubugu)
     · Cikis, sunucu erisilemiyor uyarisi
   Sayfaya ozel dosyalar App.ready() ile baslar.
   ============================================================ */
'use strict';

const App = {
  user: null,
  cooldownHours: 4,
  cooldownMs: 4 * 60 * 60 * 1000,

  /**
   * Acik donem: { dayKey, from, to, open, openedAt, asOf, previousClosedAt }
   * Gun degisimi saatle degil, gun sonu raporunun alinmasiyla olur.
   */
  period: null,

  /** Gun kapandiktan sonra kabugu tazelemek icin. */
  async refreshPeriod() {
    const cfg = await API.get('/api/config');
    App.period = cfg.period || null;
    return App.period;
  },

  /** Sayfa scriptleri bunu cagirir: kabuk hazir olunca callback calisir. */
  async ready(callback) {
    try {
      const [me, cfg] = await Promise.all([
        API.get('/api/auth/me'),
        API.get('/api/config')
      ]);

      App.user = me.user;
      App.cooldownHours = cfg.cooldownHours;
      App.cooldownMs = cfg.cooldownHours * 60 * 60 * 1000;
      App.period = cfg.period || null;

      renderShell();
      await callback();
    } catch (err) {
      console.error(err);
      if (err.offline) return showOfflineBanner(err.message);
      toast(err.message || 'Sayfa yüklenemedi.', 'error');
    }
  }
};

/* --------------------- Gezinme tanimi --------------------- */
const NAV_ITEMS = [
  { href: '/kayit.html',   icon: '⚡', label: 'Kayıt' },
  { href: '/arsiv.html',   icon: '🗂️', label: 'Arşiv' },
  // Iptal edilen satislar aktif arsivden cikar, burada gecmisiyle durur.
  // Goruntulemek herkese acik; iptal etmek yalnizca yoneticide.
  { href: '/iptal.html',   icon: '🚫', label: 'İptaller' },
  { href: '/sorgu.html',   icon: '🔍', label: 'Sorgu' },
  { href: '/stok.html',    icon: '📦', label: 'Stok' },
  { href: '/rapor.html',   icon: '📊', label: 'Rapor', adminOnly: true },
  { href: '/yonetim.html', icon: '⚙️', label: 'Yönetim', adminOnly: true }
];

/** Ust bar + gezinmeyi sayfanin basina yerlestirir. */
function renderShell() {
  const current = location.pathname.replace(/\/$/, '') || '/kayit.html';

  const items = NAV_ITEMS
    .filter((n) => !n.adminOnly || App.user.role === 'admin')
    .map((n) => {
      const active = current === n.href ? ' active' : '';
      return `<a href="${n.href}" class="${active.trim()}"${active ? ' aria-current="page"' : ''}>
                <span class="ico" aria-hidden="true">${n.icon}</span>
                <span>${n.label}</span>
              </a>`;
    }).join('');

  // Ust bar ve gezinme tek bir sticky sarmalayicida durur: boylece gezinmenin
  // ust bara gore konumu sabit bir piksel degerine bagli kalmaz.
  const shell = document.createElement('div');
  shell.innerHTML = `
    <div class="app-header">
    <header class="topbar">
      <div class="brand">
        <span aria-hidden="true">🚬</span>
        <span class="brand-text">Sigara Takip</span>
        <small>· ${App.cooldownHours} saat kuralı</small>
      </div>
      <div class="spacer"></div>
      <div class="who">
        <strong>${esc(App.user.full_name || App.user.username)}</strong>
        <span>@${esc(App.user.username)} · ${esc(App.user.role)}</span>
      </div>
      <button class="btn-ghost btn-sm" id="logoutBtn">Çıkış</button>
    </header>
    <nav class="app-nav" aria-label="Ana gezinme">${items}</nav>
    </div>`;

  // Ust bar ve gezinme sayfanin en basina gelir
  while (shell.firstChild) document.body.insertBefore(shell.firstChild, document.body.firstChild);
  document.body.classList.add('has-nav');

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await API.post('/api/auth/logout').catch(() => {});
    location.href = '/login.html';
  });
}

/** Sunucu kapaliyken kaybolmayan uyari bandi. */
function showOfflineBanner(message) {
  const bar = document.createElement('div');
  bar.style.cssText = `background:#e5484d;color:#fff;padding:13px 16px;font-size:14px;
                       text-align:center;font-weight:600;line-height:1.6`;
  bar.innerHTML = `⚠️ ${esc(message)}
    <button id="retryBtn" style="margin-left:10px;background:#fff;color:#e5484d;
            min-height:36px;padding:6px 14px;font-size:13px">Yeniden dene</button>`;
  document.body.insertBefore(bar, document.body.firstChild);
  document.getElementById('retryBtn').addEventListener('click', () => location.reload());
}
