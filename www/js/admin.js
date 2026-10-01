// Yönetim paneli. Yetki sunucuda: admins tablosunda olmayan hesap her çağrıda NOT_ADMIN alır.
import { createBackend } from './backend.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
import { money } from './locale.js';
const when = (t) => t ? new Date(t).toLocaleString('tr-TR') : '—';
const KIND = { message: 'Özel mesaj', family_message: 'Aile sohbeti', chat_message: 'Genel/şehir sohbeti', player: 'Oyuncu' };
const ACTION = { warn: 'Uyarı', mute: 'Susturma', unmute: 'Susturma kaldırıldı', ban: 'Ban', unban: 'Ban kaldırıldı',
  delete_message: 'Mesaj silindi', dismiss: 'Şikâyet kapatıldı', resolve: 'Şikâyet çözüldü',
  grant: 'Moderatör yapıldı', revoke: 'Moderatörlük alındı', season: 'Sezon',
  appeal_accept: 'İtiraz kabul', appeal_reject: 'İtiraz ret', staff_warn: 'Yetkili uyarıldı' };
const ROLE = { owner: 'Admin', moderator: 'Moderatör' };
// Admin araçları (yetkililer, itirazlar, kalıcı ban, sezon) sadece adminin kendi bilgisayarından (localhost) açılır.
// Asıl güvenlik sunucuda: bu işlemler admin hesabı dışında her yerden reddedilir. Bu ek bir katmandır.
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

// me.role: 'owner' | 'moderator' — sadece görünüm için; asıl kontrol sunucuda her çağrıda yapılır
let api, me = {}, view = 'overview', reportStatus = 'open', playerNick = '', appealStatus = 'open';
const isOwner = () => me.role === 'owner' && LOCAL;

let toastTimer;
function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast ' + (bad ? 'bad' : 'good');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}

async function call(name, args) {
  const r = await api.rpc(name, args);
  if (r && r.msg) toast(r.msg, r.ok === false);
  return r;
}

// ─────────────── Görünümler ───────────────
function showCount(n, ap = 0) {
  $('#open-count').textContent = n;
  $('#open-count').classList.toggle('hidden', !n);
  const a = $('#appeal-count');
  if (a) { a.textContent = ap; a.classList.toggle('hidden', !ap); }
}

async function overview() {
  const o = await api.rpc('admin_overview');
  showCount(o.open_reports, o.open_appeals);
  return `<div class="stats-grid">
      <div class="stat"><b>${o.players}</b>oyuncu</div>
      <div class="stat"><b>${o.online}</b>şu an çevrimiçi</div>
      <div class="stat"><b>${o.active_24h}</b>son 24 saatte</div>
      <div class="stat"><b class="${o.open_reports ? 'warn' : ''}">${o.open_reports}</b>açık şikâyet</div>
      <div class="stat"><b>${o.banned}</b>banlı</div>
      ${isOwner() ? `<div class="stat"><b class="${o.open_appeals ? 'warn' : ''}">${o.open_appeals}</b>açık itiraz</div>` : ''}
    </div>
    <h2>Sezon</h2>
    <div class="report"><b>${esc(o.season.name)}</b>
      <div class="meta">Başlangıç ${when(o.season.starts_at)} · Bitiş ${when(o.season.ends_at)}</div>
      ${isOwner() ? `<div class="actions"><input id="season-end" type="datetime-local">
        <button class="btn" data-a="season-set">Bitişi değiştir</button>
        <button class="btn danger" data-a="season-end">Sezonu şimdi bitir</button></div>
      <p class="meta">Sezon bitince şeref listesi kaydedilir ve herkesin ilerlemesi sıfırlanır. Geri alınamaz.</p>`
      : `<p class="meta">Sezonu sadece admin değiştirebilir.</p>`}</div>`;
}

