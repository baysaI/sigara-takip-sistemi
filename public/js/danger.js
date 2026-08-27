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
