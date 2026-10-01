import { createBackend } from './backend.js';
import { probeAssets, img, hasAsset, assetUrl } from './assets.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => '$' + Number(n).toLocaleString('tr-TR');

let api, S, clockOffset = 0, busy = false, tab = 'city', panel = null, qty = 1, pickedAvatar = 1;
// sekmeye / panele girince çekilen listeler
const extra = { jail: [], players: null, family: null, families: [], hitlist: [], crews: null, casino: null,
  inbox: [], conv: null, convMsgs: [], spots: null, races: null, lottery: null, market: [], bj: null, season: null };

// Sunucu saatine göre kalan saniye (telefon saati yanlış olsa da doğru sayar)
const left = (iso) => Math.max(0, Math.ceil((new Date(iso) - (Date.now() + clockOffset)) / 1000));
const fmt = (s) => s >= 3600 ? `${Math.floor(s / 3600)} sa ${Math.floor(s % 3600 / 60)} dk` : s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} sn`;

// ─────────────── Veri ───────────────
async function refresh() {
  // açık konuşmayı önce oku ki okunmamış sayacı doğru gelsin
  if (S?.player && tab === 'log' && extra.conv) extra.convMsgs = await api.rpc('get_conversation', { p_nick: extra.conv });
  S = await api.rpc('get_state');
  if (S.player) {
    clockOffset = new Date(S.now) - Date.now();
    await Promise.all([loadTabData(), loadPanelData()]);
  }
  render();
}

async function loadTabData() {
  const rpc = api.rpc;
  if (tab === 'city') extra.spots = await rpc('get_spots');
  else if (tab === 'log') [extra.players, extra.inbox, extra.season] = await Promise.all([rpc('get_players'), rpc('get_inbox'), rpc('get_season')]);
  else if (tab === 'family') { await loadFamily(); extra.spots = await rpc('get_spots'); }
  else if (tab === 'crime') extra.crews = await rpc('get_crews');
}

async function loadPanelData() {
  if (!panel) return;
  const rpc = api.rpc, kind = panel.startsWith('spot:') ? 'spot' : panel;
  if (kind === 'karakol') extra.jail = await rpc('get_jail');
  else if (kind === 'dedektif') extra.hitlist = await rpc('get_hitlist');
  else if (kind === 'garaj') extra.races = await rpc('get_races');
  else if (kind === 'carsi') extra.market = await rpc('get_market');
  else if (kind === 'spot') [extra.spots, extra.lottery, extra.bj] = await Promise.all([rpc('get_spots'), rpc('get_lottery'), rpc('bj_current')]);
}

async function loadFamily() {
  extra.family = await api.rpc('get_family');
  extra.families = extra.family.family ? [] : await api.rpc('get_families');
}

// Sonuca göre bildirimde gösterilecek görsel
function resultArt(r) {
  if (r.killed) return 'results/vuruldu';
  if (r.jailed || /içeri alındı/.test(r.msg || '')) return 'results/hapis';
  if (r.success === true) return 'results/basari';
  if (r.success === false) return 'results/kacti';
  return null;
}

async function act(name, args, opts = {}) {
  if (busy) return;
  busy = true;
  document.body.style.cursor = 'progress';
  try {
    const r = await api.rpc(name, args);
    toast(r.msg, r.ok === false || r.success === false ? 'bad' : 'good', opts.art ? (opts.art === true ? resultArt(r) : opts.art) : null);
    // başarılı işlemden sonra tutar/isim kutuları boşalsın (seçim kutuları kalsın)
    if (r.ok !== false) document.querySelectorAll(`section[data-tab="${tab}"] input, #sheet-body input`).forEach(i => i.value = '');
    await refresh();
  } catch (e) {
    console.error(e);
    if (/BANNED/.test(e.message)) await refresh();
    else toast('Bağlantı sorunu, tekrar dene.', 'bad');
  } finally {
    busy = false;
    document.body.style.cursor = '';
  }
}

