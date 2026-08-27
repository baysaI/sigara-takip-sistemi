/* ============================================================
   SIGARA DEGISIMI — onay ekrani.

   Misafir aldigi sigarayi baska bir turle degistirmek istediginde acilir.
   Yanlislikla degisim yapilmasini onlemek icin islem OZETI gosterilir ve
   onay dugmesi tur secilene kadar kapalidir.

   Cagiran: kayit.js
   ============================================================ */
'use strict';

/**
 * @param {object} o
 * @param {object} o.record  Degistirilecek kayit (id, player_id, cigarette_type,
 *                           cigarette_type_id, quantity, waiter_name, created_at)
 * @param {Array}  o.types   Stok kartlari: {id, name, stock, state}
 * @returns {Promise<null | {to_type_id:number, note:string}>}
 */
function showExchangeDialog({ record, types }) {
  return new Promise((resolve) => {
    // Mevcut tur listeden cikarilir: kendisiyle degisim anlamsiz
    const secenekler = types.filter((t) => t.id !== record.cigarette_type_id && t.is_active !== 0);

    const overlay = document.createElement('div');
    overlay.className = 'gate-overlay gate-swap';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const optionHTML = secenekler.map((t) => {
      const yetersiz = t.stock < record.quantity;
      const etiket = yetersiz
        ? `${t.name} — stok yetersiz (${t.stock})`
        : `${t.name} — ${t.stock} paket`;
      return `<option value="${t.id}" ${yetersiz ? 'disabled' : ''}>${esc(etiket)}</option>`;
    }).join('');

    overlay.innerHTML = `
      <div class="gate-box" style="max-width:480px">
        <div class="gate-head">
          <span class="gate-icon" aria-hidden="true">🔄</span>
          <h2>Sigara Değiştir</h2>
        </div>

        <div class="gate-player">
          Oyuncu <b>${esc(record.player_id)}</b>
        </div>

        <div class="cooldown-meta" style="font-size:14px;line-height:1.7;margin-bottom:14px">
          Mevcut: <b>${esc(record.cigarette_type)} ×${record.quantity}</b><br />
          Alan garson: <b>${esc(record.waiter_name)}</b><br />
          Kayıt saati: <b>${formatDateTime(record.created_at)}</b>
        </div>

        ${secenekler.length ? `
          <div class="field">
            <label for="swapType">Yeni sigara türü <span class="req">*</span></label>
            <select id="swapType">
              <option value="">— Seçiniz —</option>
              ${optionHTML}
            </select>
          </div>

          <div class="field">
            <label for="swapNote">Gerekçe <span class="muted">(opsiyonel)</span></label>
            <textarea id="swapNote" maxlength="255"
                      placeholder="ör. misafir marka değiştirmek istedi"></textarea>
          </div>

          <div class="gate-note" id="swapSummary" style="display:none"></div>
        ` : `
          <p class="gate-hint">
            Değişim yapılabilecek başka bir sigara türü yok.
            Yönetim sayfasından tür ekleyin veya stok girin.
          </p>
        `}

        <p class="gate-hint">
          İlk kayıt <b>silinmez</b> — arşivde "değiştirildi" olarak kalır ve
          hangi sigaranın neyle değiştirildiği kayda geçer.
          <b>${App.cooldownHours} saat sayacı değişmez</b>: değişim yeni bir alım değildir.
        </p>

        <div class="gate-actions">
          <button class="btn-ghost" data-no>Vazgeç</button>
          ${secenekler.length
            ? '<button class="btn-primary" data-yes disabled>Değişimi Onayla</button>'
            : ''}
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

    const onayBtn = overlay.querySelector('[data-yes]');
    if (!onayBtn) {
      overlay.querySelector('[data-no]').focus();
      return;
    }

    const secim = overlay.querySelector('#swapType');
    const ozet = overlay.querySelector('#swapSummary');

    /* Ne olacagini acikca yaz: yanlis tikin onundeki son engel budur. */
    secim.addEventListener('change', () => {
      const tur = secenekler.find((t) => String(t.id) === secim.value);
      onayBtn.disabled = !tur;

      if (!tur) {
        ozet.style.display = 'none';
        onayBtn.textContent = 'Değişimi Onayla';
        return;
      }

      ozet.style.display = '';
      ozet.innerHTML =
        `<b>${esc(record.cigarette_type)} ×${record.quantity}</b> ` +
        `→ <b>${esc(tur.name)} ×${record.quantity}</b><br />` +
        `<span class="muted">${esc(record.cigarette_type)} stoğa geri döner, ` +
        `${esc(tur.name)} stoğundan ${record.quantity} paket düşer.</span>`;
      onayBtn.textContent = `${tur.name} ile Değiştir`;
    });

    onayBtn.addEventListener('click', () => {
      const tur = secenekler.find((t) => String(t.id) === secim.value);
      if (!tur) return;
      kapat({
        to_type_id: tur.id,
        note: overlay.querySelector('#swapNote').value.trim()
      });
    });

    secim.focus();
  });
}
