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

/**
 * Tarih + SAAT alanlarını ISO'ya çevirir.
 *
 * Saat boş bırakılırsa gün sınırı kullanılır (başlangıç 00:00, bitiş
 * 23:59:59.999) — yani saat girilmediğinde davranış eskisiyle aynıdır.
 * Vardiya gece yarısını aştığı için saat seçebilmek gerekiyor:
 * "dün 22:00 – bugün 04:00" gibi bir aralık ancak böyle kurulabilir.
 *
 * @param {string} dateStr YYYY-MM-DD
 * @param {string} timeStr HH:MM (boş olabilir)
 * @param {boolean} endOfDay Saat boşsa gün sonuna mı çekilsin
 */
function localDateTimeToISO(dateStr, timeStr, endOfDay = false) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);

  if (!timeStr) return localDateToISO(dateStr, endOfDay);

  const [sa, dk] = timeStr.split(':').map(Number);
  // Bitiş saatinde o dakikanın tamamı dahil olsun: 04:00 seçilince
  // 04:00:59.999'a kadar sayılır, aksi halde tam 04:00 kaydı düşerdi.
  const dt = endOfDay
    ? new Date(y, m - 1, d, sa || 0, dk || 0, 59, 999)
    : new Date(y, m - 1, d, sa || 0, dk || 0, 0, 0);

  return dt.toISOString();
}

/* ---------------------- İş günü (gün değişimi) ---------------------- */
/*
 * Gün değişimi SAATE BAĞLI DEĞİLDİR. Açık dönem, yönetici Gün Sonu
 * Raporu'nu alana kadar sürer; raporun alındığı an dönem kapanır ve yenisi
 * tam o anda başlar. Sınırlar sunucudan gelir (App.period).
 */

/** Dönem etiketini insan diline çevirir: "27.08.2026" / "27.08.2026 (2. kapanış)" */
function periodLabel(dayKey) {
  if (!dayKey) return '—';
  const [tarih, sira] = String(dayKey).split('#');
  const [y, m, d] = tarih.split('-');
  const gosterim = (y && m && d) ? `${d}.${m}.${y}` : tarih;
  return sira ? `${gosterim} (${sira}. kapanış)` : gosterim;
}

/**
 * Açık dönemin ne kadar süredir açık olduğunu yazar.
 * "3 sa 12 dk" gibi — yöneticiye günü kapatmayı unutup unutmadığını gösterir.
 */
function periodDuration(fromISO, nowISO) {
  const bas = Date.parse(fromISO);
  const son = nowISO ? Date.parse(nowISO) : Date.now();
  if (Number.isNaN(bas) || son <= bas) return '';

  const dk = Math.floor((son - bas) / 60000);
  const gun = Math.floor(dk / 1440);
  const saat = Math.floor((dk % 1440) / 60);
  const kalan = dk % 60;

  if (gun) return `${gun} gün ${saat} sa`;
  if (saat) return `${saat} sa ${kalan} dk`;
  return `${kalan} dk`;
}

/* ------------------- Kayıt detayı (Info + onaylar) ------------------- */
/**
 * Bir kaydın "neden / kim" bilgisini tek blok halinde üretir.
 *
 * Info notu, özel onay ve erken alım bilgileri veritabanında tutuluyordu
 * ama hiçbir ekranda görünmüyordu — "kim onay verdi" sorusunun cevabı
 * yalnızca gün sonu raporundaydı. Aynı görünümü Arşiv, Son Kayıtlar ve
 * Sorgu sayfaları paylaşsın diye burada.
 *
 * @param {object} r  records satırı (arşiv uç noktasından)
 * @returns {string} HTML — kaçışlama içeride yapılır
 */
function recordDetailHTML(r) {
  const satirlar = [];

  /* İnfo iki parçalı: kim verdi (info_by) + neden (info). Eski kayıtlarda
     ad yoktur, yalnızca serbest metin bulunur. */
  if (r.info_by) {
    satirlar.push(`💬 İnfo: <b>${esc(r.info_by)}</b>${r.info ? ` · ${esc(r.info)}` : ''}`);
  } else if (r.info) {
    satirlar.push(esc(r.info));
  }

  // Erken alım: 4 saat dolmadan, yetkili onayıyla verildi
  if (r.early_release) {
    const kim = r.early_approved_by ? `<b>${esc(r.early_approved_by)}</b>` : 'yetkili';
    const sure = r.early_remaining_ms ? ` (${formatDuration(r.early_remaining_ms)} kalmıştı)` : '';
    satirlar.push(
      `<span class="detail-line early">⏳ Erken alım — onay: ${kim}${sure}` +
      `${r.early_note ? ` · ${esc(r.early_note)}` : ''}</span>`
    );
  }

  // Modül 7: özel uyarı / onay ile verildi
  if (r.flag_level) {
    const kim = r.approved_by ? `<b>${esc(r.approved_by)}</b>` : 'okundu onayı';
    satirlar.push(
      `<span class="detail-line flag">⚠️ ${esc((r.flag_level || '').toUpperCase())} — onay: ${kim}` +
      `${r.flag_note ? ` · uyarı: ${esc(r.flag_note)}` : ''}` +
      `${r.approval_note ? ` · not: ${esc(r.approval_note)}` : ''}</span>`
    );
  }

  // Sigara değişimi
  if (r.exchanged_from && r.exchanged_by) {
    satirlar.push(
      `<span class="detail-line swap">🔄 Değişimle verildi — ${esc(r.exchanged_by)}` +
      `${r.exchanged_at ? ` · ${formatDateTime(r.exchanged_at)}` : ''}</span>`
    );
  }
  if (r.superseded_by) {
    satirlar.push('<span class="detail-line swap">🔄 Bu kayıt değiştirildi, yerine yenisi geçti</span>');
  }

  // Oyuncu ID düzeltmesi — kaydın sahibi sonradan düzeltildi
  if (r.player_edited_at) {
    satirlar.push(
      `<span class="detail-line swap">🆔 ID düzeltildi — ${esc(r.player_edited_by || '')}` +
      ` · ${formatDateTime(r.player_edited_at)}</span>`
    );
  }

  // İptal
  if (r.cancelled_at) {
    satirlar.push(
      `<span class="detail-line cancel">🚫 İptal — ${esc(r.cancelled_by || '')}` +
      `${r.cancel_reason ? ` · ${esc(r.cancel_reason)}` : ''}</span>`
    );
  }

  return satirlar.length ? satirlar.join('<br />') : '<span class="muted">—</span>';
}

/**
 * Garson hücresi: ad + gerekiyorsa "tek seferlik" rozeti.
 *
 * Tek seferlik garson kalıcı listeye eklenmediği için arşive bakan kişi
 * adı listede arayıp bulamaz. Rozet bunu açıkça söyler — tek seferlik
 * sigaradaki (custom_type) "LİSTE DIŞI" rozetiyle aynı dil.
 *
 * @param {object} r  records satırı
 * @returns {string} HTML — kaçışlama içeride yapılır
 */
function waiterCellHTML(r) {
  return esc(r.waiter_name) + (r.custom_waiter
    ? ' <span class="pill custom" title="Tek seferlik garson — kayıtlı garson listesinde yok">LİSTE DIŞI</span>'
    : '');
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
