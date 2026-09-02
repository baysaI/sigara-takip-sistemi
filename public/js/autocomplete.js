/* ============================================================
   Otomatik tamamlama — uzun listeler icin (ornek: garson secimi)
   Kullanici adi yazar, eslesenler altta listelenir, biri secilir.

   Serbest metin VARSAYILAN OLARAK kabul edilmez: secim listeden yapilir.
   `custom` secenegi verilirse listede olmayan bir ad da "tek seferlik"
   deger olarak secilebilir (bkz. Hizli Kayit > Yeni Garson Ekle).
   ============================================================ */
'use strict';

/**
 * @param {object} opts
 * @param {HTMLInputElement} opts.input    Yazilan gorunur alan
 * @param {HTMLInputElement} opts.hidden   Secilen kaydin id'sini tutan gizli alan
 * @param {HTMLElement}      opts.list     Sonuclarin basilacagi <ul>
 * @param {Array<{id:number|string,name:string}>} opts.items
 * @param {(item|null)=>void} [opts.onSelect]
 * @param {number} [opts.maxResults=50]
 * @param {boolean} [opts.allowEmpty=false]  Bos birakilabilir mi (filtre alanlari icin)
 * @param {{label:(text:string)=>string, hint?:string}} [opts.custom]
 *        Verilirse listede eslesmeyen ad "tek seferlik" secilebilir.
 *        Secildiginde item {id:null, name, custom:true} seklinde doner ve
 *        gizli alan BOS birakilir — kalici bir kaydin id'si yoktur.
 */
