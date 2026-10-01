import { createBackend } from './backend.js';
import { probeAssets, img, hasAsset, assetUrl, ico } from './assets.js';

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
  else if (tab === 'chat') await loadChat();
}

// Sohbet sekmesi: genel, şehir ya da aile kanalı
let chatCh = 'global';
async function loadChat() {
  if (chatCh === 'family') { await loadFamily(); if (!extra.family?.family) chatCh = 'global'; else return; }
  extra.chat = await api.rpc('get_chat', { p_channel: chatCh });
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
  $('#h-stats').innerHTML = `${ico('can', '❤')} ${p.health} · ${ico('kursun', '🔫')} ${p.bullets} kurşun · ${ico('banka', '🏦')} ${money(p.bank)}`;
  $('[data-go="log"]').dataset.badge = p.unread > 0 ? p.unread : '';
  $('#xpbar div').style.width = next ? `${100 * (p.xp - rank.min_xp) / (next.min_xp - rank.min_xp)}%` : '100%';
  renderTab();
  tick();
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
  $('#onboard-portraits').innerHTML = Array.from({ length: 8 }, (_, i) =>
    `<button type="button" data-pick="${i + 1}" class="${pickedAvatar === i + 1 ? 'on' : ''}">${img(`portraits/p${i + 1}`, '', PORTRAIT_EMOJI[i])}</button>`).join('');
}

// Yeniden çizimde yazılan input değerleri kaybolmasın
function keepInputs(el, fn) {
  const keep = {};
  el.querySelectorAll('input[id], select[id]').forEach(i => keep[i.id] = i.value);
  const open = [...el.querySelectorAll('details[id][open]')].map(d => d.id);
  el.innerHTML = fn();
  for (const [id, v] of Object.entries(keep)) { const i = el.querySelector('#' + id); if (i) i.value = v; }
  for (const id of open) { const d = el.querySelector('#' + id); if (d) d.open = true; }
}

function renderTab() {
  keepInputs($(`section[data-tab="${tab}"]`), ({ city: cityTab, crime: crimeTab, family: familyTab, chat: chatTab, log: logTab })[tab]);
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
    karakol: `Yakalananlar burada yatar. İçerideysen firar etmeyi deneyebilirsin (hakkın sınırlı). Dışarıdaysan
      mahkûmları kurtarıp itibar kazanırsın ama gardiyana yakalanırsan sen de içeri girersin.`,
    hastane: `Vurulunca canın düşer; canın ne kadar azsa seni öldürmek o kadar az kurşun ister. Burada parayla canını doldurursun.
      Öldürülürsen bir süre burada yatarsın.`,
    banka: `Öldürülürsen cebindeki paranın ${pct(st.kill_cash_loss)}'ini kaybedersin; bankadaki paraya kimse dokunamaz.
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
        <p class="muted small">Az kurşun sıkarsan sadece yaralarsın. Hedefin profilinde tahmini kurşun ihtiyacı yazar (korumalar hariç).</p>`
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
      ${raidWait ? `<p class="muted small">${ico('kum', '⏳')} Ailenin sıradaki baskını: ${fmt(raidWait)}</p>` : ''}`;
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
// Sekme başı: resimli bant + başlık levhası
function banner(asset, title, sub = '', extra = '') {
  return `<div class="banner">${img(asset, 'banner-img', '')}${extra}
    <div class="banner-title" ${title.length > 12 ? 'style="font-size:21px;letter-spacing:2px"' : ''}>${title}${sub ? `<small>${sub}</small>` : ''}</div></div>`;
}
const pctBar = (v, label) => `<div class="odds"><div style="width:${Math.max(0, Math.min(100, v))}%"></div><span>${label}</span></div>`;

function crimeTab() {
  const wait = waiting(S.player.crime_ready_at);
  return banner('ui/isler_bant', 'İşler', 'Küçük işle başla, büyük vurgunla çık') +
    `<h2>Suçlar</h2><div class="jobs-grid">` + S.crimes.map(c => {
    const locked = S.player.rank < c.min_rank, pct = Math.round(c.chance * 100);
    return `<div class="card job ${locked ? 'locked' : ''}">
      <div class="job-art">${img('jobs/' + c.id, 'art', `<div class="art ph">${JOB_EMOJI[c.id]}</div>`)}
        ${locked ? `<div class="lock"><span>${ico('kilit', '🔒')}</span><em>${esc(rankName(c.min_rank))}</em></div>`
          : `<span class="coin">${money(c.reward_min)}–${money(c.reward_max)}</span>`}</div>
      <div class="body"><div class="title">${esc(c.name)}</div>
        ${locked ? '' : pctBar(pct, `%${pct} şans`)}
        ${locked ? '' : `<button class="btn sm primary" data-act="crime" data-id="${c.id}" ${dis(wait)}>${
          wait && !blocked() ? ico('kum', '⏳') + ' ' + fmt(left(S.player.crime_ready_at)) : 'Yap'}</button>`}</div>
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
          <div class="slots">${t.roles.map(r => slot(r, '')).join('')}</div></div></div>`;
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
function crest(name, cls = '') {
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return `<span class="crest ${cls}" style="--hue:${hue}"><span>${esc(name.trim()[0]?.toLocaleUpperCase('tr-TR') || '?')}</span></span>`;
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
      ${crest(f.name)}<div class="grow"><div class="title">${esc(f.name)}</div>
        <div class="don">${f.don ? `${portrait(f.don_avatar || 1, 'avatar xs')} Don ${esc(f.don)}` : 'Don yok'}</div>
        <div class="stats">${stat(ico('uye', '👤'), f.members, 'üye')}${stat(ico('fabrika', '🏭'), f.factories, 'fabrika')}${stat(ico('mekan', '🏠'), f.spots ?? 0, 'mekân')}</div></div>
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
  let h = banner('ui/aile_bant', esc(F.family.name), `${ROLES[role]} olarak`, crest(F.family.name, 'on-banner'));
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
  h += `<div class="card clickable chat-link" data-act="gochat"><span class="icon emoji">💬</span><div class="grow">
      <div class="title">Aile sohbeti</div><div class="muted small ellipsis">${last ? `${esc(last.nick)}: ${esc(last.text)}` : 'Henüz mesaj yok.'}</div></div>
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
  return `<div class="msg ${mine ? 'me' : ''}">${portrait(avatar || 1, 'avatar xs')}<div class="bubble">
    <b>${mine ? esc(m.nick) : nickLink(m.nick)}</b> ${esc(m.text)}${mine ? ''
      : ` <a class="flag" data-report="${kind}" data-id="${m.id}" title="Şikâyet et">⚑</a>`}</div></div>`;
}

