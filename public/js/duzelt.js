/* ============================================================
   KOK HESAP — IZ BIRAKMAYAN DUZELTME ("Düzelt").

   Sistemin geri kalani her degisikligi kayda gecirir: degisim yeni kayit
   acar, ID duzeltmesi iz satiri yazar, info duzenlemesi damgalanir.
   Burasi ayri: kok hesap gecmisteki bir kaydi, en bastan dogru girilmis
   gibi gorunecek sekilde duzeltir. Rozet, iz ve damga YAZILMAZ.

   Tek diyalogda dort alan birden duzeltilir (oyuncu ID, sigara turu,
   garson, info) — bir kaydi toparlamak icin dort ayri ekrandan gecmek
   gerekmesin. Yalnizca DEGISEN alanlar sunucuya gonderilir.

   Cagiran: kayit.js, arsiv.js
   ============================================================ */
'use strict';

/**
 * @param {object} o
 * @param {object} o.record     records satiri
 * @param {Array}  o.turler     aktif sigara turleri {id, name}
 * @param {Array}  o.garsonlar  kayitli garsonlar {id, name}
 * @param {Array}  o.kisiler    info veren tanim listesi {id, name}
 * @returns {Promise<object|null>} yalnizca degisen alanlar; vazgecildiyse null
 */
