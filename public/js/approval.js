/* ============================================================
   MODUL 7 — Ozel onay / uyari ekrani
   4 saat kurali dolmus ve sistem yesil yaniyor olsa bile, uyari kaydi
   olan oyuncularda kayit acilmadan once bu ekran acilir.
   ============================================================ */
'use strict';

/**
 * Uyari ekranini acar ve sonucu dondurur.
 * @param {object} flag  /api/records/check veya 428 yanitindan gelen uyari kaydi
 * @returns {Promise<null | {approved_by:string, approval_note:string}>}
 *          null -> vazgecildi veya bloke; nesne -> onay verildi
 */
function showApprovalGate(flag) {
  return new Promise((resolve) => {
    const bloke = flag.level === 'blocked';
    const onayGerekli = flag.level === 'approval';

    const overlay = document.createElement('div');
    overlay.className = `gate-overlay gate-${flag.level}`;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'gateTitle');

    overlay.innerHTML = `
      <div class="gate-box">
        <div class="gate-head">
          <span class="gate-icon" aria-hidden="true">${bloke ? '⛔' : '⚠️'}</span>
          <h2 id="gateTitle">${esc(flag.label)}</h2>
        </div>

        <p class="gate-player">OYUNCU: <b>${esc(flag.player_id)}</b></p>

        <div class="gate-note">${esc(flag.note)}</div>

        ${bloke ? `
          <p class="gate-hint">
            Bu oyuncuya <b>hiçbir şekilde</b> sigara verilemez.
            Kayıt oluşturulamaz.
          </p>
        ` : `
          ${onayGerekli ? `
            <div class="field">
              <label for="gateApprover">Onayı Veren Yetkili <span class="req">*</span></label>
              <input type="text" id="gateApprover" maxlength="60"
                     placeholder="ör. Salon Şefi Kerem" autocomplete="off" />
            </div>
          ` : ''}

          <div class="field">
            <label for="gateNote">Onay Notu <span class="muted">(opsiyonel)</span></label>
            <input type="text" id="gateNote" maxlength="255"
                   placeholder="ör. telsizden onay alındı" autocomplete="off" />
          </div>

          <label class="check gate-check">
            <input type="checkbox" id="gateRead" />
            Uyarıyı okudum, ${onayGerekli ? 'yetkili onayını aldım' : 'anladım'}.
          </label>
        `}

        <div class="gate-actions">
          <button class="btn-ghost" id="gateCancel">${bloke ? 'Kapat' : 'Vazgeç'}</button>
          ${bloke ? '' : '<button class="btn-primary" id="gateConfirm" disabled>Onayla ve Kaydet</button>'}
        </div>
      </div>`;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';       // arka plan kaymasin

    const kapat = (sonuc) => {
      document.body.style.overflow = '';
      overlay.remove();
      document.removeEventListener('keydown', escHandler);
      resolve(sonuc);
    };

    const escHandler = (e) => { if (e.key === 'Escape') kapat(null); };
    document.addEventListener('keydown', escHandler);

    overlay.querySelector('#gateCancel').addEventListener('click', () => kapat(null));
    // Arka plana tiklayinca kapansin (kutuya tiklama sayilmaz)
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) kapat(null); });

    if (bloke) {
      overlay.querySelector('#gateCancel').focus();
      return;
    }

    const onayKutusu = overlay.querySelector('#gateRead');
    const yetkili = overlay.querySelector('#gateApprover');
    const not = overlay.querySelector('#gateNote');
    const onayla = overlay.querySelector('#gateConfirm');

    /** Onay dugmesi: kutu isaretli ve (gerekiyorsa) yetkili adi girilmis olmali. */
    const tazele = () => {
      const yetkiliTamam = !onayGerekli || yetkili.value.trim().length >= 2;
      onayla.disabled = !(onayKutusu.checked && yetkiliTamam);
    };

    onayKutusu.addEventListener('change', tazele);
    if (yetkili) yetkili.addEventListener('input', tazele);

    onayla.addEventListener('click', () => kapat({
      approved_by: yetkili ? yetkili.value.trim() : '',
      approval_note: not.value.trim()
    }));

    (yetkili || onayKutusu).focus();
  });
}

/**
 * ERKEN ALIM ONAYI — 4 saat dolmadan kayit acmak istendiginde cikar.
 * Kalan sure canli sayacla gosterilir, onaylayan yetkilinin adi zorunludur.
 *
 * @param {object} status  /api/records/check veya 409 yanitindaki cooldown durumu
 * @returns {Promise<null | {early_approved_by:string, early_note:string}>}
 */