async function reports() {
  const list = await api.rpc('admin_reports', { p_status: reportStatus });
  const tabs = [['open', 'Açık'], ['actioned', 'İşlem yapılan'], ['dismissed', 'Kapatılan']]
    .map(([k, v]) => `<button class="btn sm ${reportStatus === k ? 'primary' : ''}" data-status="${k}">${v}</button>`).join('');
  return `<div class="subtabs">${tabs}</div>` + (list.length ? list.map(r => `
    <div class="report">
      <div class="meta">#${r.id} · ${KIND[r.kind]} · ${when(r.created_at)}</div>
      <div><b>${esc(r.reporter)}</b> → <a class="nick-link" data-nick="${esc(r.target)}">${esc(r.target)}</a>
        <span class="meta">(hakkında ${r.target_reports} şikâyet${r.target_banned ? ' · BANLI' : ''}${r.target_muted ? ' · susturulmuş' : ''})</span></div>
      ${r.snapshot ? `<div class="quote">${esc(r.snapshot)}</div>` : ''}
      ${contextHtml(r.context)}
      <div class="meta">Gerekçe: ${esc(r.reason)}</div>
      ${r.status === 'open' ? `<div class="actions">
        <input id="reason-${r.id}" placeholder="Oyuncunun göreceği gerekçe">
        ${r.still_exists ? `<button class="btn sm" data-a="delete" data-kind="${r.kind}" data-ref="${r.ref_id}" data-report="${r.id}">Mesajı sil</button>` : ''}
        <button class="btn sm" data-a="warn" data-nick="${esc(r.target)}" data-report="${r.id}">Uyar</button>
        <button class="btn sm" data-a="mute" data-hours="24" data-nick="${esc(r.target)}" data-report="${r.id}">24 sa sustur</button>
        <button class="btn sm danger" data-a="ban" data-hours="168" data-nick="${esc(r.target)}" data-report="${r.id}">7 gün ban</button>
        ${isOwner() ? `<button class="btn sm danger" data-a="ban" data-nick="${esc(r.target)}" data-report="${r.id}">Kalıcı ban</button>` : ''}
        <button class="btn sm primary" data-a="dismiss" data-report="${r.id}">Sorun yok, kapat</button>
      </div>` : ''}
    </div>`).join('') : `<p class="muted">Bu listede şikâyet yok.</p>`);
}

async function player() {
  let h = `<form class="form-row" id="search"><input id="q" placeholder="Takma ad" value="${esc(playerNick)}" autocapitalize="off">
    <button class="btn primary">Ara</button></form>`;
  if (!playerNick) return h;
  const p = await api.rpc('admin_player', { p_nick: playerNick });
  if (!p) return h + `<p class="muted">Böyle bir oyuncu yok.</p>`;
  const banned = p.banned_until && new Date(p.banned_until) > new Date();
  const muted = p.muted_until && new Date(p.muted_until) > new Date();
  h += `<div class="dossier report"><h2>${esc(p.nick)}</h2><table>
    <tr><td>Durum</td><td>${banned ? `<b class="warn">BANLI</b> (${esc(p.ban_reason)}) ${new Date(p.banned_until).getFullYear() > 2100 ? 'kalıcı' : 'bitiş ' + when(p.banned_until)}` : muted ? `susturulmuş, bitiş ${when(p.muted_until)}` : 'normal'}</td></tr>
    <tr><td>Rütbe / itibar</td><td>${p.rank} / ${p.xp}</td></tr>
    <tr><td>Nakit / banka / kurşun</td><td>${money(p.cash)} / ${money(p.bank)} / ${p.bullets}</td></tr>
    <tr><td>Aile</td><td>${p.family ? esc(p.family) + ' (' + esc(p.family_role) + ')' : '—'}</td></tr>
    <tr><td>Öldürme / ölüm / saygı</td><td>${p.kills} / ${p.deaths} / ${p.respect}</td></tr>
    <tr><td>Hakkında şikâyet / yaptığı şikâyet</td><td>${p.reports_against} / ${p.reports_made}</td></tr>
    <tr><td>Onu engelleyen</td><td>${p.blocked_by} kişi</td></tr>
    <tr><td>Katılış / son görülme</td><td>${when(p.created_at)} / ${when(p.last_seen)}</td></tr>
    </table>
    <div class="actions"><input id="reason-p" placeholder="Oyuncunun göreceği gerekçe">
      <button class="btn sm" data-a="warn" data-nick="${esc(p.nick)}">Uyar</button>
      ${muted ? `<button class="btn sm" data-a="unmute" data-nick="${esc(p.nick)}">Susturmayı kaldır</button>`
              : `<button class="btn sm" data-a="mute" data-hours="24" data-nick="${esc(p.nick)}">24 sa sustur</button>`}
      ${banned ? `<button class="btn sm primary" data-a="unban" data-nick="${esc(p.nick)}">Banı kaldır</button>`
               : `<button class="btn sm danger" data-a="ban" data-hours="168" data-nick="${esc(p.nick)}">7 gün ban</button>
                  ${isOwner() ? `<button class="btn sm danger" data-a="ban" data-nick="${esc(p.nick)}">Kalıcı ban</button>` : ''}`}
    </div></div>
    <h2>Moderasyon geçmişi</h2>${p.history.length ? p.history.map(a => `<p class="small">${when(a.at)} · <b>${ACTION[a.action]}</b> ${esc(a.reason || '')}</p>`).join('') : '<p class="muted small">Yok.</p>'}
    <h2>Son özel mesajları</h2>${p.messages.length ? p.messages.map(m => `<p class="small">${when(m.at)} → ${esc(m.to)}: ${esc(m.text)}
      <a class="flag" data-a="delete" data-kind="message" data-ref="${m.id}">sil</a></p>`).join('') : '<p class="muted small">Yok.</p>'}
    <h2>Son aile mesajları</h2>${p.family_messages.length ? p.family_messages.map(m => `<p class="small">${when(m.at)}: ${esc(m.text)}
      <a class="flag" data-a="delete" data-kind="family_message" data-ref="${m.id}">sil</a></p>`).join('') : '<p class="muted small">Yok.</p>'}
    <h2>Son olaylar</h2>${p.events.map(e => `<p class="small muted">${when(e.at)} · ${esc(e.text)}</p>`).join('')}`;
  return h;
}