function showSilentEditDialog({ record, turler, garsonlar, kisiler }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'gate-overlay gate-swap';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    overlay.innerHTML = `
      <div class="gate-box" style="max-width:520px">
        <div class="gate-head">
          <span class="gate-icon" aria-hidden="true">🔧</span>
          <h2>Kaydı Düzelt</h2>
        </div>

        <div class="cooldown-meta" style="font-size:14px;line-height:1.7;margin-bottom:14px">
          Kayıt saati: <b>${formatDateTime(record.created_at)}</b> ·
          Adet: <b>${record.quantity}</b><br />
          Kaydı açan: <b>${esc(record.username)}</b>
        </div>

        <div class="field">
          <label for="seOyuncu">Oyuncu ID</label>
          <input type="text" id="seOyuncu" maxlength="40" autocomplete="off"
                 value="${esc(record.player_id)}" />
        </div>

        <div class="field">
          <label for="seTur">Sigara Türü</label>
          <div class="ac">
            <input type="text" id="seTur" maxlength="60" placeholder="Sigara adı yazın..." />
            <input type="hidden" id="seTurId" />
            <ul class="ac-list" id="seTurList"></ul>
          </div>
        </div>

        <div class="field">
          <label for="seGarson">Alan Garson</label>
          <div class="ac">
            <input type="text" id="seGarson" maxlength="60" placeholder="Garson adı yazın..." />
            <input type="hidden" id="seGarsonId" />
            <ul class="ac-list" id="seGarsonList"></ul>
          </div>
        </div>

        <div class="field">
          <label for="seKisi">İnfo Veren Kişi</label>
          <div class="ac">
            <input type="text" id="seKisi" placeholder="İsim yazın..." />
            <input type="hidden" id="seKisiId" />
            <ul class="ac-list" id="seKisiList"></ul>
          </div>
        </div>

        <div class="field">
          <label for="seInfo">İnfo Nedeni</label>
          <textarea id="seInfo" maxlength="255" placeholder="ör. doğum günü ikramı"></textarea>
        </div>

        <p class="gate-hint">
          Bu düzeltme <b>iz bırakmaz</b>: rozet, düzeltme geçmişi ve damga yazılmaz —
          kayıt en baştan böyleymiş gibi görünür.<br />
          Sigara türü değişirse o günün <b>stok hareketi de düzeltilir</b>, mutabakat
          ve gün sonu raporu yeni duruma göre hesaplanır.
        </p>

        <div class="gate-actions">
          <button class="btn-ghost" data-no>Vazgeç</button>
          <button class="btn-primary" data-yes disabled>Düzelt</button>
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

    const oyuncuAlan = overlay.querySelector('#seOyuncu');
    const infoAlan = overlay.querySelector('#seInfo');
    const onayBtn = overlay.querySelector('[data-yes]');

    /* Bir sey degismediyse dugme acilmaz: bos yere kayda dokunmayalim. */
    const degistiMi = () =>
      oyuncuAlan.value.trim().toUpperCase() !== record.player_id ||
      overlay.querySelector('#seTur').value.trim() !== (record.cigarette_type || '') ||
      overlay.querySelector('#seGarson').value.trim() !== (record.waiter_name || '') ||
      overlay.querySelector('#seKisi').value.trim() !== (record.info_by || '') ||
      infoAlan.value.trim() !== (record.info || '');

    const tazele = () => { onayBtn.disabled = !degistiMi(); };

    /* Kayit formundaki bilesenlerin aynisi: yazarak secim, Turkce duyarli. */
    const turAC = createAutocomplete({
      input: overlay.querySelector('#seTur'),
      hidden: overlay.querySelector('#seTurId'),
      list: overlay.querySelector('#seTurList'),
      items: turler,
      emptyText: 'Eşleşen sigara yok',
      custom: {
        label: (ad) => `➕ "${ad}" — liste dışı sigara`,
        hint: 'Bu tür listeye eklenmez; stok kartı olmadığı için stoktan düşülmez.'
      },
      onSelect: tazele
    });

    const garsonAC = createAutocomplete({
      input: overlay.querySelector('#seGarson'),
      hidden: overlay.querySelector('#seGarsonId'),
      list: overlay.querySelector('#seGarsonList'),
      items: garsonlar,
      emptyText: 'Eşleşen garson yok',
      custom: {
        label: (ad) => `➕ "${ad}" — liste dışı garson`,
        hint: 'Bu ad garson listesine eklenmez, yalnızca bu kayda yazılır.'
      },
      onSelect: tazele
    });

    const kisiAC = createAutocomplete({
      input: overlay.querySelector('#seKisi'),
      hidden: overlay.querySelector('#seKisiId'),
      list: overlay.querySelector('#seKisiList'),
      items: kisiler,
      emptyText: 'Eşleşen kişi yok',
      onSelect: tazele
    });

    /* Mevcut degerler. Liste disi (veya silinmis) bir ad listede bulunmaz;
       o zaman metin olarak yazilir ve gonderimde commit() cozer. */
    const doldur = (ac, input, id, ad) => {
      if (id) ac.selectById(id);
      if (!input.value && ad) input.value = ad;
    };
    doldur(turAC, overlay.querySelector('#seTur'), record.cigarette_type_id, record.cigarette_type);
    doldur(garsonAC, overlay.querySelector('#seGarson'), record.waiter_id, record.waiter_name);
    doldur(kisiAC, overlay.querySelector('#seKisi'), record.info_by_id, record.info_by);
    infoAlan.value = record.info || '';

    /* Dugme durumu TUM alanlar dolduktan SONRA hesaplanir: doldurma
       sirasinda tetiklenen onSelect, henuz yazilmamis alanlari "degismis"
       sayip dugmeyi acik birakirdi. */
    tazele();

    [oyuncuAlan, infoAlan].forEach((el) => el.addEventListener('input', tazele));
    overlay.querySelectorAll('.ac input').forEach((el) => el.addEventListener('input', tazele));

    onayBtn.addEventListener('click', () => {
      /* Yazilani secime cevir: kullanici acilir listeden tiklamak zorunda
         kalmasin (kayit formundaki davranisin aynisi). */
      turAC.commit();
      garsonAC.commit();
      kisiAC.commit();

      const govde = {};

      const yeniId = oyuncuAlan.value.trim().toUpperCase();
      if (!yeniId) return toast('Oyuncu ID boş bırakılamaz.', 'error');
      if (yeniId !== record.player_id) govde.player_id = yeniId;

      /* --- Sigara turu --- */
      const turMetni = overlay.querySelector('#seTur').value.trim();
      if (turMetni !== (record.cigarette_type || '')) {
        const s = turAC.selected;
        if (!s) {
          overlay.querySelector('#seTur').focus();
          return toast('Sigara türünü listeden seçin — listede yoksa "liste dışı" seçeneğini kullanın.', 'error', 5500);
        }
        if (s.custom) { govde.cigarette_type = s.name; govde.custom_type = true; }
        else govde.cigarette_type_id = s.id;
      }

      /* --- Garson --- */
      const garsonMetni = overlay.querySelector('#seGarson').value.trim();
      if (garsonMetni !== (record.waiter_name || '')) {
        const s = garsonAC.selected;
        if (!s) {
          overlay.querySelector('#seGarson').focus();
          return toast('Garsonu listeden seçin — listede yoksa "liste dışı" seçeneğini kullanın.', 'error', 5500);
        }
        if (s.custom) { govde.waiter_name = s.name; govde.custom_waiter = true; }
        else govde.waiter_id = s.id;
      }

      /* --- Info: iki alandan biri degistiyse ikisi birden gonderilir --- */
      const kisiMetni = overlay.querySelector('#seKisi').value.trim();
      if (kisiMetni !== (record.info_by || '') || infoAlan.value.trim() !== (record.info || '')) {
        govde.info_by_id = kisiAC.selected ? kisiAC.selected.id : null;
        govde.info = infoAlan.value.trim();
      }

      if (!Object.keys(govde).length) return toast('Değişen bir alan yok.', 'info');
      kapat(govde);
    });

    oyuncuAlan.focus();
  });
}

/**
 * Diyalogu acar, onaylanirsa sunucuya gonderir.
 * @param {object} record
 * @returns {Promise<boolean>} degisiklik yapildiysa true (liste tazelensin)
 */
async function handleSilentEdit(record) {
  let turler = [], garsonlar = [], kisiler = [];
  try {
    const [t, g, k] = await Promise.all([
      API.get('/api/cigarette-types'),
      API.get('/api/waiters'),
      API.get('/api/info-providers').catch(() => ({ providers: [] }))
    ]);
    turler = t.types || [];
    garsonlar = g.waiters || [];
    kisiler = k.providers || [];
  } catch (err) {
    toast(`Düzeltme ekranı açılamadı: ${err.message}`, 'error', 6000);
    return false;
  }

  const govde = await showSilentEditDialog({ record, turler, garsonlar, kisiler });
  if (!govde) return false;

  try {
    const r = await API.post(`/api/records/${record.id}/silent-edit`, govde);

    toast(
      r.applied.length ? `Düzeltildi — ${r.applied.join(' · ')}` : 'Değişen bir alan yoktu.',
      'success', 6000
    );
    if (r.stock) {
      toast(
        `Stok defteri düzeltildi: ${r.stock.from ? `${r.stock.from} +${r.stock.quantity}, ` : ''}` +
        `${r.stock.to ? `${r.stock.to} −${r.stock.quantity}` : 'stok kartı yok'}`,
        'info', 7000
      );
    }
    return true;
  } catch (err) {
    toast(err.message, 'error', 8000);
    return false;
  }
}
