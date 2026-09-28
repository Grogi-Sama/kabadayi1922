import { createBackend } from './backend.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => '$' + Number(n).toLocaleString('tr-TR');

let api, S, clockOffset = 0, busy = false, tab = 'crime', qty = 1;
const extra = { jail: [], players: null, family: null, families: [], hitlist: [], crews: null, casino: null };   // sekmeye girince çekilen listeler

// Sunucu saatine göre kalan saniye (telefon saati yanlış olsa da doğru sayar)
const left = (iso) => Math.max(0, Math.ceil((new Date(iso) - (Date.now() + clockOffset)) / 1000));
const fmt = (s) => s >= 3600 ? `${Math.floor(s / 3600)} sa ${Math.floor(s % 3600 / 60)} dk` : s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} sn`;

async function refresh() {
  S = await api.rpc('get_state');
  if (S.player) clockOffset = new Date(S.now) - Date.now();
  if (S.player && tab === 'city') extra.jail = await api.rpc('get_jail');
  if (S.player && tab === 'log') extra.players = await api.rpc('get_players');
  if (S.player && tab === 'arms') extra.hitlist = await api.rpc('get_hitlist');
  if (S.player && tab === 'family') await loadFamily();
  if (S.player && tab === 'crime') extra.crews = await api.rpc('get_crews');
  render();
}

async function loadFamily() {
  extra.family = await api.rpc('get_family');
  extra.families = extra.family.family ? [] : await api.rpc('get_families');
}

async function act(name, args) {
  if (busy) return;
  busy = true;
  document.body.style.cursor = 'progress';
  try {
    const r = await api.rpc(name, args);
    toast(r.msg, r.ok === false || r.success === false ? 'bad' : 'good');
    // başarılı işlemden sonra tutar/isim kutuları boşalsın (seçim kutuları kalsın)
    if (r.ok !== false) document.querySelectorAll(`section[data-tab="${tab}"] input`).forEach(i => i.value = '');
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
  $('#h-rank').textContent = rank.name + (next ? ` · ${p.xp}/${next.min_xp} itibar` : ' · zirvede')
    + (p.family ? ` · ${p.family}` : '') + (p.bounty > 0 ? ` · 🎯 başına ${money(p.bounty)}` : '');
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
  el.innerHTML = ({ crime: crimeTab, trade: tradeTab, arms: armsTab, family: familyTab, city: cityTab, log: logTab })[tab]();
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
  (here.length ? here.map(c => card(esc(c.name), `${money(c.value)} · hurdası ${Math.max(1, Math.floor(c.value / S.settings.crusher_divisor))} kurşun`,
    `<div class="market-actions"><button class="btn sm" data-act="sell" data-id="${c.id}">Sat</button>
     <button class="btn sm" data-act="crush" data-id="${c.id}">Ez</button></div>`)).join('')
    : `<p class="muted small">Bu şehirde araban yok.</p>`) +
  (away ? `<p class="muted small">Başka şehirlerde ${away} araban var; satmak için oraya git.</p>` : '') +
  crewSection();
}

// ── Ekip işleri (soygun / organize iş)
const CREW_ROLES = { lider: 'Lider', sofor: 'Şoför', silahci: 'Silahçı', patlayici: 'Patlayıcı Uzmanı' };

function crewSection() {
  const X = extra.crews;
  if (!X) return '';
  let h = `<h2>Ekip İşleri</h2>`;
  const active = X.crews.filter(c => c.status === 'forming');
  const mine = active.find(c => c.i_lead);

  for (const c of active) {
    const t = X.types.find(x => x.id === c.type);
    const me = c.members.find(m => m.nick === S.player.nick);
    const list = c.members.map(m => `${CREW_ROLES[m.role]}: ${nickLink(m.nick)} ${m.accepted === true ? '✅' : m.accepted === false ? '❌' : '⏳'}`).join('<br>');
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
      if (locked) { h += `<div class="card locked"><div class="grow"><div class="title">${esc(t.name)}</div>
        <div class="muted small">🔒 ${esc(rankName(t.min_rank))} rütbesi gerekir</div></div></div>`; continue; }
      const req = [`lider ${money(t.leader_cost)} + silah + ${X.settings.leader_bullets} kurşun`,
        `şoförün en az ${money(t.car_min_value)} arabası`,
        t.roles.includes('silahci') ? `silahçı ${X.settings.gunner_bullets} kurşun` : '',
        t.roles.includes('patlayici') ? `patlayıcı ${money(X.settings.explosive_cost)}` : ''].filter(Boolean).join(' · ');
      h += `<div class="card col"><div class="title">${esc(t.name)} <span class="muted small">${money(t.payout_min)}–${money(t.payout_max)}</span></div>
        <div class="muted small">${req}. Herkes aynı şehirde olmalı.</div>
        ${wait ? `<div class="muted small">⏳ ${fmt(wait)} sonra tekrar</div>` : `
        ${t.roles.slice(1).map(r => `<input id="f-crew-${t.id}-${r}" placeholder="${CREW_ROLES[r]} (takma ad)" autocomplete="off" autocapitalize="off">`).join('')}
        <button class="btn primary" data-act="crewcreate" data-id="${t.id}">Ekibi kur, davet et</button>`}</div>`;
    }
  }
  return h;
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
    <p class="muted small">Bilet ${money(S.travel_cost)}. Kaçak malla yolculukta gümrüğe takılma riski var.</p>` +
    S.cities.map(c => {
      const here = c.id === S.player.city;
      return card(esc(c.name), here ? 'Buradasın' : '',
        `<button class="btn sm ${here ? '' : 'primary'}" data-act="travel" data-id="${c.id}" ${dis(here || travelWait)}>Git</button>`);
    }).join('') + transportSection();
}

