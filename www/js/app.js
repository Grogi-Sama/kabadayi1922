import { createBackend } from './backend.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => '$' + Number(n).toLocaleString('tr-TR');

let api, S, clockOffset = 0, busy = false, tab = 'crime', qty = 1;
const extra = { jail: [], players: null };   // sekmeye girince çekilen listeler

// Sunucu saatine göre kalan saniye (telefon saati yanlış olsa da doğru sayar)
const left = (iso) => Math.max(0, Math.ceil((new Date(iso) - (Date.now() + clockOffset)) / 1000));
const fmt = (s) => s >= 3600 ? `${Math.floor(s / 3600)} sa ${Math.floor(s % 3600 / 60)} dk` : s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} sn`;

async function refresh() {
  S = await api.rpc('get_state');
  if (S.player) clockOffset = new Date(S.now) - Date.now();
  if (S.player && tab === 'city') extra.jail = await api.rpc('get_jail');
  if (S.player && tab === 'log') extra.players = await api.rpc('get_players');
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
  $('#h-stats').textContent = `❤ ${p.health} · 🔫 ${p.bullets} kurşun · 🏦 ${money(p.bank)}`;
  $('#xpbar div').style.width = next ? `${100 * (p.xp - rank.min_xp) / (next.min_xp - rank.min_xp)}%` : '100%';
  renderTab();
  tick();
}

function show(id) {
  for (const s of ['loading', 'onboard', 'game']) $('#' + s).classList.toggle('hidden', s !== id);
}

const cityName = (id) => S.cities.find(c => c.id === id).name;
const rankName = (r) => S.ranks[r].name;
const nickLink = (n) => `<a class="nick-link" data-profile="${esc(n)}">${esc(n)}</a>`;

// Yeniden çizimde yazılan input değerleri kaybolmasın
function renderTab() {
  const el = $(`section[data-tab="${tab}"]`);
  const keep = {};
  el.querySelectorAll('input[id], select[id]').forEach(i => keep[i.id] = i.value);
  el.innerHTML = ({ crime: crimeTab, trade: tradeTab, arms: armsTab, city: cityTab, log: logTab })[tab]();
  for (const [id, v] of Object.entries(keep)) { const i = el.querySelector('#' + id); if (i) i.value = v; }
}

// Hazır olmayan aksiyonların butonları pasif görünsün (sunucu zaten reddeder)
const blocked = () => left(S.player.jail_until) > 0 || left(S.player.hospital_until) > 0;
const waiting = (at) => blocked() || left(at) > 0;
const dis = (cond) => cond ? 'disabled' : '';

function card(title, sub, button) {
  return `<div class="card"><div class="grow"><div class="title">${title}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>${button || ''}</div>`;
}

// ── İşler: suçlar + araba
function crimeTab() {
  const wait = waiting(S.player.crime_ready_at);
  const here = S.cars.filter(c => c.city === S.player.city);
  const away = S.cars.length - here.length;
  return `<h2>İşler</h2>` + S.crimes.map(c => {
    const locked = S.player.rank < c.min_rank;
    return `<div class="card ${locked ? 'locked' : ''}">
      <div class="grow"><div class="title">${esc(c.name)}</div>
        <div class="muted small">${locked ? '🔒 ' + esc(rankName(c.min_rank)) + ' rütbesi gerekir'
          : `${money(c.reward_min)} – ${money(c.reward_max)} · <span class="pct">%${Math.round(c.chance * 100)}</span> şans`}</div></div>
      <button class="btn sm primary" data-act="crime" data-id="${c.id}" ${dis(locked || wait)}>Yap</button>
    </div>`;
  }).join('') +
  `<h2>Araba Hırsızlığı</h2>` +
  card('Sokaktan araba çal', 'Yakalanırsan kısa süre hapis.',
    `<button class="btn sm primary" data-act="car" ${dis(waiting(S.player.car_ready_at))}>Çal</button>`) +
  (here.length ? here.map(c => card(esc(c.name), money(c.value),
    `<button class="btn sm" data-act="sell" data-id="${c.id}">Sat</button>`)).join('')
    : `<p class="muted small">Bu şehirde araban yok.</p>`) +
  (away ? `<p class="muted small">Başka şehirlerde ${away} araban var; satmak için oraya git.</p>` : '');
}

// ── Kaçakçılık: pazar + liman
function maxFor(g, buying) {
  if (!buying) return g.qty;
  const held = S.market.reduce((a, x) => a + x.qty, 0);
  return Math.max(0, Math.min(S.ranks[S.player.rank].carry - held, Math.floor(S.player.cash / g.price)));
}

function tradeTab() {
  const held = S.market.reduce((a, x) => a + x.qty, 0);
  const travelWait = waiting(S.player.travel_ready_at);
  return `<h2>Kaçak Mal · ${esc(cityName(S.player.city))}</h2>
    <p class="muted small">Fiyatlar her saat ve her şehirde değişir. Ucuza al, başka limanda pahalıya sat.
      Taşıyabileceğin: <b>${held}/${S.ranks[S.player.rank].carry}</b> kasa.</p>
    <div class="qtybar">${[1, 5, 10, 'max'].map(q => `<button class="btn sm ${qty === q ? 'on' : ''}" data-qty="${q}">${q === 'max' ? 'Hepsi' : q}</button>`).join('')}</div>` +
    S.market.map(g => {
      const nb = qty === 'max' ? maxFor(g, true) : qty, ns = qty === 'max' ? maxFor(g, false) : qty;
      return card(esc(g.name), `${money(g.price)} / kasa · elinde ${g.qty}`,
        `<div class="market-actions">
          <button class="btn sm primary" data-act="buy" data-id="${g.id}" data-n="${nb}" ${dis(!nb)}>Al</button>
          <button class="btn sm" data-act="sellg" data-id="${g.id}" data-n="${ns}" ${dis(!(g.qty && ns))}>Sat</button>
        </div>`);
    }).join('') +
    `<h2>Liman</h2>
    <p class="muted small">Vapur bileti ${money(S.travel_cost)}. Kaçak malla yolculukta gümrüğe takılma riski var.</p>` +
    S.cities.map(c => {
      const here = c.id === S.player.city;
      return card(esc(c.name), here ? 'Buradasın' : '',
        `<button class="btn sm ${here ? '' : 'primary'}" data-act="travel" data-id="${c.id}" ${dis(here || travelWait)}>Git</button>`);
    }).join('');
}

// ── Silah: kurşun, silah, koruma, atış, dedektif, vur
function armsTab() {
  const p = S.player, protectRank = S.settings.protect_rank, canFight = p.rank >= protectRank;
  const weapon = S.weapons.find(w => w.id === p.weapon);
  const foundHere = S.searches.filter(s => s.resolved && s.success && s.city === p.city);
  const killWait = left(p.kill_ready_at);

  let h = `<h2>Kurşun Fabrikası</h2>
    <p class="muted small">Stok: <b>${S.factory.stock}</b> · Fiyat: <b>${money(S.factory.price)}</b>/kurşun ·
      Bu saat alabileceğin: <b>${p.bullets_left_hour}</b></p>
    <div class="form-row"><input id="f-bullets" type="number" min="1" placeholder="Adet" inputmode="numeric">
      <button class="btn primary" data-act="bullets" ${dis(blocked())}>Satın al</button></div>

    <h2>Silahçı</h2>` +
    S.weapons.map(w => {
      const locked = p.rank < w.min_rank, owned = p.weapon === w.id;
      return `<div class="card ${locked ? 'locked' : ''}"><div class="grow"><div class="title">${esc(w.name)}${owned ? ' ✓' : ''}</div>
        <div class="muted small">${locked ? '🔒 ' + esc(rankName(w.min_rank)) : money(w.price)} · gereken kurşun ×${w.bullet_mult}</div></div>
        <button class="btn sm primary" data-act="weapon" data-id="${w.id}" ${dis(locked || owned)}>Al</button></div>`;
    }).join('') +

    `<h2>Korumalar (${p.bodyguards}/5)</h2>` +
    card('Koruma tut', 'Her koruma seni öldürmek için gereken kurşunu %20 artırır.',
      S.bodyguard_next ? `<button class="btn sm primary" data-act="bodyguard">${money(S.bodyguard_next)}</button>` : '<span class="muted small">Tam kadro</span>') +

    `<h2>Şişe Atışı</h2>` +
    card(`Nişancılık: ${p.kill_skill}/100`, '10 kurşun harcar. Nişancılık gereken kurşunu azaltır.',
      `<button class="btn sm primary" data-act="practice" ${dis(!weapon || waiting(p.practice_ready_at))}>${
        left(p.practice_ready_at) ? fmt(left(p.practice_ready_at)) : 'Atış yap'}</button>`);

  if (!canFight) {
    return h + `<h2>İnfaz</h2><p class="muted">🔒 ${esc(rankName(protectRank))} rütbesine kadar kimseyi vuramazsın, kimse de seni vuramaz.</p>`;
  }

  h += `<h2>Dedektifler</h2>
    <p class="muted small">Dedektif başı ${money(S.settings.detective_cost)}. Ne kadar çok dedektif, o kadar hızlı ve kesin sonuç.</p>
    <div class="form-row"><input id="f-target" placeholder="Hedefin takma adı" autocomplete="off" autocapitalize="off">
      <select id="f-dets">${[1, 3, 5, 10].map(n => `<option value="${n}">${n} ded.</option>`).join('')}</select>
      <button class="btn primary" data-act="detectives" ${dis(blocked())}>Arat</button></div>` +
    (S.searches.length ? S.searches.map(s => card(nickLink(s.target),
      !s.resolved ? `🔎 Aranıyor… ${fmt(left(s.ready_at))}`
        : s.success ? `📍 Görüldüğü yer: ${esc(cityName(s.city))}` : '❌ Bulunamadı')).join('') : '');

  h += `<h2>İnfaz</h2>` + (foundHere.length
    ? `<p class="muted small">${weapon ? `Silahın: ${esc(weapon.name)}.` : '⚠ Silahın yok.'}
        ${killWait ? `Tekrar tetik çekmek için ${fmt(killWait)} bekle.` : ''}</p>
      <div class="form-row"><select id="f-shoot-target">${foundHere.map(s => `<option>${esc(s.target)}</option>`).join('')}</select>
        <input id="f-shoot-bullets" type="number" min="1" placeholder="Kurşun" inputmode="numeric">
        <button class="btn danger" data-act="shoot" ${dis(!weapon || waiting(p.kill_ready_at))}>Ateş</button></div>
      <p class="muted small">Az kurşun sıkarsan sadece yaralarsın. Hedefin profilinde tahmini kurşun ihtiyacı yazar (korumalar hariç).</p>`
    : `<p class="muted small">Vurabilmek için dedektiflerinin hedefi <b>bulunduğun şehirde</b> bulmuş olması gerekir.</p>`);
  return h;
}

// ── Şehir: hapishane, hastane, banka
function cityTab() {
  const p = S.player, jailLeft = left(p.jail_until), hospLeft = left(p.hospital_until);
  let h = `<h2>Hapishane</h2>`;
  if (jailLeft) {
    h += card('Firar et', `%15 şans · kalan hakkın: ${p.self_bust_left}`,
      `<button class="btn sm primary" data-act="selfbust" ${dis(!p.self_bust_left)}>Dene</button>`);
  }
  const others = extra.jail.filter(j => j.nick !== p.nick);
  h += others.length ? others.map(j => card(nickLink(j.nick), `${esc(rankName(j.rank))} · ${fmt(j.secs)} kaldı`,
      `<button class="btn sm primary" data-act="bust" data-id="${esc(j.nick)}" ${dis(waiting(p.bust_ready_at))}>Kurtar</button>`)).join('')
    : `<p class="muted small">İçeride kimse yok.</p>`;
  h += `<p class="muted small">Birini kaçırmak itibar kazandırır ama gardiyana yakalanabilirsin.</p>`;

  h += `<h2>Hastane</h2>` + card(`Sağlık: ${p.health}/100`,
    hospLeft ? `Yatıyorsun: ${fmt(hospLeft)}` : `Can başı ${money(S.settings.heal_cost_per_hp)}`,
    `<button class="btn sm primary" data-act="heal" ${dis(p.health >= 100 || jailLeft)}>İyileş</button>`);

  h += `<h2>Banka</h2>
    <p class="muted small">Bankadaki para öldürülünce kaybolmaz. Yatırırken %${Math.round(S.settings.bank_fee * 100)} komisyon.
      Hesap: <b>${money(p.bank)}</b></p>
    <div class="form-row"><input id="f-bank" type="number" min="1" placeholder="Tutar" inputmode="numeric">
      <button class="btn primary" data-act="deposit">Yatır</button><button class="btn" data-act="withdraw">Çek</button></div>
    <h2>Para Gönder</h2>
    <div class="form-row"><input id="f-send-nick" placeholder="Kime" autocomplete="off" autocapitalize="off">
      <input id="f-send-amt" type="number" min="1" placeholder="Tutar" inputmode="numeric">
      <button class="btn primary" data-act="send">Gönder</button></div>
    <p class="muted small">%${Math.round(S.settings.transfer_fee * 100)} komisyon kesilir.</p>`;
  return h;
}

// ── Defter: istatistik, oyuncular, olaylar
function logTab() {
  const p = S.player, pl = extra.players;
  return `<h2>Sicil</h2>
    <p class="small">☠ ${p.kills} öldürme · ⚰ ${p.deaths} ölüm · 🔓 ${p.busts} kurtarma · 🎯 nişancılık ${p.kill_skill}</p>` +
    (pl ? `<h2>Çevrimiçi (${pl.online.length})</h2><p class="small">${pl.online.map(o => nickLink(o.nick)).join(' · ') || '—'}</p>
      <h2>En Büyükler</h2><ol class="top">${pl.top.map(t => `<li>${nickLink(t.nick)} <span class="muted small">${esc(rankName(t.rank))} · ☠ ${t.kills}</span></li>`).join('')}</ol>` : '') +
    `<h2>Olaylar</h2><ul class="log">` + S.events.map(e =>
      `<li>${esc(e.text)}<time>${new Date(e.at).toLocaleString('tr-TR')}</time></li>`).join('') + `</ul>` +
    (api.mode === 'local' ? `<p class="muted small" style="margin-top:24px">Yerel geliştirme modu.
      <button class="btn sm" data-act="reset">Yerel veriyi sıfırla</button></p>` : '');
}

async function showProfile(nick) {
  const pr = await api.rpc('get_profile', { p_nick: nick });
  if (!pr) return toast('Böyle biri yok.', 'bad');
  $('#modal-body').innerHTML = `<div class="logo-sm">${esc(pr.nick)}</div>
    <p>${esc(rankName(pr.rank))} ${pr.online ? '· 🟢 çevrimiçi' : ''}</p>
    <p class="small">Durum: ${esc(pr.status)}${pr.protected ? ' · 🛡 çaylak koruması' : ''}</p>
    <p class="small">☠ ${pr.kills} öldürme · ⚰ ${pr.deaths} ölüm · 🔓 ${pr.busts} kurtarma</p>
    ${pr.protected ? '' : `<p class="small muted">Tahmini gereken kurşun: ~${pr.est_bullets} (korumalar ve silah hariç)</p>`}
    <p class="small muted">Katılış: ${new Date(pr.joined).toLocaleDateString('tr-TR')}</p>`;
  $('#modal').classList.remove('hidden');
}

// Saniyelik sayaçlar; bir süre dolduğu an butonlar açılsın diye sekmeyi yeniden çizer
let lastReady = '';
function tick() {
  if (!S?.player) return;
  const p = S.player;
  const timed = [p.crime_ready_at, p.car_ready_at, p.travel_ready_at, p.jail_until, p.hospital_until,
    p.kill_ready_at, p.bust_ready_at, p.practice_ready_at, ...S.searches.map(s => s.ready_at)];
  const ready = timed.map(t => left(t) > 0).join();
  if (ready !== lastReady) {
    // bir dedektif araması tam şimdi bittiyse sonucu sunucudan al
    if (lastReady && S.searches.some(s => !s.resolved && !left(s.ready_at))) refresh();
    lastReady = ready; renderTab();
  }
  for (const [id, at, label] of [['t-crime', p.crime_ready_at, 'İş'], ['t-car', p.car_ready_at, 'Araba'], ['t-travel', p.travel_ready_at, 'Vapur']]) {
    const s = left(at), el = $('#' + id);
    el.textContent = s ? `${label} ${fmt(s)}` : `${label} hazır`;
    el.classList.toggle('wait', s > 0);
  }
  const j = left(p.jail_until), h = left(p.hospital_until);
  $('#jail').classList.toggle('hidden', !j && !h);
  if (j) $('#jail').textContent = `⛓ Hapistesin — ${fmt(j)}`;
  else if (h) $('#jail').textContent = `🏥 Hastanedesin — ${fmt(h)}`;
}
setInterval(tick, 1000);

// ─────────────── Etkileşim ───────────────
const val = (id) => $('#' + id)?.value.trim() ?? '';
const num = (id) => parseInt(val(id), 10) || 0;

document.addEventListener('click', async (e) => {
  if (e.target.closest('#modal-close') || e.target.id === 'modal') { $('#modal').classList.add('hidden'); return; }
  const prof = e.target.closest('[data-profile]');
  if (prof) return showProfile(prof.dataset.profile);

  const nav = e.target.closest('[data-go]');
  if (nav) {
    tab = nav.dataset.go;
    document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b === nav));
    document.querySelectorAll('main section').forEach(s => s.classList.toggle('hidden', s.dataset.tab !== tab));
    renderTab();
    if (tab === 'city' || tab === 'log') refresh();
    return;
  }
  const q = e.target.closest('[data-qty]');
  if (q) { qty = q.dataset.qty === 'max' ? 'max' : +q.dataset.qty; renderTab(); return; }

  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const id = b.dataset.id, n = +b.dataset.n;
  switch (b.dataset.act) {
    case 'crime':      return act('do_crime', { p_crime: id });
    case 'car':        return act('steal_car');
    case 'sell':       return act('sell_car', { p_car_id: +id });
    case 'buy':        return act('trade', { p_good: id, p_qty: n });
    case 'sellg':      return act('trade', { p_good: id, p_qty: -n });
    case 'travel':     return act('travel', { p_city: id });
    case 'bullets':    return num('f-bullets') > 0 && act('buy_bullets', { p_qty: num('f-bullets') });
    case 'weapon':     return act('buy_weapon', { p_weapon: id });
    case 'bodyguard':  return act('hire_bodyguard');
    case 'practice':   return act('practice');
    case 'detectives': return val('f-target') && act('hire_detectives', { p_nick: val('f-target'), p_count: num('f-dets') });
    case 'shoot':
      if (num('f-shoot-bullets') > 0 && confirm(`${val('f-shoot-target')} üzerine ${num('f-shoot-bullets')} kurşun sıkılsın mı?`)) {
        return act('shoot', { p_nick: val('f-shoot-target'), p_bullets: num('f-shoot-bullets') });
      }
      return;
    case 'bust':       return act('bust', { p_nick: id });
    case 'selfbust':   return act('self_bust');
    case 'heal':       return act('heal');
    case 'deposit':    return num('f-bank') > 0 && act('bank_move', { p_amount: num('f-bank') });
    case 'withdraw':   return num('f-bank') > 0 && act('bank_move', { p_amount: -num('f-bank') });
    case 'send':       return val('f-send-nick') && num('f-send-amt') > 0 &&
                         act('send_money', { p_nick: val('f-send-nick'), p_amount: num('f-send-amt') });
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
  if (api.mode === 'local') Object.assign(window, { devApi: api, devRefresh: refresh });
  await refresh();
} catch (e) {
  console.error(e);
  $('#loading').innerHTML = `<div class="logo">KABADAYI</div><p class="err">Sunucuya bağlanılamadı.</p>`;
}
