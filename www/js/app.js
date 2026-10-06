import { createBackend } from './backend.js';
import { probeAssets, img, hasAsset, assetUrl, ico } from './assets.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
import { money, moneyText, richText } from './locale.js';
import { sfx, setAudio, audioSettings } from './audio.js';
import { pushState, enablePush, disablePush, registerSW } from './push.js';

let api, S, clockOffset = 0, busy = false, tab = 'city', panel = null, qty = 1, pickedAvatar = 1, pickedGender = null;
// Portreler: 1–4 erkek, 5–8 kadın
const premiumAvatars = (g) => g === 'k' ? [13, 14, 15, 16] : g === 'e' ? [9, 10, 11, 12] : [];
const genderAvatars = (g) => g === 'k' ? [5, 6, 7, 8] : g === 'e' ? [1, 2, 3, 4] : [1, 2, 3, 4, 5, 6, 7, 8];
// sekmeye / panele girince çekilen listeler
const extra = { jail: [], players: null, family: null, families: [], hitlist: [], crews: null, casino: null,
  inbox: [], conv: null, convMsgs: [], spots: null, races: null, lottery: null, market: [], bj: null, season: null };

// Sunucu saatine göre kalan saniye (telefon saati yanlış olsa da doğru sayar)
const left = (iso) => Math.max(0, Math.ceil((new Date(iso) - (Date.now() + clockOffset)) / 1000));
const fmt = (s) => s >= 3600 ? `${Math.floor(s / 3600)} sa ${Math.floor(s % 3600 / 60)} dk` : s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} sn`;

// ─────────────── Veri ───────────────
async function refresh() {
  // açık konuşmayı önce oku ki okunmamış sayacı doğru gelsin
  if (S?.player && tab === 'chat' && chatCh === 'dm' && extra.conv) extra.convMsgs = await api.rpc('get_conversation', { p_nick: extra.conv });
  S = await api.rpc('get_state');
  if (S.player) {
    clockOffset = new Date(S.now) - Date.now();
    await Promise.all([loadTabData(), loadPanelData()]);
  }
  render();
}

async function loadTabData() {
  const rpc = api.rpc;
  if (tab === 'city') [extra.spots, extra.events] = await Promise.all([rpc('get_spots'), rpc('get_events')]);
  else if (tab === 'log') [extra.players, extra.season, extra.penalties, extra.events] = await Promise.all([rpc('get_players'), rpc('get_season'), rpc('my_penalties'), rpc('get_events')]);
  if (tab === 'log') [extra.friends, extra.men, extra.famRank, extra.account] = await Promise.all([rpc('get_friends'), rpc('get_men'), rpc('get_families'),
    api.account ? api.account().catch(() => null) : null]);
  else if (tab === 'family') { await loadFamily(); extra.spots = await rpc('get_spots'); }
  else if (tab === 'crime') extra.crews = await rpc('get_crews');
  else if (tab === 'chat') await loadChat();
}

// Sohbet sekmesi: genel, şehir, aile kanalı ya da özel mesajlar (dm)
let chatCh = 'global';
async function loadChat() {
  if (chatCh === 'dm') {
    [extra.inbox, extra.convMsgs] = await Promise.all([api.rpc('get_inbox'), extra.conv ? api.rpc('get_conversation', { p_nick: extra.conv }) : []]);
    return;
  }
  if (chatCh === 'family') { await loadFamily(); if (!extra.family?.family) chatCh = 'global'; else return; }
  extra.chat = await api.rpc('get_chat', { p_channel: chatCh });
}

async function loadPanelData() {
  if (!panel) return;
  const rpc = api.rpc, kind = panel.startsWith('spot:') ? 'spot' : panel;
  if (kind === 'karakol') extra.jail = await rpc('get_jail');
  else if (kind === 'dedektif') {
    extra.hitlist = await rpc('get_hitlist');
    const first = S.searches.find(s => s.resolved && s.success && s.city === S.player.city);
    if (first) loadShootPrev(first.target);
  }
  else if (kind === 'garaj') extra.races = await rpc('get_races');
  else if (kind === 'carsi') extra.market = await rpc('get_market');
  else if (kind === 'kahvehane' || kind === 'konak') extra.men = await rpc('get_men');
  else if (kind === 'spot') {
    [extra.spots, extra.lottery, extra.bj, extra.men] = await Promise.all([rpc('get_spots'), rpc('get_lottery'), rpc('bj_current'), rpc('get_men')]);
    const id = +panel.split(':')[1], sp = extra.spots.spots.find(x => x.id === id);
    if (sp && !sp.mine && S.player.family_role) loadRaidPrev(id, num('f-raid-' + id));
  }
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

// Sonuç sesi: yakalandıysa hücre demiri, firar ettiyse kapı, başarısızsa yumruk, başarıda para kesesi
function resultSfx(name, r, args = {}) {
  if (r.jailed || /içeri alındı/.test(r.msg || '')) return sfx.jailed();
  if (name === 'self_bust' && r.ok !== false && r.success !== false) return sfx.escape();
  if (r.success === false) return sfx.fail();
  if (r.ok === false) return sfx.error();
  if (name === 'apply_family' || name === 'hire_man' || name === 'friend_request') return sfx.click();
  if (name === 'trade') return args.p_qty > 0 ? sfx.buy() : sfx.sell();
  if (name === 'travel') return sfx.voyage();
  return /\$\d/.test(r.msg || '') ? sfx.coin() : sfx.success();
}

async function act(name, args, opts = {}) {
  if (busy) return;
  busy = true;
  document.body.style.cursor = 'progress';
  try {
    const r = await api.rpc(name, args);
    if (name === 'shoot' || name === 'raid_spot') sfx.shot();
    setTimeout(() => resultSfx(name, r, args), name === 'shoot' || name === 'raid_spot' ? 300 : 0);
    if (r.seized?.length) showSeized(r);
    else if (r.rounds) showBattle(r);
    else toast(r.msg, r.ok === false || r.success === false ? 'bad' : 'good', opts.art ? (opts.art === true ? resultArt(r) : opts.art) : null);
    // başarılı işlemden sonra tutar/isim kutuları boşalsın (seçim kutuları kalsın)
    if (r.ok !== false) document.querySelectorAll(`section[data-tab="${tab}"] input, #sheet-body input`).forEach(i => i.value = '');
    await refresh();
    setSince(S.now);   // kendi işlemimizin olayları üstten tekrar bildirilmesin
  } catch (e) {
    console.error(e);
    if (/BANNED/.test(e.message)) await refresh();
    else toast('Bağlantı sorunu, tekrar dene.', 'bad');
  } finally {
    busy = false;
    document.body.style.cursor = '';
  }
}

// Baskın: tur tur savaş raporu
function showBattle(r) {
  $('#modal-body').innerHTML = `${img(r.success ? 'results/basari' : 'results/kacti', 'seized-art', '')}
    <div class="logo-sm">${r.success ? 'Mekân senin!' : 'Püskürtüldün'}</div>
    <p class="small">${richText(r.msg)}</p>
    <p class="muted small">Senin tarafın: ${r.att_men} adam · Karşı taraf: ${r.def_men} adam${r.wall ? ' + barikat' : ''}</p>
    <div class="battle">${r.rounds.map(x => `<div class="b-round"><b>${x.round}. tur</b>
      <span class="${x.att_lost ? 'bad' : ''}">Sen: −${x.att_lost}</span><span class="${x.def_lost ? 'good' : ''}">Onlar: −${x.def_lost}</span>
      ${x.wall ? '<em>barikat yıkık</em>' : ''}</div>`).join('')}</div>`;
  $('#modal').classList.remove('hidden');
  navigator.vibrate?.(r.success ? [40, 60, 40, 60, 120] : [200]);
}

// Onay penceresi: ask('Başlık', 'metin', 'Evet') → true/false (tarayıcının confirm'ü bazı telefonlarda açılmıyor)
const askYes = (text) => ask('Emin misin?', esc(text), 'Evet');
let askResolve = null;
function ask(title, text, okLabel = 'Evet', art = '') {
  return new Promise(res => {
    askResolve = res;
    $('#modal-body').innerHTML = `${art}<div class="logo-sm">${title}</div><p class="small">${text}</p>
      <div class="ask-actions"><button class="btn primary" data-ask="1">${okLabel}</button><button class="btn" data-ask="0">Vazgeç</button></div>`;
    $('#modal').classList.add('asking');
    $('#modal').classList.remove('hidden');
  });
}

// Gümrük baskını: el konan mallar ayrı pencerede
function showSeized(r) {
  $('#modal-body').innerHTML = `${img('results/gumruk', 'seized-art', img('rehber/liman', 'seized-art', '<div class="seized-art emoji">🛃</div>'))}
    <div class="logo-sm">Gümrük baskını!</div>
    <p class="small">${richText(r.msg)}</p>
    <div class="seized">${r.seized.map(x => `<div class="card">${icon('g_' + x.good, GOOD_EMOJI[x.good] || '📦')}
      <div class="grow"><div class="title">${esc(x.name)}</div><div class="muted small">${x.qty} kasaya el konuldu</div></div></div>`).join('')}</div>
    <p class="muted small">Kalan malın seninle. Gümrük her kaçak yolculukta %${Math.round(S.settings.customs_chance * 100)} ihtimalle yoklar.</p>`;
  $('#modal').classList.remove('hidden');
  navigator.vibrate?.([200]);
}

// Başına gelenler (oyunda olmadığın an da olabilir): vurulma, infaz, mekâna baskın → gümrükteki gibi ayrı pencere.
// Olay metinlerinden tanınır (002 shoot, 021 adam kaybı, 023 baskın duyuruları).
const ALERTS = [
  { re: /seni \d+ kurşunla indirdi/, rank: 4, art: 'results/infaz', alt: 'results/vuruldu', emoji: '⚰️', title: 'İnfaz edildin!',
    foot: 'Hastanedesin; iyileşince sokaklara dönersin. Fedailer ve korumalar seni vurmayı zorlaştırır.' },
  { re: /elimizden çıktı/, rank: 3, art: 'results/mekan_dustu', emoji: '🏚', title: 'Mekânımız düştü!',
    foot: 'Mekân yeni sahibinde bir süre korunur; sonra geri almak için baskın yapabilirsiniz.' },
  { re: /sana kurşun yağdırdı/, rank: 2, art: 'results/yaralandi', alt: 'results/vuruldu', emoji: '🩸', title: 'Saldırıya uğradın!',
    foot: "Canın Hastane'de dolar. Boştaki adamların seni vurmayı zorlaştırır." },
  { re: /baskın yaptı ama püskürtüldü/, rank: 1, art: 'results/baskin_puskurtuldu', emoji: '🛡', title: 'Mekânımıza baskın!',
    foot: 'Saldırı püskürtüldü ama savunma kurşunu azaldı; mekânı yeniden tahkim et.' },
];
const SIDE = /Vurulduğun çatışmada \d+ adamını kaybettin/;   // vurulmayla birlikte gelen ek bilgi
// Tanınan olayları pencerede gösterir, kalanları döndürür (toast olarak gösterilsin)
function showAlerts(texts, away = false) {
  const hits = texts.map(t => [t, ALERTS.find(a => a.re.test(t))]).filter(([, a]) => a);
  if (!hits.length || !$('#modal').classList.contains('hidden')) return texts;   // başka pencere açıksa bildirim olarak kalsın
  const [main, a] = hits.reduce((x, y) => y[1].rank > x[1].rank ? y : x);
  const more = texts.filter(t => t !== main && (ALERTS.some(x => x.re.test(t)) || SIDE.test(t)));
  $('#modal-body').innerHTML = `${img(a.art, 'seized-art wide', (a.alt && img(a.alt, 'seized-art', '')) || `<div class="seized-art emoji">${a.emoji}</div>`)}
    ${away ? '<p class="muted small">Sen yokken</p>' : ''}<div class="logo-sm">${a.title}</div>
    <p class="small">${richText(main)}</p>
    ${more.map(t => `<p class="small">${richText(t)}</p>`).join('')}
    <p class="muted small">${a.foot}</p>`;
  $('#modal').classList.remove('hidden');
  sfx.shot(); navigator.vibrate?.([200, 100, 200]);
  return texts.filter(t => t !== main && !more.includes(t));
}

// Bildirimler üst üste dizilir: en yenisi altta, en fazla 3 tane; her biri kendi süresinde kaybolur, dokununca kapanır
function toast(msg, kind, art) {
  const box = $('#toast'), t = document.createElement('div');
  t.className = 'toast ' + (kind || '');
  t.innerHTML = (art && hasAsset(art) ? `<img src="${assetUrl(art)}" alt="">` : '') + `<span>${richText(msg)}</span>`;
  const close = () => { t.classList.add('out'); setTimeout(() => t.remove(), 200); };
  t.onclick = close;
  box.append(t);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(close, art ? 4200 : 3200);
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
const GOOD_EMOJI = { kahve: '☕', tutun: '🍂', sarap: '🍷', raki: '🥛', konyak: '🥃', viski: '🛢', hali: '🧶', mucevher: '💎', silah_parca: '⚙️' };
// Defter kartlarının simgesi: görsel varsa o, yoksa emoji
const uiIcon = (name, emoji) => img('ico/' + name, 'icon', `<span class="icon emoji">${emoji}</span>`);
// Satır içi küçük görsel (yoksa emoji): profil, sayaçlar
const aic = (path, emoji) => img(path, 'ico', emoji);
// İşlerin her birinin kendi beklemesi var (020); üstteki "İş" çipi: açık işlerden en erken hazır olan
const openCrimes = () => S.crimes.filter(c => S.player.rank >= c.min_rank);
const crimeReadyAt = () => openCrimes().map(c => c.ready_at).sort((a, b) => new Date(a) - new Date(b))[0] ?? S.player.crime_ready_at;
const until = (at) => `<span data-until="${at}">${fmt(left(at))}</span>`;
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
    show('banned');
    api.rpc('my_penalties').then(list => { extra.penalties = list; $('#ban-appeal').innerHTML = penaltiesHtml(list, true); });
    return;
  }
  if (!S.player) { renderOnboard(); show('onboard'); return; }
  show('game');
  if ($('#tutorial').classList.contains('hidden')) showTutorial();
  const p = S.player, rank = S.ranks[p.rank], next = S.ranks[p.rank + 1];
  $('#h-avatar').innerHTML = portrait(p.avatar, 'avatar');
  $('#h-nick').textContent = p.nick;
  $('#h-rank').textContent = rank.name + (next ? ` · ${p.xp}/${next.min_xp}` : ' · zirvede')
    + (p.family ? ` · ${p.family}` : '') + (p.bounty > 0 ? ` · 🎯 ${money(p.bounty)}` : '');
  $('#h-cash').innerHTML = money(p.cash);
  $('#h-city').textContent = '📍 ' + cityName(p.city);
  $('#h-stats').innerHTML = `${ico('can', '❤')} ${p.health} · ${ico('kursun', '🔫')} ${p.bullets} kurşun · ${ico('banka', '🏦')} ${money(p.bank)}`
    + (p.men || p.men_training ? ` · ${ico('uye', '👥')} ${p.men} adam` : '');
  $('#xpbar div').style.width = next ? `${100 * (p.xp - rank.min_xp) / (next.min_xp - rank.min_xp)}%` : '100%';
  $('#xp-next').textContent = next ? `${next.name} · ${(next.min_xp - p.xp).toLocaleString('tr-TR')} itibar kaldı` : 'En yüksek rütbe';
  renderTab();
  tick();
  updateBadges();
}

function show(id) {
  for (const s of ['loading', 'onboard', 'banned', 'game']) $('#' + s).classList.toggle('hidden', s !== id);
}

// Açılışta ad kutusu ekranın altında kalıyor: portreler görünene kadar "aşağı kaydır" oku
let hintWatch;
function watchScrollHint() {
  if (hintWatch) return;
  const hint = $('#scroll-hint'), target = $('#onboard-portraits');
  hintWatch = new IntersectionObserver(([e]) => hint.classList.toggle('gone', e.isIntersecting), { threshold: 0.3 });
  hintWatch.observe(target);
  hint.addEventListener('click', () => target.scrollIntoView({ behavior: 'smooth', block: 'center' }));
}

function renderOnboard() {
  watchScrollHint();
  $('#onboard-art').innerHTML = img('ui/splash', 'splash-art', '');
  $('#onboard-login').innerHTML = api?.loginEmail ? `<button type="button" class="btn sm" data-act="acctlogin">Zaten karakterin var mı? E-postanla gir</button>` : '';
  $('#onboard-gender').innerHTML = [['e', 'Erkek'], ['k', 'Kadın']].map(([g, label]) =>
    `<button type="button" data-gender="${g}" class="btn ${pickedGender === g ? 'primary' : ''}">${label}</button>`).join('');
  $('#onboard-portraits').innerHTML = pickedGender ? genderAvatars(pickedGender).map(n =>
    `<button type="button" data-pick="${n}" class="${pickedAvatar === n ? 'on' : ''}">${img(`portraits/p${n}`, '', PORTRAIT_EMOJI[n - 1])}</button>`).join('')
    : '<p class="muted small" style="grid-column:1/-1;text-align:center;margin:8px 0">Önce cinsiyetini seç; portreler ona göre açılır.</p>';
}

// Yeniden çizimde yazılan input değerleri kaybolmasın
function keepInputs(el, fn) {
  const keep = {};
  el.querySelectorAll('input[id], select[id]').forEach(i => keep[i.id] = i.value);
  const open = [...el.querySelectorAll('details[id][open]')].map(d => d.id);
  // sohbet kutuları: en alttaysa altta kalsın, okurken yukarıdaysa yerinde dursun
  const scroll = [...el.querySelectorAll('#chat, #dm')].map(c => [c.id, c.scrollTop, c.scrollHeight - c.scrollTop - c.clientHeight < 40]);
  const focus = el.contains(document.activeElement) && document.activeElement.id;
  el.innerHTML = fn();
  for (const [id, v] of Object.entries(keep)) { const i = el.querySelector('#' + id); if (i) i.value = v; }
  for (const id of open) { const d = el.querySelector('#' + id); if (d) d.open = true; }
  for (const [id, top, bottom] of scroll) { const c = el.querySelector('#' + id); if (c) c.scrollTop = bottom ? c.scrollHeight : top; }
  if (focus) el.querySelector('#' + focus)?.focus({ preventScroll: true });
}

function renderTab() {
  $('main').classList.toggle('chat-mode', tab === 'chat' && chatCh !== 'dm' || (tab === 'chat' && chatCh === 'dm' && !!extra.conv));
  try { keepInputs($(`section[data-tab="${tab}"]`), ({ city: cityTab, crime: crimeTab, family: familyTab, chat: chatTab, log: logTab })[tab]); }
  catch (e) { console.error('sekme çizimi', e); }   // sekmede bir hata açık paneli kilitlemesin
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
  kahvehane:{ name: 'Kahvehane',        emoji: '☕' },
  bos:      { name: 'Boş Dükkân',       emoji: '🏚' },
  konak:    { name: 'Konağın',          emoji: '🏛' },
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
  ['konak', 'kahvehane', 'bos'],
];

// Süsler: her sokağa bir set. x = sokak genişliğinin %'si (parçanın ortası; 33/67 bina araları),
// top = duvardaki yükseklik (px), yoksa kaldırıma basar; h = boy (px). Duvardakiler binaların arkasında kalır.
const DECOR = [
  [{ d: 'sarmasik', x: 3, top: 0, h: 46 }, { d: 'afis', x: 66.6, top: 26, h: 34 }, { d: 'kedi', x: 33.4, h: 22 }],
  [{ d: 'sarmasik', x: 97, top: 0, h: 44 }, { d: 'kasa', x: 33.4, h: 28 }],
  [{ d: 'afis', x: 33.4, top: 24, h: 32 }, { d: 'fici', x: 66.6, h: 26 }, { d: 'boyaci', x: 3, h: 20 }],
  [{ d: 'sarmasik', x: 66.6, top: 0, h: 40 }, { d: 'incir', x: 33.4, h: 42 }],
];
const CITY_ORDER = ['istanbul', 'izmir', 'selanik', 'pire', 'iskenderiye', 'beyrut'];

function decorHtml(set) {
  return set.filter(o => hasAsset('decor/' + o.d)).map(o => {
    const pos = o.top != null ? `top:${o.top}px` : 'bottom:27px';
    return `<img class="decor ${o.top != null ? 'wall' : 'ground'}" src="${assetUrl('decor/' + o.d)}" alt="" draggable="false" style="left:${o.x}%;${pos};height:${o.h}px">`;
  }).join('');
}

function buildingHtml(id, asset, emoji, name, tagHtml = '') {
  return `<div class="bld" data-open="${id}">${tagHtml}
    <div class="bld-art">${img(asset, '', `<div class="ph">${emoji}</div>`)}</div><div class="plate">${esc(name)}</div></div>`;
}