function showEarlyGate(status) {
  return new Promise((resolve) => {
    const deadline = Date.now() + status.remainingMs;
    const r = status.lastRecord;

    const overlay = document.createElement('div');
    overlay.className = 'gate-overlay gate-early';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'earlyTitle');

    overlay.innerHTML = `
      <div class="gate-box">
        <div class="gate-head">
          <span class="gate-icon" aria-hidden="true">⏳</span>
          <h2 id="earlyTitle">SÜRESİ HENÜZ DOLMADI</h2>
        </div>

        <p class="gate-player">OYUNCU: <b>${esc(status.playerId)}</b></p>

        <div class="early-count">
          <div class="early-label">Sigara alabilmesi için kalan süre</div>
          <div class="cooldown-timer" id="earlyTimer">${formatCountdown(status.remainingMs)}</div>
          <div class="cooldown-meta">
            Normal alım saati: <b id="earlyNext">${formatDateTime(status.nextAvailableAt)}</b>
          </div>
        </div>

        <div class="cooldown-meta mt">
          ${r ? `Son alım: <b>${formatDateTime(status.lastAt)}</b> — ${esc(r.cigarette_type)}
                 ×${r.quantity}, garson <b>${esc(r.waiter_name)}</b><br />` : ''}
          Toplam kayıt: <b>${status.totalRecords}</b>
        </div>

        <p class="gate-hint mt">
          Yüksek oynama miktarı gibi bir gerekçeyle erken verilecekse
          <b>yetkili onayı</b> gerekir. Onay bilgisi kayda ve gün sonu raporuna işlenir.
        </p>

        <div class="field">
          <label for="earlyApprover">Onayı Veren Yetkili <span class="req">*</span></label>
          <input type="text" id="earlyApprover" maxlength="60"
                 placeholder="ör. Salon Şefi Kerem" autocomplete="off" />
        </div>

        <div class="field">
          <label for="earlyNote">Gerekçe <span class="muted">(opsiyonel)</span></label>
          <input type="text" id="earlyNote" maxlength="255"
                 placeholder="ör. yüksek oynama miktarı" autocomplete="off" />
        </div>

        <label class="check gate-check">
          <input type="checkbox" id="earlyRead" />
          Süresinin dolmadığını gördüm, yetkili onayıyla veriyorum.
        </label>

        <div class="gate-actions">
          <button class="btn-ghost" id="earlyCancel">Vazgeç</button>
          <button class="btn-primary" id="earlyConfirm" disabled>Onayla ve Kaydet</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // Kalan sure ekran acikken de akmaya devam etsin
    const tik = setInterval(() => {
      const kalan = deadline - Date.now();
      const el = overlay.querySelector('#earlyTimer');
      if (!el) return;
      if (kalan <= 0) {
        // Sure doldu: artik onaya gerek yok, normal kayit akisina don
        el.textContent = '00:00:00';
        kapat({ early_approved_by: '', early_note: '', expired: true });
        return;
      }
      el.textContent = formatCountdown(kalan);
    }, 1000);

    const kapat = (sonuc) => {
      clearInterval(tik);
      document.body.style.overflow = '';
      overlay.remove();
      document.removeEventListener('keydown', escHandler);
      resolve(sonuc);
    };

    const escHandler = (e) => { if (e.key === 'Escape') kapat(null); };
    document.addEventListener('keydown', escHandler);

    overlay.querySelector('#earlyCancel').addEventListener('click', () => kapat(null));
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) kapat(null); });

    const kutu = overlay.querySelector('#earlyRead');
    const yetkili = overlay.querySelector('#earlyApprover');
    const not = overlay.querySelector('#earlyNote');
    const onayla = overlay.querySelector('#earlyConfirm');

    const tazele = () => {
      onayla.disabled = !(kutu.checked && yetkili.value.trim().length >= 2);
    };
    kutu.addEventListener('change', tazele);
    yetkili.addEventListener('input', tazele);

    onayla.addEventListener('click', () => kapat({
      early_approved_by: yetkili.value.trim(),
      early_note: not.value.trim()
    }));

    yetkili.focus();
  });
}

/** Kayit formunun ustunde duran kalici uyari serifi (ID yazilir yazilmaz gorunur). */
function flagBannerHTML(flag) {
  if (!flag) return '';
  return `
    <div class="flag-banner flag-${flag.level}">
      <div class="flag-banner-head">${flag.level === 'blocked' ? '⛔' : '⚠️'} ${esc(flag.label)}</div>
      <div class="flag-banner-note">${esc(flag.note)}</div>
    </div>`;
}
