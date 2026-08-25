/* ============================================================
   Yikici islemler icin onay pencereleri.
   Silme geri alinamaz; bu yuzden her islem acik bir onay ister.
   ============================================================ */
'use strict';

/**
 * Basit silme onayi — tek bir kaydi silmek icin.
 * @param {object} o
 * @param {string} o.title    Baslik (ör. "Garsonu sil")
 * @param {string} o.body     HTML gövde: ne silinecek, sonucu ne
 * @param {string} [o.confirmText='Sil']
 * @returns {Promise<boolean>}
 */
function confirmDelete({ title, body, confirmText = 'Sil' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'gate-overlay gate-blocked';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    overlay.innerHTML = `
      <div class="gate-box" style="max-width:440px">
        <div class="gate-head">
          <span class="gate-icon" aria-hidden="true">🗑️</span>
          <h2>${esc(title)}</h2>
        </div>
        <div class="cooldown-meta" style="font-size:14px;line-height:1.7">${body}</div>
        <p class="gate-hint mt"><b>Bu işlem geri alınamaz.</b></p>
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