async function log() {
  const list = await api.rpc('admin_log');
  return `<h2>İşlem geçmişi</h2>` + (list.length ? list.map(a => `<p class="small">${when(a.at)} · <span class="muted">${esc(a.admin || '?')}</span> · <b>${ACTION[a.action] || a.action}</b>
    ${a.target ? `→ <a class="nick-link" data-nick="${esc(a.target)}">${esc(a.target)}</a>` : ''} ${esc(a.reason || '')}
    ${a.until ? `<span class="muted">(bitiş ${when(a.until)})</span>` : ''}</p>`).join('') : '<p class="muted">Henüz işlem yok.</p>');
}

async function team() {
  const list = await api.rpc('admin_team');
  return `<h2>Yetkililer</h2>
    <p class="meta">Moderatörler şikâyetlere bakar; en fazla 7 gün ban, 72 saat susturma verebilir, saatte en fazla 10 ban atabilir.
      Kalıcı ban, sezon ve yetki dağıtmak sadece adminde. Admine ve diğer yetkililere işlem yapamazlar.</p>` +
    list.map(a => `<div class="report"><b>${esc(a.nick || '(silinmiş)')}</b> · ${ROLE[a.role]}
      <div class="meta">Yetki: ${when(a.granted_at)} · son 24 saatte ${a.actions_24h} işlem
        ${a.role === 'moderator' ? ` · haksız bulunan ceza: <b class="${a.overturned ? 'warn' : ''}">${a.overturned}</b> · uyarı: ${a.staff_warns}` : ''}</div>
      ${a.role === 'moderator' ? `<div class="actions"><button class="btn sm danger" data-a="revoke" data-nick="${esc(a.nick)}">Yetkiyi al</button></div>` : ''}</div>`).join('') +
    `<h2>Moderatör ekle</h2><form id="grant-form" class="actions"><input id="grant-nick" placeholder="Oyuncu adı" autocomplete="off">
      <button class="btn primary">Moderatör yap</button></form>
    <p class="meta">Sadece güvendiğin, tanıdığın kişilere ver. Yetkiyi istediğin an buradan geri alabilirsin.</p>`;
}

const PEN = { warn: 'Uyarı', mute: 'Susturma', ban: 'Ban' };
async function appeals() {
  const list = await api.rpc('admin_appeals', { p_status: appealStatus });
  return `<h2>Ceza itirazları</h2><div class="actions">${['open', 'accepted', 'rejected'].map(s => `<button class="btn sm ${appealStatus === s ? 'primary' : ''}"
      data-astatus="${s}">${{ open: 'Açık', accepted: 'Kabul edilen', rejected: 'Reddedilen' }[s]}</button>`).join('')}</div>` +
    (list.length ? list.map(a => `<div class="report">
      <b><a class="nick-link" data-nick="${esc(a.player.nick)}">${esc(a.player.nick)}</a></b>
      <span class="meta">· katılış ${when(a.player.joined)} · ${a.player.reports_against} şikâyet · toplam ${a.player.penalties_total} ceza
        ${a.player.banned ? ' · <b class="warn">banlı</b>' : ''}${a.player.muted ? ' · susturulmuş' : ''}</span>
      <div class="meta">Ceza: <b>${PEN[a.penalty.action]}</b> · ${when(a.penalty.at)} ${a.penalty.until ? `· bitiş ${when(a.penalty.until)}` : ''}</div>
      <div class="meta">Cezayı veren: <b>${esc(a.staff.nick || '?')}</b> (${ROLE[a.staff.role] || 'yetkisi alınmış'}) · daha önce haksız bulunan cezası: ${a.staff.overturned}</div>
      <div class="meta">Gerekçe: ${esc(a.penalty.reason || '—')}</div>
      ${a.penalty.evidence ? `<div class="quote">Kanıt: ${esc(a.penalty.evidence)}</div>` : ''}
      ${contextHtml(a.penalty.context)}
      <div class="quote">İtiraz (${when(a.at)}): ${esc(a.text)}</div>
      ${a.status === 'open' ? `<input id="resp-${a.id}" placeholder="Oyuncuya not (isteğe bağlı)">
        <div class="actions"><button class="btn sm primary" data-a="appeal-accept" data-id="${a.id}">Haklı: cezayı kaldır</button>
          <button class="btn sm" data-a="appeal-reject" data-id="${a.id}">Haksız: reddet</button></div>
        ${a.staff.role === 'moderator' ? `<div class="actions"><input id="sw-${a.id}" placeholder="Moderatöre uyarı gerekçesi">
          <button class="btn sm danger" data-a="warn-staff" data-nick="${esc(a.staff.nick)}" data-id="${a.id}">${esc(a.staff.nick)} adlı moderatörü uyar</button></div>` : ''}`
      : `<div class="meta">Sonuç: ${a.status === 'accepted' ? 'kabul' : 'ret'} · ${when(a.resolved_at)} ${a.response ? '· ' + esc(a.response) : ''}</div>`}
    </div>`).join('') : '<p class="muted">Bu listede itiraz yok.</p>');
}

