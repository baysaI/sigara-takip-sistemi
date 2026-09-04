/* ============================================================
   MODUL 9 — Gun Sonu Raporu
   ============================================================ */
'use strict';

const $ = (id) => document.getElementById(id);

const DURUM = {
  ok:       { etiket: 'YETERLİ', sinif: 'free' },
  critical: { etiket: 'KRİTİK',  sinif: 'locked' },
  out:      { etiket: 'TÜKENDİ', sinif: 'locked' }
};

/** YYYY-MM-DD (yerel) */
const gunStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Aktif kapsam: tek donem (varsayilan) veya tarih araligi */
let mode = 'day';

/** Kapanmis donemler + acik donem (dropdown kaynagi) */
let donemler = { open: null, closures: [] };

App.ready(async () => {
  $('dayRule').textContent =
    'Gün değişimi saate bağlı değildir: açık dönem, Gün Sonu Raporu alınana ' +
    'kadar sürer. Rapor alındığı an dönem kapanır ve yeni iş günü başlar.';

  await loadPeriods();

  const bugun = gunStr(new Date());
  $('rFrom').value = bugun;
  $('rTo').value = bugun;

  await loadReport();
  bindEvents();
});

/* ============================================================
   DONEM LISTESI
   ============================================================ */
async function loadPeriods() {
  try {
    donemler = await API.get('/api/reports/closures');
  } catch (err) {
    return toast(`Dönemler yüklenemedi: ${err.message}`, 'error');
  }

  const sel = $('rPeriod');
  const acik = donemler.open;

  const acikSecenek = acik
    ? `<option value="open">▶ Açık dönem — ${periodLabel(acik.dayKey)} (henüz kapanmadı)</option>`
    : '';

  const kapaliSecenekler = donemler.closures.map((c) => {
    const saat = new Date(c.closedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    return `<option value="${c.closureId}">${esc(periodLabel(c.dayKey))} — ${saat}'de kapandı (${esc(c.closedBy)})</option>`;
  }).join('');

  const oncekiDeger = sel.value;
  sel.innerHTML = acikSecenek + kapaliSecenekler;

  // Onceki secim hala listedeyse korunur, yoksa acik doneme dusulur
  sel.value = [...sel.options].some((o) => o.value === oncekiDeger) ? oncekiDeger : 'open';
}

/** Secili kapsamin sunucuya gidecek sorgu parametreleri. */
function currentScope() {
  if (mode === 'range') {
    return { from: $('rFrom').value, to: $('rTo').value };
  }
  const deger = $('rPeriod').value;
  return deger === 'open' || !deger ? {} : { closure: deger };
}

/** Acik donem mi goruntuleniyor? (Gunu Kapat karti yalnizca o zaman gorunur) */
function acikDonemdeMiyiz() {
  return mode === 'day' && ($('rPeriod').value === 'open' || !$('rPeriod').value);
}

async function loadReport() {
  try {
    const rapor = await API.get('/api/reports/daily', currentScope());
    render(rapor);
  } catch (err) {
    toast(err.message, 'error');
  }
  await loadReconciliation();
  updateCloseCard();
}

/**
 * "Günü Kapat" karti yalnizca ACIK donem goruntulenirken anlamlidir:
 * kapanmis bir gunu tekrar kapatmak diye bir sey yoktur.
 */
function updateCloseCard() {
  const kart = $('closeCard');
  if (!kart) return;

  const gorunur = acikDonemdeMiyiz();
  kart.classList.toggle('hidden', !gorunur);

  const durum = $('periodState');
  if (!durum) return;

  if (gorunur && donemler.open) {
    const o = donemler.open;
    const sure = o.openedAt ? periodDuration(o.openedAt, o.asOf) : '';
    durum.textContent = o.pristine
      ? 'Açık dönem — henüz hiç işlem yok'
      : `Açık dönem — ${sure ? sure + ' önce açıldı' : 'yeni açıldı'}`;
  } else if (mode === 'range') {
    durum.textContent = 'Tarih aralığı — birden çok dönem birleştirildi';
  } else {
    const secili = donemler.closures.find((c) => String(c.closureId) === $('rPeriod').value);
    durum.textContent = secili
      ? `Kapanmış dönem — ${formatDateTime(secili.closedAt)} · ${secili.closedBy}` +
        (secili.note ? ` · ${secili.note}` : '')
      : '—';
  }
}

/* ============================================================
   GUN SONU RAPORUNU AL = GUN DEGISIMI
   Raporu goruntulemek gunu kapatmaz; kapanis yalnizca bu islemle olur.
   ============================================================ */
async function closeDay() {
  const acik = donemler.open;
  if (!acik) return toast('Açık dönem bulunamadı.', 'error');

  const sure = acik.openedAt ? periodDuration(acik.openedAt, acik.asOf) : '';
  const ozet = recon
    ? `<br />Bu dönemde <b>${recon.totals.tuketim} paket</b> tüketim işlendi.`
    : '';
  const acilis = acik.openedAt
    ? `Açılış: <b>${formatDateTime(acik.openedAt)}</b>${sure ? ` (${sure} önce)` : ''}`
    : 'Bu dönemde henüz hiç işlem yok.';

  const onay = await confirmDelete({
    title: 'Günü kapat ve raporu al',
    body:
      `<b>${periodLabel(acik.dayKey)}</b> dönemi kapatılacak.<br />` +
      `${acilis}${ozet}` +
      '<br /><br />Kapanıştan sonra bu döneme kayıt eklenemez ve ' +
      'bu dönemin kayıtlarında <b>sigara değişimi yapılamaz</b>. ' +
      'Yeni iş günü tam bu anda başlar.',
    confirmText: 'Günü Kapat'
  });
  if (!onay) return;

  const btn = $('closeDayBtn');
  btn.disabled = true; btn.textContent = 'Kapatılıyor...';

  try {
    const res = await API.post('/api/reports/close', { note: $('closeNote').value.trim() });

    toast(
      `${periodLabel(res.closed.dayKey)} kapatıldı. Yeni iş günü başladı.`,
      'success', 6000
    );

    $('closeNote').value = '';
    await App.refreshPeriod();
    await loadPeriods();

    // Kapanan donemin raporunu goster: yonetici ne kapattigini gorsun
    $('rPeriod').value = String(res.closed.closureId);
    await loadReport();
  } catch (err) {
    // Bos donem uyarisi: yonetici yine de kapatmak isteyebilir
    if (err.payload?.code === 'EMPTY_PERIOD') {
      const zorla = await confirmDelete({
        title: 'Dönemde hiç işlem yok',
        body: 'Bu dönemde ne kayıt ne stok hareketi var. Boş günü yine de kapatmak istiyor musunuz?',
        confirmText: 'Boş Günü Kapat'
      });
      if (zorla) {
        try {
          const res = await API.post('/api/reports/close', {
            note: $('closeNote').value.trim(), allowEmpty: true
          });
          toast(`${periodLabel(res.closed.dayKey)} (boş) kapatıldı.`, 'success');
          await App.refreshPeriod();
          await loadPeriods();
          await loadReport();
        } catch (e2) { toast(e2.message, 'error'); }
      }
    } else {
      toast(err.message, 'error', 6000);
    }
  } finally {
    btn.disabled = false; btn.textContent = 'Günü Kapat ve Raporu Al';
  }
}

/* ============================================================
   GUN SONU STOK SAYIMI (mutabakat)
   Isletmenin Excel tablosunun karsiligi:
   DEVIR + GIRIS - TUKETIM = KALAN, sayim girilince FARK cikar.
   ============================================================ */
let recon = null;

/** Son yuklenen gun sonu raporu — mutabakat notu liste disi bilgisini buradan alir. */
let sonRapor = null;

async function loadReconciliation() {
  const body = $('reconBody');
  // Mutabakat her zaman TEK DONEM icindir; aralik modunda sonuncusu alinir.
  try {
    recon = await API.get('/api/reports/reconciliation', currentScope());
    renderReconciliation();
  } catch (err) {
    recon = null;
    body.innerHTML = `<tr><td colspan="8" class="empty">Yüklenemedi: ${esc(err.message)}</td></tr>`;
  }
}

function renderReconciliation() {
  const body = $('reconBody');
  const t = recon.totals;

  $('reconInfo').textContent =
    `${periodLabel(recon.day)} · ${recon.closed ? 'kapandı' : 'açık'} · ` +
    `${recon.rows.length} tür · ${t.sayilan} sayıldı` +
    (t.farkli ? ` · ${t.farkli} farklı` : '');

  if (!recon.rows.length) {
    body.innerHTML = '<tr><td colspan="8" class="empty">Tanımlı sigara türü yok.</td></tr>';
    $('reconFoot').innerHTML = '';
    return;
  }

  body.innerHTML = recon.rows.map((r) => {
    const farkSinif = r.fark === null ? '' : (r.fark === 0 ? 'free' : 'locked');
    const farkMetin = r.fark === null ? '—' : (r.fark > 0 ? `+${r.fark}` : String(r.fark));

    return `
      <tr${r.drift ? ' title="Stok kartı ile hareket geçmişi ayrışmış"' : ''}>
        <td data-label="NO" class="muted">${r.no}</td>
        <td data-label="Sigara Adı"><b>${esc(r.name)}</b>${r.drift ? ' <span class="pill locked">?</span>' : ''}</td>
        <td data-label="Giriş" class="mono">${r.giris ? '+' + r.giris : '0'}</td>
        <td data-label="Tüketim" class="mono">${r.tuketim ? '-' + r.tuketim : '0'}</td>
        <td data-label="Kalan"><b class="mono">${r.kalan}</b></td>
        <td data-label="Sayım">
          <input type="number" class="count-input" min="0" max="1000000"
                 data-type="${r.typeId}" value="${r.sayim ?? ''}" placeholder="—" />
        </td>
        <td data-label="Fark">
          <span class="pill ${farkSinif}" data-fark="${r.typeId}">${farkMetin}</span>
        </td>
        <td data-label="Tutar" class="mono muted">${r.tutar ? r.tutar.toFixed(2) + ' ₺' : '—'}</td>
      </tr>`;
  }).join('');

  $('reconFoot').innerHTML = `
    <tr>
      <td colspan="2"><b>TOPLAM</b></td>
      <td class="mono"><b>${t.giris}</b></td>
      <td class="mono"><b>${t.tuketim}</b></td>
      <td class="mono"><b>${t.kalan}</b></td>
      <td colspan="2"></td>
      <td class="mono"><b>${t.tutar ? t.tutar.toFixed(2) + ' ₺' : '—'}</b></td>
    </tr>`;

  // Sayim girildikce farki anlik goster
  body.querySelectorAll('.count-input').forEach((inp) =>
    inp.addEventListener('input', () => {
      const satir = recon.rows.find((x) => String(x.typeId) === inp.dataset.type);
      const rozet = body.querySelector(`[data-fark="${inp.dataset.type}"]`);
      if (!satir || !rozet) return;

      if (inp.value === '') {
        rozet.textContent = '—';
        rozet.className = 'pill';
        return;
      }
      const fark = Number(inp.value) - satir.kalan;
      rozet.textContent = fark > 0 ? `+${fark}` : String(fark);
      rozet.className = `pill ${fark === 0 ? 'free' : 'locked'}`;
    }));

  const notlar = [
    t.kayan
      ? `${t.kayan} türde stok kartı ile hareket geçmişi ayrışmış — sayım girip düzeltin.`
      : 'KALAN, önceki dönemden devreden stoğa GİRİŞ eklenip TÜKETİM düşülerek ' +
        'hesaplanır. Sayım girince fark otomatik çıkar.'
  ];

  /*
   * Liste disi (tek seferlik) sigaralarin stok karti yoktur, bu yuzden
   * yukaridaki tabloda SATIRI YOKTUR — ama "Dagitilan Paket" toplamina
   * girerler. Iki sayi tutmayinca defter bozuk sanilmasin diye farkin
   * nedeni burada acikca yaziliyor.
   */
  const ozelPaket = sonRapor?.summary?.ozelPaket || 0;
  if (ozelPaket) {
    const adlar = (sonRapor.customTypes || []).map((x) => `${x.name} (${x.paket})`).join(', ');
    notlar.push(
      `Ayrıca ${ozelPaket} paket liste dışı sigara verildi — stok kartı olmadığı için ` +
      `bu tabloda görünmez: ${adlar}.`
    );
  }

  $('reconNote').textContent = notlar.join(' ');
}

/** Girilen sayimlari kaydeder (bos birakilanlar atlanir). */
async function saveCounts() {
  const counts = [...document.querySelectorAll('.count-input')]
    .filter((i) => i.value !== '')
    .map((i) => ({ type_id: Number(i.dataset.type), counted: Number(i.value) }));

  if (!counts.length) return toast('Önce en az bir sayım girin.', 'error');

  const btn = $('saveCountBtn');
  btn.disabled = true; btn.textContent = 'Kaydediliyor...';
  try {
    /* Donem KESIN adresiyle gonderilir: closureId (acik donemde null).
       Etiketle gondermek, ayni takvim gununde kapanmis bir donem varken
       sayimi YANLIS doneme yazabilirdi — bu bir veri yazma islemi. */
    recon = await API.post('/api/reports/counts', {
      closureId: recon.period?.closureId ?? null,
      counts
    });
    renderReconciliation();
    const farkli = recon.totals.farkli;
    toast(
      farkli ? `${counts.length} sayım kaydedildi — ${farkli} türde fark var.`
             : `${counts.length} sayım kaydedildi, fark yok.`,
      farkli ? 'error' : 'success', 6000
    );
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Sayımı Kaydet'; }
}


/** Donem secimi <-> tarih araligi gecisi. */
function setMode(yeni) {
  mode = yeni;
  const tekGun = yeni === 'day';

  $('modeDay').classList.toggle('active', tekGun);
  $('modeRange').classList.toggle('active', !tekGun);
  $('dayPane').classList.toggle('hidden', !tekGun);
  $('rangePane').classList.toggle('hidden', tekGun);

  loadReport();
}

function render(r) {
  sonRapor = r;
  const d = r.period;

  /* Baslik: acik donemin bitisi YOKTUR — ust sinir (9999) ekrana yazilmaz. */
  if (d && d.open) {
    const sure = d.openedAt ? periodDuration(d.openedAt, d.asOf) : '';
    $('rangeLabel').textContent = d.pristine
      ? 'Açık dönem — henüz hiç işlem yok, gün sonu raporu alınmadı'
      : `Açık dönem — ${formatDateTime(d.openedAt)} tarihinden beri` +
        (sure ? ` (${sure})` : '') + ', henüz kapatılmadı';
  } else if (d) {
    $('rangeLabel').textContent =
      `${periodLabel(d.dayKey)} — ${formatDateTime(d.from)} / ${formatDateTime(d.closedAt)} ` +
      `· ${d.closedBy} kapattı`;
  } else {
    const adet = (r.periods || []).length;
    $('rangeLabel').textContent =
      `${formatDateTime(r.range.from)} — ${formatDateTime(r.range.to)} arası döküm` +
      (adet ? ` (${adet} dönem)` : '');
  }

  /* --- Özet --- */
  $('sIslem').textContent    = r.summary.islem;
  $('sPaket').textContent    = r.summary.paket;
  $('sOyuncu').textContent   = r.summary.oyuncu;
  $('sGarson').textContent   = r.summary.garson;
  $('sSigaraci').textContent = r.summary.sigaraci;
  $('sOnayli').textContent   = r.summary.onayli;
  $('sErken').textContent    = r.summary.erken;
  $('sDegisim').textContent  = r.summary.degisim ?? 0;
  $('sIptal').textContent    = r.summary.iptal ?? 0;

  /* --- Marka bazlı --- */
  // Liste disi turler marka dokumunde de isaretlenir: stok tablosunda
  // karsiliklari olmadigi icin okuyan kisi nedenini gorsun.
  const ozelAdlar = new Set((r.customTypes || []).map((x) => x.name));

  $('brandBody').innerHTML = r.brands.length
    ? r.brands.map((b) => `
        <tr>
          <td data-label="Sigara Türü">
            <b>${esc(b.name)}</b>
            ${ozelAdlar.has(b.name) ? '<span class="pill custom" title="Tek seferlik — stok kartı yok">LİSTE DIŞI</span>' : ''}
          </td>
          <td data-label="Paket"><span class="pill qty">${b.paket}</span></td>
          <td data-label="İşlem">${b.islem}</td>
        </tr>`).join('')
    : '<tr><td colspan="3" class="empty">Bu aralıkta dağıtım yok.</td></tr>';

  /* --- Garson bazlı --- */
  $('waiterBody').innerHTML = r.waiters.length
    ? r.waiters.map((w) => `
        <tr>
          <td data-label="Garson"><b>${esc(w.name)}</b></td>
          <td data-label="Paket"><span class="pill qty">${w.paket}</span></td>
          <td data-label="İşlem">${w.islem}</td>
          <td data-label="Oyuncu">${w.oyuncu}</td>
        </tr>`).join('')
    : '<tr><td colspan="4" class="empty">Bu aralıkta dağıtım yok.</td></tr>';

  /* --- Sigaracı bazlı --- */
  $('operatorBody').innerHTML = r.operators.length
    ? r.operators.map((o) => `
        <tr>
          <td data-label="Sigaracı"><b>${esc(o.name)}</b></td>
          <td data-label="İşlem">${o.islem}</td>
          <td data-label="Paket"><span class="pill qty">${o.paket}</span></td>
          <td data-label="İlk İşlem" class="mono">${formatDateTime(o.ilk)}</td>
          <td data-label="Son İşlem" class="mono">${formatDateTime(o.son)}</td>
        </tr>`).join('')
    : '<tr><td colspan="5" class="empty">Bu aralıkta işlem yok.</td></tr>';

  /* --- Özel onaylı işlemler --- */
  $('approvalCount').textContent = `${r.approvals.length} işlem`;
  $('approvalBody').innerHTML = r.approvals.length
    ? r.approvals.map((a) => `
        <tr>
          <td data-label="Saat" class="mono">${formatDateTime(a.created_at)}</td>
          <td data-label="Oyuncu"><span class="pill player">${esc(a.player_id)}</span></td>
          <td data-label="Durum"><span class="pill locked">${esc(a.flag_label)}</span></td>
          <td data-label="Uyarı Notu" class="info-cell">${esc(a.flag_note || '—')}</td>
          <td data-label="Onaylayan"><b>${a.approved_by ? esc(a.approved_by) : '<span class="muted">okundu onayı</span>'}</b></td>
          <td data-label="Onay Notu" class="info-cell">${a.approval_note ? esc(a.approval_note) : '—'}</td>
          <td data-label="Sigaracı">${esc(a.username)}</td>
        </tr>`).join('')
    : '<tr><td colspan="7" class="empty">Bu aralıkta özel onayla verilen sigara yok.</td></tr>';

  /* --- Erken alımlar --- */
  const erken = r.earlyReleases || [];
  $('earlyCount').textContent = `${erken.length} işlem`;
  $('earlyBody').innerHTML = erken.length
    ? erken.map((e) => `
        <tr>
          <td data-label="Saat" class="mono">${formatDateTime(e.created_at)}</td>
          <td data-label="Oyuncu"><span class="pill player">${esc(e.player_id)}</span></td>
          <td data-label="Kalan Süreydi"><span class="pill locked">${formatDuration(e.early_remaining_ms)}</span></td>
          <td data-label="Onaylayan"><b>${esc(e.early_approved_by || '—')}</b></td>
          <td data-label="Gerekçe" class="info-cell">${e.early_note ? esc(e.early_note) : '—'}</td>
          <td data-label="Tür / Adet">${esc(e.cigarette_type)} ×${e.quantity}</td>
          <td data-label="Sigaracı">${esc(e.username)}</td>
        </tr>`).join('')
    : '<tr><td colspan="7" class="empty">Bu aralıkta süresi dolmadan verilen sigara yok.</td></tr>';

  /* --- Sigara değişimleri --- */
  const degisim = r.exchanges || [];
  $('swapCount').textContent = `${degisim.length} değişim`;
  $('swapBody').innerHTML = degisim.length
    ? degisim.map((x) => `
        <tr>
          <td data-label="Saat" class="mono">${formatDateTime(x.created_at)}</td>
          <td data-label="Oyuncu"><span class="pill player">${esc(x.player_id)}</span></td>
          <td data-label="Verilen"><b>${esc(x.to_type_name)}</b></td>
          <td data-label="Değişen" class="muted">${esc(x.from_type_name)} yerine</td>
          <td data-label="Adet"><span class="pill qty">${x.quantity}</span></td>
          <td data-label="Gerekçe" class="info-cell">${x.note ? esc(x.note) : '—'}</td>
          <td data-label="İşlemi Yapan">${esc(x.username)}</td>
        </tr>`).join('')
    : '<tr><td colspan="7" class="empty">Bu aralıkta sigara değişimi yapılmamış.</td></tr>';

  /* --- İptal edilen satışlar --- */
  const iptal = r.cancellations || [];
  $('cancelCount').textContent = `${iptal.length} iptal · ${r.summary.iptalPaket ?? 0} paket`;
  $('cancelBody').innerHTML = iptal.length
    ? iptal.map((c) => `
        <tr${c.reverted_at ? ' class="row-superseded"' : ''}>
          <td data-label="İptal Saati" class="mono">${formatDateTime(c.created_at)}</td>
          <td data-label="Oyuncu">
            <span class="pill player">${esc(c.player_id)}</span>
            ${c.reverted_at ? `<span class="pill free" title="${esc(c.reverted_by || '')} geri aldı — satış yeniden aktif">GERİ ALINDI</span>` : ''}
          </td>
          <td data-label="Sigara">${esc(c.cigarette_type)}</td>
          <td data-label="Adet"><span class="pill qty">${c.quantity}</span></td>
          <td data-label="Satış Günü">
            ${esc(periodLabel(c.sale_day_key))}
            ${c.late ? '<span class="pill locked" title="Kapanmış güne ait satış — o günün raporu değişmedi, iade bu döneme işlendi">GEÇ</span>' : ''}
          </td>
          <td data-label="Neden" class="info-cell">${c.reason ? esc(c.reason) : '—'}</td>
          <td data-label="İptal Eden">${esc(c.username)}</td>
        </tr>`).join('')
    : '<tr><td colspan="7" class="empty">Bu aralıkta iptal edilen satış yok.</td></tr>';

  // Gec iptal varsa neden toplamlarin degismedigini yaz: rapordaki
  // "iptal edildi ama paket sayisi dusmedi" sorusu burada cevaplansin.
  const gecSayi = iptal.filter((c) => c.late && !c.reverted_at).length;
  const geriSayi = r.summary.iptalGeriAlinan ?? 0;
  const notlar = [];
  if (gecSayi) {
    notlar.push(
      `${gecSayi} tanesi GEÇ iptal: satış kapanmış bir güne aitti, o günün raporu ` +
      'değişmez; iade bu dönemin stok düzeltmesine işlendi.'
    );
  }
  if (geriSayi) {
    notlar.push(`${geriSayi} iptal geri alındı — satış yeniden aktif, toplamlara sayılmıyor.`);
  }
  $('cancelNote').textContent = notlar.length
    ? notlar.join(' ')
    : 'Bu dönemde yapılan iptaller. Kayıtlar silinmez, İptaller bölümünde saklanır.';

  /* --- Kalan stok (anlık) --- */
  $('stockCount').textContent = `${r.stock.summary.totalPackets} paket · ${r.stock.summary.critical} kritik`;
  $('stockBody').innerHTML = r.stock.cards.length
    ? r.stock.cards.map((c) => {
        const d = DURUM[c.state];
        return `
        <tr>
          <td data-label="Sigara Türü"><b>${esc(c.name)}</b></td>
          <td data-label="Kalan Paket">
            <b class="stock-pill stock-${c.state}" style="font-size:16px">${c.stock}</b>
          </td>
          <td data-label="Kritik Eşik" class="muted">${c.critical_level}</td>
          <td data-label="Durum"><span class="pill ${d.sinif}">${d.etiket}</span></td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="4" class="empty">Tanımlı sigara türü yok.</td></tr>';

  $('restockInfo').textContent = r.restocks.length
    ? 'Dönem içi ikmal: ' + r.restocks.map((x) => `${x.type_name} +${x.miktar}`).join(', ')
    : 'Bu aralıkta ikmal girilmemiş.';
}

function bindEvents() {
  $('modeDay').addEventListener('click', () => setMode('day'));
  $('modeRange').addEventListener('click', () => setMode('range'));

  $('rPeriod').addEventListener('change', loadReport);
  ['rFrom', 'rTo'].forEach((id) => $(id).addEventListener('change', loadReport));

  $('openBtn').addEventListener('click', () => {
    setMode('day');
    $('rPeriod').value = 'open';
    loadReport();
  });

  /** Son N takvim gunu (bugun dahil) — kapanmis donemler etiketlerine gore suzulur. */
  const sonGunler = (adet) => {
    const son = new Date();
    const bas = new Date(son);
    bas.setDate(bas.getDate() - (adet - 1));
    $('rFrom').value = gunStr(bas);
    $('rTo').value = gunStr(son);
    setMode('range');
  };

  $('week7Btn').addEventListener('click', () => sonGunler(7));
  $('month30Btn').addEventListener('click', () => sonGunler(30));

  $('printBtn').addEventListener('click', () => window.print());
  $('saveCountBtn').addEventListener('click', saveCounts);
  $('closeDayBtn').addEventListener('click', closeDay);

  /*
   * Excel'e aktar — EKRANIN kullandigi kapsamin AYNISI gonderilir.
   *
   * Eskiden ?dayKey=recon.day gidiyordu. Etiket tek basina benzersiz
   * degil: bir donem ayni takvim gununde acilip kapanirsa kapanis
   * satirinin day_key'i ile acik donemin etiketi ayni olur ve sunucu
   * kapanmis olani donerdi. Sonuc: ekranda bugunun rakamlari, indirilen
   * dosyada baska bir donemin rakamlari (GIRIS/TUKETIM bos, KALAN dolu).
   * Kapsami tek yerden uretmek bu ayrismayi kokten kaldirir.
   */
  $('csvBtn').addEventListener('click', () => {
    if (!recon) return toast('Önce mutabakat tablosu yüklenmeli.', 'error');
    const qs = new URLSearchParams(
      Object.entries(currentScope()).filter(([, v]) => v !== '' && v != null)
    );
    window.location.href = `/api/reports/reconciliation.csv?${qs}`;
  });
}
