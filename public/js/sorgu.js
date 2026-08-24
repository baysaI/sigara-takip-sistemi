/* ============================================================
   ID Sorgulama sayfasi — son alim + 4 saat durumu + gecmis
   ============================================================ */
'use strict';

const $ = (id) => document.getElementById(id);

let timer = null;

App.ready(async () => {
  $('lookupBtn').addEventListener('click', lookup);
  $('lookupId').addEventListener('keydown', (e) => { if (e.key === 'Enter') lookup(); });

  // Arsivden "?id=1247" ile gelinirse dogrudan sorgula
  const preset = new URLSearchParams(location.search).get('id');
  if (preset) { $('lookupId').value = preset; lookup(); }
});

async function lookup() {
  const id = $('lookupId').value.trim();
  const out = $('lookupResult');

  stopTimer();

  if (!id) {
    out.innerHTML = '<p class="muted center">Sorgulamak için bir ID girin.</p>';
    return;
  }

  out.innerHTML = '<p class="muted center">Sorgulanıyor...</p>';
  $('lookupHint').textContent = '';

  try {
    const [{ status }, archive] = await Promise.all([
      API.get('/api/records/check', { playerId: id }),
      API.get('/api/records', { playerId: id, pageSize: 10, page: 1 })
    ]);

    render(status, archive.records);

    // Kilitliyse kalan sureyi canli say
    if (!status.allowed) startTimer(Date.now() + status.remainingMs);
  } catch (err) {
    out.innerHTML = `<p class="muted center">Sorgu başarısız: ${esc(err.message)}</p>`;
  }
}

function render(status, records) {
  const badge = status.allowed
    ? '<span class="pill free">UYGUN</span>'
    : '<span class="pill locked">KİLİTLİ</span>';

  const durum = status.allowed
    ? `<div class="cooldown-box show ok" style="margin-top:0">
         <div class="cooldown-head">✅ Sigara alabilir</div>
         <div class="cooldown-meta" style="margin-top:5px">
           ${status.firstTime
             ? 'Bu ID ile hiç kayıt yok — ilk alım yapılabilir.'
             : `${App.cooldownHours} saat kuralı doldu, yeniden alabilir.`}
         </div>
       </div>`
    : `<div class="cooldown-box show blocked" style="margin-top:0">
         <div class="cooldown-head">⛔ ${App.cooldownHours} saat dolmadı</div>
         <div class="cooldown-timer" id="cdTimer">${formatCountdown(status.remainingMs)}</div>
         <div class="cooldown-meta">
           Uygun olacağı saat: <b>${formatDateTime(status.nextAvailableAt)}</b>
         </div>
       </div>`;

  const ozet = `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
      <b style="font-size:18px">${esc(status.playerId)}</b> ${badge}
    </div>
    ${durum}
    <div class="cooldown-meta mt">
      Son alım: <b>${status.lastAt ? formatDateTime(status.lastAt) : 'kayıt yok'}</b>
      ${status.lastAt ? `(${timeAgo(status.lastAt)})` : ''}<br />
      Toplam kayıt: <b>${status.totalRecords}</b>
    </div>`;

  const gecmis = records.length
    ? `<div class="table-scroll mt">
         <table class="responsive">
           <thead><tr><th>Tarih</th><th>Tür</th><th>Adet</th><th>Garson</th><th>Sigaracı</th></tr></thead>
           <tbody>${records.map((r) => `
             <tr>
               <td data-label="Tarih" class="mono">${formatDateTime(r.created_at)}</td>
               <td data-label="Tür">${esc(r.cigarette_type)}</td>
               <td data-label="Adet">${r.quantity}</td>
               <td data-label="Garson">${esc(r.waiter_name)}</td>
               <td data-label="Sigaracı">${esc(r.username)}</td>
             </tr>`).join('')}
           </tbody>
         </table>
       </div>`
    : '<p class="muted mt center">Bu ID için geçmiş kayıt yok.</p>';

  $('lookupResult').innerHTML = ozet + gecmis;
}

function startTimer(deadline) {
  stopTimer();
  timer = setInterval(() => {
    const remaining = deadline - Date.now();
    const el = $('cdTimer');
    if (!el) return stopTimer();
    if (remaining <= 0) { stopTimer(); lookup(); return; }
    el.textContent = formatCountdown(remaining);
  }, 1000);
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}