// Konuşma bağlamı: şikâyet edilen mesajın öncesi ve sonrası (hedef işaretli)
const contextHtml = (ctx) => ctx?.length ? `<details class="ctx" open><summary class="meta">Konuşma (öncesi ve sonrası)</summary>
  ${ctx.map(m => `<div class="ctx-line ${m.target ? 'target' : ''}"><span class="meta">${when(m.at)}</span> <b>${esc(m.nick || '?')}:</b> ${esc(m.text)}</div>`).join('')}</details>` : '';

const SUG_CAT = { ozellik: 'Yeni özellik', etkinlik: 'Etkinlik', mod: 'Oyun modu', denge: 'Denge/değişiklik', hata: 'Hata', diger: 'Diğer' };
const SUG_ST = { yeni: 'Yeni', okundu: 'Okundu', planlandi: 'Planlandı', yapildi: 'Yapıldı', reddedildi: 'Reddedildi' };
let sugStatus = 'yeni';
async function suggestions() {
  const list = await api.rpc('admin_suggestions', { p_status: sugStatus });
  return `<h2>Oyuncu önerileri</h2><div class="actions">${['yeni', 'okundu', 'planlandi', 'yapildi', 'reddedildi', 'hepsi'].map(s =>
      `<button class="btn sm ${sugStatus === s ? 'primary' : ''}" data-sstatus="${s}">${SUG_ST[s] || 'Hepsi'}</button>`).join('')}</div>` +
    (list.length ? list.map(x => `<div class="report"><b>${SUG_CAT[x.category]}</b> · <a class="nick-link" data-nick="${esc(x.nick || '')}">${esc(x.nick || '?')}</a>
      <span class="meta">· ${when(x.at)} · ${SUG_ST[x.status]}</span><div class="quote">${esc(x.text)}</div>
      <input id="sn-${x.id}" placeholder="Oyuncuya not (isteğe bağlı)" value="${esc(x.note || '')}">
      <div class="actions">${['okundu', 'planlandi', 'yapildi', 'reddedildi'].map(s =>
        `<button class="btn sm ${s === 'reddedildi' ? '' : 'primary'}" data-a="sug" data-id="${x.id}" data-st="${s}">${SUG_ST[s]}</button>`).join('')}</div></div>`).join('')
      : '<p class="muted">Bu listede öneri yok.</p>');
}

async function render() {
  try {
    $('#view').innerHTML = await ({ overview, reports, player, log, team, appeals, suggestions })[view]();
    if (view !== 'overview') { const o = await api.rpc('admin_overview'); showCount(o.open_reports, o.open_appeals); }
  } catch (e) {
    console.error(e);
    $('#view').innerHTML = /NOT_ADMIN/.test(e.message)
      ? `<p class="err">Bu sayfayı görme yetkin yok.</p>` : `<p class="err">Hata: ${esc(e.message)}</p>`;
  }
}

