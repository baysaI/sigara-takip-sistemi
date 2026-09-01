/* ============================================================
   MODUL 7 — OYUNCU UYARILARI

   Eskiden Yonetim sayfasinin bir bolumuydu ve bu yuzden yalnizca
   yoneticide gorunuyordu. Uyariyi tanimlamasi gereken kisi tezgahtaki
   sigaracidir; ayri sayfaya alindi ki Yonetim'deki hesap yonetimi ve
   veri sifirlama acilmadan uyarilar kullanilabilsin.
   ============================================================ */
'use strict';

const $ = (id) => document.getElementById(id);

const FLAG_SINIF = { warning: 'player', approval: 'locked', blocked: 'locked' };

App.ready(async () => {
  await loadFlags();
  bindEvents();
});

async function loadFlags() {
  const body = $('flagBody');
  try {
    const { flags } = await API.get('/api/flags', { all: '1' });
    const aktif = flags.filter((f) => f.is_active);
    $('flagCount').textContent = aktif.length ? `${aktif.length} aktif uyarı` : 'yok';

    if (!flags.length) {
      body.innerHTML = `<tr><td colspan="5" class="empty">
        Tanımlı uyarı yok.<br />
        <span class="muted">Özel durumu olan oyuncular için yukarıdan uyarı ekleyin.</span>
      </td></tr>`;
      return;
    }

    body.innerHTML = flags.map((f) => `
      <tr${f.is_active ? '' : ' style="opacity:.5"'}>
        <td data-label="Oyuncu"><span class="pill player">${esc(f.player_id)}</span></td>
        <td data-label="Seviye"><span class="pill ${FLAG_SINIF[f.level]}">${esc(f.label)}</span></td>
        <td data-label="Not" class="info-cell">${esc(f.note)}</td>
        <td data-label="Ekleyen" class="muted">${esc(f.updated_by || f.created_by)}</td>
        <td data-label="İşlem">
          <div class="row-actions">
            <button class="btn-ghost btn-sm" data-flag="${f.id}" data-active="${f.is_active ? 0 : 1}">
              ${f.is_active ? 'Kaldır' : 'Geri getir'}
            </button>
            <button class="btn-danger btn-sm" data-flag-del="${f.id}" data-name="${esc(f.player_id)}">Sil</button>
          </div>
        </td>
      </tr>`).join('');

    body.querySelectorAll('[data-flag]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          await API.patch(`/api/flags/${btn.dataset.flag}`, { is_active: btn.dataset.active === '1' });
          await loadFlags();
          toast(btn.dataset.active === '1' ? 'Uyarı geri getirildi.' : 'Uyarı kaldırıldı.', 'success');
        } catch (err) { toast(err.message, 'error'); }
      }));

    body.querySelectorAll('[data-flag-del]').forEach((btn) =>
      btn.addEventListener('click', () => silUyari(btn.dataset.flagDel, btn.dataset.name)));
  } catch (err) {
    body.innerHTML = `<tr><td colspan="5" class="empty">Yüklenemedi: ${esc(err.message)}</td></tr>`;
  }
}

async function silUyari(id, oyuncu) {
  const onay = await confirmDelete({
    title: 'Uyarıyı sil',
    body: `<b>${esc(oyuncu)}</b> için tanımlı uyarı kaydı tamamen silinecek.`
  });
  if (!onay) return;
  try {
    await API.request(`/api/flags/${id}`, { method: 'DELETE' });
    await loadFlags();
    toast('Uyarı silindi.', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function addFlag() {
  const player_id = $('flagPlayer').value.trim();
  const level = $('flagLevel').value;
  const note = $('flagNote').value.trim();

  if (!player_id) return toast('Oyuncu ID girin.', 'error');
  if (note.length < 3) return toast('Uyarı notu en az 3 karakter olmalıdır.', 'error');

  const btn = $('addFlagBtn');
  btn.disabled = true; btn.textContent = 'Kaydediliyor...';
  try {
    const r = await API.post('/api/flags', { player_id, level, note });
    $('flagPlayer').value = ''; $('flagNote').value = '';
    await loadFlags();
    toast(`${r.flag.player_id} için uyarı tanımlandı.`, 'success');
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Uyarı Tanımla'; }
}

function bindEvents() {
  $('addFlagBtn').addEventListener('click', addFlag);
  $('flagPlayer').addEventListener('keydown', (e) => { if (e.key === 'Enter') addFlag(); });
}
