// Ses ve müzik. Dosya gerektirmez: müzik ve efektler tarayıcının ses motoruyla (WebAudio) oyun içinde üretilir.
// assets/audio/muzik.mp3 varsa müzik olarak o çalınır. Ayarlar cihazda saklanır; ilk açılışta müzik %20.
// Tarayıcılar sesi ilk dokunuştan önce başlatmaya izin vermez: ses motoru ilk dokunuşta açılır.

const KEY = 'kb_audio';
const DEFAULTS = { music: 0.2, sfx: 0.6, musicOn: true, sfxOn: true };
let cfg = { ...DEFAULTS };
try { cfg = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {} };

let ctx, musicBus, sfxBus, fileMusic, started = false, schedTimer;
export const audioSettings = () => ({ ...cfg });

export function setAudio(patch) {
  Object.assign(cfg, patch); save();
  if (musicBus) musicBus.gain.setTargetAtTime(cfg.musicOn ? cfg.music : 0, ctx.currentTime, 0.2);
  if (sfxBus) sfxBus.gain.value = cfg.sfxOn ? cfg.sfx : 0;
  if (fileMusic) fileMusic.volume = cfg.musicOn ? cfg.music : 0;
}

function boot() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.gain.value = cfg.sfxOn ? cfg.sfx : 0; sfxBus.connect(ctx.destination);
  musicBus.gain.setTargetAtTime(cfg.musicOn ? cfg.music : 0, ctx.currentTime, 1.5);   // yavaşça girsin
  startMusic();
}
// İlk dokunuşta ses motorunu aç; sekme arka plana geçince müziği duraklat
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { boot(); if (ctx?.state === 'suspended') ctx.resume(); }, { passive: true }));
document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.hidden) { ctx.suspend(); fileMusic?.pause(); } else { ctx.resume(); if (fileMusic && cfg.musicOn) fileMusic.play().catch(() => {}); }
});

async function startMusic() {
  if (started) return; started = true;
  // Hazır parça varsa onu çal
  try {
    const r = await fetch('assets/audio/muzik.mp3', { method: 'HEAD' });
    if (r.ok) {
      fileMusic = new Audio('assets/audio/muzik.mp3'); fileMusic.loop = true; fileMusic.volume = cfg.musicOn ? cfg.music : 0;
      fileMusic.play().catch(() => {}); return;
    }
  } catch {}
  composer();
}

// ─────────────── Üretilen müzik: Hicaz havasında gerilimli noir döngüsü ───────────────
// D Hicaz: D Eb F# G A Bb C — kanun/ud benzeri tınılar, alçak bas, kalp atışı gibi ritim, yavaş yaylı akorlar.
const D = 146.83, ratio = (st) => Math.pow(2, st / 12);
const HICAZ = [0, 1, 4, 5, 7, 8, 10, 12, 13, 16];
const CHORDS = [[0, 4, 7], [-2, 1, 5], [-4, 0, 3], [-5, -2, 1]];   // D, C(m), Bb, A7 etrafı
function composer() {
  const tempo = 76, beat = 60 / tempo;
  let next = ctx.currentTime + 0.1, step = 0;
  // ortak yankı
  const delay = ctx.createDelay(); delay.delayTime.value = beat * 0.75;
  const fb = ctx.createGain(); fb.gain.value = 0.32; const wet = ctx.createGain(); wet.gain.value = 0.35;
  delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(musicBus);
  const schedule = () => {
    while (next < ctx.currentTime + 0.6) {
      const bar = Math.floor(step / 8), pos = step % 8, chord = CHORDS[bar % CHORDS.length];
      if (pos === 0) pad(next, chord, beat * 8);
      if (pos === 0 || pos === 4) bass(next, chord[0] - 12, beat * 3.5);
      if (pos === 0 || pos === 3 || pos === 6) heart(next, pos === 0 ? 1 : 0.6);
      if (Math.random() < (pos % 2 ? 0.25 : 0.45)) pluck(next, HICAZ[Math.floor(Math.random() * HICAZ.length)], delay);
      next += beat / 2; step++;
    }
  };
  schedule(); schedTimer = setInterval(schedule, 200);
}
function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
function pluck(t, st, delay) {   // kanun/ud tınısı
  const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  o.type = 'triangle'; o2.type = 'sawtooth'; o.frequency.value = D * 2 * ratio(st); o2.frequency.value = D * 2 * ratio(st) * 1.003;
  f.type = 'lowpass'; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.6);
  const g2 = ctx.createGain(); g2.gain.value = 0.25;
  o.connect(f); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(musicBus); g.connect(delay);
  env(g, t, 0.005, 0.22, 1.1); o.start(t); o2.start(t); o.stop(t + 1.3); o2.stop(t + 1.3);
}
function bass(t, st, dur) {
  const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  o.type = 'sawtooth'; o.frequency.value = D / 2 * ratio(st); f.type = 'lowpass'; f.frequency.value = 260;
  o.connect(f); f.connect(g); g.connect(musicBus); env(g, t, 0.08, 0.3, dur); o.start(t); o.stop(t + dur + 0.2);
}
function pad(t, chord, dur) {   // yavaş yaylı akor
  chord.forEach((st) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = D * ratio(st); o.detune.value = (Math.random() - 0.5) * 12;
    f.type = 'lowpass'; f.frequency.value = 900;
    o.connect(f); f.connect(g); g.connect(musicBus);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.045, t + dur * 0.4); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.1);
  });
}
function heart(t, v) {   // boğuk kalp atışı
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
  o.connect(g); g.connect(musicBus); env(g, t, 0.005, 0.35 * v, 0.22); o.start(t); o.stop(t + 0.3);
}

// ─────────────── Efektler ───────────────
function tone(freq, dur, type = 'sine', vol = 0.3, slideTo, delayS = 0) {
  if (!ctx || !cfg.sfxOn) return;
  const t = ctx.currentTime + delayS, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  o.connect(g); g.connect(sfxBus); env(g, t, 0.004, vol, dur); o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur, vol = 0.3, freq = 1200, delayS = 0) {
  if (!ctx || !cfg.sfxOn) return;
  const t = ctx.currentTime + delayS, len = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; s.connect(f); f.connect(g); g.connect(sfxBus);
  g.gain.value = vol; s.start(t);
}
export const sfx = {
  tab:     () => tone(1400, 0.035, 'sine', 0.06),                        // sekme geçişi: çok hafif tık
  tap:     () => { tone(320, 0.06, 'triangle', 0.12, 220); },            // düğme: tahta "tok"
  success: () => { tone(587, 0.18, 'triangle', 0.18); tone(880, 0.3, 'triangle', 0.16, null, 0.09); },
  fail:    () => { tone(180, 0.28, 'sawtooth', 0.12, 90); },
  coin:    () => { tone(1975, 0.12, 'square', 0.05); tone(2637, 0.2, 'square', 0.05, null, 0.07); },
  shot:    () => { noise(0.25, 0.5, 900); tone(120, 0.25, 'sine', 0.2, 50); },
  open:    () => tone(660, 0.08, 'sine', 0.07, 880),                     // panel açılışı
  notify:  () => { tone(1046, 0.12, 'sine', 0.08); tone(1318, 0.18, 'sine', 0.07, null, 0.1); },
};