function go(v) {
  view = v;
  document.querySelectorAll('.admin-nav button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  render();
}

// ─────────────── Etkileşim ───────────────
document.addEventListener('click', async (e) => {
  const nav = e.target.closest('[data-view]');
  if (nav) return go(nav.dataset.view);
  const sst = e.target.closest('[data-sstatus]');
  if (sst) { sugStatus = sst.dataset.sstatus; return render(); }
  const ast = e.target.closest('[data-astatus]');
  if (ast) { appealStatus = ast.dataset.astatus; return render(); }
  const st = e.target.closest('[data-status]');
  if (st) { reportStatus = st.dataset.status; return render(); }
  const nick = e.target.closest('[data-nick]:not([data-a])');
  if (nick) { playerNick = nick.dataset.nick; return go('player'); }

  const b = e.target.closest('[data-a]');
  if (!b) return;
  const a = b.dataset.a, report = b.dataset.report ? +b.dataset.report : null;
  const reason = ($(report ? `#reason-${report}` : '#reason-p')?.value || '').trim();
  const hours = b.dataset.hours ? +b.dataset.hours : null;

  if (a === 'delete') {
    if (!confirm('Mesaj silinsin mi?')) return;
    await call('admin_delete_message', { p_kind: b.dataset.kind, p_id: +b.dataset.ref, p_report: report });
  } else if (a === 'dismiss') {
    await call('admin_act', { p_nick: null, p_action: 'dismiss', p_hours: null, p_reason: reason, p_report: report });
  } else if (a === 'appeal-accept' || a === 'appeal-reject') {
    const accept = a === 'appeal-accept';
    if (accept && !confirm('Ceza kaldırılsın mı?')) return;
    await call('admin_resolve_appeal', { p_id: +b.dataset.id, p_accept: accept, p_response: $(`#resp-${b.dataset.id}`)?.value || null });
  } else if (a === 'sug') {
    await call('admin_suggestion_set', { p_id: +b.dataset.id, p_status: b.dataset.st, p_note: $(`#sn-${b.dataset.id}`)?.value || null });
  } else if (a === 'warn-staff') {
    await call('admin_warn_staff', { p_nick: b.dataset.nick, p_reason: $(`#sw-${b.dataset.id}`)?.value || '' });
  } else if (a === 'revoke') {
    if (!confirm(`${b.dataset.nick} moderatörlükten alınsın mı?`)) return;
    await call('admin_revoke', { p_nick: b.dataset.nick });
  } else if (a === 'season-end') {
    if (!confirm('Sezon ŞİMDİ bitsin mi? Herkesin ilerlemesi sıfırlanır, geri alınamaz.')) return;
    await call('admin_end_season');
  } else if (a === 'season-set') {
    const v = $('#season-end').value;
    if (!v) return toast('Önce tarih seç.', true);
    await call('admin_set_season_end', { p_ends_at: new Date(v).toISOString() });
  } else {
    if (a === 'ban' && !confirm(`${b.dataset.nick} ${hours ? hours / 24 + ' gün' : 'KALICI olarak'} banlansın mı?`)) return;
    await call('admin_act', { p_nick: b.dataset.nick, p_action: a, p_hours: hours, p_reason: reason, p_report: report });
  }
  render();
});

document.addEventListener('submit', async (e) => {
  if (e.target.id === 'grant-form') {
    e.preventDefault();
    const nick = $('#grant-nick').value.trim();
    if (!nick || !confirm(`${nick} moderatör yapılsın mı? Şikâyetleri görüp oyunculara ceza verebilecek.`)) return;
    await call('admin_grant', { p_nick: nick });
    return render();
  }
  if (e.target.id !== 'search') return;
  e.preventDefault();
  playerNick = $('#q').value.trim();
  render();
});

api = await createBackend();
// Yetkisi olmayan hiçbir şey görmez; sahip olmayan "Yetkililer" sekmesini görmez
try { me = await api.rpc('admin_me'); } catch { me = {}; }
if (!me.role) {
  $('.admin-nav').remove();
  $('#view').innerHTML = `<p class="err">Bu sayfayı görme yetkin yok.</p>`;
} else {
  $('#admin-who').textContent = `${me.nick} · ${ROLE[me.role]}`;
  if (isOwner()) $('.admin-nav').insertAdjacentHTML('beforeend',
    '<button data-view="appeals">İtirazlar <span id="appeal-count" class="pill hidden"></span></button><button data-view="suggestions">Öneriler</button><button data-view="team">Yetkililer</button>');
  else if (me.role === 'owner') $('#view').insertAdjacentHTML('beforebegin',
    '<p class="meta" style="padding:0 16px">Admin araçları (itirazlar, yetkililer, kalıcı ban, sezon) sadece kendi bilgisayarından açılır.</p>');
  render();
}
setInterval(() => { if (me.role && view === 'overview' && !document.hidden) render(); }, 30000);