function cityTab() {
  const p = S.player, jailed = left(p.jail_until) > 0;
  const spots = (extra.spots?.spots || []).filter(s => s.city === p.city)
    .sort((x, y) => SPOT_ORDER.indexOf(x.kind) - SPOT_ORDER.indexOf(y.kind));
  let si = 0, town = '';
  const shift = Math.max(0, CITY_ORDER.indexOf(p.city));   // şehirden şehre süs düzeni değişsin
  for (const [i, street] of STREETS.entries()) {
    town += '<div class="street">' + decorHtml(DECOR[(i + shift) % DECOR.length]);
    for (const slot of street) {
      if (slot === 'spot') {
        const sp = spots[si++];
        if (!sp) { town += '<div class="bld empty"></div>'; continue; }
        const tag = sp.owner ? `<span class="tag ${sp.mine ? 'mine' : ''}">${esc(sp.owner)}</span>` : '<span class="tag ok">Sahipsiz</span>';
        town += buildingHtml('spot:' + sp.id, `buildings/${sp.kind}`, SPOT_EMOJI[sp.kind], sp.name, tag);
      } else if (HOTSPOTS[slot]) {
        const hs = HOTSPOTS[slot];
        // Sığınağın görseli varsa bina gibi, yoksa yuvarlak düğme
        town += hasAsset(`buildings/${slot}`) ? buildingHtml(slot, `buildings/${slot}`, hs.emoji, hs.name)
          : `<div class="bld hs" data-open="${slot}"><div class="bld-art"><div class="dot">${hs.emoji}</div></div><div class="plate">${hs.name}</div></div>`;
      } else {
        const b = BUILDINGS[slot];
        let tag = '';
        if (slot === 'garaj' && !waiting(p.car_ready_at)) tag = '<span class="tag ok">Hazır</span>';
        if (slot === 'karakol' && jailed) tag = '<span class="tag">İçeridesin</span>';
        if (slot === 'hastane' && p.health < 100) tag = `<span class="tag">❤ ${p.health}</span>`;
        if (slot === 'fabrika') tag = `<span class="tag mine">${money(S.factory.price)}</span>`;
        if (slot === 'kahvehane' && p.men_training) tag = `<span class="tag">${p.men_training} eğitimde</span>`;
        town += buildingHtml(slot, `buildings/${slot}`, b.emoji, b.name, tag);
      }
    }
    town += '</div>';
  }
  // Doku görselleri gelince CSS çizimi yerine onlar kullanılır
  const tex = ['kaldirim', 'duvar'].filter(t => hasAsset('tex/' + t)).map(t => `--tex-${t}:url(${new URL(assetUrl('tex/' + t), location.href).href});--${t}-size:${t === 'duvar' ? 'auto 100%' : '200px auto'}`).join(';');
  return `<div class="map" style="${tex}">${img(`bg/${p.city}`, 'bgimg', '')}
    <div class="sky">${img(`harbor/${p.city}`, 'harbor', '<div class="ship">⛴</div>')}
      <div class="city-title">${esc(cityName(p.city).toLocaleUpperCase('tr-TR'))}<small>1922</small></div>
      <div class="hotspot liman-btn" data-open="liman">${hasAsset('ico/liman') ? img('ico/liman', 'liman-img', '') : '<div class="dot">⚓</div>'}Liman</div>
      ${eventStrip()}
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
    liman: harborSection, siginak: hideoutSection, kahvehane: menSection, konak: konakSection,
    bos: () => `<p class="muted">Kepenk inik, camlar tozlu. Şimdilik buraya taşınan bir kiracı yok.</p>` }[id];
  return { name: b.name, asset: BUILDINGS[id] || hasAsset(`buildings/${id}`) ? `buildings/${id}` : null, emoji: b.emoji, render };
}

function renderSheet() {
  if (!panel || !S?.player) { $('#sheet').classList.add('hidden'); return; }
  const info = panelInfo(panel);
  if (!info) { panel = null; $('#sheet').classList.add('hidden'); return; }
  $('#sheet-icon').innerHTML = (info.asset && img(info.asset, '', '')) || `<span class="ph-icon">${info.emoji}</span>`;
  $('#sheet-title').textContent = info.name;
  keepInputs($('#sheet-body'), () => helpBox(panel) + info.render());
  $('#sheet').classList.remove('hidden');
}

// Her binanın başında kısa "burada ne yapılır" notu
const pct = (v) => `%${Math.round(v * 100)}`;
function panelHelp(id) {
  const st = S.settings;
  if (id.startsWith('spot:')) {
    const sp = (extra.spots?.spots || []).find(s => 'spot:' + s.id === id);
    return `Mekânlar ailelerin gelir kaynağıdır: sahibi olan aile her saat haraç toplar, para aile kasasına girer.
      Ailenin yöneticileri kurşunla baskın yapıp mekânı ele geçirebilir; sahibi kurşun bırakıp mekânı tahkim eder.` +
      (sp?.kind === 'gazino' ? ' Gazinoda kumar da oynanır; kaybedilen bahislerin bir payı gazinonun sahibi aileye gider.' : '');
  }
  return {
    bos: `Bu dükkân boş. Belki yakında biri kiralar…`,
    konak: `Burası senin konağın. Adamların, arabaların, malın ve ailen bir bakışta burada.`,
    kahvehane: `Kahvehanede iş arayan delikanlılar oturur. Para verip adam tutarsın; eğitimden sonra yanına katılırlar.
      Adamların baskında savaşır, aile mekânında nöbet tutar, seni korur; gözcüler işlerde şansını artırır.
      Her adam haftalık maaş ister, her gün kasandan kesilir. Ödeyemezsen her gün bir kısmı seni bırakır.`,
    karakol: `Yakalananlar burada yatar. İçerideysen firar etmeyi deneyebilirsin (hakkın sınırlı). Dışarıdaysan
      mahkûmları kurtarıp itibar kazanırsın ama gardiyana yakalanırsan sen de içeri girersin.`,
    hastane: `Vurulunca canın düşer; canın ne kadar azsa seni öldürmek o kadar az kurşun ister. Burada parayla canını doldurursun.
      Öldürülürsen bir süre burada yatarsın.`,
    banka: `Öldürülürsen cebindeki paradan ${pct(st.kill_cash_loss)} kaybedersin; bankadaki paraya kimse dokunamaz.
      Kazancını bankaya yatır (yatırırken ${pct(st.bank_fee)} komisyon). Buradan başka oyunculara para da gönderebilirsin.`,
    fabrika: `Kurşun; adam vurmak, mekân baskını ve ekip işleri için gerekir. Şehrin fabrikasından saatlik bir sınırla alırsın.
      Fabrikayı bir aile satın alırsa fiyatı o aile belirler ve satışların parası onun kasasına gider.`,
    silahci: `Silahın yoksa kimseyi vuramazsın; iyi silah aynı işi daha az kurşunla görür. Korumalar seni öldürmeyi zorlaştırır,
      şişe atışı nişancılığını artırıp gereken kurşunu azaltır.`,
    dedektif: `Birini vurmak için önce nerede olduğunu bulmalısın: dedektif tut, hedefin hangi şehirde olduğunu öğren.
      Aynı şehirdeysen infaz edebilirsin. Kelle listesine ödül koyarak işi başkalarına da yaptırabilirsin.`,
    garaj: `Sokaktan araba çal; sat ya da hurdada ezip kurşuna çevir. Arabanla yarışa girip para kazanabilirsin.
      Ekip işlerinde şoförün belli değerde bir arabası olması gerekir.`,
    carsi: `Oyuncular arası pazar: fazla kurşununu ya da arabanı satışa koy, başkalarının ilanlarını satın al.`,
    liman: `Kaçak mal ticareti ve şehirler arası yolculuk burada. Bir şehirde ucuza alıp fiyatın yüksek olduğu limanda sat.
      Daha hızlı bir tekne ya da uçak alırsan seferler arasındaki bekleme kısalır.`,
    siginak: `Tehlikedeysen para verip yer altına in: bu sürede seni kimse bulamaz ve vuramaz, ama sen de iş yapamazsın.`,
  }[id] || '';
}
const helpBox = (id) => { const t = panelHelp(id); return t ? `<div class="help">${t}</div>` : ''; };

async function openPanel(id) {
  sfx.open();
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
    h += card('Firar et', `%15 şans · kalan hakkın: ${p.self_bust_left} · başarırsan +${S.settings.self_bust_xp ?? 5} itibar`,
      `<button class="btn sm primary" data-act="selfbust" ${dis(!p.self_bust_left)}>Dene</button>`);
    h += card('Süreyi kısalt', 'Reklam izle, kalan hapis süren yarıya insin.', boostBtn('jail'));
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
        <div class="muted small">${locked ? ico('kilit', '🔒') + ' ' + esc(rankName(w.min_rank)) : money(w.price)} · gereken kurşun ×${w.bullet_mult}</div></div>
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

// İnfaz önizlemesi: gereken kurşun aralığı ve onu belirleyenler
function shootPrevHtml(X) {
  if (!X) return '<p class="muted small">Hedefin gücü hesaplanıyor…</p>';
  if (X.ok === false) return `<p class="muted small">${esc(X.msg)}</p>`;
  const enough = X.have >= X.high, maybe = X.have >= X.low;
  return `<div class="rp-grid">
      <div><b>${esc(X.nick)}</b><span>${esc(rankName(X.rank))} · can ${X.health}</span>
        <span>${X.bodyguards} koruma · adamları +%${X.men_guard}</span>${X.in_hospital ? '<span class="muted small">Şu an hastanede</span>' : ''}</div>
      <div><b>Gereken kurşun</b><span class="big-num">${X.low.toLocaleString('tr-TR')}–${X.high.toLocaleString('tr-TR')}</span>
        <span class="muted small">silahın ×${X.weapon_mult} · nişancılık −%${X.skill_cut}</span></div></div>
    ${pctBar(Math.min(100, 100 * X.have / X.high), enough ? `Sende ${X.have} kurşun · yeter` : maybe ? `Sende ${X.have} kurşun · sınırda` : `Sende ${X.have} kurşun · yetmez`)}`;
}
async function loadShootPrev(nick) {
  try { extra.shootPrev = await api.rpc('shoot_preview', { p_nick: nick }); } catch { return; }
  const el = $('#shoot-prev'); if (el) el.innerHTML = shootPrevHtml(extra.shootPrev);
}

function detectiveSection() {
  const p = S.player, protectRank = S.settings.protect_rank;
  const weapon = S.weapons.find(w => w.id === p.weapon);
  const foundHere = S.searches.filter(s => s.resolved && s.success && s.city === p.city);
  const killWait = left(p.kill_ready_at);
  if (p.rank < protectRank) {
    return `<p class="muted">${ico('kilit', '🔒')} ${esc(rankName(protectRank))} rütbesine kadar kimseyi aratamaz, vuramazsın; kimse de seni vuramaz.</p>` + hitlistSection();
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
        <div class="raid-prev" id="shoot-prev">${shootPrevHtml(extra.shootPrev)}</div>
        <p class="muted small">Gereken kurşunun üstünde sıkarsan hedef ölür; altında kalırsan sadece yaralanır ve kurşunlar gider.</p>`
      : `<p class="muted small">Vurabilmek için dedektiflerinin hedefi <b>bulunduğun şehirde</b> bulmuş olması gerekir.</p>`) +
    hitlistSection();
}

function hitlistSection() {
  return `<h2>Kelle Listesi</h2>` +
    (extra.hitlist.length ? extra.hitlist.map(b => card(nickLink(b.nick), `${esc(rankName(b.rank))}${b.expires_at
        ? ` · ${ico('kum', '⏳')} ${fmt(left(b.expires_at))}` : ''}`,
      `<span class="cash-sm">${money(b.amount)}</span>`)).join('') : `<p class="muted small">Listede kimse yok.</p>`) +
    `<div class="form-row"><input id="f-bounty-nick" placeholder="Kimin başına" autocomplete="off" autocapitalize="off">
      <input id="f-bounty-amt" type="number" min="1" placeholder="Ödül $" inputmode="numeric">
      <button class="btn primary" data-act="bounty">Koy</button></div>
    <p class="muted small">En az ${money(S.settings.bounty_min)}. Aracıya %${Math.round(S.settings.bounty_fee * 100)} pay. Ödülü onu öldüren alır.
      ${S.settings.bounty_days} gün içinde kimse öldürmezse ödül bankana geri döner (aracı payı dönmez).</p>`;
}

function garageSection() {
  const p = S.player, here = S.cars.filter(c => c.city === p.city), away = S.cars.length - here.length;
  const cc = Math.round((S.car_chance ?? 0.5) * 100);
  return card('Sokaktan araba çal', `${pctBar(cc, `%${cc} başarı`)}<span class="small">Başaramazsan yakalanırsın: %${100 - cc} ihtimalle ${S.settings.car_fail_jail_s} sn hapis. Başarınca +8 itibar.</span>`,
      `<div class="market-actions"><button class="btn sm primary" data-act="car" ${dis(waiting(p.car_ready_at))}>${left(p.car_ready_at) ? until(p.car_ready_at) : 'Çal'}</button>
       ${left(p.car_ready_at) > 5 && !blocked() ? boostBtn('car') : ''}</div>`) +
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
  if ((S.player.trade_xp ?? 0) < (g.min_trade || 0)) return 0;
  return Math.max(0, Math.min(S.ranks[S.player.rank].carry - held, Math.floor(S.player.cash / g.price)));
}

// Ticaret puanı: malı aldığın şehirden başka yerde satınca kazanılır, pahalı malları açar
function tradeBar() {
  const xp = S.player.trade_xp ?? 0, next = S.market.filter(g => (g.min_trade || 0) > xp).sort((a, b) => a.min_trade - b.min_trade)[0];
  const prev = Math.max(0, ...S.market.filter(g => (g.min_trade || 0) <= xp).map(g => g.min_trade || 0));
  return `<div class="trade-bar"><div class="tb-head"><b>Ticaret puanı: ${xp.toLocaleString('tr-TR')}</b>
      <span class="muted small">${next ? `Sıradaki: ${esc(next.name)} (${next.min_trade})` : 'Bütün mallar açık'}</span></div>
    ${next ? pctBar(100 * (xp - prev) / (next.min_trade - prev), '') : ''}
    <p class="muted small">Malı aldığın limandan <b>başka</b> bir limanda satınca kasa başına puan kazanırsın; pahalı mal daha çok puan verir.</p></div>`;
}

