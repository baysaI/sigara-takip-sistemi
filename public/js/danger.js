/* ============================================================
   Yikici islemler icin onay pencereleri.
   Silme geri alinamaz; bu yuzden her islem acik bir onay ister.
   ============================================================ */
'use strict';

/**
 * Basit onay penceresi — tek bir kaydi silmek/geri almak icin.
 * @param {object} o
 * @param {string} o.title    Baslik (ör. "Garsonu sil")
 * @param {string} o.body     HTML gövde: ne olacak, sonucu ne
 * @param {string} [o.confirmText='Sil']
 * @param {string} [o.warning] Alt uyari satiri. Yikici olmayan islemlerde
 *                             (ör. iptali geri alma) uygun metin verilmeli;
 *                             bos string verilirse satir hic gosterilmez.
 * @param {string} [o.icon='🗑️']
 * @returns {Promise<boolean>}
 */
function confirmDelete({
  title, body, confirmText = 'Sil',
  warning = '<b>Bu işlem geri alınamaz.</b>', icon = '🗑️'
}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'gate-overlay gate-blocked';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    overlay.innerHTML = `
      <div class="gate-box" style="max-width:440px">
        <div class="gate-head">
          <span class="gate-icon" aria-hidden="true">${icon}</span>
          <h2>${esc(title)}</h2>
        </div>
        <div class="cooldown-meta" style="font-size:14px;line-height:1.7">${body}</div>
        ${warning ? `<p class="gate-hint mt">${warning}</p>` : ''}
        <div class="gate-actions">
          <button class="btn-ghost" data-no>Vazgeç</button>
          <button class="btn-danger" data-yes>${esc(confirmText)}</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const kapat = (sonuc) => {
      document.body.style.overflow = '';
      overlay.remove();
      document.removeEventListener('keydown', esc2);
      resolve(sonuc);
    };
    const esc2 = (e) => { if (e.key === 'Escape') kapat(false); };
    document.addEventListener('keydown', esc2);

    overlay.querySelector('[data-no]').addEventListener('click', () => kapat(false));
    overlay.querySelector('[data-yes]').addEventListener('click', () => kapat(true));
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) kapat(false); });
    overlay.querySelector('[data-no]').focus();
  });
}

/**
 * SATIS IPTALI onayi.
 *
 * Silmeden farki: kayit yok olmaz, "Iptal Edilenler" bolumune tasinir ve
 * tum gecmisiyle orada durur. Bu yuzden pencere kirmizi/yikici degil,
 * bilgilendirici tonda ve ne olacagini madde madde yazar.
 *
 * @param {object} o
 * @param {object} o.record  {player_id, cigarette_type, quantity, created_at}
 * @param {boolean} o.late   Satisin donemi kapanmis mi (gec iptal)
 * @returns {Promise<null | {reason:string}>}
 */
function confirmCancel({ record, late }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'gate-overlay gate-cancel';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    /* Gec iptalde muhasebe farkli isler; yonetici bunu ONCEDEN bilmeli. */
    const gecUyari = late ? `
      <p class="gate-hint" style="border-left:3px solid var(--accent);padding-left:10px">
        <b>Bu satış kapanmış bir güne ait.</b> O günün raporu
        <b>değişmeyecek</b> — sigara o gün gerçekten satılmıştı.
        İade, <b>bugünün dönemine</b> düzeltme hareketi olarak işlenecek.
      </p>` : '';

    overlay.innerHTML = `
      <div class="gate-box" style="max-width:460px">
        <div class="gate-head">
          <span class="gate-icon" aria-hidden="true">🚫</span>
          <h2>Satışı iptal et</h2>
        </div>

        <div class="gate-player">
          Oyuncu <b>${esc(record.player_id)}</b>
        </div>

        <div class="cooldown-meta" style="font-size:14px;line-height:1.7;margin-bottom:14px">
          <b>${esc(record.cigarette_type)} ×${record.quantity}</b><br />
          Kayıt saati: <b>${formatDateTime(record.created_at)}</b>
        </div>

        <div class="field">
          <label for="cancelReason">İptal nedeni <span class="muted">(opsiyonel)</span></label>
          <input type="text" id="cancelReason" maxlength="255"
                 placeholder="ör. müşteri iade etti" autocomplete="off" />
        </div>

        ${gecUyari}

        <p class="gate-hint">
          Kayıt <b>silinmez</b> — aktif arşivden çıkar, <b>İptaller</b> bölümünde
          tüm detaylarıyla kalır.<br />
          Sigara <b>stoğa geri döner</b>.<br />
          Oyuncunun <b>${App.cooldownHours} saat sayacı serbest kalır</b>: iptal edilen
          satış hak kullanımı sayılmaz.
        </p>

        <div class="gate-actions">
          <button class="btn-ghost" data-no>Vazgeç</button>
          <button class="btn-danger" data-yes>Satışı İptal Et</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const kapat = (sonuc) => {
      document.body.style.overflow = '';
      overlay.remove();
      document.removeEventListener('keydown', escTus);
      resolve(sonuc);
    };
    const escTus = (e) => { if (e.key === 'Escape') kapat(null); };
    document.addEventListener('keydown', escTus);

    overlay.querySelector('[data-no]').addEventListener('click', () => kapat(null));
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) kapat(null); });
    overlay.querySelector('[data-yes]').addEventListener('click', () =>
      kapat({ reason: overlay.querySelector('#cancelReason').value.trim() }));

    overlay.querySelector('#cancelReason').focus();
  });
}