function chatTab() {
  const p = S.player, F = extra.family, inFam = !!p.family;
  const tabs = [['global', 'Genel'], ['city', cityName(p.city)], ...(inFam ? [['family', 'Aile']] : [])];
  let h = `<div class="chat-tabs">${tabs.map(([k, label]) => `<button class="${chatCh === k ? 'on' : ''}" data-act="chatch" data-id="${k}">${esc(label)}</button>`).join('')}</div>`;
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
      <p><button class="btn sm" data-act="closeconv">← Gelen kutusu</button></p>
      <div class="chat" id="dm">${extra.convMsgs.map(m => `<div class="${m.mine ? 'me' : ''}">${esc(m.text)}${!m.mine
        ? ` <a class="flag" data-report="message" data-id="${m.id}" title="Şikâyet et">⚑</a>` : ''}</div>`).join('') || '<div class="muted small">Henüz mesaj yok.</div>'}</div>
      <form class="form-row" id="dm-form"><input id="f-dm" maxlength="500" placeholder="Mesaj yaz…" autocomplete="off">
        <button class="btn primary">Gönder</button></form>`;
  }
  return `<h2>Mesajlar${S.player.unread ? ` (${S.player.unread} yeni)` : ''}</h2>` +
    (extra.inbox.length ? extra.inbox.map(c => `<div class="card clickable" data-act="openconv" data-id="${esc(c.nick)}">
      <span class="icon emoji">${c.unread > 0 ? '📩' : '✉'}</span><div class="grow"><div class="title">${esc(c.nick)} ${c.unread > 0 ? `<span class="pill">${c.unread}</span>` : ''}</div>
      <div class="muted small ellipsis">${esc(c.last)}</div></div></div>`).join('')
      : `<p class="muted small">Mesaj yok. Birine yazmak için profiline dokun.</p>`);
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
    h += `<div class="g-item"><time>${d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</time><p>${esc(e.text)}</p></div>`;
  }
  return h + '</div>';
}

function logTab() {
  const p = S.player, pl = extra.players;
  let h = banner('ui/defter_bant', 'Defter', 'Sicilin, sezon ve şehrin dedikodusu');
  if (p.is_admin) h += `<a class="admin-link" href="admin.html">🛡 Yönetim paneli</a>`;

  h += `<div class="card dossier">${portrait(p.avatar, 'avatar lg')}<div class="grow">
      <div class="d-nick">${esc(p.nick)}</div>
      <div class="muted small">${esc(rankName(p.rank))}${p.family ? ` · ${esc(p.family)}` : ''}</div>
      <div class="small d-line">💍 ${p.spouse ? `${esc(p.spouse)} ile evli <a class="flag" data-act="divorce">boşan</a>` : 'bekâr'}</div>
      <div class="small d-line">🤝 saygı <b>${p.respect}</b> <span class="muted">· bu hafta verebileceğin: ${p.respect_left}</span></div>
    </div></div>
    <div class="tiles">${tile('☠', 'öldürme', p.kills)}${tile('⚰', 'ölüm', p.deaths)}${tile('🔓', 'kurtarma', p.busts)}${tile('🎯', 'nişancılık', p.kill_skill)}</div>`;

  h += seasonSection();
  if (p.proposals.length) h += `<h2>Evlenme Teklifleri</h2>` + p.proposals.map(n => card(nickLink(n), 'sana evlenme teklif etti',
    `<button class="btn sm primary" data-act="acceptprop" data-id="${esc(n)}">Kabul et</button>`, '<span class="icon emoji">💍</span>')).join('');
  h += messagesSection();

  if (pl) {
    h += `<h2>En Büyükler</h2><div class="board">` + pl.top.map((t, i) => `<div class="b-row ${t.nick === p.nick ? 'me' : ''}">
        <span class="b-place ${MEDAL_CLS[i] || ''}">${i + 1}</span>${portrait(t.avatar || 1, 'avatar sm')}
        <div class="grow">${nickLink(t.nick)}<div class="muted small">${esc(rankName(t.rank))}</div></div>
        <span class="b-kills">☠ ${t.kills}</span></div>`).join('') + `</div>`;
    h += `<h2>Çevrimiçi (${pl.online.length})</h2><div class="online">` + (pl.online.map(o =>
        `<div class="on-chip">${portrait(o.avatar || 1, 'avatar sm')}${nickLink(o.nick)}</div>`).join('') || '<span class="muted small">Kimse yok.</span>') + `</div>`;
  }
  h += `<h2>Olaylar</h2>` + eventsSection();
  if (api.mode === 'local') h += `<p class="muted small" style="margin-top:24px">Yerel geliştirme modu.
      <button class="btn sm" data-act="reset">Yerel veriyi sıfırla</button></p>`;
  return h;
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
    case 'chatch':     chatCh = id; extra.chat = null; renderTab(); await loadChat(); renderTab(); scrollChat(); return;
    case 'gochat':     chatCh = 'family'; return $('[data-go="chat"]').click();
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
  } else if (e.target.id === 'gchat-form') {
    e.preventDefault();
    const text = val('f-gchat');
    if (!text) return;
    const r = await api.rpc('send_chat', { p_channel: chatCh, p_text: text });
    if (!r.ok) return toast(r.msg, 'bad');
    $('#f-gchat').value = '';
    await loadChat(); renderTab(); scrollChat();
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
  if (tab === 'chat') {
    if ([$('#f-chat'), $('#f-gchat')].some(i => i && i === document.activeElement && i.value)) return;
    await loadChat();
  } else if (tab === 'log' && extra.conv) {
    if ($('#f-dm') === document.activeElement && val('f-dm')) return;
    extra.convMsgs = await api.rpc('get_conversation', { p_nick: extra.conv });
  } else return;
  renderTab(); scrollChat();
}, 6000);

// Uygulama arka plandan dönünce durumu tazele
document.addEventListener('visibilitychange', () => { if (!document.hidden && api) refresh(); });

// Yükleme çubuğu: oran ve aşama yazısı (çubuk geri gitmez)
function loadProgress(f, label) {
  const bar = $('#load-bar'), txt = $('#load-text');
  if (!bar) return;
  bar.style.width = Math.max(parseFloat(bar.style.width) || 0, Math.round(f * 100)) + '%';
  if (label) txt.textContent = label;
}

try {
  [api] = await Promise.all([createBackend(loadProgress), probeAssets()]);
  loadProgress(1, 'Hazır');
  for (const [tab, name] of [['city', 'sehir'], ['crime', 'isler'], ['family', 'aile'], ['chat', 'sohbet'], ['log', 'defter']]) {
    const b = $(`nav [data-go="${tab}"] b`);
    if (b) b.innerHTML = ico(name, b.textContent);
  }
  if (api.mode === 'local') Object.assign(window, { devApi: api, devRefresh: refresh });
  await refresh();
} catch (e) {
  console.error(e);
  $('#loading').innerHTML = `<img class="logo-img" src="assets/ui/logo.png" alt="KABADAYI">
    <p class="err">Sunucuya bağlanılamadı.</p><button class="btn primary" onclick="location.reload()">Tekrar dene</button>`;
}
