/* ============================================================
   OYUNCU ID DUZELTME — onay ekrani.

   Yanlis yazilmis ID icin. Yanlislikla baskasinin kaydini baska bir
   oyuncuya gecirmemek adina islem OZETI gosterilir ve onay dugmesi
   gecerli, FARKLI bir ID yazilana kadar kapali kalir.

   Cagiran: arsiv.js, kayit.js
   ============================================================ */
'use strict';

/**
 * @param {object} o
 * @param {object} o.record   Duzeltilecek kayit (id, player_id, cigarette_type,
 *                            quantity, waiter_name, created_at, superseded_by,
 *                            exchanged_from)
 * @param {boolean} [o.late]  Kaydin donemi kapanmis mi (uyari metni icin)
 * @param {Array}  [o.edits]  Onceki duzeltmeler (varsa gecmis gosterilir)
 * @returns {Promise<null | {player_id:string, reason:string}>}
 */
function showPlayerIdDialog({ record, late = false, edits = [] }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'gate-overlay gate-swap';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    /* Sigara degistirilmis kayitlarda zincirin TAMAMI birlikte duzeltilir;
       kullanici bunu onaydan once bilmeli. */
    const zincirli = !!(record.superseded_by || record.exchanged_from);

    const gecmisHTML = edits.length ? `
      <div class="cooldown-meta" style="font-size:13px;line-height:1.7;margin-bottom:14px">
        <b>Önceki düzeltmeler:</b><br />
        ${edits.map((e) =>
          `${esc(e.old_player_id)} → ${esc(e.new_player_id)}` +
          ` <span class="muted">· ${esc(e.username)} · ${formatDateTime(e.created_at)}</span>`
        ).join('<br />')}
      </div>` : '';

    overlay.innerHTML = `
      <div class="gate-box" style="max-width:480px">
        <div class="gate-head">
          <span class="gate-icon" aria-hidden="true">🆔</span>
          <h2>Oyuncu ID Düzelt</h2>
        </div>

        <div class="gate-player">
          Mevcut ID <b>${esc(record.player_id)}</b>
        </div>

        <div class="cooldown-meta" style="font-size:14px;line-height:1.7;margin-bottom:14px">
          Kayıt: <b>${esc(record.cigarette_type)} ×${record.quantity}</b><br />
          Alan garson: <b>${esc(record.waiter_name)}</b><br />
          Kayıt saati: <b>${formatDateTime(record.created_at)}</b>
        </div>

        ${gecmisHTML}

        <div class="field">
          <label for="newPlayerId">Doğru oyuncu ID <span class="req">*</span></label>
          <input type="text" id="newPlayerId" maxlength="40" autocomplete="off"
                 inputmode="text" placeholder="ör. 1250" />
        </div>

        <div class="field">
          <label for="editReason">Neden <span class="muted">(opsiyonel)</span></label>
          <input type="text" id="editReason" maxlength="255" autocomplete="off"
                 placeholder="ör. garson yanlış ID getirdi" />
        </div>

        <div class="cooldown-box show" id="idSummary" style="display:none"></div>

        ${zincirli ? `
          <p class="muted" style="font-size:13px;line-height:1.6;margin-bottom:10px">
            🔄 Bu kayıt sigara değişimiyle bağlantılı. Düzeltme
            <b>zincirin tamamına</b> uygulanır; aksi halde aynı sigara iki
            farklı oyuncuda görünürdü.
          </p>` : ''}

        ${late ? `
          <p class="muted" style="font-size:13px;line-height:1.6;margin-bottom:10px">
            ⚠️ Bu kaydın <b>günü kapandı</b>. Adet, stok ve tüketim değişmez —
            yalnızca kaydın sahibi düzelir. Düzeltme geç yapıldı olarak
            işaretlenir.
          </p>` : ''}

        <p class="muted" style="font-size:13px;line-height:1.6;margin-bottom:14px">
          Stok ve adet <b>değişmez</b>. 4 saat sayacı yeni ID'ye geçer:
          eski ID serbest kalır.
        </p>

        <div class="gate-actions">
          <button class="btn-ghost" data-no>Vazgeç</button>
          <button class="btn-primary" data-yes disabled>ID'yi Düzelt</button>
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

    const alan = overlay.querySelector('#newPlayerId');
    const onayBtn = overlay.querySelector('[data-yes]');
    const ozet = overlay.querySelector('#idSummary');

    /* Ne olacagini acikca yaz: yanlis tikin onundeki son engel budur.
       Normalizasyon sunucudakiyle AYNI olmali (bosluk kirp + BUYUK harf),
       yoksa ozet gosterilen ile kaydedilen farkli olurdu. */
    const dogrula = () => {
      const yeni = alan.value.trim().toUpperCase();

      if (!yeni) {
        ozet.style.display = 'none';
        onayBtn.disabled = true;
        return;
      }
      if (yeni === record.player_id) {
        ozet.style.display = '';
        ozet.className = 'cooldown-box show blocked';
        ozet.innerHTML = '<div class="cooldown-meta">Mevcut ID ile aynı — değişecek bir şey yok.</div>';
        onayBtn.disabled = true;
        return;
      }

      ozet.style.display = '';
      ozet.className = 'cooldown-box show ok';
      ozet.innerHTML =
        `<div class="cooldown-meta"><b>${esc(record.player_id)}</b> → ` +
        `<b>${esc(yeni)}</b><br />` +
        `<span class="muted">Bu kayıt artık ${esc(yeni)} oyuncusuna ait olur; ` +
        `${esc(record.player_id)} sayacı serbest kalır.</span></div>`;
      onayBtn.disabled = false;
    };

    alan.addEventListener('input', dogrula);
    alan.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !onayBtn.disabled) { e.preventDefault(); onayBtn.click(); }
    });

    onayBtn.addEventListener('click', () => {
      const yeni = alan.value.trim().toUpperCase();
      if (!yeni || yeni === record.player_id) return;
      kapat({ player_id: yeni, reason: overlay.querySelector('#editReason').value.trim() });
    });

    alan.focus();
  });
}

/**
 * Diyalogu acar, onaylanirsa sunucuya gonderir ve sonucu bildirir.
 * Iki sayfa da ayni akisi kullansin diye burada.
 *
 * @param {object} record  Duzeltilecek kayit
 * @param {boolean} late   Donemi kapanmis mi
 * @returns {Promise<boolean>} degisiklik yapildiysa true (liste tazelensin)
 */
async function handlePlayerIdEdit(record, late) {
  // Onceki duzeltmeler varsa onay ekraninda gosterilir; kritik degil.
  let edits = [];
  try {
    edits = (await API.get(`/api/records/${record.id}/player-edits`)).edits || [];
  } catch { /* gecmis alinamadi, ekran yine acilir */ }

  const secim = await showPlayerIdDialog({ record, late, edits });
  if (!secim) return false;

  try {
    const r = await API.post(`/api/records/${record.id}/player-id`, secim);

    toast(
      `ID düzeltildi: ${r.oldPlayerId} → ${r.newPlayerId}` +
      (r.chain ? ` (${r.records.length} kayıtlık değişim zinciri)` : ''),
      'success', 5000
    );
    if (r.late) {
      toast(
        `${periodLabel(r.saleDayKey)} tarihli kayıttı — adet ve stok değişmedi, ` +
        'yalnızca kaydın sahibi düzeltildi.',
        'info', 6500
      );
    }
    if (!r.status.allowed) {
      toast(
        `${r.newPlayerId} için sayaç işliyor: ${formatDuration(r.status.remainingMs)} kaldı.`,
        'info', 6000
      );
    }
    return true;
  } catch (err) {
    toast(err.message, 'error', 6000);
    return false;
  }
}

/* ============================================================
   SONRADAN INFO EKLE / DUZENLE — onay ekrani.

   Tezgahta sira sigarayi vermektir; info veren kisi ve gerekce cogu
   zaman DAHA SONRA belli olur. Kaydi eksik acip sonradan tamamlamak
   mumkun olmasaydi ya kayit bekletilir ya da iptal edilip yeniden
   acilirdi — stok ve 4 saat sayaci bosuna iki kez kurcalanirdi.

   Info veren TANIM LISTESINDEN secilir (kayit formundaki gibi);
   neden serbest metindir. Ikisi de bosaltilabilir.

   Cagiran: kayit.js, arsiv.js, info.js
   ============================================================ */

/**
 * @param {object} o
 * @param {object} o.record     Kayit (id, player_id, cigarette_type, quantity,
 *                              created_at, info, info_by, info_by_id)
 * @param {Array}  o.providers  Tanim listesi: {id, name}
 * @returns {Promise<null | {info_by_id:number|null, info:string}>}
 */
function showInfoDialog({ record, providers }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'gate-overlay gate-swap';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const vardi = !!(record.info_by || record.info);

    overlay.innerHTML = `
      <div class="gate-box" style="max-width:480px">
        <div class="gate-head">
          <span class="gate-icon" aria-hidden="true">💬</span>
          <h2>${vardi ? 'İnfo Düzenle' : 'İnfo Ekle'}</h2>
        </div>

        <div class="gate-player">
          Oyuncu <b>${esc(record.player_id)}</b>
        </div>

        <div class="cooldown-meta" style="font-size:14px;line-height:1.7;margin-bottom:14px">
          Kayıt: <b>${esc(record.cigarette_type)} ×${record.quantity}</b><br />
          Kayıt saati: <b>${formatDateTime(record.created_at)}</b>
          ${record.info_edited_at
            ? `<br /><span class="muted">Son düzenleme: ${esc(record.info_edited_by || '')}
               · ${formatDateTime(record.info_edited_at)}</span>` : ''}
        </div>

        <div class="field">
          <label for="dlgInfoBy">İnfo Veren Kişi <span class="muted">(opsiyonel)</span></label>
          <div class="ac">
            <input type="text" id="dlgInfoBy" placeholder="İsim yazın..." />
            <input type="hidden" id="dlgInfoById" />
            <ul class="ac-list" id="dlgInfoByList"></ul>
          </div>
          ${providers.length ? '' :
            '<p class="muted mt">Tanımlı info veren yok — Yönetim → İnfo Verenler\'den eklenir.</p>'}
        </div>

        <div class="field">
          <label for="dlgInfo">İnfo Nedeni <span class="muted">(opsiyonel)</span></label>
          <textarea id="dlgInfo" maxlength="255" placeholder="ör. doğum günü ikramı"></textarea>
        </div>

        <p class="muted" style="font-size:13px;line-height:1.6;margin-bottom:14px">
          Adet, sigara türü, garson ve <b>stok değişmez</b>. İkisini de boş
          bırakırsanız kayıttaki info silinir.
        </p>

        <div class="gate-actions">
          <button class="btn-ghost" data-no>Vazgeç</button>
          <button class="btn-primary" data-yes>Kaydet</button>
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

    /* Kayit formundaki alanla AYNI bilesen: listeden secim, serbest metin yok. */
    const ac = createAutocomplete({
      input: overlay.querySelector('#dlgInfoBy'),
      hidden: overlay.querySelector('#dlgInfoById'),
      list: overlay.querySelector('#dlgInfoByList'),
      items: providers,
      emptyText: 'Eşleşen kişi yok'
    });

    // Mevcut degerler yuklenir; kisi silinmisse ad kutuda kalmaz ama
    // neden korunur — kullanici yeniden secebilsin.
    if (record.info_by_id) ac.selectById(record.info_by_id);
    overlay.querySelector('#dlgInfo').value = record.info || '';

    overlay.querySelector('[data-yes]').addEventListener('click', () => {
      ac.commit();
      kapat({
        info_by_id: ac.selected ? ac.selected.id : null,
        info: overlay.querySelector('#dlgInfo').value.trim()
      });
    });

    overlay.querySelector('#dlgInfoBy').focus();
  });
}

/**
 * Diyalogu acar, onaylanirsa sunucuya gonderir.
 * Uc sayfa da ayni akisi kullansin diye burada.
 *
 * @param {object} record
 * @returns {Promise<boolean>} degisiklik yapildiysa true (liste tazelensin)
 */
async function handleInfoEdit(record) {
  let providers = [];
  try {
    providers = (await API.get('/api/info-providers')).providers || [];
  } catch { /* liste alinamadi; neden yine girilebilir */ }

  const secim = await showInfoDialog({ record, providers });
  if (!secim) return false;

  try {
    const r = await API.post(`/api/records/${record.id}/info`, secim);
    const y = r.record;

    toast(
      y.info_by || y.info
        ? `İnfo kaydedildi${y.info_by ? `: ${y.info_by}` : ''}.`
        : 'Kayıttaki info temizlendi.',
      'success', 4500
    );
    return true;
  } catch (err) {
    toast(err.message, 'error', 6000);
    return false;
  }
}
