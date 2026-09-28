import { createBackend } from './backend.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => '$' + Number(n).toLocaleString('tr-TR');

let api, S, clockOffset = 0, busy = false, tab = 'crime', qty = 1;

// Sunucu saatine göre kalan saniye (telefon saati yanlış olsa da doğru sayar)
const left = (iso) => Math.max(0, Math.ceil((new Date(iso) - (Date.now() + clockOffset)) / 1000));
const fmt = (s) => s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} sn`;

async function refresh() {
  S = await api.rpc('get_state');
  if (S.player) clockOffset = new Date(S.now) - Date.now();
  render();
}

async function act(name, args) {
  if (busy) return;
  busy = true;
  document.body.style.cursor = 'progress';
  try {
    const r = await api.rpc(name, args);
    toast(r.msg, r.ok === false || r.success === false ? 'bad' : 'good');
    await refresh();
  } catch (e) {
    console.error(e);
    toast('Bağlantı sorunu, tekrar dene.', 'bad');
  } finally {
    busy = false;
    document.body.style.cursor = '';
  }
}

let toastTimer;
function toast(msg, kind) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + (kind || '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}

// ─────────────── Çizim ───────────────
function render() {
  if (!S.player) { show('onboard'); return; }
  show('game');
  const p = S.player, rank = S.ranks[p.rank], next = S.ranks[p.rank + 1];
  $('#h-nick').textContent = p.nick;
  $('#h-rank').textContent = rank.name + (next ? ` · ${p.xp}/${next.min_xp} itibar` : ' · zirvede');
  $('#h-cash').textContent = money(p.cash);
  $('#h-city').textContent = '📍 ' + cityName(p.city);
  $('#xpbar div').style.width = next ? `${100 * (p.xp - rank.min_xp) / (next.min_xp - rank.min_xp)}%` : '100%';
  renderTab();
  tick();
}

function show(id) {
  for (const s of ['loading', 'onboard', 'game']) $('#' + s).classList.toggle('hidden', s !== id);
}

const cityName = (id) => S.cities.find(c => c.id === id).name;

function renderTab() {
  const el = $(`section[data-tab="${tab}"]`);
  el.innerHTML = ({ crime: crimeTab, car: carTab, market: marketTab, travel: travelTab, log: logTab })[tab]();
}

// Hazır olmayan aksiyonların butonları pasif görünsün (sunucu zaten reddeder)
const jailed = () => left(S.player.jail_until) > 0;
const waiting = (at) => jailed() || left(at) > 0;

function crimeTab() {
  const wait = waiting(S.player.crime_ready_at);
  return `<h2>İşler</h2>` + S.crimes.map(c => {
    const locked = S.player.rank < c.min_rank;
    return `<div class="card ${locked ? 'locked' : ''}">
      <div class="grow"><div class="title">${esc(c.name)}</div>
        <div class="muted small">${locked ? '🔒 ' + esc(S.ranks[c.min_rank].name) + ' rütbesi gerekir'
          : `${money(c.reward_min)} – ${money(c.reward_max)} · <span class="pct">%${Math.round(c.chance * 100)}</span> şans`}</div></div>
      <button class="btn sm primary" data-act="crime" data-id="${c.id}" ${locked || wait ? 'disabled' : ''}>Yap</button>
    </div>`;
  }).join('');
}

function carTab() {
  const here = S.cars.filter(c => c.city === S.player.city);
  const away = S.cars.filter(c => c.city !== S.player.city);
  return `<h2>Araba Hırsızlığı</h2>
    <div class="card"><div class="grow"><div class="title">Sokaktan araba çal</div>
      <div class="muted small">Yakalanırsan kısa süre hapis.</div></div>
      <button class="btn sm primary" data-act="car" ${waiting(S.player.car_ready_at) ? 'disabled' : ''}>Çal</button></div>
    <h2>Garajın (${here.length})</h2>` +
    (here.length ? here.map(c => `<div class="card"><div class="grow"><div class="title">${esc(c.name)}</div>
      <div class="muted small">${money(c.value)}</div></div>
      <button class="btn sm" data-act="sell" data-id="${c.id}">Sat</button></div>`).join('')
      : `<p class="muted">Bu şehirde araban yok.</p>`) +
    (away.length ? `<p class="muted small">Başka şehirlerde ${away.length} araban var; satmak için oraya git.</p>` : '');
}

function maxFor(g, buying) {
  if (!buying) return g.qty;
  const held = S.market.reduce((a, x) => a + x.qty, 0);
  return Math.max(0, Math.min(S.ranks[S.player.rank].carry - held, Math.floor(S.player.cash / g.price)));
}

function marketTab() {
  const held = S.market.reduce((a, x) => a + x.qty, 0);
  return `<h2>Kaçak Mal · ${esc(cityName(S.player.city))}</h2>
    <p class="muted small">Fiyatlar her saat ve her şehirde değişir. Ucuza al, başka limanda pahalıya sat.
      Taşıyabileceğin: <b>${held}/${S.ranks[S.player.rank].carry}</b> kasa.</p>
    <div class="qtybar">${[1, 5, 10, 'max'].map(q => `<button class="btn sm ${qty === q ? 'on' : ''}" data-qty="${q}">${q === 'max' ? 'Hepsi' : q}</button>`).join('')}</div>` +
    S.market.map(g => {
      const nb = qty === 'max' ? maxFor(g, true) : qty, ns = qty === 'max' ? maxFor(g, false) : qty;
      return `<div class="card"><div class="grow"><div class="title">${esc(g.name)}</div>
        <div class="muted small">${money(g.price)} / kasa · elinde ${g.qty}</div></div>
        <div class="market-actions">
          <button class="btn sm primary" data-act="buy" data-id="${g.id}" data-n="${nb}" ${nb ? '' : 'disabled'}>Al</button>
          <button class="btn sm" data-act="sellg" data-id="${g.id}" data-n="${ns}" ${g.qty && ns ? '' : 'disabled'}>Sat</button>
        </div></div>`;
    }).join('');
}

function travelTab() {
  return `<h2>Liman</h2>
    <p class="muted small">Vapur bileti ${money(S.travel_cost)}. Kaçak malla yolculukta gümrüğe takılma riski var.</p>` +
    S.cities.map(c => {
      const here = c.id === S.player.city;
      return `<div class="card"><div class="grow"><div class="title">${esc(c.name)}</div>
        ${here ? '<div class="muted small">Buradasın</div>' : ''}</div>
        <button class="btn sm ${here ? '' : 'primary'}" data-act="travel" data-id="${c.id}"
          ${here || waiting(S.player.travel_ready_at) ? 'disabled' : ''}>Git</button></div>`;
    }).join('');
}

function logTab() {
  return `<h2>Defter</h2><ul class="log">` + S.events.map(e =>
    `<li>${esc(e.text)}<time>${new Date(e.at).toLocaleString('tr-TR')}</time></li>`).join('') + `</ul>` +
    (api.mode === 'local' ? `<p class="muted small" style="margin-top:24px">Yerel geliştirme modu.
      <button class="btn sm" data-act="reset">Yerel veriyi sıfırla</button></p>` : '');
}

// Saniyelik sayaçlar; bir süre dolduğu an butonlar açılsın diye sekmeyi yeniden çizer
let lastReady = '';
function tick() {
  if (!S?.player) return;
  const p = S.player;
  const ready = [p.crime_ready_at, p.car_ready_at, p.travel_ready_at, p.jail_until].map(t => left(t) > 0).join();
  if (ready !== lastReady) { lastReady = ready; renderTab(); }
  for (const [id, at, label] of [['t-crime', p.crime_ready_at, 'İş'], ['t-car', p.car_ready_at, 'Araba'], ['t-travel', p.travel_ready_at, 'Vapur']]) {
    const s = left(at), el = $('#' + id);
    el.textContent = s ? `${label} ${fmt(s)}` : `${label} hazır`;
    el.classList.toggle('wait', s > 0);
  }
  const j = left(p.jail_until);
  $('#jail').classList.toggle('hidden', !j);
  if (j) $('#jail').textContent = `⛓ Hapistesin — ${fmt(j)}`;
}
setInterval(tick, 1000);

// ─────────────── Etkileşim ───────────────
document.addEventListener('click', async (e) => {
  const nav = e.target.closest('[data-go]');
  if (nav) {
    tab = nav.dataset.go;
    document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b === nav));
    document.querySelectorAll('main section').forEach(s => s.classList.toggle('hidden', s.dataset.tab !== tab));
    renderTab();
    return;
  }
  const q = e.target.closest('[data-qty]');
  if (q) { qty = q.dataset.qty === 'max' ? 'max' : +q.dataset.qty; renderTab(); return; }

  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const id = b.dataset.id, n = +b.dataset.n;
  switch (b.dataset.act) {
    case 'crime':  return act('do_crime', { p_crime: id });
    case 'car':    return act('steal_car');
    case 'sell':   return act('sell_car', { p_car_id: +id });
    case 'buy':    return act('trade', { p_good: id, p_qty: n });
    case 'sellg':  return act('trade', { p_good: id, p_qty: -n });
    case 'travel': return act('travel', { p_city: id });
    case 'reset':
      if (confirm('Yerel oyun verisi silinsin mi?')) { await api.reset(); location.reload(); }
  }
});

$('#nick-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await api.rpc('create_player', { p_nick: $('#nick').value.trim() });
  if (!r.ok) { $('#nick-err').textContent = r.msg; return; }
  await refresh();
});

// Uygulama arka plandan dönünce durumu tazele
document.addEventListener('visibilitychange', () => { if (!document.hidden && api) refresh(); });

try {
  api = await createBackend();
  await refresh();
} catch (e) {
  console.error(e);
  $('#loading').innerHTML = `<div class="logo">KABADAYI</div><p class="err">Sunucuya bağlanılamadı.</p>`;
}
