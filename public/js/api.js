/* ============================================================
   Ortak yardimcilar: Fetch sarmalayici, tarih bicimleyici, toast
   ============================================================ */
'use strict';

/*
 * Sayfa dosyaya cift tiklanarak (file://) acildiysa hicbir API cagrisi calismaz;
 * kullanici bunu "veritabani calismiyor" olarak gorur. Net bir uyari goster.
 */
if (location.protocol === 'file:') {
  document.addEventListener('DOMContentLoaded', () => {
    document.body.innerHTML = `
      <div style="min-height:100vh;display:grid;place-items:center;padding:24px;
                  font-family:'Segoe UI',system-ui,sans-serif;background:#0f1419;color:#e6edf3">
        <div style="max-width:480px;background:#1b232d;border:1px solid #e5484d;
                    border-radius:14px;padding:30px;text-align:center">
          <div style="font-size:42px;margin-bottom:10px">⚠️</div>
          <h1 style="font-size:19px;margin-bottom:12px">Sayfa yanlış şekilde açıldı</h1>
          <p style="color:#93a4b5;font-size:14px;line-height:1.6;margin-bottom:18px">
            HTML dosyasına çift tıklayarak açtınız. Bu şekilde veritabanına
            bağlanılamaz ve hiçbir kayıt görünmez.
          </p>
          <p style="font-size:14px;line-height:1.7">
            Önce terminalden <b style="color:#f0a500">npm start</b> komutunu çalıştırın,<br />
            sonra tarayıcıdan şu adrese gidin:
          </p>
          <a href="http://localhost:3000" style="display:inline-block;margin-top:14px;
             background:#f0a500;color:#241a00;text-decoration:none;font-weight:700;
             padding:11px 22px;border-radius:8px">http://localhost:3000</a>
        </div>
      </div>`;
  });
}

const API = {
  async request(url, options = {}) {
    let res;
    try {
      res = await fetch(url, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
        ...options
      });
    } catch (netErr) {
      // fetch ag seviyesinde patlarsa tarayici sadece "Failed to fetch" der.
      // Gercek sebep neredeyse her zaman sunucunun kapali olmasidir.
      const err = new Error(
        `Sunucuya ulaşılamıyor (${location.origin}). ` +
        'Terminalde "npm start" komutunun çalıştığından emin olun.'
      );
      err.offline = true;
      err.cause = netErr;
      throw err;
    }

    // Oturum düştüyse giriş sayfasına dön
    if (res.status === 401 && !location.pathname.endsWith('login.html')) {
      location.href = '/login.html';
      throw new Error('Oturum sona erdi.');
    }

    let data = null;
    try { data = await res.json(); } catch { /* gövdesiz yanıt */ }

    if (!res.ok) {
      const err = new Error(data?.error || `İstek başarısız (HTTP ${res.status})`);
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  },

  get(url, params) {
    const qs = params ? '?' + new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== '' && v != null)
    ) : '';
    return API.request(url + qs);
  },

  post(url, body) {
    return API.request(url, { method: 'POST', body: JSON.stringify(body || {}) });
  },

  patch(url, body) {
    return API.request(url, { method: 'PATCH', body: JSON.stringify(body || {}) });
  }
};

/* ------------------------- Tarih / süre ------------------------- */

/** ISO -> "23.08.2026 18:04" (kullanıcının yerel saati) */
function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('tr-TR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

/** Milisaniye -> "03:47:12" geri sayım biçimi */
function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/** Milisaniye -> "3 saat 47 dakika" gibi okunur metin */
function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h} saat ${m} dakika`;
  if (h) return `${h} saat`;
  return `${m} dakika`;
}

/** ISO -> "12 dakika önce" */
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'az önce';
  return formatDuration(diff) + ' önce';
}

/**
 * <input type="date"> değerini gün başlangıcı/sonu ISO'suna çevirir.
 * Kullanıcının yerel saat dilimine göre hesaplanır; sunucu UTC ISO saklar.
 */
function localDateToISO(dateStr, endOfDay = false) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
  return dt.toISOString();
}

/** XSS koruması: kullanıcı verisi innerHTML'e girerken kaçışlanır. */
function esc(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* --------------------------- Bildirim --------------------------- */
function toast(message, type = 'info', ms = 3800) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/** Belirli gecikmeyle tetiklenen fonksiyon (input üzerinde istek yağmurunu önler). */
function debounce(fn, delay = 400) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}