function createAutocomplete(opts) {
  const { input, hidden, list, onSelect, maxResults = 50, allowEmpty = false, custom = null } = opts;
  let items = opts.items || [];
  let matches = [];
  let activeIndex = -1;
  let selected = null;

  /* Turkce'ye duyarli kucultme: I->i, İ->i, boylece "ilker" ~ "İlker" eslesir. */
  const norm = (s) => String(s ?? '')
    .replace(/İ/g, 'i').replace(/I/g, 'ı')
    .toLocaleLowerCase('tr')
    .trim();

  /* -------------------------- Listeleme -------------------------- */
  function filter(query) {
    const q = norm(query);
    if (!q) return items.slice(0, maxResults);

    // Bastan eslesenler once, icinde gecenler sonra
    const bastan = [], icinde = [];
    for (const it of items) {
      const n = norm(it.name);
      if (n.startsWith(q)) bastan.push(it);
      else if (n.includes(q)) icinde.push(it);
    }
    return [...bastan, ...icinde].slice(0, maxResults);
  }

  /** Eslesen bolumu kalin gosterir. */
  function highlight(name, query) {
    const q = norm(query);
    if (!q) return esc(name);
    const i = norm(name).indexOf(q);
    if (i < 0) return esc(name);
    return esc(name.slice(0, i)) + '<b>' + esc(name.slice(i, i + q.length)) + '</b>' + esc(name.slice(i + q.length));
  }

  /**
   * Yazilan ad listede yoksa uretilen "tek seferlik" secenek.
   * Listede birebir karsiligi varsa uretilmez: kalici kaydi secmek dogrudur.
   */
  function customCandidate(query) {
    if (!custom) return null;
    const text = String(query ?? '').trim();
    if (!text) return null;
    if (items.some((it) => norm(it.name) === norm(text))) return null;
    return { id: null, name: text, custom: true };
  }

  function render(query) {
    matches = filter(query);

    // Tek seferlik secenek listenin SONUNA eklenir ve varsayilan olarak
    // secili gelmez: kayitli bir garson varken elin oraya gitmesin.
    const aday = customCandidate(query);
    if (aday) matches = [...matches, aday];

    activeIndex = matches.length ? 0 : -1;

    if (!matches.length) {
      list.innerHTML = `<li class="ac-empty" role="presentation">Eşleşen garson yok</li>`;
    } else {
      const gizlenen = items.length > maxResults && !norm(query)
        ? `<li class="ac-empty" role="presentation">${items.length} kayıttan ilk ${maxResults} tanesi — yazarak daraltın</li>`
        : '';
      const ipucu = aday && custom.hint
        ? `<li class="ac-empty" role="presentation">${esc(custom.hint)}</li>`
        : '';

      list.innerHTML = matches.map((it, i) => `
        <li role="option" id="ac-opt-${i}" data-i="${i}"
            class="ac-item${it.custom ? ' ac-custom' : ''}${i === activeIndex ? ' active' : ''}"
            aria-selected="${i === activeIndex}">${
              it.custom ? esc(custom.label(it.name)) : highlight(it.name, query)
            }</li>`).join('') + ipucu + gizlenen;
    }
    open();
  }

  function open() {
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    scrollToActive();
  }

  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function setActive(i) {
    if (!matches.length) return;
    activeIndex = (i + matches.length) % matches.length;
    [...list.querySelectorAll('.ac-item')].forEach((el, idx) => {
      const on = idx === activeIndex;
      el.classList.toggle('active', on);
      el.setAttribute('aria-selected', String(on));
    });
    input.setAttribute('aria-activedescendant', `ac-opt-${activeIndex}`);
    scrollToActive();
  }

  function scrollToActive() {
    const el = list.querySelector('.ac-item.active');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  /* --------------------------- Secim --------------------------- */
  function select(item) {
    selected = item;
    // Tek seferlik secimin kalici bir kaydi yoktur: gizli alan BOS kalir,
    // yoksa "null" metni id sanilip forma sizardi.
    hidden.value = item && !item.custom ? item.id : '';
    input.value = item ? item.name : '';
    input.classList.toggle('ac-ok', !!item);
    input.classList.toggle('ac-custom-on', !!(item && item.custom));
    input.classList.remove('ac-invalid');
    close();
    if (onSelect) onSelect(item);
  }

  function clearSelection({ silent = false } = {}) {
    selected = null;
    hidden.value = '';
    input.classList.remove('ac-ok', 'ac-custom-on');
    if (!silent && onSelect) onSelect(null);
  }

  /**
   * Alandan cikilinca: yazilan metin tam olarak bir kayda esitse onu sec,
   * degilse secimi temizle ve alani isaretle. Boylece elle yazilan
   * gecersiz bir isim forma sizamaz.
   *
   * `custom` acikken "gecersiz" diye bir sey yoktur: eslesmeyen ad tek
   * seferlik deger olur. Bu durumda "tek esleme kaldiysa onu sec"
   * kisayolu UYGULANMAZ — yazilan adi sessizce baska bir garsona
   * cevirmek, kalici listeye girmeyen bir adi yanlis kisiye yazmak olurdu.
   */
  function commit() {
    const text = input.value.trim();

    if (!text) {
      input.classList.remove('ac-invalid');
      clearSelection();
      return;
    }
    if (selected && selected.name === text) return;

    const tam = items.find((it) => norm(it.name) === norm(text));
    if (tam) return select(tam);

    if (custom) return select({ id: null, name: text, custom: true });

    // Tek bir esleme kaldiysa onu sec (yazim kolayligi)
    const kalan = filter(text);
    if (kalan.length === 1) return select(kalan[0]);

    clearSelection();
    input.classList.add('ac-invalid');
  }

  /* -------------------------- Olaylar -------------------------- */
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('autocomplete', 'off');
  list.setAttribute('role', 'listbox');
  list.hidden = true;

  input.addEventListener('input', () => {
    input.classList.remove('ac-invalid');
    clearSelection({ silent: true });
    render(input.value);
  });

  input.addEventListener('focus', () => render(input.value));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); list.hidden ? render(input.value) : setActive(activeIndex + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex - 1); }
    else if (e.key === 'Enter') {
      if (!list.hidden && matches[activeIndex]) { e.preventDefault(); select(matches[activeIndex]); }
    } else if (e.key === 'Escape') { close(); }
    else if (e.key === 'Tab') { commit(); close(); }
  });

  // mousedown kullanilir: blur'dan once calissin
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('.ac-item');
    if (!li) return;
    e.preventDefault();
    select(matches[Number(li.dataset.i)]);
  });

  input.addEventListener('blur', () => setTimeout(() => { commit(); close(); }, 120));

  /* ------------------------- Dis arayuz ------------------------- */
  return {
    /** Liste sonradan degistiginde (ornek: yeni garson eklendi) */
    setItems(next) {
      items = next || [];
      // Tek seferlik secim listeye bagli degildir; liste tazelenince silinmez.
      if (selected && !selected.custom &&
          !items.some((i) => String(i.id) === String(selected.id))) {
        input.value = '';
        clearSelection();
      }
    },
    get value() { return hidden.value; },
    get selected() { return selected; },
    selectById(id) {
      const it = items.find((i) => String(i.id) === String(id));
      if (it) select(it);
    },
    reset() {
      input.value = '';
      input.classList.remove('ac-invalid', 'ac-ok');
      clearSelection({ silent: true });
    },
    focus() { input.focus(); }
  };
}