function harborSection() {
  const held = S.market.reduce((a, x) => a + x.qty, 0);
  const travelWait = waiting(S.player.travel_ready_at);
  const cur = S.transports.find(t => t.id === S.player.transport);
  return `<h2>Kaçak Mal</h2>
    <p class="muted small">Fiyatlar her saat ve her şehirde değişir. Ucuza al, başka limanda pahalıya sat; aynı limanda satarsan alışın %${Math.round((1 - S.settings.trade_sell_rate) * 100)} altına gider.
      Taşıyabileceğin: <b>${held}/${S.ranks[S.player.rank].carry}</b> kasa.</p>
    ${tradeBar()}
    <div class="qtybar">${[1, 5, 10, 'max'].map(q => `<button class="btn sm ${qty === q ? 'on' : ''}" data-qty="${q}">${q === 'max' ? 'Hepsi' : q}</button>`).join('')}</div>` +
    S.market.map(g => {
      const locked = (S.player.trade_xp ?? 0) < (g.min_trade || 0);
      const nb = locked ? 0 : qty === 'max' ? maxFor(g, true) : qty, ns = qty === 'max' ? maxFor(g, false) : qty;
      const sub = `Al <b>${money(g.price)}</b> · Sat <b>${money(g.sell ?? g.price)}</b>` +
        (locked ? `<br>${ico('kilit', '🔒')} ${g.min_trade} ticaret puanıyla açılır`
          : g.qty ? `<br>Elinde ${g.qty} · alışın ${money(g.avg_cost ?? 0)}${g.bought_city ? ` (${esc(cityName(g.bought_city))})` : ''}` : '');
      return card(esc(g.name), sub,
        `<div class="market-actions">
          <button class="btn sm primary" data-act="buy" data-id="${g.id}" data-n="${nb}" ${dis(!nb)}>Al</button>
          <button class="btn sm" data-act="sellg" data-id="${g.id}" data-n="${ns}" ${dis(!(g.qty && ns))}>Sat</button>
        </div>`, icon('g_' + g.id, GOOD_EMOJI[g.id]));
    }).join('') +
    `<h2>Sefer</h2>
    <p class="muted small">Kaçak malla yolculukta %${Math.round(S.settings.customs_chance * 100)} ihtimalle gümrüğe takılırsın; gümrük malının yarısına el koyar.
      ${travelWait && !blocked() ? `Sıradaki sefer: <b>${until(S.player.travel_ready_at)}</b> ${boostBtn('travel')}` : ''}</p>` +
    S.cities.filter(c => c.id !== S.player.city).map(c => card(esc(c.name), `Bilet ${money(S.travel_cost)}`,
      `<button class="btn sm primary" data-act="travel" data-id="${c.id}" ${dis(travelWait)}>Git</button>`)).join('') +
    `<h2>Ulaşım</h2><p class="muted small">Şu an: <b>${esc(cur.name)}</b> · her yolculuktan sonra ${cur.cooldown_s / 60} dk bekleme.</p>` +
    S.transports.filter(t => t.cooldown_s < cur.cooldown_s).map(t => {
      const locked = S.player.rank < t.min_rank;
      return `<div class="card ${locked ? 'locked' : ''}">${icon('t_' + t.id, TRANSPORT_EMOJI[t.id])}<div class="grow"><div class="title">${esc(t.name)}</div>
        <div class="muted small">${locked ? ico('kilit', '🔒') + ' ' + esc(rankName(t.min_rank)) : money(t.price)} · ${t.cooldown_s / 60} dk bekleme</div></div>
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
      l.kind === 'bullets' ? `<span class="icon emoji">${ico('kursun', '🔫')}</span>` : icon('c_' + l.car_type, CAR_EMOJI[l.car_type] || '🚗'))).join('')
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

// ═════════════════ KONAK: OYUNCUNUN KENDİ MEKÂNI ═════════════════
function konakSection() {
  const p = S.player, M = extra.men, weapon = S.weapons.find(w => w.id === p.weapon);
  let h = `<div class="men-sum">
      <div><b>${M ? M.owned : p.men}</b><span>adam</span></div>
      <div><b>${S.cars.length}</b><span>araba</span></div>
      <div><b>${S.market.reduce((a, g) => a + g.qty, 0)}</b><span>kasa mal</span></div>
      <div><b>${M ? Math.round(M.power) : Math.round(p.power || 0)}</b><span>güç</span></div></div>`;
  // Hane: eş
  h += `<h2>Hane</h2>` + (p.spouse
    ? card(`${nickLink(p.spouse)}`, `Eşin${p.spouse_rank != null ? ` · ${esc(rankName(p.spouse_rank))}` : ''}${p.spouse_city ? ` · ${esc(cityName(p.spouse_city))}` : ''}`,
        '', p.spouse_avatar ? portrait(p.spouse_avatar, 'avatar') : aic('ico/yuzuk', '💍'))
    : `<p class="muted small">Bekârsın. Arkadaşın olan karşı cinsten birine profilinden evlenme teklif edebilirsin.</p>`);
  // Adamlar
  if (M) {
    h += `<h2>Adamların</h2>` + (M.owned ? `<p class="muted small">Bir adamı dağıtmak için üstüne dokun.</p>` + M.types.filter(t => t.active + t.posted + t.training).map(t =>
      `<div class="card clickable" data-act="fireman" data-id="${t.id}" data-name="${esc(t.name)}">${img('men/' + t.id, 'icon', `<span class="icon emoji">${MAN_EMOJI[t.id]}</span>`)}
        <div class="grow"><div class="title">${esc(t.name)}</div><div class="muted small">${t.active} boşta${t.posted ? ` · ${t.posted} nöbette` : ''}${t.training ? ` · ${t.training} eğitimde` : ''} · Can ${t.defense} · Hasar ${t.attack}</div></div>
        <span class="muted">›</span></div>`).join('')
      + (M.training.length ? `<p class="muted small">Eğitimi bitecekler: ${M.training.map(x => `${esc(M.types.find(t => t.id === x.type).name)} ${until(x.ready_at)}`).join(' · ')}</p>` : '')
      + `<p class="muted small">Haftalık maaş: <b>${money(M.wage_week)}</b>.</p>`
      : `<p class="muted small">Henüz adamın yok. Kahvehane'den tutabilirsin.</p>`);
  }
  // Arabalar (bütün şehirler)
  h += `<h2>Arabaların</h2>` + (S.cars.length ? S.cars.map(c => card(esc(c.name), `${esc(cityName(c.city))} · ${money(c.value)}`, '',
      icon('c_' + c.type, CAR_EMOJI[c.type]))).join('') : `<p class="muted small">Araban yok. Garajda sokaktan araba çalabilirsin.</p>`);
  // Mal ve silah
  const goods = S.market.filter(g => g.qty);
  h += `<h2>Ambarın</h2>` + (goods.length ? goods.map(g => card(esc(g.name), `${g.qty} kasa${g.avg_cost ? ` · alışın ${money(g.avg_cost)}` : ''}${g.bought_city ? ` (${esc(cityName(g.bought_city))})` : ''}`, '',
      icon('g_' + g.id, GOOD_EMOJI[g.id]))).join('') : `<p class="muted small">Elinde kaçak mal yok.</p>`);
  h += `<h2>Silahlık</h2>` + card(weapon ? esc(weapon.name) : 'Silahın yok', `${p.bullets} kurşun · ${p.bodyguards}/5 koruma`, '',
      weapon ? icon('w_' + weapon.id, WEAPON_EMOJI[weapon.id]) : icon('w_yumruk', '✊'));
  return h;
}

// ═════════════════ DUYURULAR ═════════════════
const ANN_KIND = { guncelleme: ['Güncelleme', 'k-upd'], bakim: ['Planlı bakım', 'k-mnt'], etkinlik: ['Etkinlik', 'k-evt'], duyuru: ['Duyuru', 'k-ann'] };
function annView() {
  let h = banner('ui/defter_bant', 'Duyurular', 'Güncellemeler, bakımlar ve haberler') +
    `<p><button class="btn sm" data-act="logmain">← Defter</button></p>`;
  if (!extra.ann) return h + '<p class="muted">Yükleniyor…</p>';
  if (!extra.ann.length) return h + '<p class="muted">Henüz duyuru yok.</p>';
  return h + extra.ann.map(a => `<article class="ann ${a.pinned ? 'pinned' : ''}">
      <div class="ann-head"><span class="ann-kind ${ANN_KIND[a.kind][1]}">${ANN_KIND[a.kind][0]}</span>
        ${a.pinned ? '<span class="muted small">📌 sabit</span>' : ''}<span class="muted small ann-date">${new Date(a.at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</span></div>
      <h3>${esc(a.title)}</h3><div class="ann-body">${esc(a.body)}</div></article>`).join('');
}

// ═════════════════ AYARLAR ═════════════════
async function openSettings() {
  const a = audioSettings(), ps = await pushState();
  extra.account = api.account ? await api.account().catch(() => null) : null;
  const slider = (key, on, label) => `<div class="set-row"><label class="set-check"><input type="checkbox" data-aud="${on}" ${a[on] ? 'checked' : ''}> ${label}</label>
    <input type="range" min="0" max="100" step="5" value="${Math.round(a[key] * 100)}" data-aud="${key}"><span class="muted small" id="aud-${key}">%${Math.round(a[key] * 100)}</span></div>`;
  $('#modal-body').innerHTML = `<div class="logo-sm">Ayarlar</div>
    <h2>Ses</h2>${slider('music', 'musicOn', 'Müzik')}${slider('sfx', 'sfxOn', 'Efektler')}
    <h2>Bildirimler</h2>
    <p class="muted small">${ps.supported ? (ps.on ? 'Bu cihazda bildirimler açık: işin hazır olunca, mesaj gelince, saldırıya uğrayınca haber verilir.'
      : ps.denied ? 'Bildirim izni tarayıcı ayarlarından kapatılmış. Açmak için tarayıcı/site ayarlarından izin ver.'
      : 'Oyun kapalıyken de önemli gelişmelerden haberin olsun.') : ps.reason}</p>
    ${ps.supported && !ps.denied ? (ps.on ? `<button class="btn" data-act="pushoff">Bildirimleri kapat</button>` : `<button class="btn primary" data-act="pushon">Bildirimleri aç</button>`) : ''}
    <h2>Hesap</h2>${accountCard()}
    <div class="card col"><div class="title">Başka cihazda karakterin mi var?</div>
      <div class="muted small">E-postasını bağladığın karakterle bu cihazda oynamak için e-postanla gir.</div>
      <button class="btn" data-act="acctlogin">E-postayla gir</button></div>
    <h2>Yasal</h2>
    <div class="menu-list"><a class="btn" href="gizlilik.html" target="_blank">Gizlilik Politikası</a>
      <a class="btn" href="kvkk.html" target="_blank">KVKK Aydınlatma Metni</a>
      <a class="btn" href="kullanim.html" target="_blank">Kullanım Şartları</a></div>`;
  $('#modal').classList.remove('hidden');
}
document.addEventListener('input', (e) => {
  const k = e.target.dataset?.aud; if (!k || e.target.type !== 'range') return;
  setAudio({ [k]: e.target.value / 100 }); $('#aud-' + k).textContent = '%' + e.target.value;
});
document.addEventListener('change', (e) => {
  const k = e.target.dataset?.aud; if (!k || e.target.type !== 'checkbox') return;
  setAudio({ [k]: e.target.checked });
});

// ═════════════════ HESAP KORUMA ═════════════════
// Hesap şimdilik bu cihaza bağlı (anonim). E-posta bağlanınca başka cihazdan da aynı karaktere girilir.
function accountCard() {
  const A = extra.account;
  if (!api.account || !A) return '';
  if (A.email && !A.anonymous) return `<div class="card"><span class="icon emoji">🔐</span><div class="grow"><div class="title">Hesabın korunuyor</div>
      <div class="muted small">${esc(A.email)} adresine bağlı. Başka cihazdan girişte bu e-postayı kullan.</div></div></div>`;
  return `<div class="card col acct-card"><div class="title">🔐 Hesabını koru</div>
    <div class="muted small">Karakterin şu an sadece bu cihazda. Tarayıcı verisi silinirse ya da telefon değişirse kaybolur.
      E-postanı bağla; başka cihazdan da aynı karaktere girebilirsin.${A.email ? ` <b>${esc(A.email)}</b> adresine onay bağlantısı gönderildi, mailine bak.` : ''}</div>
    <div class="form-row"><input id="f-acct-email" type="email" placeholder="E-posta adresin" autocomplete="email" autocapitalize="off">
      <button class="btn primary" data-act="acctlink">Bağla</button></div></div>`;
}

// ═════════════════ MAĞAZA ═════════════════
const tl = (v) => '₺' + Number(v).toLocaleString('tr-TR', { minimumFractionDigits: 2 });
async function loadShop() { extra.shop = await api.rpc('get_shop'); if (logView === 'shop') renderTab(); }
async function openShop() {
  logView = 'shop';
  if (tab !== 'log') $('[data-go="log"]').click(); else { renderTab(); $('main').scrollTop = 0; }
  await loadShop();
}
function shopView() {
  const X = extra.shop, p = S.player;
  let h = banner('ui/defter_bant', 'Mağaza', 'Sadece görünüm ve zaman; güç satılmaz') +
    `<p><button class="btn sm" data-act="logmain">← Defter</button></p>`;
  if (!X) return h + `<p class="muted">Yükleniyor…</p>`;
  const prod = (kind) => X.products.filter(x => x.kind === kind);
  const gift = X.club_gift_ready;
  const buyBtn = (x) => `<button class="btn sm primary" data-act="shopbuy" data-id="${x.id}">${tl(x.price)}</button>`;
  // Kulüp
  const club = prod('club')[0];
  h += `<div class="card col club-card"><div class="title">★ Kabadayı Kulübü <span class="muted small">aylık</span></div>
    <ul class="small perk-list"><li>Sohbette altın isim ve Kulüp rozeti</li><li>Her gün ${S.settings.club_boosts_daily ?? 5} ücretsiz hızlandırma (reklamsız)</li>
      <li>Her ay bir özel portre ya da aile arması hediye</li><li>Reklam yok</li></ul>
    ${X.club_until ? `<p class="small">Üyesin · bitiş: <b>${new Date(X.club_until).toLocaleDateString('tr-TR')}</b>${gift ? ' · <b>bu ayın hediyesini aşağıdan seç</b>' : ''}</p>` : ''}
    <div>${buyBtn(club)} <span class="muted small">${X.club_until ? 'süreni uzat' : '30 gün'}</span></div></div>`;
  // Hızlandırma
  h += `<h2>Hızlandırma</h2><p class="muted small">Bir bekleme süresini (iş, araba, vapur, adam eğitimi) yarıya indirir. Hapis ve hastane hızlanmaz.
      Kum saatinin yanındaki ⚡ düğmesine dokun. Bugün kalan: <b>${X.today_left}</b>.</p>
    <div class="men-sum"><div><b>${X.tokens}</b><span>jeton</span></div><div><b>${X.ads_enabled ? X.ad_left : '—'}</b><span>reklam hakkı</span></div>
      <div><b>${X.club_until ? X.club_left : '—'}</b><span>kulüp hakkı</span></div><div><b>${X.today_left}</b><span>bugün</span></div></div>` +
    prod('boosts').map(x => card(esc(x.name), 'İstediğin zaman kullan; süresi dolmaz.', buyBtn(x), '<span class="icon emoji">⚡</span>')).join('') +
    (X.ads_enabled ? '' : `<p class="muted small">Reklam izleyerek ücretsiz hızlandırma çok yakında (günde ${S.settings.ad_boosts_daily ?? 8} hak).</p>`);
  // Portreler (kendi cinsiyetine uygun)
  const mine = prod('portrait').filter(x => !p.gender || x.gender === p.gender);
  h += `<h2>Özel portreler</h2><div class="shop-grid">` + mine.map(x => `<div class="shop-item ${x.owned ? 'owned' : ''}">
      ${img(`portraits/p${x.ref}`, 'shop-art', '')}<b>${esc(x.name)}</b>
      ${x.owned ? (p.avatar === x.ref ? '<span class="muted small">Kullanılıyor</span>' : `<button class="btn sm" data-act="wear" data-id="${x.ref}">Kullan</button>`)
        : gift ? `<button class="btn sm primary" data-act="clubgift" data-id="${x.id}" data-name="${esc(x.name)}">Hediye al</button>` : buyBtn(x)}</div>`).join('') + `</div>`;
  // Armalar
  h += `<h2>Özel aile armaları</h2><p class="muted small">Armayı ailenin Don'u seçer; satın aldığın armayı Don olduğun ailede kullanabilirsin.</p>
    <div class="shop-grid">` + prod('crest').map(x => `<div class="shop-item ${x.owned ? 'owned' : ''}">
      ${img(`crests/c${x.ref}`, 'shop-art', '')}<b>${esc(x.name)}</b>
      ${x.owned ? '<span class="muted small">Sende</span>'
        : gift ? `<button class="btn sm primary" data-act="clubgift" data-id="${x.id}" data-name="${esc(x.name)}">Hediye al</button>` : buyBtn(x)}</div>`).join('') + `</div>`;
  // Sohbet görünümü
  const nick = esc(p.nick), fontOn = p.chat_font, frameOn = p.chat_frame;
  const styleBtn = (x, kind) => {
    const on = kind === 'font' ? fontOn === x.id : frameOn === x.id;
    if (x.owned) return on ? '<span class="muted small">Kullanılıyor</span>'
      : `<button class="btn sm" data-act="chatstyle" data-kind="${kind}" data-id="${x.id}">Kullan</button>`;
    return gift ? `<button class="btn sm primary" data-act="clubgift" data-id="${x.id}" data-name="${esc(x.name)}">Hediye al</button>` : buyBtn(x);
  };
  h += `<h2>Sohbet görünümü</h2><p class="muted small">Genel ve şehir sohbetinde mesajların özel yazı tipiyle, adın çerçeveyle görünür.</p>
    <div class="shop-grid">` + prod('chatfont').map(x => `<div class="shop-item ${x.owned ? 'owned' : ''}">
      <div class="style-prev cf-${x.id}"><b>${nick}</b> Selam, ahali!</div><b>${esc(x.name)}</b>${styleBtn(x, 'font')}</div>`).join('') + `</div>
    <div class="shop-grid">` + prod('chatframe').map(x => `<div class="shop-item ${x.owned ? 'owned' : ''}">
      <div class="style-prev"><b class="nf nf-${x.id}">${nick}</b></div><b>${esc(x.name)}</b>${styleBtn(x, 'frame')}</div>`).join('') + `</div>` +
    (fontOn || frameOn ? `<button class="btn sm" data-act="chatstyle" data-kind="reset">Varsayılan görünüme dön</button>` : '');
  h += `<p class="muted small">Satın alınanlar sezon sonunda silinmez. Ödeme, oyun telefon mağazalarına çıkınca açılacak.</p>`;
  return h;
}

// Hızlandırma seçimi: reklam / kulüp hakkı / jeton
async function openBoost(target) {
  const X = extra.shop = await api.rpc('get_shop');
  const opt = (via, label, sub, on) => `<button class="btn ${on ? 'primary' : ''}" data-act="useboost" data-id="${via}" data-target="${target}" ${dis(!on)}>
    ${label}<small>${sub}</small></button>`;
  $('#modal-body').innerHTML = `<div class="ask-art"><span class="boost-big">⚡</span></div><div class="logo-sm">Hızlandır</div>
    <p class="small">Kalan bekleme süresi yarıya iner. Bugün kalan hakkın: <b>${X.today_left}</b>.</p>
    <div class="menu-list boost-list">
      ${opt('ad', 'Reklam izle', X.ads_enabled ? `bugün ${X.ad_left} hak` : 'çok yakında', X.ads_enabled && X.ad_left > 0)}
      ${target === 'jail' ? `</div><p class="muted small">Hapis süresi sadece reklam izleyerek kısalır; jeton ve kulüp hakkı burada geçmez.</p>` : `
      ${X.club_until ? opt('club', 'Kulüp hakkı', `bugün ${X.club_left} hak`, X.club_left > 0) : ''}
      ${opt('token', 'Jeton kullan', `${X.tokens} jetonun var`, X.tokens > 0)}
      <button class="btn" data-act="shop">Jeton al / Kulübe katıl</button></div>`}`;
  $('#modal').classList.remove('hidden');
}
const boostBtn = (target) => `<button class="btn sm boost-btn" data-act="boost" data-id="${target}" title="Hızlandır">⚡</button>`;

// ═════════════════ KAHVEHANE: ADAMLAR ═════════════════
const MAN_EMOJI = { zorba: '👊', fedai: '🛡', gozcu: '👁', nisanci: '🎯' };
function menSection() {
  const M = extra.men;
  if (!M) return `<p class="muted">Yükleniyor…</p>`;
  const hireWait = left(M.hire_ready_at), full = M.owned >= M.cap;
  let h = `<div class="men-sum">
      <div><b>${M.owned}<small>/${M.cap}</small></b><span>adam</span></div>
      <div><b>${M.attack}</b><span>hasar</span></div>
      <div><b>${M.defense}</b><span>can</span></div>
      <div><b>${Math.round(M.power)}</b><span>güç</span></div></div>
    <p class="muted small">Haftalık maaş: <b>${money(M.wage_week)}</b> (her gün yedide biri kesilir, önce cepten sonra bankadan).
      Boştaki adamların (toplam canları) seni vurmayı <b>%${Math.round(M.guard * 100)}</b> zorlaştırıyor.${M.job ? ` Gözcülerin işlerde <b>+%${Math.round(M.job * 100)}</b> şans veriyor.` : ''}
      ${M.family_power != null ? `Ailenin toplam gücü: <b>${Math.round(M.family_power)}</b>.` : ''}</p>`;
  if (hireWait) h += `<p class="small">${ico('kum', '⏳')} Sıradaki adam için: <b>${until(M.hire_ready_at)}</b></p>`;
  h += `<h2>Adam tut</h2>` + M.types.map(t => {
    const locked = S.player.rank < t.min_rank;
    const sub = `Can ${t.defense} · Hasar ${t.attack} · Maaş ${money(t.wage)}/hafta · Eğitim ${t.train_min}-${t.train_max} dk
      <br>${esc(t.descr)}${t.active + t.posted + t.training ? `<br>Sende: ${t.active} boşta${t.posted ? `, ${t.posted} nöbette` : ''}${t.training ? `, ${t.training} eğitimde` : ''}` : ''}
      ${locked ? `<br>${ico('kilit', '🔒')} ${esc(rankName(t.min_rank))} rütbesi gerekir` : ''}`;
    return `<div class="card ${locked ? 'locked' : ''}">${img('men/' + t.id, 'icon', `<span class="icon emoji">${MAN_EMOJI[t.id]}</span>`)}
      <div class="grow"><div class="title">${esc(t.name)} · ${money(t.price)}</div><div class="muted small">${sub}</div></div>
      <div class="market-actions"><button class="btn sm primary" data-act="hireman" data-id="${t.id}" ${dis(locked || full || hireWait || blocked() || S.player.cash < t.price)}>${
        locked ? 'Kilitli' : full ? 'Sınır dolu' : blocked() ? 'Hapistesin' : hireWait ? `${ico('kum', '⏳')} ${until(M.hire_ready_at)}` : S.player.cash < t.price ? 'Para yetmiyor' : 'Tut'}</button></div></div>`;
  }).join('');
  if (M.training.length) h += `<h2>Eğitimde ${boostBtn('men')}</h2>` + M.types.filter(t => t.training).map(t =>
      card(esc(t.name), `${t.active} boşta${t.posted ? ` · ${t.posted} nöbette` : ''} · ${t.training} eğitimde · Can ${t.defense} · Hasar ${t.attack}`, '',
        img('men/' + t.id, 'icon', `<span class="icon emoji">${MAN_EMOJI[t.id]}</span>`))).join('')
    + `<p class="muted small">Eğitimi bitecekler: ${M.training.map(x => `${esc(M.types.find(t => t.id === x.type).name)} ${until(x.ready_at)}`).join(' · ')}</p>`;
  if (M.posts.length) h += `<h2>Nöbette</h2>` + M.posts.map(x => card(esc(x.name), `${esc(cityName(x.city))} · ${x.count} adam`,
    `<button class="btn sm" data-act="recall" data-id="${x.spot}">Geri çağır</button>`)).join('');
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
// Baskın önizlemesi: iki tarafın gücü ve kazanma ihtimali (sunucu savaşı 60 kez dener)
function raidPrevHtml(X) {
  if (!X) return '<p class="muted small">Güçler hesaplanıyor…</p>';
  const m = X.me, e = X.enemy, c = X.chance;
  const verdict = c >= 85 ? 'Büyük ihtimalle alırsın' : c >= 55 ? 'Şansın yüksek' : c >= 30 ? 'Başa baş' : c > 0 ? 'Zor' : 'Bu güçle alamazsın';
  return `<div class="rp-grid">
      <div><b>Senin tarafın</b><span>${m.men} savaşçı adam · ${Math.round(m.hp)} can</span><span>tur başına ${m.dmg} hasar</span>
        <span class="muted small">kurşundan ${m.bullet_dmg}${m.support ? ` · aile desteği ${m.support}` : ''}${m.allies > 1 ? ` · ${m.allies} üye şehirde` : ''}</span></div>
      <div><b>Karşı taraf</b><span>${e.npc ? `${e.npc} yerel kabadayı` : `${e.men ? '~' + e.men + ' nöbetçi' : 'nöbetçi yok'}${e.wall_hp ? ` · barikat ~${e.wall_hp} can` : ''}`}</span>
        <span>${e.npc ? '' : '~'}${Math.round(e.hp)} can · tur başına ${e.dmg} hasar</span>
        <span class="muted small">${e.defenders ? `${e.defenders} savunucu şehirde` : 'savunan +%25 vurur'}</span></div></div>
    ${pctBar(c, `%${c} kazanma · ${verdict}`)}
    ${m.scouts ? `<p class="muted small">${m.scouts} gözcün baskına girmez.</p>` : ''}`;
}
let raidPrevTimer;
async function loadRaidPrev(spot, bullets) {
  try { (extra.raidPrev ??= {})[spot] = await api.rpc('raid_preview', { p_spot: spot, p_bullets: bullets }); } catch { return; }
  const el = $('#raid-prev-' + spot);
  if (el) el.innerHTML = raidPrevHtml(extra.raidPrev[spot]);
}
document.addEventListener('input', (e) => {
  const i = e.target.closest('.raid-input');
  if (!i) return;
  clearTimeout(raidPrevTimer);
  raidPrevTimer = setTimeout(() => loadRaidPrev(+i.dataset.spot, parseInt(i.value, 10) || 0), 350);
});

function spotPanel(sp) {
  const role = S.player.family_role, canRaid = ['don', 'sottocapo', 'capo'].includes(role);
  const raidWait = extra.spots?.raid_ready_at && left(extra.spots.raid_ready_at);
  const prot = sp.protected_until && left(sp.protected_until);
  let h = card(`${money(sp.income)}/saat haraç`,
    `${sp.owner ? `Sahibi: <b>${esc(sp.owner)}</b>` : 'Sahipsiz'} · ${sp.mine ? `savunma ${sp.defense} kurşun` : `koruma: ${esc(sp.strength)}`}${prot ? ` · 🛡 ${fmt(prot)}` : ''}`);
  const M = extra.men;
  if (sp.mine) {
    h += `<div class="form-row"><input id="f-fort-${sp.id}" type="number" min="1" placeholder="Bırakılacak kurşun" inputmode="numeric">
      <button class="btn" data-act="fortify" data-id="${sp.id}">Tahkim et</button></div>`;
    if (M) {
      const here = M.posts.find(x => x.spot === sp.id)?.count || 0, free = M.types.filter(t => t.active > 0);
      h += `<h2>Nöbet</h2><p class="muted small">Buraya bıraktığın adamlar baskında mekânı savunur ve +%25 hasarla vurur.
        Bıraktığın kurşunlar barikat olur: önce barikat yıkılır, sonra adamlara sıra gelir. Canı biten nöbetçi ölür. Bu mekânda nöbet tutan adamın: <b>${here}</b>.</p>` +
        (free.length ? `<div class="form-row"><select id="f-post-type-${sp.id}">${free.map(t => `<option value="${t.id}">${esc(t.name)} (${t.active} boşta)</option>`).join('')}</select>
          <input id="f-post-n-${sp.id}" type="number" min="1" placeholder="Kaç" inputmode="numeric">
          <button class="btn" data-act="post" data-id="${sp.id}">Bırak</button></div>` : `<p class="muted small">Boşta eğitimli adamın yok; Kahvehane'den tutabilirsin.</p>`) +
        (here ? `<button class="btn sm" data-act="recall" data-id="${sp.id}">Nöbetçileri geri çağır</button>` : '');
    }
  } else if (canRaid && !prot) {
    h += `<p class="muted small">Baskın en fazla ${S.settings.battle_rounds ?? 5} tur süren bir çatışmadır. Boştaki adamların (gözcüler hariç) seninle gelir${M?.attack ? `: tur başına <b>${M.attack}</b> hasar, toplam <b>${M.defense}</b> can` : ''}.
      Her ${S.settings.battle_bullet_div ?? 100} kurşun tur başına +1 hasar ekler. Canının yarısını kaybeden taraf dağılır; canı biten adam ölür.</p>`;
    h += `<div class="raid-prev" id="raid-prev-${sp.id}">${raidPrevHtml(extra.raidPrev?.[sp.id])}</div>`;
    h += `<div class="form-row"><input id="f-raid-${sp.id}" class="raid-input" data-spot="${sp.id}" type="number" min="0" placeholder="Baskın kurşunu" inputmode="numeric">
      <button class="btn danger" data-act="raid" data-id="${sp.id}" ${dis(raidWait || blocked())}>Baskın</button></div>
      ${raidWait ? `<p class="muted small">${ico('kum', '⏳')} Ailenin sıradaki baskını: ${fmt(raidWait)}</p>` : ''}`;
  } else if (!sp.mine) {
    h += `<p class="muted small">Baskını ailenin Don, Sottocapo ya da bir Capo'su yönetebilir. Şehirde çevrimiçi her aile üyesi gücü %15 artırır.</p>`;
  }
  if (sp.kind === 'gazino') h += casinoSection();
  return h;
}

// ── Kumarhane: zar, rulet, slot görsel; blackjack masada kartlarla
const DIE_PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
const die = (n, roll) => `<span class="die ${roll ? 'roll' : ''}">${Array.from({ length: 9 }, (_, i) =>
  `<i class="${DIE_PIPS[n]?.includes(i + 1) ? 'on' : ''}"></i>`).join('')}</span>`;
const RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const rouletteColor = (n) => n === 0 ? 'green' : RED.includes(n) ? 'red' : 'black';
// Kart: "10♥" → küçük kart; gizli kart → kart arkası görseli
const cardHtml = (c) => c === '🂠' ? `<span class="pcard back">${img('casino/kart', '', '')}</span>`
  : `<span class="pcard ${/[♥♦]/.test(c) ? 'red' : ''}"><b>${c.slice(0, -1)}</b><i>${c.slice(-1)}</i></span>`;
const cards = (label) => (label || '').split(' ').filter(Boolean);
// Sadece yeni gelen kart dağıtılma animasyonuyla girer (seen: o eldeki önceden görülen kart sayısı)
const hand = (list, seen = 0) => list.map((c, i) => cardHtml(c).replace('class="pcard', `class="pcard${i >= seen ? ' new' : ''}`)).join('');

function casinoSection() {
  const c = extra.casino, max = S.player.max_bet, just = c && !c.shown;
  if (c) c.shown = true;   // animasyon sadece sonuç ilk çizildiğinde
  // Her oyunun kendi bahis kutusu + hızlı fişler
  const bet = (g) => `<div class="bet-row"><input id="f-bet-${g}" type="number" min="10" max="${max}" placeholder="Bahis $" inputmode="numeric" value="${extra.bets?.[g] ?? ''}">
    ${[[100, 'fis_teal'], [1000, 'fis_bordo']].filter(([v]) => v <= max).map(([v, ic]) =>
      `<button class="bet-chip" data-act="betset" data-game="${g}" data-id="${v}">${img('casino/' + ic, '', '')}<span>${v >= 1000 ? v / 1000 + 'B' : v}</span></button>`).join('')}
    <button class="bet-chip max" data-act="betset" data-game="${g}" data-id="${max}"><span>Max</span></button></div>`;
  return `<div class="casino-hero">${img('ui/kumar_bant', '', '')}<div class="ch-title">Kumarhane</div></div>
    <p class="muted small">Oyun parasıyla oynanır. Rütbene göre en yüksek bahis: <b>${money(max)}</b>. Kasa her zaman biraz önde.</p>
    <p class="muted small legal-note">Bu bir oyundur: oyun parasının gerçek bir değeri yoktur, gerçek parayla satın alınamaz ve gerçek paraya ya da ödüle çevrilemez.</p>
    <div class="games">
      <div class="game"><div class="g-head">Zar</div>
        <div class="dice">${die(c?.game === 'zar' ? c.d1 : 6, just && c.game === 'zar')}${die(c?.game === 'zar' ? c.d2 : 1, just && c.game === 'zar')}</div>
        ${c?.game === 'zar' ? `<div class="g-res">${c.d1} + ${c.d2} = <b>${c.d1 + c.d2}</b></div>` : '<div class="g-res muted">İki zarın toplamını bil</div>'}
        ${bet('zar')}
        <div class="g-btns"><button class="btn sm" data-act="casino" data-game="zar" data-choice="yuksek">Yüksek 8-12</button>
          <button class="btn sm" data-act="casino" data-game="zar" data-choice="dusuk">Düşük 2-6</button></div></div>
      <div class="game"><div class="g-head">Rulet</div>
        <div class="wheel ${just && c.game === 'rulet' ? 'spin' : ''}">${img('casino/rulet', '', '🎡')}</div>
        ${c?.game === 'rulet' ? `<div class="g-res"><span class="rnum ${rouletteColor(c.num)}">${c.num}</span></div>` : '<div class="g-res muted">Renk ya da sayı seç</div>'}
        ${bet('rulet')}
        <div class="g-btns"><button class="btn sm red" data-act="casino" data-game="rulet" data-choice="kirmizi">Kırmızı</button>
          <button class="btn sm black" data-act="casino" data-game="rulet" data-choice="siyah">Siyah</button></div>
        <div class="g-btns"><input id="f-rulet-n" type="number" min="0" max="36" placeholder="0-36" inputmode="numeric">
          <button class="btn sm" data-act="casino" data-game="rulet" data-choice="num">×36</button></div></div>
      <div class="game wide"><div class="g-head">Slot</div>
        <div class="slotm ${just && c.game === 'slot' ? 'shake' : ''}">${img('casino/slot', 'frame', '🎰')}</div>
        <div class="slot-res ${just && c.game === 'slot' ? 'spin' : ''}">${(c?.game === 'slot' ? c.reels : ['❔', '❔', '❔']).map(e => `<span>${e}</span>`).join('')}</div>
        ${bet('slot')}
        <button class="btn primary" data-act="casino" data-game="slot">Kolu çek</button>
        <p class="muted small">Üç 7️⃣ ×250 · üç 💎 ×60 · üç 🍀 ×25 · üç 🔔 ×14 · üç 🍋 ×8 · üç 🍒 ×5 · iki 🍒 ×3 · tek 🍒 ×1,2</p></div>
    </div>
    ${c ? `<div class="casino-result ${c.win > 0 ? 'good' : 'bad'}">${richText(c.msg)}</div>` : ''}
    <h2>Blackjack</h2>${bjSection()}
    <h2>Kazı Kazan</h2>` + card('Tanesi ' + money(S.settings.scratch_price), `Büyük ikramiye ${money(100000)}`,
      `<button class="btn sm primary" data-act="scratch">Kazı</button>`) + lotterySection();
}

function bjSection() {
  const g = extra.bj;
  const max = S.player.max_bet;
  const betRow = `<div class="bet-row"><input id="f-bet-bj" type="number" min="10" max="${max}" placeholder="Bahis $" inputmode="numeric" value="${extra.bets?.bj ?? ''}">
    <button class="bet-chip" data-act="betset" data-game="bj" data-id="100">${img('casino/fis_teal', '', '')}<span>100</span></button>
    <button class="bet-chip max" data-act="betset" data-game="bj" data-id="${max}"><span>Max</span></button></div>`;
  if (!g) return `<div class="felt"><p class="muted small">Krupiye 17'de durur, blackjack 3:2 öder.</p>${betRow}
    <button class="btn primary" data-act="bjstart">Kart dağıt</button></div>`;
  // El bitince krupiye kartlarını tek tek açar (bjReveal: şu an açık kart sayısı)
  const seen = extra.bjSeen || { d: 0, p: 0 }, dc = cards(g.dealer), pc = cards(g.hand);
  const revealing = g.done && extra.bjReveal != null && extra.bjReveal < dc.length;
  const shownD = revealing ? [...dc.slice(0, extra.bjReveal), ...(extra.bjReveal < 2 ? ['🂠'] : [])] : dc;
  extra.bjSeen = { d: revealing ? extra.bjReveal : shownD.length, p: pc.length };
  const rows = `<div class="bj-row"><span class="bj-who">Krupiye${!revealing && g.dealer_value != null ? ` · ${g.dealer_value}` : ''}</span>${hand(shownD, seen.d)}</div>
    <div class="bj-row"><span class="bj-who">Sen · ${g.hand_value}</span>${hand(pc, seen.p)}</div>`;
  if (revealing) return `<div class="felt">${rows}<div class="muted small">Krupiye kart açıyor…</div></div>`;
  if (g.done) return `<div class="felt">${rows}<div class="casino-result ${g.win > 0 ? 'good' : 'bad'}">${richText(g.msg)}</div>
    ${betRow}<button class="btn primary" data-act="bjstart">Yeni el</button></div>`;
  return `<div class="felt">${rows}
    <div class="muted small">Bahis ${money(g.bet)}</div>` +
    `<div class="market-actions"><button class="btn primary" data-act="bjhit">Kart çek</button>
        <button class="btn" data-act="bjstand">Dur</button></div></div>`;
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
// Sekme başı: resimli bant + başlık levhası
function banner(asset, title, sub = '', extra = '') {
  return `<div class="banner">${img(asset, 'banner-img', '')}${extra}
    <div class="banner-title" ${title.length > 12 ? 'style="font-size:21px;letter-spacing:2px"' : ''}>${title}${sub ? `<small>${sub}</small>` : ''}</div></div>`;
}
const pctBar = (v, label) => `<div class="odds"><div style="width:${Math.max(0, Math.min(100, v))}%"></div><span>${label}</span></div>`;

function crimeTab() {
  return banner('ui/isler_bant', 'İşler', 'Küçük işle başla, büyük vurgunla çık') +
    `<h2>Suçlar</h2><div class="jobs-grid">` + S.crimes.map(c => {
    const locked = S.player.rank < c.min_rank, pct = Math.round(c.chance * 100);
    return `<div class="card job ${locked ? 'locked' : ''}">
      <div class="job-art">${img('jobs/' + c.id, 'art', `<div class="art ph">${JOB_EMOJI[c.id]}</div>`)}
        ${locked ? `<div class="lock"><span>${ico('kilit', '🔒')}</span><em>${esc(rankName(c.min_rank))}</em></div>`
          : `<span class="coin">${money(c.reward_min)}–${money(c.reward_max)}</span><span class="coin xp">+${c.xp} itibar</span>`}</div>
      <div class="body"><div class="title">${esc(c.name)}</div>
        ${locked ? `<div class="lock-note">Bu işi açmak için en az <b>${esc(rankName(c.min_rank))}</b> rütbesinde olmalısın. Suç işledikçe itibar kazanır, rütbe atlarsın.</div>`
          : pctBar(pct, `%${pct} şans`)}
        ${locked ? '' : `<button class="btn sm primary" data-act="crime" data-id="${c.id}" ${dis(waiting(c.ready_at))}>${
          waiting(c.ready_at) && !blocked() ? ico('kum', '⏳') + ' ' + until(c.ready_at) : 'Yap'}</button>
          ${left(c.ready_at) > 5 && !blocked() ? boostBtn('crime:' + c.id) : ''}`}</div>
    </div>`;
  }).join('') + `</div>` + crewSection();
}

const CREW_ROLES = { lider: 'Lider', sofor: 'Şoför', silahci: 'Silahçı', patlayici: 'Patlayıcı Uzmanı' };
const roleLabel = (r) => { const [, k, n] = r.match(/^(\D+)(\d*)$/); return CREW_ROLES[k] + (n ? ' ' + n : ''); };
const countRole = (t, k) => t.roles.filter(r => r.replace(/\d+$/, '') === k).length;

const ROLE_ICON = { lider: '🎩', sofor: '🚗', silahci: '🔫', patlayici: '🧨' };
const roleIcon = (r) => { const k = r.replace(/\d+$/, ''); return ico(k, ROLE_ICON[k]); };
// Ekip yuvası: rol simgesi, rol adı, kim (boşsa kesikli çember)
const slot = (role, nick, state = 'empty') => `<div class="slot ${state}"><div class="slot-av">${roleIcon(role)}</div>
  <b>${roleLabel(role)}</b><span>${nick ? nickLink(nick) : 'boş'}</span></div>`;

// Ekip işi nasıl yapılır: kısa açıklama (kilitli ve açık kartlarda)
const crewHowTo = (t) => `<details class="howto"><summary>Ekip işi nasıl yapılır?</summary>
  <ol><li>Sen <b>lider</b> olursun. "Ekibi kur"a dokun.</li>
  <li>Diğer rollere (${t.roles.slice(1).map(roleLabel).join(', ')}) oyuncuları <b>takma adlarıyla</b> yaz ve davet et.</li>
  <li>Davet edilenler İşler sekmesinde daveti görüp <b>Katıl</b> der. Herkes aynı şehirde olmalı.</li>
  <li>Herkes katılınca <b>Başlat</b>. Şoförün arabası, silahçının kurşunu yeterliyse iş başlar; ganimet paylaşılır.</li></ol>
  <p class="muted small">Ekip bulmak için Sohbet sekmesini ya da aileni kullan.</p></details>`;

function crewSection() {
  const X = extra.crews;
  if (!X) return '';
  let h = `<h2>Ekip İşleri</h2>`;
  const active = X.crews.filter(c => c.status === 'forming');
  const mine = active.find(c => c.i_lead);

  for (const c of active) {
    const t = X.types.find(x => x.id === c.type);
    const me = c.members.find(m => m.nick === S.player.nick);
    let btn = '';
    if (c.i_lead) btn = `<div class="crew-actions"><button class="btn sm primary" data-act="crewstart">Başlat</button>
      <button class="btn sm" data-act="crewcancel">Dağıt</button></div>`;
    else if (me && me.accepted === null) btn = `<div class="crew-actions"><button class="btn sm primary" data-act="crewyes" data-id="${c.id}">Katıl</button>
      <button class="btn sm" data-act="crewno" data-id="${c.id}">Reddet</button></div>`;
    h += `<div class="card job crew">
      <div class="job-art wide">${img('jobs/' + t.id, 'art', `<div class="art ph">${JOB_EMOJI[t.id]}</div>`)}
        <span class="coin">${esc(cityName(c.city))}</span></div>
      <div class="body"><div class="title">${esc(t.name)} <span class="muted small">· ekip toplanıyor</span></div>
        <div class="slots">${c.members.map(m => slot(m.role, m.nick,
          m.accepted === true ? 'ok' : m.accepted === false ? 'no' : 'wait')).join('')}</div>${btn}</div></div>`;
  }

  for (const c of X.crews.filter(c => c.status !== 'forming').slice(0, 2)) {
    h += `<p class="news small">📰 ${esc(c.result || '')}</p>`;
  }

  if (!mine) {
    for (const t of X.types) {
      const locked = S.player.rank < t.min_rank, wait = t.ready_at && left(t.ready_at);
      const art = `<div class="job-art wide">${img('jobs/' + t.id, 'art', `<div class="art ph">${JOB_EMOJI[t.id]}</div>`)}
        ${locked ? `<div class="lock"><span>${ico('kilit', '🔒')}</span><em>${esc(rankName(t.min_rank))}</em></div>`
          : `<span class="coin">${money(t.payout_min)}–${money(t.payout_max)}</span>`}</div>`;
      if (locked) {
        h += `<div class="card job crew locked">${art}<div class="body"><div class="title">${esc(t.name)}</div>
          <div class="slots">${t.roles.map(r => slot(r, '')).join('')}</div>
          <div class="lock-note">Bu işi açmak için en az <b>${esc(rankName(t.min_rank))}</b> rütbesinde olmalısın.</div>
          ${crewHowTo(t)}</div></div>`;
        continue;
      }
      const req = [`lider ${money(t.leader_cost)} + silah + ${X.settings.leader_bullets} kurşun`,
        `${countRole(t, 'sofor') > 1 ? countRole(t, 'sofor') + ' şoförün' : 'şoförün'} en az ${money(t.car_min_value)} arabası`,
        countRole(t, 'silahci') ? `${countRole(t, 'silahci') > 1 ? countRole(t, 'silahci') + ' silahçı' : 'silahçı'} ${X.settings.gunner_bullets}'er kurşun` : '',
        countRole(t, 'patlayici') ? `patlayıcı ${money(X.settings.explosive_cost)}` : ''].filter(Boolean).join(' · ');
      h += `<div class="card job crew">${art}<div class="body">
        <div class="title">${esc(t.name)}</div>
        <div class="slots">${t.roles.map((r, i) => slot(r, i === 0 ? S.player.nick : '', i === 0 ? 'ok' : 'empty')).join('')}</div>
        <div class="muted small">${req}. Herkes aynı şehirde olmalı.</div>
        ${crewHowTo(t)}
        ${wait ? `<div class="muted small">${ico('kum', '⏳')} ${fmt(wait)} sonra tekrar</div>` : `
        <details class="crew-form" id="crew-${t.id}"><summary class="btn primary">Ekibi kur</summary>
          ${t.roles.slice(1).map(r => `<input id="f-crew-${t.id}-${r}" placeholder="${roleLabel(r)} (takma ad)" autocomplete="off" autocapitalize="off">`).join('')}
          <button class="btn primary" data-act="crewcreate" data-id="${t.id}">Davet et</button></details>`}</div></div>`;
    }
  }
  return h;
}

// ═════════════════ AİLE ═════════════════
const ROLES = { don: 'Don', sottocapo: 'Sottocapo', consigliere: 'Consigliere', capo: 'Capo', asker: 'Asker' };

// Aile arması: adın baş harfi, renk addan türetilir (her ailenin kendi rengi)
// n > 0: ailenin seçtiği arma görseli (assets/crests/cN.png); 0 ya da görsel yoksa baş harfli otomatik arma
function crest(name, cls = '', n = 0) {
  if (n > 0 && hasAsset(`crests/c${n}`)) return `<span class="crest img ${cls}">${img(`crests/c${n}`, '', '')}</span>`;
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return `<span class="crest ${cls}" style="--hue:${hue}"><span>${esc(name.trim()[0]?.toLocaleUpperCase('tr-TR') || '?')}</span></span>`;
}

// Don için arma seçici (0 = harfli otomatik arma)
function crestPicker(F) {
  return `<details class="crest-pick" id="crest-pick"><summary class="muted small">Armayı değiştir</summary><div class="crest-grid">
    ${Array.from({ length: 9 }, (_, n) => `<button data-act="crest" data-id="${n}" class="${(F.family.crest || 0) === n ? 'on' : ''}">
      ${crest(F.family.name, '', n)}</button>`).join('')}
    ${Array.from({ length: 8 }, (_, i) => i + 9).map(n => (S.player.items || []).includes('crest_' + n)
      ? `<button data-act="crest" data-id="${n}" class="${F.family.crest === n ? 'on' : ''}">${crest(F.family.name, '', n)}</button>`
      : `<button data-act="shop" class="locked">${crest(F.family.name, '', n)}<span class="lock-ic">${ico('kilit', '🔒')}</span></button>`).join('')}</div>
    <p class="muted small">Arma ailenin her yerde görünen işaretidir: aile listesi, aile sayfası, mekânlar.</p></details>`;
}
const stat = (icon, v, title) => `<span class="stat" title="${title}">${icon} ${v}</span>`;

// Rollerin Türkçe açıklaması (adlar İtalyanca kalıyor)
const ROLE_HELP = {
  don: 'Ailenin başı. Rolleri o dağıtır; kasa, üyeler ve baskınlar üzerinde tam yetkilidir.',
  sottocapo: "Don'un sağ kolu (ailede bir tane). Kasadan üyelere ödeme yapar, fabrika alır, üye atar, baskın yönetir.",
  consigliere: 'Danışman (ailede bir tane). Aileye katılma başvurularını kabul eder ya da reddeder.',
  capo: 'Bölükbaşı. Mekânlara baskın yönetebilir.',
  asker: 'Ailenin eri. Kasaya para koyar, baskınlara ve ekip işlerine katılır.',
};
const rolesHelp = () => `<details class="roles-help" id="roles-help"><summary class="muted small">Roller ne demek?</summary>
  ${Object.entries(ROLES).map(([k, v]) => `<p class="small"><b>${v}</b> — ${ROLE_HELP[k]}</p>`).join('')}
  <p class="muted small">Sıralama yukarıdan aşağıya Don, Sottocapo, Consigliere, Capo, Asker. Rolleri sadece Don değiştirir.</p></details>`;

function familyTab() {
  const F = extra.family;
  if (!F) return banner('ui/aile_bant', 'Aile') + `<p class="muted">Yükleniyor…</p>`;
  if (!F.family) {
    let h = banner('ui/aile_bant', 'Aile', 'Tek başına kabadayı olunmaz');
    if (F.application) h += card(`Başvurun: ${esc(F.application.family)}`, 'Yönetimin cevabı bekleniyor.',
      `<button class="btn sm" data-act="cancelapp">Geri çek</button>`);
    h += `<h2>Aileler</h2>` + (extra.families.length ? extra.families.map(f => `<div class="card fam-card">
      ${crest(f.name, '', f.crest)}<div class="grow"><div class="title">${esc(f.name)}</div>
        <div class="don">${f.don ? `${portrait(f.don_avatar || 1, 'avatar xs')} Don ${esc(f.don)}` : 'Don yok'}</div>
        <div class="stats">${stat(ico('uye', '👤'), f.members, 'üye')}${stat(ico('fabrika', '🏭'), f.factories, 'fabrika')}${stat(ico('mekan', '🏠'), f.spots ?? 0, 'mekân')}${stat(ico('uye', '⚔'), Math.round(f.power || 0), 'güç')}</div></div>
      <button class="btn sm primary" data-act="apply" data-id="${esc(f.name)}">Başvur</button></div>`).join('')
      : `<p class="muted small">Henüz aile yok. İlk aileyi sen kur.</p>`);
    h += `<h2>Aile Kur</h2>`;
    if (F.can_create) {
      h += `<div class="card col"><div class="muted small">Don sen olursun; aileye isim ver, kasayı ve mekânları büyüt.</div>
        <div class="form-row"><input id="f-fam-name" placeholder="Aile adı" autocomplete="off">
        <button class="btn primary" data-act="createfam">Kur · ${money(F.create_cost)}</button></div></div>`;
    } else {
      const need = S.settings.family_create_rank, p = S.player;
      h += `<div class="card col locked-card"><div class="title">${ico('kilit', '🔒')} Aile kurmak için</div>
        <div class="req"><span>${esc(rankName(need))} rütbesi</span>${pctBar(100 * Math.min(p.rank, need) / need,
          `${esc(rankName(p.rank))} → ${esc(rankName(need))}`)}</div>
        <div class="req"><span>${money(F.create_cost)} nakit</span>${pctBar(100 * p.cash / F.create_cost,
          `${money(Math.min(p.cash, F.create_cost))} / ${money(F.create_cost)}`)}</div></div>`;
    }
    return h + spotsSection(null);
  }

  const role = F.my_role, isDon = role === 'don', leader = ['don', 'sottocapo', 'consigliere'].includes(role);
  const treasurer = ['don', 'sottocapo'].includes(role);
  let h = banner('ui/aile_bant', esc(F.family.name), `${ROLES[role]} olarak`, crest(F.family.name, 'on-banner', F.family.crest));
  if (isDon) h += crestPicker(F);
  const mySpots = (extra.spots?.spots || []).filter(x => x.mine).length;
  h += `<div class="card vault"><div class="vault-head"><span class="muted small">Aile kasası</span>
      <b class="vault-sum">${money(F.family.bank)}</b></div>
    <p class="muted small vault-help">Ailenin ortak parası. Üyeler buraya para koyar; mekân haraçları, ailenin fabrikasının kurşun
      satışları ve gazino payı da buraya gelir. Don ve Sottocapo kasadan üyelere ödeme yapar, fabrika satın alır.</p>
    <div class="stats">${stat(ico('uye', '👤'), F.members.length, 'üye')}${stat(ico('fabrika', '🏭'), F.factories.length, 'fabrika')}${stat(ico('mekan', '🏠'), mySpots, 'mekân')}</div>
    <div class="form-row"><input id="f-fam-dep" type="number" min="1" placeholder="Kasaya koy $" inputmode="numeric">
      <button class="btn primary" data-act="famdeposit">Koy</button></div>
    ${treasurer ? `<div class="form-row"><input id="f-pay-nick" placeholder="Üyeye" autocomplete="off" autocapitalize="off">
      <input id="f-pay-amt" type="number" min="1" placeholder="$" inputmode="numeric">
      <button class="btn" data-act="fampay">Öde</button></div>` : ''}</div>`;

  h += `<h2>Üyeler (${F.members.length})</h2>` + rolesHelp() + `<div class="member-grid">` + F.members.map(m => {
    const self = m.nick === S.player.nick;
    const controls = isDon && !self
      ? `<select data-role="${esc(m.nick)}">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === m.role ? 'selected' : ''}>${v}</option>`).join('')}</select>` : '';
    const kick = treasurer && !self && m.role !== 'don' ? `<button class="btn sm" data-act="kick" data-id="${esc(m.nick)}">At</button>` : '';
    return `<div class="member ${m.role}">${portrait(m.avatar || 1, 'avatar')}${m.online ? '<i class="on" title="çevrimiçi"></i>' : ''}
      <span class="ribbon">${ROLES[m.role]}</span><div class="m-nick">${nickLink(m.nick)}</div>
      <div class="muted small">${esc(rankName(m.rank))}</div>${controls || kick ? `<div class="m-ctl">${controls}${kick}</div>` : ''}</div>`;
  }).join('') + `</div>`;

  const last = F.messages.filter(m => m.nick).at(-1);
  h += `<div class="card clickable chat-link" data-act="gochat"><span class="icon emoji">${ico('sohbet', '💬')}</span><div class="grow">
      <div class="title">Aile sohbeti</div><div class="muted small ellipsis">${last ? `${esc(last.nick)}: ${esc(last.text)}` : 'Henüz mesaj yok.'}</div></div>
      <span class="muted">›</span></div>
    <div class="card clickable guide-link" data-act="evcal">${uiIcon('takvim', '📅')}<div class="grow">
      <div class="title">Etkinlik takvimi</div><div class="muted small">${(extra.events || []).filter(evActive).map(e => EVENTS[e.kind].name).join(', ') || 'Kıtlık, altın saat, baskın gecesi ve sürprizler'}</div></div>
      <span class="muted">›</span></div>`;

  if (leader && F.applications?.length) {
    h += `<h2>Başvurular</h2>` + F.applications.map(a => card(nickLink(a.nick), `${esc(rankName(a.rank))} · ☠ ${a.kills}`,
      `<div class="market-actions"><button class="btn sm primary" data-act="accept" data-id="${esc(a.nick)}">Al</button>
       <button class="btn sm" data-act="reject" data-id="${esc(a.nick)}">Reddet</button></div>`)).join('');
  }

  const here = F.factory_here, facIcon = img('buildings/fabrika', 'icon', '<span class="icon emoji">🏭</span>');
  h += `<h2>Kurşun Fabrikaları</h2>` + (F.factories.length ? F.factories.map(f =>
      card(esc(f.city), `Fiyat ${money(f.price)} · stok ${f.stock}`, '', facIcon)).join('') : `<p class="muted small">Ailenin fabrikası yok.</p>`);
  if (here.mine && treasurer) {
    h += `<div class="form-row"><input id="f-fac-price" type="number" min="2" max="20" placeholder="Buradaki fiyat ($2-20)">
      <button class="btn primary" data-act="facprice">Ayarla</button></div>`;
  } else if (!here.owner) {
    h += card(`${esc(cityName(S.player.city))} fabrikası sahipsiz`, `Kasadan ${money(F.factory_price)}. Satılan her kurşunun parası kasaya girer.`,
      treasurer ? `<button class="btn sm primary" data-act="buyfactory">Satın al</button>` : '', facIcon);
  } else if (!here.mine) {
    h += `<p class="muted small">${esc(cityName(S.player.city))} fabrikası ${esc(here.owner)} ailesinin.</p>`;
  }
  h += spotsSection(role);
  h += `<p style="margin-top:20px"><button class="btn" data-act="leave">${isDon && F.members.length === 1 ? 'Aileyi dağıt' : 'Aileden ayrıl'}</button></p>`;
  return h;
}

// Bütün şehirlerdeki mekânlar: bina resimli ızgara (baskın için haritadaki binaya dokunulur)
function spotTile(sp) {
  return `<div class="spot-tile ${sp.mine ? 'mine' : ''}">${img('buildings/' + sp.kind, 'spot-img', `<div class="spot-img ph">${SPOT_EMOJI[sp.kind]}</div>`)}
    <span class="tag ${sp.mine ? 'mine' : sp.owner ? '' : 'ok'}">${sp.owner ? esc(sp.owner) : 'Sahipsiz'}</span>
    <b>${esc(sp.name)}</b><span class="muted small">${esc(cityName(sp.city))} · ${money(sp.income)}/sa</span></div>`;
}

function spotsSection(role) {
  const list = extra.spots?.spots;
  if (!list) return '';
  const mine = list.filter(s => s.mine);
  let h = `<h2>Mekânlar</h2><p class="muted small">Mekân sahibi aile her saat haraç toplar (24 saate kadar birikir). Baskın ve tahkim için
    Şehir haritasında mekânın binasına dokun.</p>`;
  if (role) h += mine.length ? `<div class="spot-grid">${mine.map(spotTile).join('')}</div>`
    : `<p class="muted small">Ailenin mekânı yok.</p>`;
  const byCity = CITY_ORDER.map(c => list.filter(s => s.city === c && !(role && s.mine))).filter(l => l.length);
  h += `<details id="all-spots"><summary class="muted small">Bütün mekânlar (${list.length})</summary>
    ${byCity.map(l => `<div class="spot-city">${esc(cityName(l[0].city))}</div><div class="spot-grid">${l.map(spotTile).join('')}</div>`).join('')}</details>`;
  return h;
}

// ═════════════════ SOHBET ═════════════════
// Mesaj balonu: portre, ad, metin; başkasının mesajında şikâyet bayrağı
function chatMsg(m, avatar, kind) {
  if (!m.nick) return `<div class="sys">— ${esc(m.text)} —</div>`;
  const mine = m.mine ?? m.nick === S.player.nick;
  const tap = mine ? '' : ` data-mnick="${esc(m.nick)}" data-mkind="${kind}" data-mid="${m.id}"`;
  return `<div class="msg ${mine ? 'me' : 'tap'}"${tap}>${portrait(avatar || 1, 'avatar xs')}<div class="bubble">
    <b class="${m.club ? 'club-nick' : ''}"><span class="${m.frame ? 'nf nf-' + m.frame : ''}">${m.club ? '★ ' : ''}${esc(m.nick)}</span>${m.at ? ` <time>${stamp(m.at)}</time>` : ''}</b>
    <span class="${m.font ? 'cf-' + m.font : ''}">${esc(m.text)}</span></div></div>`;
}

// Mesaj/oyuncu menüsü: profil, şikâyet, engelle
function openMsgMenu(nick, kind, id) {
  $('#modal-body').innerHTML = `<div class="logo-sm">${esc(nick)}</div>
    <div class="menu-list">
      <button class="btn" data-profile="${esc(nick)}">👤 Profili gör</button>
      <button class="btn danger" data-act="reportmsg" data-kind="${kind}" data-ref="${id ?? ''}" data-id="${esc(nick)}">⚑ Şikâyet et</button>
      <button class="btn" data-act="block" data-id="${esc(nick)}">🚫 Engelle</button>
    </div>`;
  $('#modal').classList.remove('hidden');
}

// Şikâyet: gerekçe seçilir (yazmak gerekmez); kanıt olarak içerik sunucuda saklanır
const REPORT_REASONS = ['Küfür / hakaret', 'Taciz / tehdit', 'Irkçılık / nefret söylemi', 'Dolandırıcılık', 'Spam / reklam', 'Uygunsuz ad', 'Hile şüphesi'];
function openReport(kind, ref, nick) {
  $('#modal-body').innerHTML = `<div class="logo-sm">Şikâyet</div>
    <p class="small">${kind === 'player' ? `<b>${esc(nick)}</b> adlı oyuncuyu` : `<b>${esc(nick)}</b> kullanıcısının mesajını`}
      moderasyon ekibine bildiriyorsun. Neden?</p>
    <div class="menu-list">${REPORT_REASONS.map(r => `<button class="btn" data-act="sendreport" data-kind="${kind}"
      data-ref="${ref ?? ''}" data-nick="${esc(nick)}" data-reason="${esc(r)}">${esc(r)}</button>`).join('')}</div>
    <p class="muted small">Yanlış şikâyetler de kayda geçer. Engellemek istersen şikâyetten sonra profilinden engelleyebilirsin.</p>`;
  $('#modal').classList.remove('hidden');
}

function chatTab() {
  const p = S.player, F = extra.family, inFam = !!p.family;
  const tabs = [['global', 'Genel'], ['city', 'Şehir'], ...(inFam ? [['family', 'Aile']] : []), ['dm', 'Özel']];
  let h = `<div class="chat-tabs">${tabs.map(([k, label]) => `<button class="${chatCh === k ? 'on' : ''}" data-act="chatch" data-id="${k}">${esc(label)}${
    k === 'dm' && p.unread > 0 ? ` <span class="pill">${p.unread}</span>` : k !== 'dm' && chanNew(k) && chatCh !== k ? '<span class="new-dot"></span>' : ''}</button>`).join('')}</div>`;
  if (chatCh === 'dm') return h + messagesSection();
  const note = { global: 'Bütün oyuncular burada. Saygılı ol; küfür otomatik sansürlenir, hakaret ve taciz şikâyet edilir.',
    city: `Sadece şu an ${cityName(p.city)} şehrinde olanlar görür. Başka şehre gidince o şehrin sohbetine geçersin.`,
    family: 'Sadece ailen görür.' }[chatCh];
  h += `<p class="muted small chat-note">${note}</p>`;
  if (chatCh === 'family') {
    if (!F?.family) return h + `<p class="muted">Yükleniyor…</p>`;
    const av = Object.fromEntries(F.members.map(m => [m.nick, m.avatar || 1]));
    h += `<div class="chat paper tall" id="chat">${F.messages.map(m => chatMsg(m, av[m.nick], 'family_message')).join('')}</div>
      <form class="form-row" id="chat-form"><input id="f-chat" maxlength="300" placeholder="Aileye yaz…" autocomplete="off">
        <button class="btn primary">Gönder</button></form>`;
  } else {
    const list = extra.chat || [];
    h += `<div class="chat paper tall" id="chat">${list.length ? list.map(m => chatMsg(m, m.avatar, 'chat_message')).join('')
        : '<div class="sys">Henüz kimse yazmadı. İlk sözü sen söyle.</div>'}</div>
      <form class="form-row" id="gchat-form"><input id="f-gchat" maxlength="300" placeholder="Mesaj yaz…" autocomplete="off">
        <button class="btn primary">Gönder</button></form>`;
  }
  if (p.muted_until) h += `<p class="muted small">🔇 Susturuldun: ${new Date(p.muted_until).toLocaleString('tr-TR')} tarihine kadar yazamazsın.</p>`;
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
    <div class="season-box">${X.starts_at ? pctBar(100 * (1 - secs / ((new Date(X.ends_at) - new Date(X.starts_at)) / 1000)), 'sezonun ilerleyişi') : ''}
    <div class="season-count">${days > 0 ? `${days} gün ${Math.floor(secs % 86400 / 3600)} saat` : fmt(secs)}</div>
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
      <p><button class="btn sm" data-act="closeconv">← Mesajlar</button></p>
      <div class="chat" id="dm">${extra.convMsgs.map(m => `<div class="${m.mine ? 'me' : ''}">${esc(m.text)} <time>${stamp(m.at)}</time>${!m.mine
        ? ` <a class="flag" data-report="message" data-id="${m.id}" title="Şikâyet et">⚑</a>` : ''}</div>`).join('') || '<div class="muted small">Henüz mesaj yok.</div>'}</div>
      <form class="form-row" id="dm-form"><input id="f-dm" maxlength="500" placeholder="Mesaj yaz…" autocomplete="off">
        <button class="btn primary">Gönder</button></form>`;
  }
  return `<p class="muted small chat-note">Sadece arkadaşlarınla yazışırsın. Arkadaş eklemek için Defter'deki Arkadaşlar bölümüne bak.</p>` +
    (extra.inbox.length ? extra.inbox.map(c => `<div class="card clickable" data-act="openconv" data-id="${esc(c.nick)}">
      ${portrait(c.avatar || 1, 'avatar')}<div class="grow"><div class="title">${esc(c.nick)} ${c.unread > 0 ? `<span class="pill">${c.unread}</span>` : ''}</div>
      <div class="muted small ellipsis">${esc(c.last)}</div></div></div>`).join('')
      : `<p class="muted small">Henüz mesaj yok. Arkadaşına yazmak için Defter → Arkadaşlar listesinde ✉'ye dokun.</p>`);
}

const tile = (icon, label, v) => `<div class="tile"><span class="t-ic">${icon}</span><b>${v}</b><span>${label}</span></div>`;
const MEDAL_CLS = ['gold', 'silver', 'bronze'];

// Olaylar: güne göre gruplanmış gazete sütunu
function eventsSection() {
  if (!S.events.length) return `<p class="muted small">Henüz kayda değer bir şey olmadı.</p>`;
  let day = '', h = '<div class="gazette">';
  for (const e of S.events) {
    const d = new Date(e.at), dd = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
    if (dd !== day) { h += `<div class="g-day">${dd}</div>`; day = dd; }
    h += `<div class="g-item"><time>${d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</time><p>${richText(e.text)}</p></div>`;
  }
  return h + '</div>';
}

function logTab() {
  if (logView === 'guide') return guideView();
  if (logView === 'events') return eventsView();
  if (logView === 'shop') return shopView();
  if (logView === 'ann') return annView();
  const p = S.player, pl = extra.players;
  let h = banner('ui/defter_bant', 'Defter', 'Sicilin, sezon ve şehrin dedikodusu');
  h += `<div class="card clickable guide-link" data-act="guide">${uiIcon('rehber', '📖')}<div class="grow">
      <div class="title">Rehber</div><div class="muted small">Bütün kurallar: rütbeler, ölüm ve infaz, aileler, mekânlar…</div></div>
      <span class="muted">›</span></div>`;
  h += `<div class="card clickable guide-link shop-link" data-act="shop">${uiIcon('magaza', '🛍')}<div class="grow">
      <div class="title">Mağaza ${p.club ? '<span class="club-badge">★ Kulüp</span>' : ''}</div>
      <div class="muted small">Özel portreler, aile armaları, Kabadayı Kulübü ve hızlandırma</div></div><span class="muted">›</span></div>`;
  h += accountCard();
  if (p.is_admin) h += `<a class="admin-link" href="admin.html${location.search}">🛡 Yönetim paneli</a>`;

  h += `<div class="card dossier">${portrait(p.avatar, 'avatar lg')}<div class="grow">
      <div class="d-nick">${esc(p.nick)}</div>
      <div class="muted small">${esc(rankName(p.rank))}${p.family ? ` · ${esc(p.family)}` : ''}</div>
      <div class="small d-line">${aic('ico/yuzuk', '💍')} ${p.spouse ? `${nickLink(p.spouse)} ile evli${p.spouse_rank != null ? ` · ${esc(rankName(p.spouse_rank))}` : ''} <a class="flag" data-act="divorce">boşan</a>` : 'bekâr'}</div>
      <div class="small d-line">${aic('ico/saygi', '🎩')} saygı <b>${p.respect}</b> <span class="muted">· bu hafta verebileceğin: ${p.respect_left}</span></div>
    </div></div>
    <div class="tiles">${tile(aic('rehber/olum', '☠'), 'öldürme', p.kills)}${tile(aic('ico/tabut', '⚰'), 'ölüm', p.deaths)}${tile(aic('ico/kilit', '🔓'), 'kurtarma', p.busts)}${tile(aic('rehber/kelle', '🎯'), 'nişancılık', p.kill_skill)}</div>`;

  if (extra.penalties?.length) h += `<h2>Cezalarım</h2>` + penaltiesHtml(extra.penalties);
  h += seasonSection();
  if (p.proposals.length) h += `<h2>Evlenme Teklifleri</h2>` + p.proposals.map(n => card(nickLink(n), 'sana evlenme teklif etti',
    `<div class="market-actions"><button class="btn sm primary" data-act="acceptprop" data-id="${esc(n)}">Kabul et</button>
     <button class="btn sm" data-act="rejectprop" data-id="${esc(n)}">Reddet</button></div>`, aic('ico/yuzuk', '💍'))).join('');
  if (p.proposal_to) h += card(`Teklifin: ${nickLink(p.proposal_to)}`, 'Cevap bekleniyor.', `<button class="btn sm" data-act="cancelprop">Geri çek</button>`, aic('ico/yuzuk', '💍'));
  h += friendsSection();
  h += `<div class="card clickable" data-act="suggest">${uiIcon('oneri', '💡')}<div class="grow">
      <div class="title">Öneri kutusu</div><div class="muted small">Yeni özellik, etkinlik, mod ya da değişiklik fikrini yönetime gönder</div></div>
      <span class="muted">›</span></div>`;

  if (pl) {
    h += `<h2>En Güçlüler</h2><div class="board">` + pl.top.map((t, i) => `<div class="b-row ${t.nick === p.nick ? 'me' : ''}">
        <span class="b-place ${MEDAL_CLS[i] || ''}">${i + 1}</span>${portrait(t.avatar || 1, 'avatar sm')}
        <div class="grow">${nickLink(t.nick)}<div class="muted small">${esc(rankName(t.rank))}</div></div>
        <span class="b-kills">☠ ${t.kills}</span></div>`).join('') + `</div>`;
    if (pl.rich?.length) h += `<h2>En Zenginler</h2><div class="board">` + pl.rich.map((t, i) => `<div class="b-row ${t.nick === p.nick ? 'me' : ''}">
        <span class="b-place ${MEDAL_CLS[i] || ''}">${i + 1}</span>${portrait(t.avatar || 1, 'avatar sm')}
        <div class="grow">${nickLink(t.nick)}<div class="muted small">${esc(rankName(t.rank))}</div></div>
        <span class="b-kills">${money(t.wealth)}</span></div>`).join('') + `</div>`;
    const fams = [...(extra.famRank || [])].sort((a, b) => b.power - a.power || b.members - a.members).slice(0, 5);
    if (fams.length) h += `<h2>En Güçlü Aileler</h2><div class="board">` + fams.map((f, i) => `<div class="b-row ${f.name === p.family ? 'me' : ''}">
        <span class="b-place ${MEDAL_CLS[i] || ''}">${i + 1}</span>${crest(f.name, 'sm', f.crest)}
        <div class="grow"><b>${esc(f.name)}</b><div class="muted small">${f.members} üye${f.don ? ` · Don ${esc(f.don)}` : ''}</div></div>
        <span class="b-kills">⚔ ${Math.round(f.power)}</span></div>`).join('') + `</div>`;
    const top = extra.men?.top || [];
    if (top.length) h += `<h2>En Güçlü Çeteler</h2><div class="board">` + top.map((t, i) => `<div class="b-row ${t.nick === p.nick ? 'me' : ''}">
        <span class="b-place ${MEDAL_CLS[i] || ''}">${i + 1}</span>${portrait(t.avatar || 1, 'avatar sm')}
        <div class="grow">${nickLink(t.nick)}<div class="muted small">çete gücü</div></div>
        <span class="b-kills">⚔ ${Math.round(t.power)}</span></div>`).join('') + `</div>`;
    h += `<h2>Çevrimiçi (${pl.online.length})</h2><div class="online">` + (pl.online.map(o =>
        `<div class="on-chip">${portrait(o.avatar || 1, 'avatar sm')}${nickLink(o.nick)}</div>`).join('') || '<span class="muted small">Kimse yok.</span>') + `</div>`;
  }
  h += `<h2>Olaylar</h2>` + eventsSection();
  const annNew = (heads.ann || 0) > getSeen('ann');
  h += `<div class="card clickable guide-link ann-link" data-act="ann">${uiIcon('duyuru', '📢')}<div class="grow">
      <div class="title">Duyurular ${annNew ? '<span class="new-dot"></span>' : ''}</div>
      <div class="muted small">Güncellemeler, planlı bakımlar, etkinlikler ve oyunla ilgili haberler</div></div><span class="muted">›</span></div>`;
  h += `<button class="btn settings-btn" data-act="settings">${aic('ico/ayarlar', '⚙')} Ayarlar</button>`;
  if (api.mode === 'local') h += `<p class="muted small" style="margin-top:24px">Yerel geliştirme modu.
      <button class="btn sm" data-act="reset">Yerel veriyi sıfırla</button></p>`;
  return h;
}

// ═════════════════ ETKİNLİKLER ═════════════════
const EVENTS = {
  kitlik:          { icon: '📉', name: 'Kıtlık', desc: (e) => `${S.market.find(g => g.id === e.good)?.name || 'Mal'} piyasada yok: satın alınamaz, satışta +%${Math.round(S.settings.ev_shortage_bonus * 100)} (en fazla ${S.settings.ev_shortage_cap} kasa).` },
  altin_saat:      { icon: '⭐', name: 'Altın saat', desc: () => `Bütün suçlardan +%${Math.round(S.settings.ev_golden_xp * 100)} itibar.` },
  baskin_gecesi:   { icon: '🔥', name: 'Baskın gecesi', desc: () => 'Mekân baskınlarından sonraki bekleme yarıya iner.' },
  kelle_haftasi:   { icon: '🎯', name: 'Kelle haftası', desc: () => 'Kelle listesi aracı payı yarıya iner.' },
  fabrika_kazasi:  { icon: '💥', name: 'Fabrika kazası', desc: (e) => `${cityName(e.city)} kurşun fabrikası kapalı.` },
  polis_baskini:   { icon: '🚨', name: 'Polis baskını', desc: (e) => `${cityName(e.city)}: suçlarda yakalanma riski artar, ödül +%${Math.round((S.settings.ev_police_reward - 1) * 100)}.` },
  liman_firtinasi: { icon: '🌊', name: 'Liman fırtınası', desc: (e) => `${cityName(e.city)} limanına ve limanından sefer yok.` },
};
const evActive = (e) => new Date(e.starts) <= Date.now() + clockOffset;
const hm = (d) => new Date(d).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
// Sohbet damgası: tarih + saat ("2 Eki 14:05")
const stamp = (d) => `${new Date(d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })} ${hm(d)}`;

// Haritada: bu şehirde süren ya da birazdan başlayacak etkinlikler
function eventStrip() {
  const p = S.player, soon = Date.now() + clockOffset + S.settings.ev_notice_minutes * 60e3;
  const list = (extra.events || []).filter(e => (!e.city || e.city === p.city) && new Date(e.starts) <= soon);
  if (!list.length) return '';
  return `<div class="ev-strip" data-act="evcal">${list.slice(0, 3).map(e => `<div class="ev ${evActive(e) ? 'on' : 'soon'}">
    ${img('events/' + e.kind, 'ev-ic', `<span class="ev-ic">${EVENTS[e.kind].icon}</span>`)}<b>${EVENTS[e.kind].name}</b>
    <span>${evActive(e) ? `etkin · ${fmt(left(e.ends))} kaldı` : `${fmt(left(e.starts))} sonra başlıyor`}</span></div>`).join('')}
    ${list.length > 3 ? `<div class="ev more">+${list.length - 3} etkinlik daha</div>` : ''}</div>`;
}

function eventsView() {
  const all = extra.events || [];
  const now = all.filter(evActive), later = all.filter(e => !evActive(e));
  const row = (e) => `<div class="card ev-card ${evActive(e) ? 'on' : ''}"><span class="icon emoji">${EVENTS[e.kind].icon}</span><div class="grow">
    <div class="title">${EVENTS[e.kind].name}${e.city ? ` · ${esc(cityName(e.city))}` : ''}</div>
    <div class="muted small">${evActive(e) ? `Sürüyor · ${fmt(left(e.ends))} kaldı` : `${new Date(e.starts).toLocaleDateString('tr-TR', { weekday: 'long' })} ${hm(e.starts)}–${hm(e.ends)}`}${e.planned ? '' : ' · sürpriz'}</div>
    <div class="small">${EVENTS[e.kind].desc(e)}</div></div></div>`;
  return banner('ui/defter_bant', 'Etkinlikler', 'Takvim ve sürprizler') +
    `<p><button class="btn sm" data-act="logmain">← Defter</button></p>
    <p class="muted small">Planlı etkinlikler her hafta aynı saatlerde olur (Türkiye saati). Sürpriz etkinlikler başlamadan ${S.settings.ev_notice_minutes} dakika önce haritada duyurulur.</p>
    <h2>Şu an</h2>${now.length ? now.map(row).join('') : '<p class="muted small">Şu an süren etkinlik yok.</p>'}
    <h2>Yaklaşan</h2>${later.slice(0, 20).map(row).join('') || '<p class="muted small">Yakında etkinlik yok.</p>'}`;
}

// ═════════════════ ARKADAŞLAR VE ÖNERİLER ═════════════════
function friendsSection() {
  const F = extra.friends || { friends: [], incoming: [], outgoing: [] };
  let h = `<h2>Arkadaşlar (${F.friends.length})</h2>
    <form class="form-row" id="friend-form"><input id="f-friend" placeholder="Oyuncu adı" autocomplete="off" autocapitalize="off">
      <button class="btn primary">İstek gönder</button></form>`;
  if (F.incoming.length) h += F.incoming.map(f => card(`${nickLink(f.nick)} <span class="muted small">arkadaş olmak istiyor</span>`,
      esc(rankName(f.rank)), `<div class="market-actions"><button class="btn sm primary" data-act="fraccept" data-id="${esc(f.nick)}">Kabul</button>
       <button class="btn sm" data-act="frreject" data-id="${esc(f.nick)}">Reddet</button></div>`, portrait(f.avatar || 1, 'avatar sm'))).join('');
  h += F.friends.length ? `<div class="friend-list">${F.friends.map(f => `<div class="friend">${portrait(f.avatar || 1, 'avatar sm')}
      ${f.online ? '<i class="on"></i>' : ''}<div class="grow">${nickLink(f.nick)}<div class="muted small">${esc(rankName(f.rank))}</div></div>
      <button class="btn sm" data-act="dmto" data-id="${esc(f.nick)}">✉</button></div>`).join('')}</div>`
    : `<p class="muted small">Henüz arkadaşın yok. Adını yazarak istek gönder; kabul ederse özelden yazışabilirsiniz.</p>`;
  if (F.outgoing.length) h += `<p class="muted small">Cevap bekleyen isteklerin: ${F.outgoing.map(esc).join(', ')}</p>`;
  return h;
}

const SUG_CAT = { ozellik: 'Yeni özellik', etkinlik: 'Etkinlik fikri', mod: 'Oyun modu', denge: 'Denge / değişiklik', hata: 'Hata bildirimi', diger: 'Diğer' };
const SUG_ST = { yeni: 'Gönderildi', okundu: 'Okundu', planlandi: 'Plana alındı', yapildi: 'Oyuna eklendi', reddedildi: 'Şimdilik değil' };
async function openSuggest() {
  const mine = await api.rpc('my_suggestions');
  $('#modal-body').innerHTML = `<div class="logo-sm">Öneri kutusu</div>
    <p class="small">Oyunda görmek istediğin özellik, etkinlik, mod ya da değişikliği yaz. Önerileri doğrudan yönetim okur.</p>
    <select id="f-sug-cat">${Object.entries(SUG_CAT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    <textarea id="f-sug" maxlength="1000" rows="5" placeholder="Fikrini anlat… (en az 10 karakter)"></textarea>
    <button class="btn primary" data-act="sendsug" style="width:100%;margin-top:8px">Gönder</button>
    ${mine.length ? `<h2>Önerilerin</h2>${mine.map(x => `<div class="sug"><b>${SUG_CAT[x.category]}</b> · <span class="sug-st ${x.status}">${SUG_ST[x.status]}</span>
      <div class="small">${esc(x.text)}</div>${x.note ? `<div class="muted small">Yönetim: ${esc(x.note)}</div>` : ''}</div>`).join('')}` : ''}`;
  $('#modal').classList.remove('hidden');
}

// ═════════════════ CEZALAR VE İTİRAZ ═════════════════
const PEN = { warn: '⚠ Uyarı', mute: '🔇 Susturma', ban: '⛔ Ban' };
const APPEAL = { open: 'İtirazın inceleniyor', accepted: 'İtirazın kabul edildi, ceza kaldırıldı', rejected: 'İtirazın reddedildi' };
function penaltiesHtml(list, onBanScreen = false) {
  if (!list?.length) return onBanScreen ? '' : '';
  return (onBanScreen ? `<h2>Cezaların</h2>` : '') + list.map(x => `<div class="card col penalty">
      <div class="title">${PEN[x.action]} <span class="muted small">· ${new Date(x.at).toLocaleString('tr-TR')}</span></div>
      <div class="small">Gerekçe: ${esc(x.reason || '—')}</div>
      ${x.evidence ? `<div class="evidence">Cezaya konu mesajın: “${esc(x.evidence)}”</div>` : ''}
      ${x.until ? `<div class="muted small">Bitiş: ${new Date(x.until).getFullYear() > 2100 ? 'süresiz' : new Date(x.until).toLocaleString('tr-TR')}</div>` : ''}
      ${x.appeal ? `<div class="appeal-status ${x.appeal.status}">${APPEAL[x.appeal.status]}${x.appeal.response ? `<br><span class="muted small">Not: ${esc(x.appeal.response)}</span>` : ''}</div>`
        : `<button class="btn sm" data-act="appeal" data-id="${x.id}">⚖ Haksız mı? İtiraz et</button>`}</div>`).join('') +
    `<p class="muted small">Cezanın haksız olduğunu düşünüyorsan ${S?.settings?.appeal_window_days ?? 30} gün içinde bir kez itiraz edebilirsin. İtirazları yönetim inceler.</p>`;
}
function openAppeal(id) {
  $('#modal-body').innerHTML = `<div class="logo-sm">İtiraz</div>
    <p class="small">Cezanın neden haksız olduğunu kısaca anlat. Ne olduğunu, kiminle konuştuğunu yazarsan daha hızlı sonuçlanır.</p>
    <textarea id="f-appeal" maxlength="600" rows="5" placeholder="En az 10 karakter…"></textarea>
    <button class="btn primary" data-act="sendappeal" data-id="${id}" style="width:100%;margin-top:8px">İtirazı gönder</button>`;
  $('#modal').classList.remove('hidden');
}

// ═════════════════ REHBER ═════════════════
// Bütün sayılar oyunun kendi ayarlarından gelir; bir değer değişince rehber de kendiliğinden güncellenir.
let logView = 'main';
const mins = (sec) => sec >= 3600 ? `${+(sec / 3600).toFixed(1)} saat` : `${Math.round(sec / 60)} dakika`;

function guideSections() {
  const st = S.settings, R = S.ranks, protect = R[st.protect_rank].name;
  const li = (a) => `<ul>${a.map(x => `<li>${x}</li>`).join('')}</ul>`;
  return [
    ['basla', '🎩 İlk adımlar', li([
      `Amaç: suç işleyip para ve <b>itibar</b> toplamak, rütbe atlamak, bir aileyle şehre hükmetmek.`,
      `Üstteki çubuk itibarını gösterir; dolunca rütben yükselir. Yeni rütbe yeni işler, silahlar ve ulaşım açar.`,
      `"İş hazır / Araba hazır / Vapur hazır" yazıları bekleme sürelerini gösterir; süre dolunca tekrar yapabilirsin.`,
      `Her şey bekleme süresiyle ilerler: sık sık kısa uğramak, uzun oturmaktan iyidir.`])],
    ['rutbe', '⭐ Rütbeler', `<table class="g-table"><tr><th>Rütbe</th><th>İtibar</th><th>Taşıma</th></tr>${R.map(r =>
      `<tr><td>${esc(r.name)}</td><td>${r.min_xp.toLocaleString('tr-TR')}</td><td>${r.carry} kasa</td></tr>`).join('')}</table>
      <p class="small">"Taşıma": limanda aynı anda elinde tutabileceğin kaçak mal kasası.</p>`],
    ['suc', '🕶 Suçlar ve hapis', li([
      `İşler sekmesindeki suçlar para ve itibar getirir. Şans yüzdesi kartta yazar; başarısız olursan kısa süre hapse girersin.`,
      `Her işin kendi bekleme süresi var: küçük işler ${mins(S.crimes[0].cooldown_s)}, en büyüğü ${mins(S.crimes.at(-1).cooldown_s)}. Biri beklerken diğerini yapabilirsin. Büyük işler rütbeyle açılır.`,
      `Tecrübe kazandıkça (itibar) işlerin başarı şansı artar; rütbe atlamadan da her itibar puanı şansı biraz yükseltir.`,
      `Hapisteyken firar etmeyi deneyebilirsin (hakkın sınırlı) ya da biri seni Karakol'dan kurtarabilir.`,
      `Başkalarını kurtarmak itibar kazandırır, ama gardiyana yakalanırsan ${mins(st.bust_fail_jail_s)} içeride kalırsın.`])],
    ['araba', '🚗 Arabalar ve yarış', li([
      `Garajda sokaktan araba çalarsın (${mins(st.car_cooldown_s)} arayla). Yakalanırsan kısa hapis.`,
      `Arabayı satabilir ya da hurdada ezip kurşuna çevirebilirsin (değerinin 1/${st.crusher_divisor} oranında kurşun).`,
      `Yarışlara girip para kazanabilirsin; kazanan havuzdan %${Math.round((1 - st.race_house_cut) * 100)} pay alır.`])],
    ['liman', '⚓ Kaçak mal ve yolculuk', li([
      `Rakı, şarap, tütün, kahve gibi mallar her şehirde ve her saat farklı fiyattadır: ucuza al, pahalı limanda sat. Aynı limanda satış alışın %${Math.round((1 - st.trade_sell_rate) * 100)} altındadır.`,
      `Konyak, viski, halı, mücevherat ve silah parçaları ticaret puanıyla açılır. Puan, malı aldığın limandan başka bir limanda satınca kazanılır.`,
      `Yolculuk bileti ${money(S.travel_cost ?? st.travel_cost)}. Kaçak malla yolculukta %${Math.round(st.customs_chance * 100)} ihtimalle gümrüğe takılırsın; gümrük malının yarısına el koyar.`,
      `Daha hızlı ulaşım (${S.transports.map(t => esc(t.name)).join(', ')}) seferler arası beklemeyi kısaltır.`])],
    ['silah', '🔫 Silah, koruma, nişancılık', li([
      `Silahın yoksa kimseyi vuramazsın. ${S.weapons.map(w => `${esc(w.name)}: ${money(w.price)}, kurşun ihtiyacı ×${w.bullet_mult}`).join(' · ')}.`,
      `Her koruma (en fazla 5) seni öldürmek için gereken kurşunu %20 artırır.`,
      `Şişe atışı nişancılığını artırır; 100 puanda %40 daha az kurşun gerekir.`,
      `Kurşunu Fabrika'dan saatlik sınırla, ya da Çarşı'dan oyunculardan alırsın.`])],
    ['olum', '☠ Ölüm ve infaz', li([
      `<b>${esc(protect)}</b> rütbesine kadar kimse sana dokunamaz, sen de kimseyi vuramazsın.`,
      `Birini vurmak için önce Dedektif Bürosu'ndan dedektif tutup nerede olduğunu bulmalısın (1 dedektif %10, 10 dedektif %100 şans). Bulgu 1 saat geçerli.`,
      `Hedefle aynı şehirde olmalısın. Gereken kurşun hedefin rütbesine, korumalarına, canına ve senin silahınla nişancılığına göre değişir.`,
      `Az kurşun sıkarsan sadece yaralarsın. Her atıştan sonra ${mins(st.kill_cooldown_s)} beklersin.`,
      `Öldürürsen hedefin cebindeki paradan %${Math.round(st.kill_loot_share * 100)} pay alırsın (en fazla hedefin rütbe sırası × ${money(st.kill_loot_cap_rank)}; aynı kişiden ${st.kill_loot_cooldown_h} saatte bir).`,
      `Öldürülürsen: cebindeki paradan %${Math.round(st.kill_cash_loss * 100)}, kurşunlarından %${Math.round(st.kill_bullet_loss * 100)} gider; ${mins(st.hospital_s)} hastanede yatarsın. Kalıcı ölüm yok.`,
      `Korunmak için: parayı bankaya koy, koruma tut, canını doldur, gerekirse Sığınak'a in ya da şehir değiştir.`])],
    ['kelle', '🎯 Kelle listesi', li([
      `Birinin başına en az ${money(st.bounty_min)} ödül koyabilirsin (+%${Math.round(st.bounty_fee * 100)} aracı payı).`,
      `Hedefi kim öldürürse ödülü o alır. ${st.bounty_days} gün içinde kimse öldürmezse ödül bankana geri döner.`])],
    ['banka', '🏦 Banka ve para', li([
      `Bankadaki paraya kimse dokunamaz; cebindeki para öldürülünce kısmen kaybolur. Yatırırken %${Math.round(st.bank_fee * 100)} komisyon.`,
      `Başka oyunculara para gönderebilirsin (%${Math.round(st.transfer_fee * 100)} komisyon).`])],
    ['aile', '🤝 Aile ve roller', li([
      `Bir aileye başvur ya da ${esc(R[S.settings.family_create_rank].name)} olunca kendi aileni kur.`,
      `Don ailenin başıdır; Sottocapo sağ kolu (kasa, üye atma, baskın); Consigliere başvuruları kabul eder; Capo baskın yönetir; Asker üyedir.`,
      `Aile kasası ortak paradır: mekân haraçları, fabrika satışları ve gazino payı buraya gelir.`,
      `Aileden birine silah çekilmez. Don ailenin armasını seçer.`])],
    ['mekan', '🏠 Mekânlar ve baskın', li([
      `Gazino, meyhane, kahvehane ve antrepolar sahibine saatlik haraç getirir (en fazla ${st.spot_income_cap_h} saat birikir).`,
      `Ailenin Don, Sottocapo ya da Capo'su kurşunla baskın yapıp mekânı ele geçirebilir. Şehirde çevrimiçi her aile üyesi gücü %${Math.round(st.raid_ally_bonus * 100)} artırır.`,
      `Ele geçirilen mekâna ${mins(st.spot_protect_s)} baskın yapılamaz; sahibi kurşun bırakıp tahkim eder.`,
      `Gazinoda kaybedilen bahislerden %${Math.round(st.casino_owner_cut * 100)} pay sahibi aileye gider.`])],
    ['ekip', '🚂 Ekip işleri', li([
      `Tren Soygunu, Banka Soygunu ve Büyük Liman Vurgunu birkaç kişiyle yapılır: lider, şoför, silahçı, patlayıcı uzmanı.`,
      `Lider ekibi kurar ve davet eder; herkes aynı şehirde olmalı. Şoförün belli değerde arabası, silahçının ${st.crew_gunner_bullets} kurşunu gerekir.`,
      `Ödül büyük, ama başarısız olursanız ekip hapse girebilir.`])],
    ['kumar', '🎰 Kumarhane ve şans', li([
      `Gazinoda zar, rulet, slot ve blackjack oynanır; rütbene göre en yüksek bahis sınırı var. Kasa her zaman biraz önde.`,
      `Kazı kazan ${money(st.scratch_price)}; günlük piyango bileti ${money(st.lottery_ticket)}.`])],
    ['sohbet', '💬 Sohbet ve kurallar', li([
      `Genel, şehir ve aile sohbeti var. Küfür otomatik sansürlenir.`,
      `Rahatsız eden birinin mesajına ya da portresine dokun: şikâyet et veya engelle.`,
      `Hakaret, taciz, hile ve dolandırıcılık susturma ya da banla sonuçlanır; gerekçe sana gösterilir.`])],
    ['etkinlik', '📅 Etkinlikler', li([
      `Kıtlık (her gün 17-18): kahve ya da tütün piyasadan kalkar; elinde olan %${Math.round(st.ev_shortage_bonus * 100)} primle satar (kişi başı ${st.ev_shortage_cap} kasa).`,
      `Altın saat (her gün 21-22): suçlardan %${Math.round(st.ev_golden_xp * 100)} fazla itibar.`,
      `Baskın gecesi (Cuma 21-23): baskın bekleme süresi yarıya iner. Kelle haftası (Cumartesi-Pazar): aracı payı yarıya iner.`,
      `Sürprizler: fabrika kazası, polis baskını, liman fırtınası. Başlamadan ${st.ev_notice_minutes} dakika önce haritada duyurulur.`,
      `Takvim Defter sekmesinde.`])],
    ['adam', '👥 Adamlar, Kahvehane ve baskın', li([
      `Kahvehane'den adam tutarsın: Zorba (çok can), Fedai (dengeli), Nişancı (çok hasar), Gözcü (işlerde şans). Her yeni adam bir öncekinden pahalıdır; iki adam arası ${mins(st.men_hire_cd_s ?? 1800)} beklersin.`,
      `Tutulan adam 15-30 dakika eğitimden sonra yanına katılır. Rütbene göre en fazla ${st.men_cap_base ?? 5} + rütbe başına ${st.men_cap_per_rank ?? 5} adam besleyebilirsin.`,
      `Her adamın haftalık maaşı vardır; her gün yedide biri cebinden (yetmezse bankadan) kesilir. Ödeyemezsen her gün adamların %2-4'ü seni bırakır.`,
      `Boştaki adamların seni korur: toplam canları seni vurmak için gereken kurşunu artırır. Gözcüler işlerde başarı şansını artırır (her biri +%1, en fazla +%10).`,
      `Baskın: boştaki adamların (gözcüler hariç) ve kurşunun savaşır. Her ${st.battle_bullet_div ?? 100} kurşun tur başına 1 hasar. En fazla ${st.battle_rounds ?? 5} tur; canının yarısını kaybeden dağılır, canı biten adam ölür.`,
      `Sahipsiz mekânı yerel kabadayılar korur (gelirin her 1000 doları için 12 canlı bir kabadayı). Aile mekânını mekâna bırakılan kurşun (barikat) ve nöbetçiler korur; savunan +%25 hasarla vurur.`,
      `Baskın ekranında iki tarafın gücü ve kazanma ihtimalin yazar; kurşun miktarını değiştirdikçe güncellenir. Nişancılık sadece oyuncu vururken işe yarar, baskında değil.`,
      `Adamlarını Konağın'dan görür, üstlerine dokunarak dağıtırsın.`])],
    ['sezon', '🏆 Sezonlar ve diğerleri', li([
      `Sezon ${st.season_days} gün sürer. Sonunda İtibar, İnfaz, Servet ve Aile listelerinde ilk 3'e girenler kalıcı rozet alır, sonra herkes sıfırdan başlar.`,
      `Sığınak: saatlik ücretle (en fazla ${st.hideout_max_h} saat) yer altına inersin; kimse bulamaz ama iş de yapamazsın.`,
      `Evlilik ${money(st.marriage_cost)}: profilden teklif edilir.`])],
  ];
}

function guideView() {
  return banner(hasAsset('ui/rehber_bant') ? 'ui/rehber_bant' : 'ui/defter_bant', 'Rehber', 'Merak ettiğin kurala dokun') +
    `<p><button class="btn sm" data-act="logmain">← Defter</button>
      <button class="btn sm" data-act="tutorial">▶ Hızlı eğitimi tekrar izle</button></p>` +
    guideSections().map(([id, title, body]) => `<details class="guide" id="g-${id}"><summary>${hasAsset('rehber/' + id)
      ? img('rehber/' + id, 'g-ic', '') + title.replace(/^\S+\s/, '') : title}</summary><div class="g-body">${body}</div></details>`).join('');
}

// ═════════════════ HIZLI EĞİTİM ═════════════════
// İlk girişte bir kez: kısa, görselli kartlar. Ayrıntı için en sonda Rehber'e yönlendirir.
let tutStep = 0;
function tutCards() {
  const b = (n) => img('buildings/' + n, 'tut-bld', '');
  return [
    { art: img('ui/splash', 'tut-splash', ''), title: 'İstanbul, 1922',
      text: 'İçki yasak, sokaklar aç. Sıfırdan başla, şehrin en büyük kabadayısı ol.' },
    { art: `<div class="tut-stats">${ico('can', '❤')}<b>Can</b>${ico('kursun', '🔫')}<b>Kurşun</b>${ico('banka', '🏦')}<b>Banka</b></div>
        <div class="tut-bar"><div></div></div>`, title: 'Üstteki çubuk',
      text: 'Rütben, paran ve canın hep üstte. Çubuk dolunca rütbe atlarsın; yeşil "hazır" yazıları ne yapabileceğini gösterir.' },
    { art: img('jobs/cep', 'tut-job', ''), title: 'İşler: para ve itibar',
      text: 'Suç işle, para ve itibar kazan. Yakalanırsan kısa süre hapse girersin.' },
    { art: `<div class="tut-blds">${b('banka')}${b('silahci')}${b('dedektif')}</div>`, title: 'Şehirdeki binalar',
      text: 'Haritada bir binaya dokun: banka, silahçı, dedektif, liman… Her birinin başında ne işe yaradığı yazar.' },
    { art: `<div class="tut-shield">🛡</div>`, title: 'Sokakların kuralı',
      text: `${S.ranks[S.settings.protect_rank].name} olana kadar kimse sana dokunamaz. Sonra dikkat: parayı bankaya koy, öldürülürsen cebindekini kaybedersin.` },
    { art: img('ui/aile_bant', 'tut-job', ''), title: 'Aile ve sohbet',
      text: 'Bir aileye katıl, mekânları ele geçirin. Sohbet sekmesinde şehrin ahalisiyle tanış.' },
    { art: img('ui/logo', 'tut-logo', '<div class="logo-sm">KABADAYI</div>'), title: 'Hazırsın', text: 'Merak ettiğin her kural Defter sekmesindeki Rehber\'de.', last: true },
  ];
}
const tutKey = () => 'kabadayi-tut-' + (S?.player?.nick || '');
function showTutorial(force = false) {
  try { if (!force && localStorage.getItem(tutKey())) return; } catch { if (!force) return; }
  tutStep = 0; renderTut(); $('#tutorial').classList.remove('hidden');
}
function renderTut() {
  const cards = tutCards(), c = cards[tutStep];
  $('#tutorial').innerHTML = `<div class="tut-card" key="${tutStep}">
    ${c.last ? '' : '<button class="tut-skip" data-act="tutdone">Atla</button>'}
    <div class="tut-art">${c.art}</div><h3>${c.title}</h3><p>${c.text}</p>
    <div class="tut-dots">${cards.map((_, i) => `<i class="${i === tutStep ? 'on' : ''}"></i>`).join('')}</div>
    ${c.last ? `<button class="btn primary tut-next" data-act="tutdone">Eğitimi aldım. Daha fazla bilgi için “Defter” sekmesindeki “Rehber”e girebileceğimi anladım.</button>
      <button class="btn tut-guide" data-act="tutguide">Rehberi şimdi aç</button>`
      : `<div class="tut-nav">${tutStep ? '<button class="btn" data-act="tutback">Geri</button>' : '<span></span>'}
         <button class="btn primary" data-act="tutnext">İleri</button></div>`}</div>`;
}
function endTutorial() {
  try { localStorage.setItem(tutKey(), '1'); } catch {}
  $('#tutorial').classList.add('hidden');
}
// Kaydırarak ilerleme
let tutX = null;
document.addEventListener('touchstart', (e) => { if (e.target.closest('#tutorial')) tutX = e.touches[0].clientX; }, { passive: true });
document.addEventListener('touchend', (e) => {
  if (tutX === null) return;
  const dx = e.changedTouches[0].clientX - tutX; tutX = null;
  if (Math.abs(dx) < 50) return;
  const n = tutCards().length;
  tutStep = Math.max(0, Math.min(n - 1, tutStep + (dx < 0 ? 1 : -1))); renderTut();
});

// ═════════════════ PROFİL ═════════════════
async function showProfile(nick) {
  const pr = await api.rpc('get_profile', { p_nick: nick });
  if (!pr) return toast('Böyle biri yok.', 'bad');
  const self = pr.nick === S.player.nick;
  $('#modal-body').innerHTML = `${portrait(pr.avatar, 'portrait-lg')}<div class="logo-sm">${esc(pr.nick)}</div>
    <p>${esc(rankName(pr.rank))} ${pr.online ? '· 🟢 çevrimiçi' : ''}${pr.club ? ' <span class="club-badge">★ Kulüp</span>' : ''}</p>
    ${pr.family ? `<p class="small">${esc(ROLES[pr.family_role])} · ${esc(pr.family)}</p>` : ''}
    <p class="small">Durum: ${esc(pr.status)}${pr.protected ? ` · ${aic('ico/kalkan', '🛡')} çaylak koruması` : ''}</p>
    ${pr.bounty > 0 ? `<p class="small">${aic('rehber/kelle', '🎯')} Başına ödül: <b class="cash-sm">${money(pr.bounty)}</b></p>` : ''}
    <p class="small">${aic('rehber/olum', '☠')} ${pr.kills} öldürme · ${aic('ico/tabut', '⚰')} ${pr.deaths} ölüm · ${aic('ico/kilit', '🔓')} ${pr.busts} kurtarma</p>
    ${pr.protected ? '' : `<p class="small muted">Tahmini gereken kurşun: ~${pr.est_bullets} (korumalar ve silah hariç)</p>`}
    ${pr.spouse ? `<p class="small">${aic('ico/yuzuk', '💍')} ${nickLink(pr.spouse)} ile evli${pr.spouse_rank != null ? ` · ${esc(rankName(pr.spouse_rank))}` : ''}</p>` : ''}
    ${pr.badges?.length ? `<p class="small">${badgeList(pr.badges)}</p>` : ''}
    <p class="small muted">${aic('ico/saygi', '🎩')} saygı ${pr.respect} · ${aic('rehber/araba', '🏁')} yarış formu ${pr.race_form} · katılış ${new Date(pr.joined).toLocaleDateString('tr-TR')}</p>
    ${self ? `<h2>Portreni değiştir</h2><div class="portrait-grid">${genderAvatars(S.player.gender).map(n =>
        `<button data-avatar="${n}" class="${pr.avatar === n ? 'on' : ''}">${img(`portraits/p${n}`, '', PORTRAIT_EMOJI[n - 1])}</button>`).join('')}
        ${premiumAvatars(S.player.gender).map(n => (S.player.items || []).includes('portrait_' + n)
          ? `<button data-avatar="${n}" class="${pr.avatar === n ? 'on' : ''}">${img(`portraits/p${n}`, '', '★')}</button>`
          : `<button data-act="shop" class="locked">${img(`portraits/p${n}`, '', '★')}<span class="lock-ic">${ico('kilit', '🔒')}</span></button>`).join('')}</div>
        <p class="muted small">Kilitli portreler Mağaza'da.</p>`
    : `<div class="profile-actions">
      ${pr.friend === 'friends' || S.player.is_admin ? `<button class="btn sm primary" data-act="dmto" data-id="${esc(pr.nick)}">${aic('ico/sohbet', '✉')} Mesaj</button>` : ''}
      ${pr.friend === 'friends' ? `<button class="btn sm" data-act="frremove" data-id="${esc(pr.nick)}">Arkadaşlıktan çıkar</button>`
        : pr.friend === 'sent' ? `<button class="btn sm" disabled>İstek gönderildi</button>`
        : pr.friend === 'received' ? `<button class="btn sm primary" data-act="fraccept" data-id="${esc(pr.nick)}">Arkadaşlığı kabul et</button>`
        : `<button class="btn sm primary" data-act="fradd" data-id="${esc(pr.nick)}">➕ Arkadaş ekle</button>`}
      <button class="btn sm" data-act="respect" data-id="${esc(pr.nick)}" ${dis(!S.player.respect_left)}>${aic('ico/saygi', '🎩')} Saygı</button>
      ${!S.player.spouse && !pr.spouse && pr.friend === 'friends' && pr.gender && S.player.gender && pr.gender !== S.player.gender ? (pr.proposed_to_me
        ? `<button class="btn sm" data-act="acceptprop" data-id="${esc(pr.nick)}">${aic('ico/yuzuk', '💍')} Kabul et</button>
           <button class="btn sm" data-act="rejectprop" data-id="${esc(pr.nick)}">Reddet</button>`
        : pr.i_proposed ? `<button class="btn sm" data-act="cancelprop">${aic('ico/yuzuk', '💍')} Teklifi geri çek</button>`
        : `<button class="btn sm" data-act="propose" data-id="${esc(pr.nick)}">${aic('ico/yuzuk', '💍')} Teklif</button>`) : ''}
      <button class="btn sm" data-act="${pr.blocked ? 'unblock' : 'block'}" data-id="${esc(pr.nick)}">${pr.blocked ? 'Engeli kaldır' : aic('ico/engel', '🚫') + ' Engelle'}</button>
      <button class="btn sm" data-act="reportplayer" data-id="${esc(pr.nick)}">${aic('ico/bayrak', '⚑')} Şikâyet</button>
    </div>`}`;
  $('#modal').classList.remove('hidden');
}

// ═════════════════ SAYAÇLAR ═════════════════
// Bir süre dolduğu an butonlar açılsın diye sekmeyi/paneli yeniden çizer
let lastReady = '';
function tick() {
  if (!S?.player) return;
  const p = S.player;
  const timed = [...S.crimes.map(c => c.ready_at), p.car_ready_at, p.travel_ready_at, p.jail_until, p.hospital_until, p.hideout_until,
    p.kill_ready_at, p.bust_ready_at, p.practice_ready_at, ...S.searches.map(s => s.ready_at),
    ...(extra.men ? [extra.men.hire_ready_at, ...extra.men.training.map(t => t.ready_at)] : [])];
  const ready = timed.map(t => left(t) > 0).join();
  if (ready !== lastReady) {
    // bir dedektif araması tam şimdi bittiyse sonucu sunucudan al
    if (lastReady && S.searches.some(s => !s.resolved && !left(s.ready_at))) refresh();
    // eğitimi biten adam: kahvehane verisini tazele
    if (lastReady && extra.men?.training.some(t => !left(t.ready_at))) api.rpc('get_men').then(m => { extra.men = m; refresh(); });
    lastReady = ready; renderTab();
  }
  document.querySelectorAll('[data-until]').forEach(el => el.textContent = fmt(left(el.dataset.until)));
  // Güvenlik ağı: süresi biten ama hâlâ kilitli görünen düğme kalmasın (saat farkı vb. yüzünden yeniden çizim kaçarsa)
  const stuck = (root) => root && [...root.querySelectorAll('button[disabled] [data-until]')].some(el => !left(el.dataset.until));
  if (stuck($('#sheet-body'))) renderSheet();
  if (stuck($(`section[data-tab="${tab}"]`))) renderTab();
  for (const [id, at, label] of [['t-crime', crimeReadyAt(), 'İş'], ['t-car', p.car_ready_at, 'Araba'], ['t-travel', p.travel_ready_at, 'Vapur']]) {
    const s = left(at), el = $('#' + id);
    el.textContent = s ? `${label} ${fmt(s)}` : `${label} hazır`;
    el.classList.toggle('wait', s > 0);
  }
  const j = left(p.jail_until), h = left(p.hospital_until), hid = left(p.hideout_until);
  $('#jail').classList.toggle('hidden', !j && !h && !hid);
  // şeride dokununca ilgili bina açılır (Karakol'da reklamla süreyi kısaltma da var)
  const where = j ? 'karakol' : h ? 'hastane' : hid ? 'siginak' : null;
  if (where) $('#jail').dataset.open = where; else delete $('#jail').dataset.open;
  if (j) $('#jail').textContent = `⛓ Hapistesin — ${fmt(j)}`;
  else if (h) $('#jail').textContent = `🏥 Hastanedesin — ${fmt(h)}`;
  else if (hid) $('#jail').textContent = `🕳 Sığınaktasın — ${fmt(hid)}`;
}
setInterval(tick, 1000);

// ═════════════════ ETKİLEŞİM ═════════════════
const val = (id) => $('#' + id)?.value.trim() ?? '';
const num = (id) => parseInt(val(id), 10) || 0;
const closeModal = () => { $('#modal').classList.add('hidden'); $('#modal').classList.remove('asking'); };

async function openConv(nick) {
  extra.conv = nick; chatCh = 'dm';
  closePanel();
  if (tab !== 'chat') return $('[data-go="chat"]').click();
  await refresh(); scrollChat();
}

document.addEventListener('click', async (e) => {
  const ak = e.target.closest('[data-ask]');
  if (ak) { closeModal(); const r = askResolve; askResolve = null; return r?.(ak.dataset.ask === '1'); }
  if (e.target.closest('#modal-close') || e.target.id === 'modal') { if (askResolve) { askResolve(false); askResolve = null; } return closeModal(); }
  if (e.target.closest('[data-close-sheet]') || e.target.id === 'sheet') return closePanel();

  const pick = e.target.closest('[data-pick]');
  if (pick) { pickedAvatar = +pick.dataset.pick; return renderOnboard(); }
  const gpick = e.target.closest('[data-gender]');
  if (gpick) { pickedGender = gpick.dataset.gender; pickedAvatar = genderAvatars(pickedGender)[0]; return renderOnboard(); }
  const av = e.target.closest('[data-avatar]');
  if (av) { const r = await api.rpc('set_avatar', { p_avatar: +av.dataset.avatar }); if (r.ok === false) toast(r.msg, 'bad'); closeModal(); return refresh(); }
  if (e.target.closest('[data-me]')) return showProfile(S.player.nick);
  const prof = e.target.closest('[data-profile]');
  if (prof) return showProfile(prof.dataset.profile);
  const open = e.target.closest('[data-open]');
  if (open) return openPanel(open.dataset.open);
  const rep = e.target.closest('[data-report]');
  if (rep) return openReport(rep.dataset.report, +rep.dataset.id, rep.closest('[data-mnick]')?.dataset.mnick || extra.conv || '');
  const tapMsg = e.target.closest('[data-mnick]');
  if (tapMsg) return openMsgMenu(tapMsg.dataset.mnick, tapMsg.dataset.mkind, tapMsg.dataset.mid);

  const nav = e.target.closest('[data-go]');
  if (nav) {
    if (nav.dataset.go !== tab) sfx.tab();
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
  if (b.tagName === 'BUTTON') sfx.tap();
  const id = b.dataset.id, n = +b.dataset.n;
  switch (b.dataset.act) {
    // işler, araba, ticaret
    case 'crime':      return act('do_crime', { p_crime: id }, { art: true });
    case 'car':        return act('steal_car', {}, { art: true });
    case 'sell':       return act('sell_car', { p_car_id: +id });
    case 'crush':      return await askYes('Araba hurdaya gitsin mi?') && act('crush_car', { p_car_id: +id });
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
      if (num('f-shoot-bullets') < 1) return toast('Kaç kurşun sıkacağını yaz.', 'bad');
      if (await askYes(`${val('f-shoot-target')} üzerine ${num('f-shoot-bullets')} kurşun sıkılsın mı?`)) {
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
    case 'hide':       return await askYes('Sığınağa girilsin mi?') && act('enter_hideout', { p_hours: num('f-hide-h') });
    case 'leavehide':  return act('leave_hideout');
    case 'raid':       return (num('f-raid-' + id) > 0 || extra.men?.attack > 0) && await askYes('Baskın başlasın mı? Kurşunlar geri gelmez.') &&
                         act('raid_spot', { p_spot: +id, p_bullets: num('f-raid-' + id) }, { art: true });
    case 'post':       return act('station_men', { p_spot: +id, p_type: val('f-post-type-' + id), p_qty: num('f-post-n-' + id) });
    case 'recall':     return act('recall_men', { p_spot: +id });
    case 'hireman':    return act('hire_man', { p_type: id });
    case 'fireman':    return (await ask('Adamı dağıt', `Bir <b>${esc(b.dataset.name)}</b> dağıtılsın mı? Tutarken ödediğin para geri gelmez,
                         ama maaşı da artık ödenmez. Önce boştaki adamlardan biri gider.`, 'Dağıt',
                         `<div class="ask-art">${img('men/' + id, 'shop-art', '')}</div>`)) && act('dismiss_man', { p_type: id });
    case 'fortify':    return num('f-fort-' + id) > 0 && act('fortify_spot', { p_spot: +id, p_bullets: num('f-fort-' + id) });
    // pazar
    case 'listbullets': return num('f-sell-bullets') > 0 && num('f-sell-bprice') > 0 &&
                          act('list_item', { p_kind: 'bullets', p_qty: num('f-sell-bullets'), p_car: null, p_price: num('f-sell-bprice') });
    case 'listcar':    return num('f-sell-cprice') > 0 &&
                         act('list_item', { p_kind: 'car', p_qty: null, p_car: num('f-sell-car'), p_price: num('f-sell-cprice') });
    case 'unlist':     return act('cancel_listing', { p_id: +id });
    case 'buylisting': return await askYes('Satın alınsın mı?') && act('buy_listing', { p_id: +id });
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
    case 'kick':       return await askYes(`${id} aileden atılsın mı?`) && act('kick_member', { p_nick: id });
    case 'famdeposit': return num('f-fam-dep') > 0 && act('family_deposit', { p_amount: num('f-fam-dep') });
    case 'fampay':     return val('f-pay-nick') && num('f-pay-amt') > 0 &&
                         act('family_pay', { p_nick: val('f-pay-nick'), p_amount: num('f-pay-amt') });
    case 'buyfactory': return await askYes('Fabrika kasadan satın alınsın mı?') && act('buy_factory');
    case 'facprice':   return num('f-fac-price') > 0 && act('set_factory_price', { p_price: num('f-fac-price') });
    case 'leave':      return await askYes('Emin misin?') && act('leave_family');
    // sosyal
    case 'dmto':       closeModal(); return openConv(id);
    case 'openconv':   return openConv(id);
    case 'closeconv':  extra.conv = null; return refresh();
    case 'respect': {
      const pts = parseInt(prompt(`${id} kişisine kaç saygı puanı? (kalan: ${S.player.respect_left})`, '1'), 10);
      if (pts > 0) { closeModal(); return act('give_respect', { p_nick: id, p_points: pts }); }
      return;
    }
    case 'block':      closeModal(); return await askYes(`${id} engellensin mi? Mesajlarını görmezsin.`) && act('block_player', { p_nick: id });
    case 'unblock':    closeModal(); return act('unblock_player', { p_nick: id });
    case 'reportplayer': return openReport('player', null, id);
    case 'appeal':     return openAppeal(id);
    case 'suggest':    return openSuggest();
    case 'sendsug': {
      const r = await api.rpc('submit_suggestion', { p_category: val('f-sug-cat'), p_text: $('#f-sug').value });
      toast(r.msg, r.ok ? 'good' : 'bad');
      if (r.ok) closeModal();
      return;
    }
    case 'fraccept':   return act('friend_respond', { p_nick: id, p_accept: true });
    case 'frreject':   return act('friend_respond', { p_nick: id, p_accept: false });
    case 'fradd':      closeModal(); return act('friend_request', { p_nick: id });
    case 'frremove':   closeModal(); return await askYes(`${id} arkadaş listenden çıkarılsın mı?`) && act('friend_remove', { p_nick: id });
    case 'sendappeal': {
      const r = await api.rpc('submit_appeal', { p_action: +id, p_text: $('#f-appeal').value });
      toast(r.msg, r.ok ? 'good' : 'bad');
      if (!r.ok) return;
      closeModal(); extra.penalties = await api.rpc('my_penalties');
      if (S.banned) $('#ban-appeal').innerHTML = penaltiesHtml(extra.penalties, true); else renderTab();
      return;
    }
    case 'guide':      logView = 'guide'; renderTab(); $('main').scrollTop = 0; return;
    case 'shop':       return openShop();
    case 'settings':   return openSettings();
    case 'ann':        logView = 'ann'; extra.ann = null; renderTab(); $('main').scrollTop = 0;
                       extra.ann = await api.rpc('get_announcements');
                       setSeen('ann', Math.max(heads.ann || 0, ...extra.ann.map(a => a.id), 0)); updateBadges(); return renderTab();
    case 'pushon':     { const r = await enablePush(api); toast(r.msg, r.ok ? 'good' : 'bad'); return openSettings(); }
    case 'pushoff':    { await disablePush(api); toast('Bildirimler kapatıldı.', 'good'); return openSettings(); }
    case 'acctlink': {
      const email = val('f-acct-email');
      if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Geçerli bir e-posta yaz.', 'bad');
      const r = await api.linkEmail(email);
      if (!r.ok) return toast(r.msg, 'bad');
      toast('E-postana bir onay bağlantısı gönderdik. Tıklayınca hesabın e-postana bağlanır.', 'good');
      extra.account = await api.account();
      return $('#modal').classList.contains('hidden') ? renderTab() : openSettings();
    }
    case 'acctlogin': {
      const A = api.account ? await api.account().catch(() => null) : null;
      const risk = S?.player && A && (A.anonymous || !A.email);   // bu cihazdaki karakter korunmuyor
      $('#modal-body').innerHTML = `<div class="logo-sm">E-postayla gir</div>
        <p class="small">Karakterine bağladığın e-postayı yaz. Sana bir giriş bağlantısı gönderelim; bu cihazda açınca o karakterle oyuna girersin.</p>
        ${risk ? `<p class="small" style="color:#f3c2bb">Dikkat: bu cihazdaki karakterin <b>${esc(S.player.nick)}</b> bir e-postaya bağlı değil. Başka hesaba geçersen ona bir daha giremezsin. Önce Ayarlar'dan onu da bağlayabilirsin.</p>` : ''}
        <div class="form-row"><input id="f-login-email" type="email" placeholder="E-posta adresin" autocomplete="email" autocapitalize="off">
          <button class="btn primary" data-act="acctloginsend">Gönder</button></div>
        <p class="muted small" id="login-msg"></p>`;
      $('#modal').classList.remove('hidden');
      return $('#f-login-email').focus();
    }
    case 'acctloginsend': {
      const email = val('f-login-email');
      if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Geçerli bir e-posta yaz.', 'bad');
      const r = await api.loginEmail(email);
      $('#login-msg').textContent = r.ok ? 'E-postana bir giriş bağlantısı gönderdik. Bağlantıyı bu cihazda aç.' : r.msg;
      return r.ok ? toast('Giriş bağlantısı gönderildi.', 'good') : toast(r.msg, 'bad');
    }
    case 'boost':      return openBoost(id);
    case 'useboost':   closeModal(); return act('use_boost', { p_target: b.dataset.target, p_via: id });
    case 'clubgift':   return (await ask('Kulüp hediyesi', `<b>${esc(b.dataset.name)}</b> bu ayın hediyesi olarak senin olsun mu? Ayda bir hediye seçebilirsin.`, 'Al'))
                         && act('club_claim', { p_product: id }).then(loadShop);
    case 'wear':       return act('set_avatar', { p_avatar: +id }).then(loadShop);
    case 'chatstyle': {
      const k = b.dataset.kind, P = S.player;
      return act('set_chat_style', { p_font: k === 'reset' ? '' : k === 'font' ? id : (P.chat_font || ''),
                                     p_frame: k === 'reset' ? '' : k === 'frame' ? id : (P.chat_frame || '') }).then(loadShop);
    }
    case 'shopbuy':    return toast('Ödeme, oyun telefon mağazalarına çıkınca açılacak. Çok yakında!', 'good');
    case 'evcal':      logView = 'events'; if (tab !== 'log') return $('[data-go="log"]').click(); renderTab(); $('main').scrollTop = 0; return;
    case 'logmain':    logView = 'main'; renderTab(); $('main').scrollTop = 0; return;
    case 'tutorial':   return showTutorial(true);
    case 'tutnext':    tutStep++; return renderTut();
    case 'tutback':    tutStep--; return renderTut();
    case 'tutdone':    return endTutorial();
    case 'tutguide':   endTutorial(); logView = 'guide'; return $('[data-go="log"]').click();
    case 'crest':      return act('set_family_crest', { p_crest: +id });
    case 'reportmsg':  return openReport(b.dataset.kind, b.dataset.ref ? +b.dataset.ref : null, id);
    case 'sendreport': closeModal(); return act('report_content', { p_kind: b.dataset.kind, p_ref: b.dataset.ref ? +b.dataset.ref : null,
      p_nick: b.dataset.kind === 'player' ? b.dataset.nick : null, p_reason: b.dataset.reason });
    case 'propose':    return (await ask('Evlenme teklifi', `<b>${esc(id)}</b> kişisine evlenme teklif etmek istediğine emin misin?
                         Kabul ederse düğün masrafı (${money(S.settings.marriage_cost)}) senden çıkar. Reddederse aynı kişiye ${S.settings.proposal_retry_days ?? 14} gün boyunca tekrar teklif edemezsin.`,
                         'Teklif et', `<div class="ask-art">${aic('ico/yuzuk', '💍')}</div>`)) && act('propose', { p_nick: id });
    case 'acceptprop': closeModal(); return act('accept_proposal', { p_nick: id });
    case 'rejectprop': closeModal(); return act('reject_proposal', { p_nick: id });
    case 'cancelprop': closeModal(); return act('cancel_proposal', {});
    case 'divorce':    return await askYes('Boşanmak istediğine emin misin?') && act('divorce');
    case 'chatch':     chatCh = id; extra.chat = null; extra.conv = null; renderTab(); await loadChat(); renderTab(); scrollChat(); return;
    case 'gochat':     chatCh = 'family'; return $('[data-go="chat"]').click();
    // kumarhane
    case 'lottery':    return act('buy_lottery', { p_qty: num('f-lot-n') });
    case 'scratch':    if (!blocked()) sfx.scratch(); return act('scratch_card');
    case 'casino': case 'bjstart': case 'bjhit': case 'bjstand': return playCasino(b);
    case 'betset':     if ($('#f-bet-' + b.dataset.game)) $('#f-bet-' + b.dataset.game).value = id; extra.bets = { ...extra.bets, [b.dataset.game]: id }; return;
    case 'reset':
      if (await askYes('Yerel oyun verisi silinsin mi?')) { await api.reset(); location.reload(); }
  }
});

// Kumarhane: sonucu panelde gösterir, bahis kutusu dolu kalır (aynı bahisle tekrar oynansın)
const buzz = (win) => { try { navigator.vibrate?.(win ? [40, 60, 40, 60, 120] : [180]); } catch {} };
// Zar/rulet/slot: oyun (animasyon) bitmeden yeni oyun başlamaz; sonra en az 1 sn ara (sunucu beklemesi 1 sn)
let casinoLockUntil = 0;
const CASINO_ANIM = { zar: 1000, rulet: 1500, slot: 1500 };

async function playCasino(b) {
  if (busy) return;
  if (b.dataset.act === 'casino' && Date.now() < casinoLockUntil) return;   // süren oyun var: tıklama yok sayılır
  const a = b.dataset.act, game = a === 'bjstart' ? 'bj' : b.dataset.game, bet = num('f-bet-' + game);
  if ((a === 'casino' || a === 'bjstart') && bet < 10) return toast(`Önce bu oyunun bahsini yaz (en az ${moneyText(10)}).`, 'bad');
  let choice = b.dataset.choice || null;
  if (choice === 'num') { if (val('f-rulet-n') === '') return toast('0-36 arası bir sayı yaz.', 'bad'); choice = String(num('f-rulet-n')); }
  busy = true;
  if (a === 'casino') casinoLockUntil = Infinity;
  // Oyunun sesi hemen; sonuç sesi animasyon bitince. Hapiste/hastanede/sığınaktaysa oyun yok: sadece ret sesi
  const g = a === 'casino' ? b.dataset.game : 'bj', quiet = blocked();
  if (!quiet) {
    if (a === 'casino') sfx.bet();
    if (g === 'zar') setTimeout(sfx.dice, 120); else if (g === 'rulet') setTimeout(sfx.roulette, 150); else if (g === 'slot') setTimeout(sfx.slot, 150);
    else if (a === 'bjstart') { sfx.bet(); sfx.shuffle(); setTimeout(sfx.deal, 700); setTimeout(sfx.deal, 950); } else if (a === 'bjhit') sfx.deal();
  }
  const resultDelay = { zar: 800, slot: 1500 }[g] || 0;   // rulet: sonuç sesi hemen
  try {
    const r = a === 'casino' ? await api.rpc('play_casino', { p_game: b.dataset.game, p_bet: bet, p_choice: choice })
      : a === 'bjstart' ? await api.rpc('bj_start', { p_bet: bet })
      : await api.rpc(a === 'bjhit' ? 'bj_hit' : 'bj_stand');
    if (game && bet) extra.bets = { ...extra.bets, [game]: bet };   // aynı bahisle tekrar oynanabilsin
    if (!r.ok) { if (!/karıştırıyor/.test(r.msg || '')) { toast(r.msg, 'bad'); sfx.error(); } }   // bekleme mesajı gösterilmez
    else if (a === 'casino') extra.casino = r;
    else {
      if (a === 'bjstart') extra.bjSeen = { d: 0, p: 0 };
      extra.bj = r;
      extra.bjReveal = r.done ? 1 : null;
    }
    S = await api.rpc('get_state'); render();
    if (a === 'casino') casinoLockUntil = Date.now() + (r.ok ? Math.max(1000, CASINO_ANIM[g] || 0) : 1000);   // animasyon bitene kadar
    // Krupiye: gizli kartı çevirir, sonra gerekirse tek tek çeker
    while (extra.bj === r && r.done && extra.bjReveal != null && extra.bjReveal < cards(r.dealer).length) {
      await new Promise(res => setTimeout(res, 2000));   // her kart arası 2 sn: gerilim
      if (extra.bj !== r) break;
      extra.bjReveal++; render(); sfx.card();
    }
    // Sonuç belli olunca telefona kısa titreşim (destekleyen tarayıcılarda; iOS Safari desteklemez)
    if (r.ok && (a === 'casino' || (r.done && extra.bj === r))) {
      buzz(r.win > 0);
      setTimeout(() => r.win > 0 ? sfx.casinoWin() : sfx.casinoLose(), resultDelay);
    }
  } finally { busy = false; if (casinoLockUntil === Infinity) casinoLockUntil = Date.now() + 1000; }
}

document.addEventListener('change', async (e) => {
  if (e.target.id === 'f-shoot-target') { extra.shootPrev = null; $('#shoot-prev').innerHTML = shootPrevHtml(null); return loadShootPrev(e.target.value); }
  const sel = e.target.closest('[data-role]');
  if (!sel) return;
  if (sel.value === 'don' && !await askYes(`Donluk devredilsin mi? Yeni Don: ${sel.dataset.role}. Sen Sottocapo olursun.`)) return renderTab();
  act('set_role', { p_nick: sel.dataset.role, p_role: sel.value });
});

document.addEventListener('submit', async (e) => {
  if (e.target.id === 'dm-form') {
    e.preventDefault();
    const text = val('f-dm');
    if (!text) return;
    const r = await api.rpc('send_message', { p_nick: extra.conv, p_text: text });
    if (!r.ok) return toast(r.msg, 'bad');
    $('#f-dm').value = ''; sfx.msg();
    extra.convMsgs = await api.rpc('get_conversation', { p_nick: extra.conv });
    renderTab(); scrollChat();
  } else if (e.target.id === 'friend-form') {
    e.preventDefault();
    const nick = val('f-friend');
    if (!nick) return;
    $('#f-friend').value = '';
    return act('friend_request', { p_nick: nick });
  } else if (e.target.id === 'gchat-form') {
    e.preventDefault();
    const text = val('f-gchat');
    if (!text) return;
    const r = await api.rpc('send_chat', { p_channel: chatCh, p_text: text });
    if (!r.ok) return toast(r.msg, 'bad');
    $('#f-gchat').value = ''; sfx.msg();
    await loadChat(); renderTab(); scrollChat();
  } else if (e.target.id === 'chat-form') {
    e.preventDefault();
    const text = val('f-chat');
    if (!text) return;
    const r = await api.rpc('post_family_message', { p_text: text });
    if (!r.ok) return toast(r.msg, 'bad');
    $('#f-chat').value = ''; sfx.msg();
    await loadFamily(); renderTab(); scrollChat();
  } else if (e.target.id === 'nick-form') {
    e.preventDefault();
    if (!pickedGender) { $('#nick-err').textContent = 'Önce cinsiyetini seç.'; return; }
    const r = await api.rpc('create_character', { p_nick: $('#nick').value.trim(), p_gender: pickedGender, p_avatar: pickedAvatar });
    if (!r.ok) { $('#nick-err').textContent = r.msg; return; }
    await refresh();
    setSince(S.now); poll();   // yeni karakter: duyuru ve bildirimler hemen
  }
});

// Açık sohbetteki son mesaj (yeni mesaj sesi için)
function lastChatMsg() {
  const L = chatCh === 'dm' ? (extra.conv ? extra.convMsgs : null) : chatCh === 'family' ? extra.family?.messages : extra.chat;
  const m = L?.[L.length - 1];
  return m ? { k: `${m.id ?? ''}|${m.at}|${m.text}`, mine: m.mine ?? m.nick === S.player.nick } : null;
}
const scrollChat = () => { for (const c of [$('#chat'), $('#dm')]) if (c) c.scrollTop = c.scrollHeight; };
// Sohbet sekmesi (kanal ya da özel mesaj) açıkken 10 sn'de bir tazele (yazarken bölme)
setInterval(async () => {
  if (document.hidden || !S?.player) return;
  if (tab === 'chat') {
    if ([$('#f-chat'), $('#f-gchat'), $('#f-dm')].some(i => i && i === document.activeElement && i.value)) return;
    const before = lastChatMsg(), ch = chatCh;
    await loadChat();
    const after = lastChatMsg();   // açık sohbete başkasından yeni mesaj geldi: tok tık
    if (before && after && ch === chatCh && after.k !== before.k && !after.mine) sfx.msg();
  } else return;
  renderTab(); scrollChat();
}, 6000);

// Uygulama arka plandan dönünce durumu tazele
document.addEventListener('visibilitychange', () => { if (!document.hidden && api) { refresh(); poll(); } });

// ═════════════════ BİLDİRİMLER ═════════════════
// Sohbet kanallarında görülen son mesaj (cihazda saklanır); yeni mesaj varsa kırmızı nokta
const seenKey = (ch) => 'kb_seen_' + (ch === 'city' ? 'city:' + S.player.city : ch);
const getSeen = (ch) => { try { return +localStorage.getItem(seenKey(ch)) || 0; } catch { return 0; } };
const setSeen = (ch, id) => { try { if (id > getSeen(ch)) localStorage.setItem(seenKey(ch), id); } catch {} };
let heads = {}, pollSince = null, lastHour = null, catchUp = false;
// Son bakılan an cihazda saklanır: oyunu açınca "sen yokken" olanlar (vurulma, baskın…) pencerede gösterilir
const sinceKey = () => 'kb_since:' + S.player.nick;
function setSince(t) { pollSince = t; try { localStorage.setItem(sinceKey(), t); } catch {} }
function startSince() {
  let t = null; try { t = localStorage.getItem(sinceKey()); } catch {}
  const now = new Date(S.now).getTime(), day = 86400000;
  // ilk kez (kayıt yoksa) son 24 saate bak; çok eskiyse en fazla 3 gün geriye
  const from = t ? Math.max(new Date(t).getTime(), now - 3 * day) : now - day;
  pollSince = new Date(from).toISOString(); catchUp = true;
}
const chanNew = (ch) => (heads[ch] || 0) > getSeen(ch);
function markSeen() {
  if (tab !== 'chat' || chatCh === 'dm') return;
  const ids = chatCh === 'family' ? (extra.family?.messages || []).map(m => m.id || 0) : (extra.chat || []).map(m => m.id || 0);
  setSeen(chatCh, Math.max(heads[chatCh] || 0, ...ids, 0));
}
function updateBadges() {
  if (!S?.player) return;
  markSeen();
  const anyNew = ['global', 'city', 'family'].some(ch => (ch !== 'family' || S.player.family) && chanNew(ch));
  const nav = $('[data-go="chat"]');
  nav.dataset.badge = S.player.unread > 0 ? S.player.unread : '';
  nav.classList.toggle('has-dot', anyNew && !(S.player.unread > 0));
  // Aile: yeni başvuru ya da aile duyurusu · İşler: ekip daveti. Sekme açılınca görüldü sayılır.
  if (tab === 'family') { setSeen('apps', heads.apps || 0); setSeen('famnews', heads.famnews || 0); }
  if (tab === 'crime') setSeen('crew', heads.crew || 0);
  $('[data-go="family"]').classList.toggle('has-dot', tab !== 'family' && ['apps', 'famnews'].some(k => (heads[k] || 0) > getSeen(k)));
  $('[data-go="crime"]').classList.toggle('has-dot', tab !== 'crime' && (heads.crew || 0) > getSeen('crew'));
  $('[data-go="log"]').classList.toggle('has-dot', !(tab === 'log' && logView === 'ann') && (heads.ann || 0) > getSeen('ann'));
  document.querySelectorAll('.chat-tabs [data-act="chatch"]').forEach(b => {
    const ch = b.dataset.id; if (ch === 'dm') return;
    const dot = b.querySelector('.new-dot'), want = chanNew(ch) && chatCh !== ch;
    if (want && !dot) b.insertAdjacentHTML('beforeend', '<span class="new-dot"></span>'); else if (!want && dot) dot.remove();
  });
}
async function poll() {
  if (!api || !S?.player || document.hidden) return;
  try {
    const n = await api.rpc('notify_poll', { p_since: pollSince || S.now });
    if (!n.heads) return;
    heads = n.heads;
    // ilk açılışta eski mesajlar "yeni" sayılmasın
    for (const ch of ['global', 'city', 'family', 'famnews']) if (heads[ch] && !getSeen(ch) && !localStorage.getItem('kb_init_' + seenKey(ch))) {
      setSeen(ch, heads[ch]); try { localStorage.setItem('kb_init_' + seenKey(ch), 1); } catch {}
    }
    if (n.unread !== S.player.unread) { S.player.unread = n.unread; if (tab === 'chat' && chatCh === 'dm') refresh(); }
    const was = catchUp; catchUp = false;
    const rest = showAlerts([...n.events, ...n.family_news].map(e => e.text), was);
    if (!was) for (const t of rest) toast('📣 ' + t, 'good');   // açılışta eski olaylar bildirim yağdırmasın (Defter'de duruyor)
    if (n.events.length + n.family_news.length > rest.length) refresh();   // can, para, mekân değişti
    if (!was && (n.events.length || n.family_news.length)) sfx.notify();
    setSince(n.now);
    updateBadges();
  } catch (e) { console.warn('poll', e); }
}
setInterval(poll, 15000);
// Limanda fiyatlar her saat başı değişir: bir kez haber ver
setInterval(() => {
  if (!S?.player || document.hidden) return;
  const h = Math.floor((Date.now() + clockOffset) / 3600000);
  if (lastHour !== null && h !== lastHour) toast('⚓ Limanlarda fiyatlar değişti; yeni fırsatlara bak.', 'good');
  lastHour = h;
}, 10000);

// Yükleme çubuğu: oran ve aşama yazısı (çubuk geri gitmez)
function loadProgress(f, label) {
  const bar = $('#load-bar'), txt = $('#load-text');
  if (!bar) return;
  bar.style.width = Math.max(parseFloat(bar.style.width) || 0, Math.round(f * 100)) + '%';
  if (label) txt.textContent = label;
}

try {
  [api] = await Promise.all([createBackend(loadProgress), probeAssets()]);
  if (api.mode === 'local') window.kbDev = api;   // sadece yerel deneme: konsoldan kbDev.sql(...) ile hızlı test
  loadProgress(1, 'Hazır');
  for (const [tab, name] of [['city', 'sehir'], ['crime', 'isler'], ['family', 'aile'], ['chat', 'sohbet'], ['log', 'defter']]) {
    const b = $(`nav [data-go="${tab}"] b`);
    if (b) b.innerHTML = ico(name, b.textContent);
  }
  if (api.mode === 'local') Object.assign(window, { devApi: api, devRefresh: refresh });
  await refresh();
  if (S?.player) { startSince(); poll(); }   // bildirimlerin başlangıç noktası: son bakılan an (sen yokken olanlar)
  registerSW();   // bildirimler ve Ana Ekrana ekleme için
} catch (e) {
  console.error(e);
  $('#loading').innerHTML = `<img class="logo-img" src="assets/ui/logo.png" alt="KABADAYI">
    <p class="err">Sunucuya bağlanılamadı.</p><button class="btn primary" onclick="location.reload()">Tekrar dene</button>`;
}