/**
 * Toplu sifirlama onayi — kapsam secimi + kelime yazarak dogrulama.
 * @param {Array<{key:string,label:string,count:number}>} scopes
 * @param {string} confirmWord
 * @param {string[]} [preselect]  Bastan isaretli gelecek kapsamlar
 * @returns {Promise<null | {scopes:string[], confirm:string}>}
 */
function confirmReset(scopes, confirmWord, preselect = []) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'gate-overlay gate-blocked';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const satirlar = scopes.map((s) => `
      <label class="check reset-row">
        <input type="checkbox" value="${s.key}" ${preselect.includes(s.key) ? 'checked' : ''}
               ${s.count === 0 ? 'disabled' : ''} />
        <span class="reset-label">${esc(s.label)}</span>
        <span class="pill ${s.count ? 'locked' : ''}">${s.count}</span>
      </label>`).join('');

    overlay.innerHTML = `
      <div class="gate-box">
        <div class="gate-head">
          <span class="gate-icon" aria-hidden="true">⚠️</span>
          <h2>VERİ SIFIRLAMA</h2>
        </div>

        <p class="gate-hint">
          Seçtiğiniz veriler kalıcı olarak silinir. <b>Geri alınamaz</b> —
          silmeden önce yedek almak isterseniz sunucudaki
          <code>data/sigara.db</code> dosyasını kopyalayın.
        </p>

        <div class="reset-list">${satirlar}</div>

        <div class="field mt">
          <label for="resetWord">Onaylamak için <b>${esc(confirmWord)}</b> yazın</label>
          <input type="text" id="resetWord" autocomplete="off" placeholder="${esc(confirmWord)}" />
        </div>

        <div class="gate-actions">
          <button class="btn-ghost" data-no>Vazgeç</button>
          <button class="btn-danger" data-yes disabled>Seçilenleri Sil</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const kapat = (sonuc) => {
      document.body.style.overflow = '';
      overlay.remove();
      document.removeEventListener('keydown', esc2);
      resolve(sonuc);
    };
    const esc2 = (e) => { if (e.key === 'Escape') kapat(null); };
    document.addEventListener('keydown', esc2);

    const kelime = overlay.querySelector('#resetWord');
    const onayla = overlay.querySelector('[data-yes]');
    const kutular = [...overlay.querySelectorAll('.reset-list input')];

    /** Onay: en az bir kapsam secili + dogrulama kelimesi tam yazilmis. */
    const tazele = () => {
      const secili = kutular.filter((k) => k.checked).length;
      onayla.disabled = !(secili > 0 && kelime.value.trim() === confirmWord);
      onayla.textContent = secili ? `Seçilenleri Sil (${secili})` : 'Seçilenleri Sil';
    };

    kutular.forEach((k) => k.addEventListener('change', tazele));
    kelime.addEventListener('input', tazele);
    tazele();

    overlay.querySelector('[data-no]').addEventListener('click', () => kapat(null));
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) kapat(null); });

    onayla.addEventListener('click', () => kapat({
      scopes: kutular.filter((k) => k.checked).map((k) => k.value),
      confirm: kelime.value.trim()
    }));
  });
}

/* ============================================================
   KAYDI KALICI OLARAK SILME — yalnizca KOK HESAP.

   Sistemin geri kalani hicbir seyi silmez: iptal edilen satis arsivde
   kalir, degisimde orijinal kayit durur, ID duzeltmesi iz birakir.
   Silme bu prensibin TEK istisnasi ve geri donusu yok.

   Yanlis girilmis bir kayit icin once IPTAL denenmelidir — iptal geri
   alinabilir, silme alinamaz. Silme, iptalin bile yetmedigi durum
   icindir: ornegin adi tamamen yanlis yazilmis TEK SEFERLIK sigara,
   cunku o kayit stok karti olmadigi icin baska turlu duzeltilemez.

   Cagiran: arsiv.js, kayit.js, iptal.js
   ============================================================ */

/** Kok hesap mi? Silme dugmeleri yalnizca burada gorunur. */
const kokHesap = () => !!App.user?.is_root;

/**
 * Onay ekranini acar, onaylanirsa kaydi siler.
 *
 * @param {object} r  Silinecek kayit
 * @returns {Promise<boolean>} silindiyse true (liste tazelensin)
 */
async function handleRecordDelete(r) {
  const zincirli = !!(r.superseded_by || r.exchanged_from);
  const iptalli = !!r.cancelled_at;

  /* Ne olacagini ONCEDEN yaz: stok iadesi kaydin durumuna gore degisir
     ve kullanici bunu onaydan sonra ogrenmemeli. */
  const stokSatiri = r.custom_type
    ? 'Bu <b>tek seferlik</b> bir sigara — stok kartı yok, stoğa bir şey eklenmez.'
    : iptalli
      ? 'Bu satış <b>zaten iptal edilmişti</b>; stok o an geri dönmüştü, tekrar eklenmez.'
      : `<b>${esc(r.cigarette_type)} ×${r.quantity}</b> stoğa geri eklenir.`;

  const onay = await confirmDelete({
    title: 'Kaydı kalıcı olarak sil',
    body:
      `<b>${esc(r.player_id)}</b> — ${esc(r.cigarette_type)} ×${r.quantity}<br />` +
      `${formatDateTime(r.created_at)} · garson ${esc(r.waiter_name)}<br /><br />` +
      stokSatiri +
      (zincirli
        ? '<br /><br />🔄 Bu kayıt sigara değişimiyle bağlantılı; <b>zincirin tamamı</b> silinir.'
        : '') +
      '<br /><br /><span class="muted">Kaydı geri getirmenin yolu yoktur. ' +
      'Yalnızca hatayı düzeltmek için kullanın — iade için <b>İptal Et</b> daha doğrudur.</span>',
    confirmText: 'Kalıcı Olarak Sil'
  });
  if (!onay) return false;

  try {
    const res = await API.request(`/api/records/${r.id}`, { method: 'DELETE' });

    toast(
      `Kayıt silindi: ${res.deleted.player_id} — ${res.deleted.cigarette_type}` +
      (res.chain ? ` (${res.chain.length} kayıtlık değişim zinciri)` : ''),
      'success', 5000
    );
    if (res.restocked) {
      toast(`↩️ ${res.restocked.type}: ${res.restocked.balance} paket (stoğa döndü)`, 'info', 4500);
    } else if (res.wasCancelled) {
      toast('Stok eklenmedi — iptal edildiğinde zaten geri dönmüştü.', 'info', 5000);
    }
    return true;
  } catch (err) {
    // 403: kok hesap degil. Dugme zaten gizli ama sunucu son sozu soyler.
    toast(err.message, 'error', 6000);
    return false;
  }
}