let toastTimer;
function toast(msg, kind, art) {
  const t = $('#toast');
  t.innerHTML = (art && hasAsset(art) ? `<img src="${assetUrl(art)}" alt="">` : '') + `<span>${esc(msg)}</span>`;
  t.className = 'toast ' + (kind || '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), art ? 4200 : 3200);
}

// ─────────────── Görsel yardımcılar ───────────────
const cityName = (id) => S.cities.find(c => c.id === id).name;
const rankName = (r) => S.ranks[r].name;
const nickLink = (n) => `<a class="nick-link" data-profile="${esc(n)}">${esc(n)}</a>`;
const PORTRAIT_EMOJI = ['🧔', '👴', '🕴', '💪', '💃', '🧕', '👸', '🧢'];
const portrait = (n, cls) => img(`portraits/p${n}`, cls, `<span class="${cls} emoji">${PORTRAIT_EMOJI[n - 1]}</span>`);
const icon = (name, emoji) => img(`items/${name}`, 'icon', `<span class="icon emoji">${emoji}</span>`);
const WEAPON_EMOJI = { tabanca: '🔫', pompali: '🔫', thompson: '🔫' };
const CAR_EMOJI = { kamyonet: '🛻', taksi: '🚕', aile: '🚗', spor: '🏎', sedan: '🚘', limuzin: '🚙' };
const GOOD_EMOJI = { kahve: '☕', tutun: '🍂', sarap: '🍷', raki: '🥛', konyak: '🥃', viski: '🛢' };
const TRANSPORT_EMOJI = { vapur: '⛴', motorbot: '🚤', deniz_ucagi: '🛩' };
const JOB_EMOJI = { cep: '👛', dukkan: '🏪', kumarhane: '🃏', liman: '📦', kuyumcu: '💍', banka: '🏦', soygun: '🚂', organize: '🏛', buyuk: '⚓' };

function card(title, sub, button, iconHtml = '') {
  return `<div class="card">${iconHtml}<div class="grow"><div class="title">${title}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>${button || ''}</div>`;
}

// Hazır olmayan aksiyonların butonları pasif görünsün (sunucu zaten reddeder)
const blocked = () => left(S.player.jail_until) > 0 || left(S.player.hospital_until) > 0 || left(S.player.hideout_until) > 0;
const waiting = (at) => blocked() || left(at) > 0;
const dis = (cond) => cond ? 'disabled' : '';

// ─────────────── Çizim ───────────────
function render() {
  if (S.banned) {
    $('#ban-reason').textContent = 'Gerekçe: ' + (S.banned.reason || '—');
    $('#ban-until').textContent = S.banned.until ? 'Bitiş: ' + new Date(S.banned.until).toLocaleString('tr-TR') : 'Süresiz.';
    show('banned'); return;
  }
  if (!S.player) { renderOnboard(); show('onboard'); return; }
  show('game');
  const p = S.player, rank = S.ranks[p.rank], next = S.ranks[p.rank + 1];
  $('#h-avatar').innerHTML = portrait(p.avatar, 'avatar');
  $('#h-nick').textContent = p.nick;
  $('#h-rank').textContent = rank.name + (next ? ` · ${p.xp}/${next.min_xp}` : ' · zirvede')
    + (p.family ? ` · ${p.family}` : '') + (p.bounty > 0 ? ` · 🎯 ${money(p.bounty)}` : '');
  $('#h-cash').textContent = money(p.cash);
  $('#h-city').textContent = '📍 ' + cityName(p.city);
  $('#h-stats').textContent = `❤ ${p.health} · 🔫 ${p.bullets} kurşun · 🏦 ${money(p.bank)}`;
  $('[data-go="log"]').dataset.badge = p.unread > 0 ? p.unread : '';
  $('#xpbar div').style.width = next ? `${100 * (p.xp - rank.min_xp) / (next.min_xp - rank.min_xp)}%` : '100%';
  renderTab();
  tick();
}

function show(id) {
  for (const s of ['loading', 'onboard', 'banned', 'game']) $('#' + s).classList.toggle('hidden', s !== id);
}

function renderOnboard() {
  $('#onboard-art').innerHTML = img('ui/splash', 'splash-art', '');
  $('#onboard-portraits').innerHTML = Array.from({ length: 8 }, (_, i) =>
    `<button type="button" data-pick="${i + 1}" class="${pickedAvatar === i + 1 ? 'on' : ''}">${img(`portraits/p${i + 1}`, '', PORTRAIT_EMOJI[i])}</button>`).join('');
}

// Yeniden çizimde yazılan input değerleri kaybolmasın
function keepInputs(el, fn) {
  const keep = {};
  el.querySelectorAll('input[id], select[id]').forEach(i => keep[i.id] = i.value);
  el.innerHTML = fn();
  for (const [id, v] of Object.entries(keep)) { const i = el.querySelector('#' + id); if (i) i.value = v; }
}

function renderTab() {
  keepInputs($(`section[data-tab="${tab}"]`), ({ city: cityTab, crime: crimeTab, family: familyTab, log: logTab })[tab]);
  renderSheet();
}

// ═════════════════ ŞEHİR HARİTASI ═════════════════
// Harita: üstte gökyüzü + liman şeridi, altında 4 sokak; her sokakta 3 bina yan yana (ızgara, üst üste binme yok).
const BUILDINGS = {
  karakol:  { name: 'Karakol',          emoji: '⛓' },
  banka:    { name: 'Banka',            emoji: '🏦' },
  hastane:  { name: 'Hastane',          emoji: '🏥' },
  fabrika:  { name: 'Kurşun Fabrikası', emoji: '🏭' },
  silahci:  { name: 'Silahçı',          emoji: '🔫' },
  dedektif: { name: 'Dedektif Bürosu',  emoji: '🕵' },
  garaj:    { name: 'Garaj',            emoji: '🚗' },
  carsi:    { name: 'Çarşı',            emoji: '🛍' },
};
const SPOT_EMOJI = { gazino: '🎰', meyhane: '🍷', kahvehane: '☕', antrepo: '📦' };
const SPOT_ORDER = ['gazino', 'meyhane', 'kahvehane', 'antrepo'];
const HOTSPOTS = {
  liman:   { name: 'Liman',   emoji: '⚓' },
  siginak: { name: 'Sığınak', emoji: '🗝' },
};
// Sokaklar; 'spot' sıradaki mekân (şehrin 3 mekânı gazino önce gelecek şekilde dağıtılır)
const STREETS = [
  ['karakol', 'banka', 'hastane'],
  ['spot', 'fabrika', 'spot'],
  ['silahci', 'dedektif', 'spot'],
  ['garaj', 'carsi', 'siginak'],
];

function buildingHtml(id, asset, emoji, name, tagHtml = '') {
  return `<div class="bld" data-open="${id}">${tagHtml}
    <div class="bld-art">${img(asset, '', `<div class="ph">${emoji}</div>`)}</div><div class="plate">${esc(name)}</div></div>`;
}

function cityTab() {
  const p = S.player, jailed = left(p.jail_until) > 0;
  const spots = (extra.spots?.spots || []).filter(s => s.city === p.city)
    .sort((x, y) => SPOT_ORDER.indexOf(x.kind) - SPOT_ORDER.indexOf(y.kind));
  let si = 0, town = '';
  for (const street of STREETS) {
    town += '<div class="street">';
    for (const slot of street) {
      if (slot === 'spot') {
        const sp = spots[si++];
        if (!sp) { town += '<div class="bld empty"></div>'; continue; }
        const tag = sp.owner ? `<span class="tag ${sp.mine ? 'mine' : ''}">${esc(sp.owner)}</span>` : '<span class="tag ok">sahipsiz</span>';
        town += buildingHtml('spot:' + sp.id, `buildings/${sp.kind}`, SPOT_EMOJI[sp.kind], sp.name, tag);
      } else if (HOTSPOTS[slot]) {
        const hs = HOTSPOTS[slot];
        town += `<div class="bld hs" data-open="${slot}"><div class="bld-art"><div class="dot">${hs.emoji}</div></div><div class="plate">${hs.name}</div></div>`;
      } else {
        const b = BUILDINGS[slot];
        let tag = '';
        if (slot === 'garaj' && !waiting(p.car_ready_at)) tag = '<span class="tag ok">hazır</span>';
        if (slot === 'karakol' && jailed) tag = '<span class="tag">içeridesin</span>';
        if (slot === 'hastane' && p.health < 100) tag = `<span class="tag">❤ ${p.health}</span>`;
        if (slot === 'fabrika') tag = `<span class="tag mine">${money(S.factory.price)}</span>`;
        town += buildingHtml(slot, `buildings/${slot}`, b.emoji, b.name, tag);
      }
    }
    town += '</div>';
  }
  // Doku görselleri gelince CSS çizimi yerine onlar kullanılır
  const tex = ['kaldirim', 'duvar'].filter(t => hasAsset('tex/' + t)).map(t => `--tex-${t}:url(${assetUrl('tex/' + t)});--${t}-size:${t === 'duvar' ? '160px' : '96px'} auto`).join(';');
  return `<div class="map" style="${tex}">${img(`bg/${p.city}`, 'bgimg', '')}
    <div class="sky">${img(`harbor/${p.city}`, 'harbor', '<div class="ship">⛴</div>')}
      <div class="city-title">${esc(cityName(p.city).toLocaleUpperCase('tr-TR'))}<small>1922</small></div>
      <div class="hotspot" data-open="liman"><div class="dot">⚓</div>Liman</div>
    </div>
    <div class="town">${town}</div></div>`;
}

// ── Binaya dokununca açılan panel
function panelInfo(id) {
  if (id.startsWith('spot:')) {
    const sp = (extra.spots?.spots || []).find(s => 'spot:' + s.id === id);
    return sp ? { name: sp.name, asset: `buildings/${sp.kind}`, emoji: SPOT_EMOJI[sp.kind], render: () => spotPanel(sp) } : null;
  }
  const b = BUILDINGS[id] || HOTSPOTS[id];
  const render = { karakol: jailSection, hastane: hospitalSection, banka: bankSection, fabrika: factorySection,
    silahci: gunsmithSection, dedektif: detectiveSection, garaj: garageSection, carsi: marketSection,
    liman: harborSection, siginak: hideoutSection }[id];
  return { name: b.name, asset: BUILDINGS[id] ? `buildings/${id}` : null, emoji: b.emoji, render };
}

function renderSheet() {
  if (!panel || !S?.player) { $('#sheet').classList.add('hidden'); return; }
  const info = panelInfo(panel);
  if (!info) { panel = null; $('#sheet').classList.add('hidden'); return; }
  $('#sheet-icon').innerHTML = (info.asset && img(info.asset, '', '')) || `<span class="ph-icon">${info.emoji}</span>`;
  $('#sheet-title').textContent = info.name;
  keepInputs($('#sheet-body'), info.render);
  $('#sheet').classList.remove('hidden');
}

async function openPanel(id) {
  panel = id;
  renderSheet();          // hemen aç, veriyi sonra doldur
  await loadPanelData();
  renderSheet();
}

function closePanel() {
  panel = null;
  extra.casino = null;
  $('#sheet').classList.add('hidden');
}

// ═════════════════ PANELLER ═════════════════
function jailSection() {
  const p = S.player, jailLeft = left(p.jail_until);
  let h = '';
  if (jailLeft) {
    h += card('Firar et', `%15 şans · kalan hakkın: ${p.self_bust_left}`,
      `<button class="btn sm primary" data-act="selfbust" ${dis(!p.self_bust_left)}>Dene</button>`);
  }
  const others = extra.jail.filter(j => j.nick !== p.nick);
  h += `<h2>Mahkûmlar</h2>` + (others.length ? others.map(j => card(nickLink(j.nick), `${esc(rankName(j.rank))} · ${fmt(j.secs)} kaldı`,
      `<button class="btn sm primary" data-act="bust" data-id="${esc(j.nick)}" ${dis(waiting(p.bust_ready_at))}>Kurtar</button>`)).join('')
    : `<p class="muted small">İçeride kimse yok.</p>`);
  return h + `<p class="muted small">Birini kaçırmak itibar kazandırır ama gardiyana yakalanabilirsin.</p>`;
}

function hospitalSection() {
  const p = S.player, hospLeft = left(p.hospital_until);
  return card(`Sağlık: ${p.health}/100`,
    hospLeft ? `Yatıyorsun: ${fmt(hospLeft)}` : `Can başı ${money(S.settings.heal_cost_per_hp)}`,
    `<button class="btn sm primary" data-act="heal" ${dis(p.health >= 100 || left(p.jail_until))}>İyileş</button>`) +
    `<p class="muted small">Vurulursan canın azalır; ne kadar yaralıysan seni öldürmek o kadar az kurşun ister.</p>`;
}

function bankSection() {
  const p = S.player;
  return `<p class="muted small">Bankadaki para öldürülünce kaybolmaz. Yatırırken %${Math.round(S.settings.bank_fee * 100)} komisyon.</p>
    ${card(`Hesap: ${money(p.bank)}`, `Cepte: ${money(p.cash)}`)}
    <div class="form-row"><input id="f-bank" type="number" min="1" placeholder="Tutar" inputmode="numeric">
      <button class="btn primary" data-act="deposit">Yatır</button><button class="btn" data-act="withdraw">Çek</button></div>
    <h2>Para Gönder</h2>
    <div class="form-row"><input id="f-send-nick" placeholder="Kime" autocomplete="off" autocapitalize="off">
      <input id="f-send-amt" type="number" min="1" placeholder="Tutar" inputmode="numeric">
      <button class="btn primary" data-act="send">Gönder</button></div>
    <p class="muted small">%${Math.round(S.settings.transfer_fee * 100)} komisyon kesilir.</p>`;
}

function factorySection() {
  const p = S.player;
  return `<p class="muted small">Stok: <b>${S.factory.stock}</b> · Fiyat: <b>${money(S.factory.price)}</b>/kurşun ·
      Bu saat alabileceğin: <b>${p.bullets_left_hour}</b></p>
    <div class="form-row"><input id="f-bullets" type="number" min="1" placeholder="Adet" inputmode="numeric">
      <button class="btn primary" data-act="bullets" ${dis(blocked())}>Satın al</button></div>
    <p class="muted small">Fabrikayı bir aile satın alabilir; o zaman fiyatı aile belirler ve para aile kasasına gider (Aile sekmesi).</p>`;
}

function gunsmithSection() {
  const p = S.player, weapon = S.weapons.find(w => w.id === p.weapon);
  return S.weapons.map(w => {
      const locked = p.rank < w.min_rank, owned = p.weapon === w.id;
      return `<div class="card ${locked ? 'locked' : ''}">${icon('w_' + w.id, WEAPON_EMOJI[w.id])}<div class="grow"><div class="title">${esc(w.name)}${owned ? ' ✓' : ''}</div>
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
}

function detectiveSection() {
  const p = S.player, protectRank = S.settings.protect_rank;
  const weapon = S.weapons.find(w => w.id === p.weapon);
  const foundHere = S.searches.filter(s => s.resolved && s.success && s.city === p.city);
  const killWait = left(p.kill_ready_at);
  if (p.rank < protectRank) {
    return `<p class="muted">🔒 ${esc(rankName(protectRank))} rütbesine kadar kimseyi aratamaz, vuramazsın; kimse de seni vuramaz.</p>` + hitlistSection();
  }
  return `<p class="muted small">Dedektif başı ${money(S.settings.detective_cost)}. Ne kadar çok dedektif, o kadar hızlı ve kesin sonuç.</p>
    <div class="form-row"><input id="f-target" placeholder="Hedefin takma adı" autocomplete="off" autocapitalize="off">
      <select id="f-dets">${[1, 3, 5, 10].map(n => `<option value="${n}">${n} ded.</option>`).join('')}</select>
      <button class="btn primary" data-act="detectives" ${dis(blocked())}>Arat</button></div>` +
    S.searches.map(s => card(nickLink(s.target),
      !s.resolved ? `🔎 Aranıyor… ${fmt(left(s.ready_at))}`
        : s.success ? `📍 Görüldüğü yer: ${esc(cityName(s.city))}` : '❌ Bulunamadı')).join('') +
    `<h2>İnfaz</h2>` + (foundHere.length
      ? `<p class="muted small">${weapon ? `Silahın: ${esc(weapon.name)}.` : '⚠ Silahın yok (Silahçı).'}
          ${killWait ? `Tekrar tetik çekmek için ${fmt(killWait)} bekle.` : ''}</p>
        <div class="form-row"><select id="f-shoot-target">${foundHere.map(s => `<option>${esc(s.target)}</option>`).join('')}</select>
          <input id="f-shoot-bullets" type="number" min="1" placeholder="Kurşun" inputmode="numeric">
          <button class="btn danger" data-act="shoot" ${dis(!weapon || waiting(p.kill_ready_at))}>Ateş</button></div>
        <p class="muted small">Az kurşun sıkarsan sadece yaralarsın. Hedefin profilinde tahmini kurşun ihtiyacı yazar (korumalar hariç).</p>`
      : `<p class="muted small">Vurabilmek için dedektiflerinin hedefi <b>bulunduğun şehirde</b> bulmuş olması gerekir.</p>`) +
    hitlistSection();
}

function hitlistSection() {
  return `<h2>Kelle Listesi</h2>` +
    (extra.hitlist.length ? extra.hitlist.map(b => card(nickLink(b.nick), esc(rankName(b.rank)),
      `<span class="cash-sm">${money(b.amount)}</span>`)).join('') : `<p class="muted small">Listede kimse yok.</p>`) +
    `<div class="form-row"><input id="f-bounty-nick" placeholder="Kimin başına" autocomplete="off" autocapitalize="off">
      <input id="f-bounty-amt" type="number" min="1" placeholder="Ödül $" inputmode="numeric">
      <button class="btn primary" data-act="bounty">Koy</button></div>
    <p class="muted small">En az ${money(S.settings.bounty_min)}. Aracıya %${Math.round(S.settings.bounty_fee * 100)} pay. Ödülü onu öldüren alır.</p>`;
}

function garageSection() {
  const p = S.player, here = S.cars.filter(c => c.city === p.city), away = S.cars.length - here.length;
  return card('Sokaktan araba çal', 'Yakalanırsan kısa süre hapis.',
      `<button class="btn sm primary" data-act="car" ${dis(waiting(p.car_ready_at))}>${left(p.car_ready_at) ? fmt(left(p.car_ready_at)) : 'Çal'}</button>`) +
    `<h2>Garajın (${here.length})</h2>` +
    (here.length ? here.map(c => card(esc(c.name), `${money(c.value)} · hurdası ${Math.max(1, Math.floor(c.value / S.settings.crusher_divisor))} kurşun`,
      `<div class="market-actions"><button class="btn sm" data-act="sell" data-id="${c.id}">Sat</button>
       <button class="btn sm" data-act="crush" data-id="${c.id}">Ez</button></div>`, icon('c_' + c.type, CAR_EMOJI[c.type]))).join('')
      : `<p class="muted small">Bu şehirde araban yok.</p>`) +
    (away ? `<p class="muted small">Başka şehirlerde ${away} araban var; satmak için oraya git.</p>` : '') +
    raceSection();
}

function raceSection() {
  const R = extra.races;
  if (!R) return '';
  const here = S.cars.filter(c => c.city === S.player.city);
  const carSelect = (id) => here.length
    ? `<select id="${id}">${here.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>` : '';
  const inRace = R.open.some(r => r.joined);
  let h = `<h2>Yarışlar</h2><p class="muted small">Yarış formun: <b>${R.form}</b>/20. Güçlü araba ve form avantaj sağlar ama şans baskındır.
    Kazanan havuzun %95'ini alır.</p>`;
  h += R.open.map(r => card(`${esc(r.host)} · giriş ${money(r.fee)}`,
    r.racers.map(x => `${nickLink(x.nick)} (${esc(x.car)})`).join(', '),
    r.i_host ? `<div class="market-actions"><button class="btn sm primary" data-act="racestart">Start</button>
                <button class="btn sm" data-act="raceleave">İptal</button></div>`
    : r.joined ? `<button class="btn sm" data-act="raceleave">Çekil</button>`
    : !inRace && here.length ? `<div class="market-actions">${carSelect('f-race-car-' + r.id)}
        <button class="btn sm primary" data-act="racejoin" data-id="${r.id}">Katıl</button></div>` : '')).join('');
  if (!inRace) {
    h += here.length ? `<div class="form-row">${carSelect('f-race-car')}
        <input id="f-race-fee" type="number" min="1000" placeholder="Giriş $" inputmode="numeric">
        <button class="btn primary" data-act="racecreate">Yarış aç</button></div>`
      : `<p class="muted small">Yarışmak için bu şehirde bir araban olmalı.</p>`;
  }
  return h + R.recent.map(t => `<p class="muted small">🏁 ${esc(t)}</p>`).join('');
}

function maxFor(g, buying) {
  if (!buying) return g.qty;
  const held = S.market.reduce((a, x) => a + x.qty, 0);
  return Math.max(0, Math.min(S.ranks[S.player.rank].carry - held, Math.floor(S.player.cash / g.price)));
}

function harborSection() {
  const held = S.market.reduce((a, x) => a + x.qty, 0);
  const travelWait = waiting(S.player.travel_ready_at);
  const cur = S.transports.find(t => t.id === S.player.transport);
  return `<h2>Kaçak Mal</h2>
    <p class="muted small">Fiyatlar her saat ve her şehirde değişir. Ucuza al, başka limanda pahalıya sat.
      Taşıyabileceğin: <b>${held}/${S.ranks[S.player.rank].carry}</b> kasa.</p>
    <div class="qtybar">${[1, 5, 10, 'max'].map(q => `<button class="btn sm ${qty === q ? 'on' : ''}" data-qty="${q}">${q === 'max' ? 'Hepsi' : q}</button>`).join('')}</div>` +
    S.market.map(g => {
      const nb = qty === 'max' ? maxFor(g, true) : qty, ns = qty === 'max' ? maxFor(g, false) : qty;
      return card(esc(g.name), `${money(g.price)} / kasa · elinde ${g.qty}`,
        `<div class="market-actions">
          <button class="btn sm primary" data-act="buy" data-id="${g.id}" data-n="${nb}" ${dis(!nb)}>Al</button>
          <button class="btn sm" data-act="sellg" data-id="${g.id}" data-n="${ns}" ${dis(!(g.qty && ns))}>Sat</button>
        </div>`, icon('g_' + g.id, GOOD_EMOJI[g.id]));
    }).join('') +
    `<h2>Sefer</h2>
    <p class="muted small">Bilet ${money(S.travel_cost)}. Kaçak malla yolculukta gümrüğe takılma riski var.
      ${travelWait && !blocked() ? `Sıradaki sefer: ${fmt(left(S.player.travel_ready_at))}` : ''}</p>` +
    S.cities.filter(c => c.id !== S.player.city).map(c => card(esc(c.name), '',
      `<button class="btn sm primary" data-act="travel" data-id="${c.id}" ${dis(travelWait)}>Git</button>`)).join('') +
    `<h2>Ulaşım</h2><p class="muted small">Şu an: <b>${esc(cur.name)}</b> · her yolculuktan sonra ${cur.cooldown_s / 60} dk bekleme.</p>` +
    S.transports.filter(t => t.cooldown_s < cur.cooldown_s).map(t => {
      const locked = S.player.rank < t.min_rank;
      return `<div class="card ${locked ? 'locked' : ''}">${icon('t_' + t.id, TRANSPORT_EMOJI[t.id])}<div class="grow"><div class="title">${esc(t.name)}</div>
        <div class="muted small">${locked ? '🔒 ' + esc(rankName(t.min_rank)) : money(t.price)} · ${t.cooldown_s / 60} dk bekleme</div></div>
        <button class="btn sm primary" data-act="transport" data-id="${t.id}" ${dis(locked)}>Al</button></div>`;
    }).join('');
}

function marketSection() {
  let h = `<p class="muted small">Oyuncular arası alım satım. Satıcıdan %${Math.round(S.settings.market_fee * 100)} komisyon kesilir.</p>`;
  h += extra.market.length ? extra.market.map(l => card(
      l.kind === 'bullets' ? `${l.qty} kurşun` : `${esc(l.car)} <span class="muted small">(${esc(l.city)})</span>`,
      `${nickLink(l.seller)} · ${money(l.price)}${l.unit ? ` · kurşunu ${money(l.unit)}` : ` · piyasa ${money(l.car_value)}`}`,
      l.mine ? `<button class="btn sm" data-act="unlist" data-id="${l.id}">Kaldır</button>`
             : `<button class="btn sm primary" data-act="buylisting" data-id="${l.id}">Al</button>`,
      l.kind === 'bullets' ? `<span class="icon emoji">🔫</span>` : `<span class="icon emoji">🚗</span>`)).join('')
    : `<p class="muted small">Pazarda ilan yok.</p>`;
  h += `<h2>Sat</h2><div class="form-row"><input id="f-sell-bullets" type="number" min="1" placeholder="Kurşun adedi" inputmode="numeric">
      <input id="f-sell-bprice" type="number" min="1" placeholder="Toplam $" inputmode="numeric">
      <button class="btn" data-act="listbullets">Sat</button></div>`;
  if (S.cars.length) h += `<div class="form-row"><select id="f-sell-car">${S.cars.map(c =>
      `<option value="${c.id}">${esc(c.name)} · ${esc(cityName(c.city))}</option>`).join('')}</select>
      <input id="f-sell-cprice" type="number" min="1" placeholder="Fiyat $" inputmode="numeric">
      <button class="btn" data-act="listcar">Sat</button></div>`;
  return h;
}

function hideoutSection() {
  const p = S.player;
  return left(p.hideout_until)
    ? card('Yer altındasın', `Kimse seni bulamaz ve vuramaz; sen de iş yapamazsın. ${fmt(left(p.hideout_until))} kaldı.`,
        `<button class="btn sm primary" data-act="leavehide">Çık</button>`)
    : `<p class="muted small">Saati ${money(S.settings.hideout_cost_per_rank_h * (p.rank + 1))}. Dedektifler bulamaz, kimse vuramaz ama bu sürede hiçbir iş yapamazsın.</p>
      <div class="form-row"><select id="f-hide-h">${[1, 2, 4, 8, 12].map(n => `<option value="${n}">${n} saat</option>`).join('')}</select>
        <button class="btn primary" data-act="hide" ${dis(blocked())}>Saklan</button></div>`;
}

// ── Mekân paneli (gazino ise kumarhane de burada)
function spotPanel(sp) {
  const role = S.player.family_role, canRaid = ['don', 'sottocapo', 'capo'].includes(role);
  const raidWait = extra.spots?.raid_ready_at && left(extra.spots.raid_ready_at);
  const prot = sp.protected_until && left(sp.protected_until);
  let h = card(`${money(sp.income)}/saat haraç`,
    `${sp.owner ? `Sahibi: <b>${esc(sp.owner)}</b>` : 'Sahipsiz'} · ${sp.mine ? `savunma ${sp.defense} kurşun` : `koruma: ${esc(sp.strength)}`}${prot ? ` · 🛡 ${fmt(prot)}` : ''}`);
  if (sp.mine) {
    h += `<div class="form-row"><input id="f-fort-${sp.id}" type="number" min="1" placeholder="Bırakılacak kurşun" inputmode="numeric">
      <button class="btn" data-act="fortify" data-id="${sp.id}">Tahkim et</button></div>`;
  } else if (canRaid && !prot) {
    h += `<div class="form-row"><input id="f-raid-${sp.id}" type="number" min="1" placeholder="Baskın kurşunu" inputmode="numeric">
      <button class="btn danger" data-act="raid" data-id="${sp.id}" ${dis(raidWait || blocked())}>Baskın</button></div>
      ${raidWait ? `<p class="muted small">⏳ Ailenin sıradaki baskını: ${fmt(raidWait)}</p>` : ''}`;
  } else if (!sp.mine) {
    h += `<p class="muted small">Baskını ailenin Don, Sottocapo ya da bir Capo'su yönetebilir. Şehirde çevrimiçi her aile üyesi gücü %15 artırır.</p>`;
  }
  if (sp.kind === 'gazino') h += casinoSection();
  return h;
}

function casinoSection() {
  const c = extra.casino;
  return `<h2>Kumarhane</h2>
    <p class="muted small">Oyun parasıyla oynanır. Rütbene göre en fazla bahis: <b>${money(S.player.max_bet)}</b>. Kasa her zaman biraz önde.</p>
    <div class="form-row"><input id="f-bet" type="number" min="10" placeholder="Bahis $" inputmode="numeric"></div>
    <div class="casino">
      <button class="btn" data-act="casino" data-game="zar" data-choice="yuksek">🎲 Yüksek (8-12)</button>
      <button class="btn" data-act="casino" data-game="zar" data-choice="dusuk">🎲 Düşük (2-6)</button>
      <button class="btn" data-act="casino" data-game="rulet" data-choice="kirmizi">🔴 Kırmızı</button>
      <button class="btn" data-act="casino" data-game="rulet" data-choice="siyah">⚫ Siyah</button>
      <button class="btn primary" data-act="casino" data-game="slot">🎰 Slot çevir</button>
      <div class="form-row"><input id="f-rulet-n" type="number" min="0" max="36" placeholder="Sayı 0-36" inputmode="numeric">
        <button class="btn" data-act="casino" data-game="rulet" data-choice="num">×36</button></div>
    </div>
    ${c ? `<div class="casino-result ${c.win > 0 ? 'good' : 'bad'}">${esc(c.msg)}</div>` : ''}
    <h2>Blackjack</h2>${bjSection()}
    <h2>Kazı Kazan</h2>` + card('Tanesi ' + money(S.settings.scratch_price), 'Büyük ikramiye $100.000',
      `<button class="btn sm primary" data-act="scratch">Kazı</button>`) + lotterySection();
}

function bjSection() {
  const g = extra.bj;
  if (!g) return `<p class="muted small">Bahsi yukarıdaki kutuya yaz. Krupiye 17'de durur, blackjack 3:2 öder.</p>
    <button class="btn primary" data-act="bjstart">Kart dağıt</button>`;
  return `<div class="bj"><div>Krupiye: <b>${esc(g.dealer)}</b>${g.dealer_value != null ? ` (${g.dealer_value})` : ''}</div>
    <div>Sen: <b>${esc(g.hand)}</b> (${g.hand_value}) · bahis ${money(g.bet)}</div></div>` +
    (g.done ? `<div class="casino-result ${g.win > 0 ? 'good' : 'bad'}">${esc(g.msg)}</div>
       <button class="btn primary" data-act="bjstart">Yeni el</button>`
     : `<div class="market-actions"><button class="btn primary" data-act="bjhit">Kart çek</button>
        <button class="btn" data-act="bjstand">Dur</button></div>`);
}

function lotterySection() {
  const L = extra.lottery;
  if (!L) return '';
  return `<h2>Piyango</h2>` + card(`İkramiye: ${money(L.pot)}`,
    `Çekiliş: ${new Date(L.draw_at).toLocaleString('tr-TR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} ·
     ${L.tickets} bilet satıldı · senin ${L.mine} biletin` +
    (L.last_winner ? `<br>Son kazanan: ${nickLink(L.last_winner)} (${money(L.last_prize)})` : ''),
    `<div class="market-actions"><select id="f-lot-n">${[1, 5, 10, 25].map(n => `<option value="${n}">${n}</option>`).join('')}</select>
     <button class="btn sm primary" data-act="lottery">${money(S.settings.lottery_ticket)}</button></div>`);
}

// ═════════════════ İŞLER ═════════════════
function crimeTab() {
  const wait = waiting(S.player.crime_ready_at);
  return `<h2>Suçlar</h2><div class="jobs-grid">` + S.crimes.map(c => {
    const locked = S.player.rank < c.min_rank;
    return `<div class="card job ${locked ? 'locked' : ''}">
      ${img('jobs/' + c.id, 'art', `<div class="art ph">${JOB_EMOJI[c.id]}</div>`)}
      <div class="body"><div class="title">${esc(c.name)}</div>
        <div class="muted small">${locked ? '🔒 ' + esc(rankName(c.min_rank))
          : `${money(c.reward_min)}–${money(c.reward_max)}<br><span class="pct">%${Math.round(c.chance * 100)}</span> şans`}</div>
        <button class="btn sm primary" data-act="crime" data-id="${c.id}" ${dis(locked || wait)}>${
          wait && !locked && !blocked() ? fmt(left(S.player.crime_ready_at)) : 'Yap'}</button></div>
    </div>`;
  }).join('') + `</div>` + crewSection();
}

const CREW_ROLES = { lider: 'Lider', sofor: 'Şoför', silahci: 'Silahçı', patlayici: 'Patlayıcı Uzmanı' };
const roleLabel = (r) => { const [, k, n] = r.match(/^(\D+)(\d*)$/); return CREW_ROLES[k] + (n ? ' ' + n : ''); };
const countRole = (t, k) => t.roles.filter(r => r.replace(/\d+$/, '') === k).length;

function crewSection() {
  const X = extra.crews;
  if (!X) return '';
  let h = `<h2>Ekip İşleri</h2>`;
  const active = X.crews.filter(c => c.status === 'forming');
  const mine = active.find(c => c.i_lead);

  for (const c of active) {
    const t = X.types.find(x => x.id === c.type);
    const me = c.members.find(m => m.nick === S.player.nick);
    const list = c.members.map(m => `${roleLabel(m.role)}: ${nickLink(m.nick)} ${m.accepted === true ? '✅' : m.accepted === false ? '❌' : '⏳'}`).join('<br>');
    let btn = '';
    if (c.i_lead) btn = `<div class="market-actions"><button class="btn sm primary" data-act="crewstart">Başlat</button>
      <button class="btn sm" data-act="crewcancel">Dağıt</button></div>`;
    else if (me && me.accepted === null) btn = `<div class="market-actions"><button class="btn sm primary" data-act="crewyes" data-id="${c.id}">Katıl</button>
      <button class="btn sm" data-act="crewno" data-id="${c.id}">Reddet</button></div>`;
    h += card(`${esc(t.name)} · ${esc(cityName(c.city))}`, list, btn);
  }

  for (const c of X.crews.filter(c => c.status !== 'forming').slice(0, 2)) {
    h += `<p class="muted small">📰 ${esc(c.result || '')}</p>`;
  }

  if (!mine) {
    for (const t of X.types) {
      const locked = S.player.rank < t.min_rank, wait = t.ready_at && left(t.ready_at);
      const art = img('jobs/' + t.id, 'art', `<div class="art ph">${JOB_EMOJI[t.id]}</div>`);
      if (locked) { h += `<div class="card job locked">${art}<div class="body"><div class="grow"><div class="title">${esc(t.name)}</div>
        <div class="muted small">🔒 ${esc(rankName(t.min_rank))} rütbesi gerekir</div></div></div></div>`; continue; }
      const req = [`lider ${money(t.leader_cost)} + silah + ${X.settings.leader_bullets} kurşun`,
        `${countRole(t, 'sofor') > 1 ? countRole(t, 'sofor') + ' şoförün' : 'şoförün'} en az ${money(t.car_min_value)} arabası`,
        countRole(t, 'silahci') ? `${countRole(t, 'silahci') > 1 ? countRole(t, 'silahci') + ' silahçı' : 'silahçı'} ${X.settings.gunner_bullets}'er kurşun` : '',
        countRole(t, 'patlayici') ? `patlayıcı ${money(X.settings.explosive_cost)}` : ''].filter(Boolean).join(' · ');
      h += `<div class="card job">${art}<div class="body" style="flex-direction:column;align-items:stretch">
        <div class="title">${esc(t.name)} <span class="muted small">${money(t.payout_min)}–${money(t.payout_max)}</span></div>
        <div class="muted small">${req}. Herkes aynı şehirde olmalı.</div>
        ${wait ? `<div class="muted small">⏳ ${fmt(wait)} sonra tekrar</div>` : `
        ${t.roles.slice(1).map(r => `<input id="f-crew-${t.id}-${r}" placeholder="${roleLabel(r)} (takma ad)" autocomplete="off" autocapitalize="off">`).join('')}
        <button class="btn primary" data-act="crewcreate" data-id="${t.id}">Ekibi kur, davet et</button>`}</div></div>`;
    }
  }
  return h;
}

// ═════════════════ AİLE ═════════════════
const ROLES = { don: 'Don', sottocapo: 'Sottocapo', consigliere: 'Consigliere', capo: 'Capo', asker: 'Asker' };

function familyTab() {
  const F = extra.family;
  if (!F) return `<h2>Aile</h2><p class="muted">Yükleniyor…</p>`;
  if (!F.family) {
    let h = `<h2>Aile</h2><p class="muted small">Tek başına kabadayı olunmaz. Bir aileye katıl ya da kendi aileni kur.</p>`;
    if (F.application) h += card(`Başvurun: ${esc(F.application.family)}`, 'Yönetimin cevabı bekleniyor.',
      `<button class="btn sm" data-act="cancelapp">Geri çek</button>`);
    h += `<h2>Aileler</h2>` + (extra.families.length ? extra.families.map(f => card(esc(f.name),
      `Don: ${f.don ? esc(f.don) : '—'} · ${f.members} üye · 🏭 ${f.factories} · 🏠 ${f.spots ?? 0}`,
      `<button class="btn sm primary" data-act="apply" data-id="${esc(f.name)}">Başvur</button>`)).join('')
      : `<p class="muted small">Henüz aile yok.</p>`);
    h += `<h2>Aile Kur</h2>` + (F.can_create
      ? `<div class="form-row"><input id="f-fam-name" placeholder="Aile adı" autocomplete="off">
          <button class="btn primary" data-act="createfam">${money(F.create_cost)}</button></div>`
      : `<p class="muted small">🔒 Aile kurmak için ${esc(rankName(S.settings.family_create_rank))} olmalısın (${money(F.create_cost)}).</p>`);
    return h + spotsSection(null);
  }

  const role = F.my_role, isDon = role === 'don', leader = ['don', 'sottocapo', 'consigliere'].includes(role);
  const treasurer = ['don', 'sottocapo'].includes(role);
  let h = `<h2>${esc(F.family.name)}</h2>
    <p class="small">Rolün: <b>${ROLES[role]}</b> · Kasa: <b class="cash-sm">${money(F.family.bank)}</b></p>
    <div class="form-row"><input id="f-fam-dep" type="number" min="1" placeholder="Kasaya koy $" inputmode="numeric">
      <button class="btn primary" data-act="famdeposit">Koy</button></div>`;
  if (treasurer) h += `<div class="form-row"><input id="f-pay-nick" placeholder="Üyeye" autocomplete="off" autocapitalize="off">
      <input id="f-pay-amt" type="number" min="1" placeholder="$" inputmode="numeric">
      <button class="btn" data-act="fampay">Öde</button></div>`;

  h += `<h2>Sohbet</h2><div class="chat" id="chat">${F.messages.map(m => m.nick
      ? `<div><b>${esc(m.nick)}:</b> ${esc(m.text)}${m.nick !== S.player.nick
          ? ` <a class="flag" data-report="family_message" data-id="${m.id}" title="Şikâyet et">⚑</a>` : ''}</div>`
      : `<div class="muted small">— ${esc(m.text)}</div>`).join('')}</div>
    <form class="form-row" id="chat-form"><input id="f-chat" maxlength="300" placeholder="Mesaj yaz…" autocomplete="off">
      <button class="btn primary">Gönder</button></form>`;

  h += `<h2>Üyeler (${F.members.length})</h2>` + F.members.map(m => {
    const self = m.nick === S.player.nick;
    const controls = isDon && !self
      ? `<select data-role="${esc(m.nick)}">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === m.role ? 'selected' : ''}>${v}</option>`).join('')}</select>` : '';
    const kick = treasurer && !self && m.role !== 'don' ? `<button class="btn sm" data-act="kick" data-id="${esc(m.nick)}">At</button>` : '';
    return card(`${nickLink(m.nick)} ${m.online ? '🟢' : ''}`, `${ROLES[m.role]} · ${esc(rankName(m.rank))}`,
      controls || kick ? `<div class="market-actions">${controls}${kick}</div>` : '');
  }).join('');

  if (leader && F.applications?.length) {
    h += `<h2>Başvurular</h2>` + F.applications.map(a => card(nickLink(a.nick), `${esc(rankName(a.rank))} · ☠ ${a.kills}`,
      `<div class="market-actions"><button class="btn sm primary" data-act="accept" data-id="${esc(a.nick)}">Al</button>
       <button class="btn sm" data-act="reject" data-id="${esc(a.nick)}">Reddet</button></div>`)).join('');
  }

  const here = F.factory_here;
  h += `<h2>Kurşun Fabrikaları</h2>` + (F.factories.length ? F.factories.map(f =>
      card(`🏭 ${esc(f.city)}`, `Fiyat ${money(f.price)} · stok ${f.stock}`)).join('') : `<p class="muted small">Ailenin fabrikası yok.</p>`);
  if (here.mine && treasurer) {
    h += `<div class="form-row"><input id="f-fac-price" type="number" min="2" max="20" placeholder="Buradaki fiyat ($2-20)">
      <button class="btn primary" data-act="facprice">Ayarla</button></div>`;
  } else if (!here.owner) {
    h += card(`${esc(cityName(S.player.city))} fabrikası sahipsiz`, `Kasadan ${money(F.factory_price)}. Satılan her kurşunun parası kasaya girer.`,
      treasurer ? `<button class="btn sm primary" data-act="buyfactory">Satın al</button>` : '');
  } else if (!here.mine) {
    h += `<p class="muted small">${esc(cityName(S.player.city))} fabrikası ${esc(here.owner)} ailesinin.</p>`;
  }
  h += spotsSection(role);
  h += `<p style="margin-top:20px"><button class="btn" data-act="leave">${isDon && F.members.length === 1 ? 'Aileyi dağıt' : 'Aileden ayrıl'}</button></p>`;
  return h;
}

// Bütün şehirlerdeki mekânların özeti (baskın için haritadaki binaya dokunulur)
function spotsSection(role) {
  const list = extra.spots?.spots;
  if (!list) return '';
  const mine = list.filter(s => s.mine);
  let h = `<h2>Mekânlar</h2><p class="muted small">Mekân sahibi aile her saat haraç toplar (24 saate kadar birikir). Baskın ve tahkim için
    Şehir haritasında mekânın binasına dokun.</p>`;
  if (role) h += mine.length ? mine.map(s => card(`${SPOT_EMOJI[s.kind]} ${esc(s.name)}`,
      `${esc(cityName(s.city))} · ${money(s.income)}/saat · savunma ${s.defense}`)).join('')
    : `<p class="muted small">Ailenin mekânı yok.</p>`;
  h += `<details><summary class="muted small">Bütün mekânlar (${list.length})</summary>${list.map(sp =>
    `<p class="small">${SPOT_EMOJI[sp.kind]} ${esc(sp.name)} · ${esc(cityName(sp.city))} · ${sp.owner ? esc(sp.owner) : 'sahipsiz'}${sp.mine ? ' ✓' : ''}</p>`).join('')}</details>`;
  return h;
}

// ═════════════════ DEFTER ═════════════════
const BADGE = { itibar: 'İtibar', infaz: 'İnfaz', servet: 'Servet', aile: 'Aile' };
const MEDAL = ['', '🥇', '🥈', '🥉'];
const badgeList = (bs) => bs.map(b => `<span class="badge">${MEDAL[b.place]} ${esc(b.season)} · ${BADGE[b.category]}</span>`).join(' ');

function seasonSection() {
  const X = extra.season;
  if (!X) return '';
  const secs = left(X.ends_at);
  const days = Math.floor(secs / 86400);
  let h = `<h2>${esc(X.name)}</h2>
    <div class="season-box"><div class="season-count">${days > 0 ? `${days} gün ${Math.floor(secs % 86400 / 3600)} saat` : fmt(secs)}</div>
    <div class="muted small">sonra sezon biter: ilk 3'e girenler kalıcı rozet alır, sonra herkes sıfırdan başlar.</div></div>`;
  if (X.badges.length) h += `<p class="small">Rozetlerin: ${badgeList(X.badges)}</p>`;
  if (X.last) {
    h += `<details><summary class="muted small">${esc(X.last.name)} şeref listesi</summary>` +
      Object.entries(BADGE).map(([k, label]) => X.last.results?.[k] ? `<p class="small"><b>${label}:</b> ${X.last.results[k].slice(0, 3)
        .map(r => `${MEDAL[r.place]} ${esc(r.name)}`).join(' · ')}</p>` : '').join('') + `</details>`;
  }
  return h;
}

function messagesSection() {
  if (extra.conv) {
    return `<h2>${esc(extra.conv)}</h2>
      <p><button class="btn sm" data-act="closeconv">← Gelen kutusu</button></p>
      <div class="chat" id="dm">${extra.convMsgs.map(m => `<div class="${m.mine ? 'me' : ''}">${esc(m.text)}${!m.mine
        ? ` <a class="flag" data-report="message" data-id="${m.id}" title="Şikâyet et">⚑</a>` : ''}</div>`).join('') || '<div class="muted small">Henüz mesaj yok.</div>'}</div>
      <form class="form-row" id="dm-form"><input id="f-dm" maxlength="500" placeholder="Mesaj yaz…" autocomplete="off">
        <button class="btn primary">Gönder</button></form>`;
  }
  return `<h2>Mesajlar${S.player.unread ? ` (${S.player.unread} yeni)` : ''}</h2>` +
    (extra.inbox.length ? extra.inbox.map(c => `<div class="card clickable" data-act="openconv" data-id="${esc(c.nick)}">
      <div class="grow"><div class="title">${esc(c.nick)} ${c.unread > 0 ? `<span class="pill">${c.unread}</span>` : ''}</div>
      <div class="muted small ellipsis">${esc(c.last)}</div></div></div>`).join('')
      : `<p class="muted small">Mesaj yok. Birine yazmak için profiline dokun.</p>`);
}

function logTab() {
  const p = S.player, pl = extra.players;
  return (p.is_admin ? `<a class="admin-link" href="admin.html">🛡 Yönetim paneli</a>` : '') +
    seasonSection() + messagesSection() +
    (p.proposals.length ? `<h2>Evlenme Teklifleri</h2>` + p.proposals.map(n => card(nickLink(n), 'sana evlenme teklif etti',
      `<button class="btn sm primary" data-act="acceptprop" data-id="${esc(n)}">Kabul et</button>`)).join('') : '') +
    `<h2>Sicil</h2>
    <p class="small">💍 ${p.spouse ? `${esc(p.spouse)} ile evli <a class="flag" data-act="divorce">boşan</a>` : 'bekâr'} ·
      🤝 saygı ${p.respect} (bu hafta verebileceğin: ${p.respect_left})</p>
    <p class="small">☠ ${p.kills} öldürme · ⚰ ${p.deaths} ölüm · 🔓 ${p.busts} kurtarma · 🎯 nişancılık ${p.kill_skill}</p>` +
    (pl ? `<h2>Çevrimiçi (${pl.online.length})</h2><p class="small">${pl.online.map(o => nickLink(o.nick)).join(' · ') || '—'}</p>
      <h2>En Büyükler</h2><ol class="top">${pl.top.map(t => `<li>${nickLink(t.nick)} <span class="muted small">${esc(rankName(t.rank))} · ☠ ${t.kills}</span></li>`).join('')}</ol>` : '') +
    `<h2>Olaylar</h2><ul class="log">` + S.events.map(e =>
      `<li>${esc(e.text)}<time>${new Date(e.at).toLocaleString('tr-TR')}</time></li>`).join('') + `</ul>` +
    (api.mode === 'local' ? `<p class="muted small" style="margin-top:24px">Yerel geliştirme modu.
      <button class="btn sm" data-act="reset">Yerel veriyi sıfırla</button></p>` : '');
}

// ═════════════════ PROFİL ═════════════════
async function showProfile(nick) {
  const pr = await api.rpc('get_profile', { p_nick: nick });
  if (!pr) return toast('Böyle biri yok.', 'bad');
  const self = pr.nick === S.player.nick;
  $('#modal-body').innerHTML = `${portrait(pr.avatar, 'portrait-lg')}<div class="logo-sm">${esc(pr.nick)}</div>
    <p>${esc(rankName(pr.rank))} ${pr.online ? '· 🟢 çevrimiçi' : ''}</p>
    ${pr.family ? `<p class="small">${esc(ROLES[pr.family_role])} · ${esc(pr.family)}</p>` : ''}
    <p class="small">Durum: ${esc(pr.status)}${pr.protected ? ' · 🛡 çaylak koruması' : ''}</p>
    ${pr.bounty > 0 ? `<p class="small">🎯 Başına ödül: <b class="cash-sm">${money(pr.bounty)}</b></p>` : ''}
    <p class="small">☠ ${pr.kills} öldürme · ⚰ ${pr.deaths} ölüm · 🔓 ${pr.busts} kurtarma</p>
    ${pr.protected ? '' : `<p class="small muted">Tahmini gereken kurşun: ~${pr.est_bullets} (korumalar ve silah hariç)</p>`}
    ${pr.spouse ? `<p class="small">💍 ${esc(pr.spouse)} ile evli</p>` : ''}
    ${pr.badges?.length ? `<p class="small">${badgeList(pr.badges)}</p>` : ''}
    <p class="small muted">🤝 saygı ${pr.respect} · 🏁 yarış formu ${pr.race_form} · katılış ${new Date(pr.joined).toLocaleDateString('tr-TR')}</p>
    ${self ? `<h2>Portreni değiştir</h2><div class="portrait-grid">${Array.from({ length: 8 }, (_, i) =>
        `<button data-avatar="${i + 1}" class="${pr.avatar === i + 1 ? 'on' : ''}">${img(`portraits/p${i + 1}`, '', PORTRAIT_EMOJI[i])}</button>`).join('')}</div>`
    : `<div class="profile-actions">
      <button class="btn sm primary" data-act="dmto" data-id="${esc(pr.nick)}">✉ Mesaj</button>
      <button class="btn sm" data-act="respect" data-id="${esc(pr.nick)}" ${dis(!S.player.respect_left)}>🤝 Saygı</button>
      ${!S.player.spouse && !pr.spouse ? (pr.proposed_to_me
        ? `<button class="btn sm" data-act="acceptprop" data-id="${esc(pr.nick)}">💍 Kabul et</button>`
        : `<button class="btn sm" data-act="propose" data-id="${esc(pr.nick)}">💍 Teklif</button>`) : ''}
      <button class="btn sm" data-act="${pr.blocked ? 'unblock' : 'block'}" data-id="${esc(pr.nick)}">${pr.blocked ? 'Engeli kaldır' : '🚫 Engelle'}</button>
      <button class="btn sm" data-act="reportplayer" data-id="${esc(pr.nick)}">⚑ Şikâyet</button>
    </div>`}`;
  $('#modal').classList.remove('hidden');
}

// ═════════════════ SAYAÇLAR ═════════════════
// Bir süre dolduğu an butonlar açılsın diye sekmeyi/paneli yeniden çizer
let lastReady = '';
function tick() {
  if (!S?.player) return;
  const p = S.player;
  const timed = [p.crime_ready_at, p.car_ready_at, p.travel_ready_at, p.jail_until, p.hospital_until, p.hideout_until,
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
  const j = left(p.jail_until), h = left(p.hospital_until), hid = left(p.hideout_until);
  $('#jail').classList.toggle('hidden', !j && !h && !hid);
  if (j) $('#jail').textContent = `⛓ Hapistesin — ${fmt(j)}`;
  else if (h) $('#jail').textContent = `🏥 Hastanedesin — ${fmt(h)}`;
  else if (hid) $('#jail').textContent = `🕳 Sığınaktasın — ${fmt(hid)}`;
}
setInterval(tick, 1000);

// ═════════════════ ETKİLEŞİM ═════════════════
const val = (id) => $('#' + id)?.value.trim() ?? '';
const num = (id) => parseInt(val(id), 10) || 0;
const closeModal = () => $('#modal').classList.add('hidden');

async function openConv(nick) {
  extra.conv = nick;
  closePanel();
  if (tab !== 'log') return $('[data-go="log"]').click();
  await refresh(); scrollChat();
}

document.addEventListener('click', async (e) => {
  if (e.target.closest('#modal-close') || e.target.id === 'modal') return closeModal();
  if (e.target.closest('[data-close-sheet]') || e.target.id === 'sheet') return closePanel();

  const pick = e.target.closest('[data-pick]');
  if (pick) { pickedAvatar = +pick.dataset.pick; return renderOnboard(); }
  const av = e.target.closest('[data-avatar]');
  if (av) { await api.rpc('set_avatar', { p_avatar: +av.dataset.avatar }); closeModal(); return refresh(); }
  if (e.target.closest('[data-me]')) return showProfile(S.player.nick);
  const prof = e.target.closest('[data-profile]');
  if (prof) return showProfile(prof.dataset.profile);
  const open = e.target.closest('[data-open]');
  if (open) return openPanel(open.dataset.open);
  const rep = e.target.closest('[data-report]');
  if (rep) {
    const reason = prompt('Neden şikâyet ediyorsun? (hakaret, taciz, dolandırıcılık…)');
    if (reason !== null) act('report_content', { p_kind: rep.dataset.report, p_ref: +rep.dataset.id, p_nick: null, p_reason: reason });
    return;
  }

  const nav = e.target.closest('[data-go]');
  if (nav) {
    tab = nav.dataset.go;
    closePanel();
    document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b === nav));
    document.querySelectorAll('main section').forEach(s => s.classList.toggle('hidden', s.dataset.tab !== tab));
    renderTab();
    refresh().then(scrollChat);
    return;
  }
  const q = e.target.closest('[data-qty]');
  if (q) { qty = q.dataset.qty === 'max' ? 'max' : +q.dataset.qty; renderSheet(); return; }

  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const id = b.dataset.id, n = +b.dataset.n;
  switch (b.dataset.act) {
    // işler, araba, ticaret
    case 'crime':      return act('do_crime', { p_crime: id }, { art: true });
    case 'car':        return act('steal_car', {}, { art: true });
    case 'sell':       return act('sell_car', { p_car_id: +id });
    case 'crush':      return confirm('Araba hurdaya gitsin mi?') && act('crush_car', { p_car_id: +id });
    case 'buy':        return act('trade', { p_good: id, p_qty: n });
    case 'sellg':      return act('trade', { p_good: id, p_qty: -n });
    case 'travel':     closePanel(); return act('travel', { p_city: id });
    case 'transport':  return act('buy_transport', { p_id: id });
    // silah, savaş
    case 'bullets':    return num('f-bullets') > 0 && act('buy_bullets', { p_qty: num('f-bullets') });
    case 'weapon':     return act('buy_weapon', { p_weapon: id });
    case 'bodyguard':  return act('hire_bodyguard');
    case 'practice':   return act('practice');
    case 'detectives': return val('f-target') && act('hire_detectives', { p_nick: val('f-target'), p_count: num('f-dets') });
    case 'shoot':
      if (num('f-shoot-bullets') > 0 && confirm(`${val('f-shoot-target')} üzerine ${num('f-shoot-bullets')} kurşun sıkılsın mı?`)) {
        return act('shoot', { p_nick: val('f-shoot-target'), p_bullets: num('f-shoot-bullets') }, { art: true });
      }
      return;
    case 'bounty':     return val('f-bounty-nick') && num('f-bounty-amt') > 0 &&
                         act('place_bounty', { p_nick: val('f-bounty-nick'), p_amount: num('f-bounty-amt') });
    // şehir binaları
    case 'bust':       return act('bust', { p_nick: id }, { art: true });
    case 'selfbust':   return act('self_bust', {}, { art: true });
    case 'heal':       return act('heal');
    case 'deposit':    return num('f-bank') > 0 && act('bank_move', { p_amount: num('f-bank') });
    case 'withdraw':   return num('f-bank') > 0 && act('bank_move', { p_amount: -num('f-bank') });
    case 'send':       return val('f-send-nick') && num('f-send-amt') > 0 &&
                         act('send_money', { p_nick: val('f-send-nick'), p_amount: num('f-send-amt') });
    case 'hide':       return confirm('Sığınağa girilsin mi?') && act('enter_hideout', { p_hours: num('f-hide-h') });
    case 'leavehide':  return act('leave_hideout');
    case 'raid':       return num('f-raid-' + id) > 0 && confirm('Baskın başlasın mı? Kurşunlar geri gelmez.') &&
                         act('raid_spot', { p_spot: +id, p_bullets: num('f-raid-' + id) }, { art: true });
    case 'fortify':    return num('f-fort-' + id) > 0 && act('fortify_spot', { p_spot: +id, p_bullets: num('f-fort-' + id) });
    // pazar
    case 'listbullets': return num('f-sell-bullets') > 0 && num('f-sell-bprice') > 0 &&
                          act('list_item', { p_kind: 'bullets', p_qty: num('f-sell-bullets'), p_car: null, p_price: num('f-sell-bprice') });
    case 'listcar':    return num('f-sell-cprice') > 0 &&
                         act('list_item', { p_kind: 'car', p_qty: null, p_car: num('f-sell-car'), p_price: num('f-sell-cprice') });
    case 'unlist':     return act('cancel_listing', { p_id: +id });
    case 'buylisting': return confirm('Satın alınsın mı?') && act('buy_listing', { p_id: +id });
    // yarış
    case 'racecreate': return num('f-race-fee') > 0 && act('create_race', { p_fee: num('f-race-fee'), p_car: num('f-race-car') });
    case 'racejoin':   return act('join_race', { p_race: +id, p_car: num('f-race-car-' + id) });
    case 'racestart':  return act('start_race', {}, { art: 'results/yaris' });
    case 'raceleave':  return act('leave_race');
    // ekip işleri
    case 'crewcreate': {
      const t = extra.crews.types.find(x => x.id === id), invites = {};
      for (const r of t.roles.slice(1)) invites[r] = val(`f-crew-${id}-${r}`);
      if (Object.values(invites).some(v => !v)) return toast('Bütün rollere birini yaz.', 'bad');
      return act('create_crew', { p_type: id, p_invites: invites });
    }
    case 'crewyes':    return act('respond_crew', { p_crew: +id, p_accept: true });
    case 'crewno':     return act('respond_crew', { p_crew: +id, p_accept: false });
    case 'crewstart':  return act('start_crew', {}, { art: true });
    case 'crewcancel': return act('cancel_crew');
    // aile
    case 'createfam':  return val('f-fam-name') && act('create_family', { p_name: val('f-fam-name') });
    case 'apply':      return act('apply_family', { p_name: id });
    case 'cancelapp':  return act('cancel_application');
    case 'accept':     return act('answer_application', { p_nick: id, p_accept: true });
    case 'reject':     return act('answer_application', { p_nick: id, p_accept: false });
    case 'kick':       return confirm(`${id} aileden atılsın mı?`) && act('kick_member', { p_nick: id });
    case 'famdeposit': return num('f-fam-dep') > 0 && act('family_deposit', { p_amount: num('f-fam-dep') });
    case 'fampay':     return val('f-pay-nick') && num('f-pay-amt') > 0 &&
                         act('family_pay', { p_nick: val('f-pay-nick'), p_amount: num('f-pay-amt') });
    case 'buyfactory': return confirm('Fabrika kasadan satın alınsın mı?') && act('buy_factory');
    case 'facprice':   return num('f-fac-price') > 0 && act('set_factory_price', { p_price: num('f-fac-price') });
    case 'leave':      return confirm('Emin misin?') && act('leave_family');
    // sosyal
    case 'dmto':       closeModal(); return openConv(id);
    case 'openconv':   return openConv(id);
    case 'closeconv':  extra.conv = null; return refresh();
    case 'respect': {
      const pts = parseInt(prompt(`${id} kişisine kaç saygı puanı? (kalan: ${S.player.respect_left})`, '1'), 10);
      if (pts > 0) { closeModal(); return act('give_respect', { p_nick: id, p_points: pts }); }
      return;
    }
    case 'block':      closeModal(); return confirm(`${id} engellensin mi? Mesajlarını görmezsin.`) && act('block_player', { p_nick: id });
    case 'unblock':    closeModal(); return act('unblock_player', { p_nick: id });
    case 'reportplayer': {
      const reason = prompt('Neden şikâyet ediyorsun?');
      if (reason !== null) { closeModal(); return act('report_content', { p_kind: 'player', p_ref: null, p_nick: id, p_reason: reason }); }
      return;
    }
    case 'propose':    closeModal(); return confirm(`${id} kişisine evlenme teklif edilsin mi? Kabul ederse düğün masrafı ($${S.settings.marriage_cost}) senden çıkar.`) && act('propose', { p_nick: id });
    case 'acceptprop': closeModal(); return act('accept_proposal', { p_nick: id });
    case 'divorce':    return confirm('Boşanmak istediğine emin misin?') && act('divorce');
    // kumarhane
    case 'lottery':    return act('buy_lottery', { p_qty: num('f-lot-n') });
    case 'scratch':    return act('scratch_card');
    case 'casino': case 'bjstart': case 'bjhit': case 'bjstand': return playCasino(b);
    case 'reset':
      if (confirm('Yerel oyun verisi silinsin mi?')) { await api.reset(); location.reload(); }
  }
});

// Kumarhane: sonucu panelde gösterir, bahis kutusu dolu kalır (aynı bahisle tekrar oynansın)
async function playCasino(b) {
  if (busy) return;
  const a = b.dataset.act, bet = num('f-bet');
  if ((a === 'casino' || a === 'bjstart') && bet < 10) return toast('Önce bahsini yaz (en az $10).', 'bad');
  let choice = b.dataset.choice || null;
  if (choice === 'num') { if (val('f-rulet-n') === '') return toast('0-36 arası bir sayı yaz.', 'bad'); choice = String(num('f-rulet-n')); }
  busy = true;
  try {
    const r = a === 'casino' ? await api.rpc('play_casino', { p_game: b.dataset.game, p_bet: bet, p_choice: choice })
      : a === 'bjstart' ? await api.rpc('bj_start', { p_bet: bet })
      : await api.rpc(a === 'bjhit' ? 'bj_hit' : 'bj_stand');
    if (!r.ok) toast(r.msg, 'bad');
    else if (a === 'casino') extra.casino = r;
    else extra.bj = r;
    S = await api.rpc('get_state'); render();
    if ($('#f-bet')) $('#f-bet').value = bet;
  } finally { busy = false; }
}

document.addEventListener('change', (e) => {
  const sel = e.target.closest('[data-role]');
  if (!sel) return;
  if (sel.value === 'don' && !confirm(`Donluk devredilsin mi? Yeni Don: ${sel.dataset.role}. Sen Sottocapo olursun.`)) return renderTab();
  act('set_role', { p_nick: sel.dataset.role, p_role: sel.value });
});

document.addEventListener('submit', async (e) => {
  if (e.target.id === 'dm-form') {
    e.preventDefault();
    const text = val('f-dm');
    if (!text) return;
    const r = await api.rpc('send_message', { p_nick: extra.conv, p_text: text });
    if (!r.ok) return toast(r.msg, 'bad');
    $('#f-dm').value = '';
    extra.convMsgs = await api.rpc('get_conversation', { p_nick: extra.conv });
    renderTab(); scrollChat();
  } else if (e.target.id === 'chat-form') {
    e.preventDefault();
    const text = val('f-chat');
    if (!text) return;
    const r = await api.rpc('post_family_message', { p_text: text });
    if (!r.ok) return toast(r.msg, 'bad');
    $('#f-chat').value = '';
    await loadFamily(); renderTab(); scrollChat();
  } else if (e.target.id === 'nick-form') {
    e.preventDefault();
    const r = await api.rpc('create_player', { p_nick: $('#nick').value.trim() });
    if (!r.ok) { $('#nick-err').textContent = r.msg; return; }
    await api.rpc('set_avatar', { p_avatar: pickedAvatar });
    await refresh();
  }
});

const scrollChat = () => { for (const c of [$('#chat'), $('#dm')]) if (c) c.scrollTop = c.scrollHeight; };
// Aile sohbeti ya da özel mesaj açıkken 10 sn'de bir tazele (yazarken bölme)
setInterval(async () => {
  if (document.hidden || !S?.player) return;
  if (tab === 'family' && extra.family?.family) {
    if ($('#f-chat') === document.activeElement && val('f-chat')) return;
    await loadFamily();
  } else if (tab === 'log' && extra.conv) {
    if ($('#f-dm') === document.activeElement && val('f-dm')) return;
    extra.convMsgs = await api.rpc('get_conversation', { p_nick: extra.conv });
  } else return;
  renderTab(); scrollChat();
}, 10000);

// Uygulama arka plandan dönünce durumu tazele
document.addEventListener('visibilitychange', () => { if (!document.hidden && api) refresh(); });

try {
  [api] = await Promise.all([createBackend(), probeAssets()]);
  if (api.mode === 'local') Object.assign(window, { devApi: api, devRefresh: refresh });
  await refresh();
} catch (e) {
  console.error(e);
  $('#loading').innerHTML = `<div class="logo">KABADAYI</div><p class="err">Sunucuya bağlanılamadı.</p>`;
}