function transportSection() {
  const cur = S.transports.find(t => t.id === S.player.transport);
  return `<h2>Ulaşım</h2><p class="muted small">Şu an: <b>${esc(cur.name)}</b> · her yolculuktan sonra ${cur.cooldown_s / 60} dk bekleme.</p>` +
    S.transports.filter(t => t.cooldown_s < cur.cooldown_s).map(t => {
      const locked = S.player.rank < t.min_rank;
      return `<div class="card ${locked ? 'locked' : ''}"><div class="grow"><div class="title">${esc(t.name)}</div>
        <div class="muted small">${locked ? '🔒 ' + esc(rankName(t.min_rank)) : money(t.price)} · ${t.cooldown_s / 60} dk bekleme</div></div>
        <button class="btn sm primary" data-act="transport" data-id="${t.id}" ${dis(locked)}>Al</button></div>`;
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

  h += `<h2>Kelle Listesi</h2>` +
    (extra.hitlist.length ? extra.hitlist.map(b => card(nickLink(b.nick), esc(rankName(b.rank)),
      `<span class="cash-sm">${money(b.amount)}</span>`)).join('') : `<p class="muted small">Listede kimse yok.</p>`) +
    `<div class="form-row"><input id="f-bounty-nick" placeholder="Kimin başına" autocomplete="off" autocapitalize="off">
      <input id="f-bounty-amt" type="number" min="1" placeholder="Ödül $" inputmode="numeric">
      <button class="btn primary" data-act="bounty">Koy</button></div>
    <p class="muted small">En az ${money(S.settings.bounty_min)}. Aracıya %${Math.round(S.settings.bounty_fee * 100)} pay. Ödülü onu öldüren alır.</p>`;
  return h;
}

// ── Aile
const ROLES = { don: 'Don', sottocapo: 'Sottocapo', consigliere: 'Consigliere', capo: 'Capo', asker: 'Asker' };

function familyTab() {
  const F = extra.family;
  if (!F) return `<h2>Aile</h2><p class="muted">Yükleniyor…</p>`;
  if (!F.family) {
    let h = `<h2>Aile</h2><p class="muted small">Tek başına kabadayı olunmaz. Bir aileye katıl ya da kendi aileni kur.</p>`;
    if (F.application) h += card(`Başvurun: ${esc(F.application.family)}`, 'Yönetimin cevabı bekleniyor.',
      `<button class="btn sm" data-act="cancelapp">Geri çek</button>`);
    h += `<h2>Aileler</h2>` + (extra.families.length ? extra.families.map(f => card(esc(f.name),
      `Don: ${f.don ? esc(f.don) : '—'} · ${f.members} üye · 🏭 ${f.factories}`,
      `<button class="btn sm primary" data-act="apply" data-id="${esc(f.name)}">Başvur</button>`)).join('')
      : `<p class="muted small">Henüz aile yok.</p>`);
    h += `<h2>Aile Kur</h2>` + (F.can_create
      ? `<div class="form-row"><input id="f-fam-name" placeholder="Aile adı" autocomplete="off">
          <button class="btn primary" data-act="createfam">${money(F.create_cost)}</button></div>`
      : `<p class="muted small">🔒 Aile kurmak için ${esc(rankName(S.settings.family_create_rank))} olmalısın (${money(F.create_cost)}).</p>`);
    return h;
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
      ? `<div><b>${esc(m.nick)}:</b> ${esc(m.text)}</div>` : `<div class="muted small">— ${esc(m.text)}</div>`).join('')}</div>
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
  h += `<p style="margin-top:20px"><button class="btn" data-act="leave">${isDon && F.members.length === 1 ? 'Aileyi dağıt' : 'Aileden ayrıl'}</button></p>`;
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

  h += casinoSection();
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
    ${c ? `<div class="casino-result ${c.win > 0 ? 'good' : 'bad'}">${esc(c.msg)}</div>` : ''}`;
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
    ${pr.family ? `<p class="small">${esc(ROLES[pr.family_role])} · ${esc(pr.family)}</p>` : ''}
    <p class="small">Durum: ${esc(pr.status)}${pr.protected ? ' · 🛡 çaylak koruması' : ''}</p>
    ${pr.bounty > 0 ? `<p class="small">🎯 Başına ödül: <b class="cash-sm">${money(pr.bounty)}</b></p>` : ''}
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
    if (['crime', 'city', 'log', 'arms', 'family'].includes(tab)) refresh().then(scrollChat);
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
    case 'bounty':     return val('f-bounty-nick') && num('f-bounty-amt') > 0 &&
                         act('place_bounty', { p_nick: val('f-bounty-nick'), p_amount: num('f-bounty-amt') });
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
    case 'crush':      return confirm('Araba hurdaya gitsin mi?') && act('crush_car', { p_car_id: +id });
    case 'transport':  return act('buy_transport', { p_id: id });
    case 'crewcreate': {
      const t = extra.crews.types.find(x => x.id === id), invites = {};
      for (const r of t.roles.slice(1)) invites[r] = val(`f-crew-${id}-${r}`);
      if (Object.values(invites).some(v => !v)) return toast('Bütün rollere birini yaz.', 'bad');
      return act('create_crew', { p_type: id, p_invites: invites });
    }
    case 'crewyes':    return act('respond_crew', { p_crew: +id, p_accept: true });
    case 'crewno':     return act('respond_crew', { p_crew: +id, p_accept: false });
    case 'crewstart':  return act('start_crew');
    case 'crewcancel': return act('cancel_crew');
    case 'casino': {
      const bet = num('f-bet');
      if (bet < 10) return toast('Önce bahsini yaz (en az $10).', 'bad');
      let choice = b.dataset.choice || null;
      if (choice === 'num') { if (val('f-rulet-n') === '') return toast('0-36 arası bir sayı yaz.', 'bad'); choice = String(num('f-rulet-n')); }
      if (busy) return;
      busy = true;
      try {
        const r = await api.rpc('play_casino', { p_game: b.dataset.game, p_bet: bet, p_choice: choice });
        extra.casino = r.ok ? r : null;
        if (!r.ok) toast(r.msg, 'bad');
        S = await api.rpc('get_state'); render();
        $('#f-bet').value = bet;   // aynı bahisle tekrar oynanabilsin
      } finally { busy = false; }
      return;
    }
    case 'reset':
      if (confirm('Yerel oyun verisi silinsin mi?')) { await api.reset(); location.reload(); }
  }
});

document.addEventListener('change', (e) => {
  const sel = e.target.closest('[data-role]');
  if (!sel) return;
  if (sel.value === 'don' && !confirm(`Donluk devredilsin mi? Yeni Don: ${sel.dataset.role}. Sen Sottocapo olursun.`)) return renderTab();
  act('set_role', { p_nick: sel.dataset.role, p_role: sel.value });
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'chat-form') return;
  e.preventDefault();
  const text = val('f-chat');
  if (!text) return;
  const r = await api.rpc('post_family_message', { p_text: text });
  if (!r.ok) return toast(r.msg, 'bad');
  $('#f-chat').value = '';
  await loadFamily(); renderTab(); scrollChat();
});

const scrollChat = () => { const c = $('#chat'); if (c) c.scrollTop = c.scrollHeight; };
// Aile sekmesi açıkken sohbeti 10 sn'de bir tazele (yazarken bölme)
setInterval(async () => {
  if (tab !== 'family' || !extra.family?.family || document.hidden) return;
  if ($('#f-chat') === document.activeElement && val('f-chat')) return;
  await loadFamily(); renderTab(); scrollChat();
}, 10000);

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
