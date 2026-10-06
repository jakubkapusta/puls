import '@fontsource/audiowide/400.css';
import '@fontsource/exo-2/400.css';
import '@fontsource/exo-2/600.css';
import './style.css';

import { Renderer, type Beat } from './render/renderer';
import { Audio } from './audio/audio';
import { Game } from './game/game';
import { BAL, mergeBal, resetBal } from './game/balance';
import { Input } from './game/input';
import { UI, type EndInfo } from './ui/ui';
import { applySpeed, applyTest, fullSel, testTag, type TestSel } from './game/tuning';
import { hintSeen, loadMeta, logPlay, markHint, saveMeta, today } from './game/save';
import { Bot } from './sim/bot';
import { SONGS } from './music/songs';
import type { LayerId, Song } from './music/song';
import { clamp, damp } from './core/math';

type Mode = 'menu' | 'play' | 'pause' | 'end' | 'calib';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const audio = new Audio();
const meta = loadMeta();
let sel: TestSel = fullSel(meta.test);
audio.enabled = meta.sound;
audio.calib = meta.calib ?? 0;

// URL: #debug, #bal={...} (deep-merged over BAL), #auto=0.8 (a bot plays)
const hash = new URLSearchParams(location.hash.slice(1));
let hashBal: Record<string, unknown> | null = null;
try {
  if (hash.get('bal')) hashBal = JSON.parse(hash.get('bal')!);
} catch { /* ignore */ }
const debug = hash.has('debug') || !!hashBal;
const autoSkill = hash.has('auto') ? parseFloat(hash.get('auto') || '0.85') : null;

let mode: Mode = 'menu';
let song: Song = SONGS[0];
let game: Game | null = null;
let auto: Bot | null = null;
let touchSeen = false;

// the menu shows a silent bot game behind it
let demo: Game | null = null;
let demoBot: Bot | null = null;
let demoSeed = 1;

const LAYER_NAMES: Record<LayerId, string> = {
  hat: 'hi-hat', snare: 'werbel', pad: 'pad', arp: 'arpeggio', bass2: 'bas w szesnastkach', perc: 'perkusjonalia',
};

/** BAL for a level: defaults → test presets → #bal */
function layers() {
  resetBal();
  applyTest(sel);
  applySpeed(meta.speed);
  if (hashBal) mergeBal(hashBal);
  input.swingMode = sel.swing;
}

const input = new Input(canvas, {
  action: (ms) => {
    if (mode !== 'play' || !game) return;
    if (game.onPaddle) game.launch();
    else game.swing(audio.heardAt(ms));
  },
  nudge: (dx) => {
    touchSeen = true;
    if (game && mode === 'play') game.target += (dx / renderer.cssScale) * BAL.paddle.touchGain;
  },
  point: (x) => {
    if (game && mode === 'play') game.target = renderer.worldX(x);
  },
  pause: () => (mode === 'play' ? pause() : mode === 'pause' ? resume() : undefined),
});

const ui = new UI(document.getElementById('ui')!, {
  play: () => start(),
  again: () => start(),
  pause: () => pause(),
  resume: () => resume(),
  menu: () => toMenu(),
  sound: (on) => {
    audio.unlock();
    audio.setEnabled(on);
    meta.sound = on;
    saveMeta(meta);
  },
  speed: (id) => {
    meta.speed = id;
    saveMeta(meta);
    layers();
  },
  test: (s) => {
    sel = s;
    meta.test = s;
    saveMeta(meta);
    layers();
  },
  calibOpen: () => calibOpen(),
  calibStart: () => calibStart(),
  calibTap: (ms) => calibTap(ms),
  calibSet: (ms) => {
    audio.calib = ms / 1000;
    meta.calib = audio.calib;
    saveMeta(meta);
    ui.calibValue(ms, (audio.latency() - audio.calib) * 1000);
  },
  calibDone: () => toMenu(),
});
ui.setSound(meta.sound);

// any first touch can start the audio context (iOS needs a gesture)
window.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse') touchSeen = true;
  if (mode !== 'pause') audio.unlock();
}, { capture: true });

// ------------------------------------------------------------ flow
function songLine() {
  const r = meta.songs[song.id];
  const best = r?.best ? ` · rekord <b>${r.best.toLocaleString('pl-PL')}</b>` : '';
  return `Utwór: <b>${song.title}</b> · ${song.bpm} BPM${best}`;
}

function toMenu() {
  mode = 'menu';
  audio.stopSong(0.3);
  if (audio.paused) audio.resume();
  game = null;
  renderer.clear();
  input.enabled = false;
  ui.hint(null);
  ui.setGroove(false);
  ui.showMenu(sel, songLine(), meta.speed);
}

function start() {
  audio.unlock();
  if (audio.paused) audio.resume();
  layers();
  ui.resetHud();
  renderer.clear();
  game = new Game(song, (Date.now() & 0xffff) + 1);
  auto = autoSkill !== null ? new Bot(autoSkill, 5) : null;
  audio.play(song, game);
  mode = 'play';
  ui.hideScreens();
  ui.hudVisible(true);
  input.enabled = true;
  hintStage = hintSeen('launch') ? (hintSeen('swing') ? 2 : 1) : 0;
  if (hintStage === 0) ui.hint(touchSeen ? 'Przesuwaj palcem, żeby sterować paletką. <b>Stuknij</b>, żeby wystrzelić piłkę.' : 'Mysz albo strzałki sterują paletką. <b>Klik</b> albo <b>spacja</b> wystrzeliwuje piłkę.');
}

function pause() {
  if (mode !== 'play') return;
  mode = 'pause';
  audio.pause();
  ui.showPause();
}

function resume() {
  if (mode !== 'pause') return;
  audio.resume();
  mode = 'play';
  ui.hideScreens();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

// ------------------------------------------------------------ hints
let hintStage = 2;
let hintUntil = 0;
function hintOnEvent(type: string) {
  if (hintStage === 0 && type === 'launch') {
    markHint('launch');
    hintStage = 1;
  }
  if (hintStage === 1 && type === 'launch') {
    ui.hint(touchSeen && sel.swing === 'flick'
      ? 'Gdy piłka spada na paletkę, <b>szybko pchnij palec w górę</b>. Uderzenie w rytm rozgrzewa piłkę i podbija mnożnik.'
      : touchSeen ? '<b>Stuknij</b> w chwili, gdy piłka dotyka paletki. Uderzenie w rytm rozgrzewa piłkę i podbija mnożnik.'
        : '<b>Spacja</b> albo <b>klik</b> w chwili, gdy piłka dotyka paletki. Uderzenie w rytm rozgrzewa piłkę i podbija mnożnik.');
    hintUntil = performance.now() + 9000;
    hintStage = 3;
  } else if (hintStage === 3 && type === 'judge') {
    markHint('swing');
    hintStage = 2;
    ui.hint(null);
  }
}

// ------------------------------------------------------------ calibration
let calibClicks: number[] = [];
let calibTaps: number[] = [];
let calibEnd = 0;
const CALIB_N = 16;

function calibOpen() {
  audio.unlock();
  mode = 'calib';
  ui.showCalib(audio.calib * 1000, (audio.latency() - audio.calib) * 1000);
}
function calibStart() {
  audio.unlock();
  calibClicks = audio.clicks(CALIB_N, 0.5);
  calibTaps = [];
  calibEnd = calibClicks.length ? calibClicks[calibClicks.length - 1] + 0.6 : 0;
  ui.calibDots(0, CALIB_N);
}
function calibTap(ms: number) {
  if (!calibClicks.length || !audio.ctx) return;
  const tc = audio.tapCtx(ms);
  let best = Infinity;
  for (const c of calibClicks) if (Math.abs(tc - c) < Math.abs(best)) best = tc - c;
  if (Math.abs(best) < 0.25) calibTaps.push(best);
  ui.calibDots(Math.min(CALIB_N, calibTaps.length), CALIB_N);
}
function calibCheck() {
  if (!calibClicks.length || !audio.ctx || audio.ctx.currentTime < calibEnd) return;
  calibClicks = [];
  // skip the first taps (finding the beat), take the median
  const t = calibTaps.slice(2).sort((a, b) => a - b);
  if (t.length >= 6) {
    const med = t[Math.floor(t.length / 2)];
    audio.calib = clamp(med, -0.1, 0.4);
    meta.calib = audio.calib;
    saveMeta(meta);
  }
  ui.calibValue(audio.calib * 1000, (audio.latency() - audio.calib) * 1000);
}

// ------------------------------------------------------------ events
function handleEvents(g: Game) {
  for (const e of g.drain()) {
    audio.onEvent(e);
    let noteT: number | null = null;
    if (e.type === 'brick' && audio.running) {
      const nt = audio.noteTimes[audio.noteTimes.length - 1];
      if (nt && nt.id === e.brick.id) noteT = audio.songTimeOf(nt.t);
    }
    renderer.onEvent(e, g, noteT);
    hintOnEvent(e.type);
    switch (e.type) {
      case 'judge': {
        if (e.judge === 'perfect') freezeUntil = performance.now() + FREEZE_MS;
        const p = renderer.toCss(e.x, e.y + 60);
        ui.pop(e.judge === 'perfect' ? 'Idealnie' : 'Dobrze', p.x, p.y, e.judge);
        break;
      }
      case 'row': {
        const p = renderer.toCss(360, 560);
        const name = LAYER_NAMES[g.song.layers[e.layers - 1]];
        if (name) ui.pop('+ ' + name, p.x, p.y, 'row');
        break;
      }
      case 'lost': {
        const p = renderer.toCss(360, 300);
        ui.pop(e.lives > 0 ? 'Piłka stracona' : 'Koniec żyć', p.x, p.y, 'lost');
        break;
      }
      case 'groove':
        ui.setGroove(e.on);
        break;
      case 'end':
        endLevel(g);
        break;
      default:
        break;
    }
  }
}

function endLevel(g: Game) {
  mode = 'end';
  input.enabled = false;
  ui.hint(null);
  const broken = g.total - g.alive;
  const pctB = Math.round((100 * broken) / g.total);
  const st = g.stats;
  const rhythm = st.contacts ? Math.round((100 * (st.perfect + st.good)) / st.contacts) : 0;
  const rec = meta.songs[song.id] ?? { best: 0, passed: false, cleared: false, plays: 0 };
  const isBest = !auto && g.score > rec.best;
  if (!auto) {
    rec.plays++;
    if (isBest) rec.best = Math.round(g.score);
    if (g.passed) rec.passed = true;
    if (g.endReason === 'clear') rec.cleared = true;
    meta.songs[song.id] = rec;
    saveMeta(meta);
    logPlay({
      date: today(), song: song.id, reason: g.endReason ?? '', passed: g.passed, score: Math.round(g.score), time: Math.round(g.t),
      bricks: pctB, speed: meta.speed, perfect: st.perfect, good: st.good, catches: st.catches, lost: st.lost, bestStreak: st.bestStreak,
      test: testTag(sel), calib: Math.round(audio.calib * 1000),
    });
  }
  const barsLeft = Math.max(0, Math.floor((song.length - st.clearT) / song.bar));
  const info: EndInfo = {
    title: g.endReason === 'clear' ? 'Wszystko zbite!' : g.endReason === 'lives' ? 'Koniec żyć' : g.passed ? 'Utwór zaliczony' : 'Za mało klocków',
    sub: g.endReason === 'clear' ? `Finał ${barsLeft} taktów przed końcem utworu` : g.endReason === 'lives' ? `Zbite ${pctB}% klocków`
      : g.passed ? `Zbite ${pctB}% klocków` : `Potrzeba ${Math.round(BAL.passFrac * 100)}%, zbite ${pctB}%`,
    passed: g.passed,
    score: Math.round(g.score),
    best: isBest,
    rows: [
      ['Klocki', pctB + '%'],
      ['W rytm', rhythm + '%'],
      ['Idealne', String(st.perfect)],
      ['Najdłuższa seria', String(st.bestStreak)],
    ],
  };
  setTimeout(() => {
    if (mode === 'end') ui.showEnd(info);
  }, 500);
}

// ------------------------------------------------------------ the music, for the visuals
function since(s: Song, pat: string, t: number) {
  const i = Math.floor(t / s.s16);
  for (let k = 0; k < 32; k++) {
    const j = i - k;
    if (j < 0) break;
    if (pat[((j % 16) + 16) % 16] !== '.') return t - j * s.s16;
  }
  return 9;
}
const freq = new Uint8Array(256);
const spec = new Uint8Array(32);
let grooveK = 0;
const band = (lo: number, hi: number) => {
  let sum = 0;
  for (let i = lo; i < hi; i++) sum += freq[i];
  return sum / (hi - lo) / 255;
};
function beatOf(g: Game | null, dt: number, live: boolean): Beat {
  if (!g || g.t < 0) return { kick: 0, snare: 0, hat: 0, bass: 0, mid: 0, high: 0, energy: 0, groove: 0, scroll: 0, spec };
  const s = g.song;
  const t = g.t;
  const over = t >= s.length;
  const has = (id: LayerId) => g.layers > s.layers.indexOf(id) && t > s.intro * s.bar;
  const kick = over ? 0 : Math.exp(-since(s, s.kick, t) * 7);
  const hat = has('hat') && !over ? Math.exp(-since(s, s.hat, t) * 12) : 0;
  const snare = has('snare') && !over ? Math.exp(-since(s, s.snare, t) * 9) : 0;
  let bass = kick * 0.5, mid = 0.3 * (snare + hat), high = hat * 0.6;
  if (live && audio.analyser && audio.running) {
    // 256 bins over 0..sampleRate/2: log-spaced groups for the skyline, three bands for the rest
    audio.analyser.getByteFrequencyData(freq);
    bass = clamp((band(1, 6) - 0.35) * 1.6, 0, 1);
    mid = clamp((band(8, 40) - 0.2) * 1.8, 0, 1);
    high = clamp((band(60, 160) - 0.1) * 2.5, 0, 1);
    for (let i = 0; i < 32; i++) {
      const lo = Math.floor(Math.pow(200, i / 32)), hi = Math.max(lo + 1, Math.floor(Math.pow(200, (i + 1) / 32)));
      const v = band(lo, hi);
      spec[i] = Math.max(spec[i] * 0.85, clamp((v - 0.25) * 1.6, 0, 1) * 255);
    }
  } else {
    // demo / no audio: a fake spectrum from the drum envelopes
    for (let i = 0; i < 32; i++) {
      const k = i / 32;
      const v = kick * (1 - k) * 0.9 + (hat + snare) * k * 0.6 + 0.08 * Math.sin(t * 3 + i);
      spec[i] = Math.max(spec[i] * 0.85, clamp(v, 0, 1) * 255);
    }
  }
  grooveK += ((g.groove ? 1 : 0) - grooveK) * damp(4, dt);
  return { kick, snare, hat, bass, mid, high, energy: g.layers / s.layers.length, groove: grooveK, scroll: t / s.beat, spec };
}

// ------------------------------------------------------------ loop
let lastFrame = performance.now() / 1000;
const FREEZE_MS = 40;
let freezeUntil = 0;
let fps = 60;
let slowFrames = 0;

function frame(nowMs: number) {
  const now = nowMs / 1000;
  const dt = clamp(now - lastFrame, 0, 0.1);
  lastFrame = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;

  let shown: Game | null = null;
  if ((mode === 'play' || mode === 'end') && game) {
    if (mode === 'play') {
      if (input.keyDir) game.target += input.keyDir * BAL.paddle.keySpeed * dt;
      if (auto) auto.update(game, dt);
      // a perfect hit freezes the world for a blink; afterwards it catches up a little faster
      const heard = audio.now();
      const target = performance.now() < freezeUntil ? game.t
        : heard - game.t > 0.3 ? heard : Math.min(heard, game.t + Math.max(dt * 1.6, 0.03));
      let n = 0;
      while (game.t + BAL.dt <= target && n < 480) {
        game.step(BAL.dt);
        n++;
      }
      handleEvents(game);
      if (hintStage === 3 && performance.now() > hintUntil) {
        ui.hint(null);
        hintStage = 2;
      }
    }
    shown = game;
    ui.updateHud(game);
  } else if (mode === 'pause' && game) {
    shown = game;
  } else {
    // menu / calibration: a silent demo game
    if (!demo || demo.phase === 'over') {
      layers();
      demo = new Game(song, demoSeed++);
      demoBot = new Bot(0.8, demoSeed * 7);
    }
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(BAL.dt, left);
      demoBot!.update(demo, h);
      demo.step(h);
      left -= h;
    }
    for (const e of demo.drain()) renderer.onEvent(e, demo, null);
    shown = demo;
    calibCheck();
  }

  renderer.render(shown, beatOf(shown, dt, mode === 'play'), sel.ring === 'on');

  // quality: drop the render scale if frames are slow for a while
  if (fps < 45) slowFrames++;
  else slowFrames = Math.max(0, slowFrames - 1);
  if (slowFrames > 90 && renderer.quality > 0.6) {
    renderer.quality = Math.max(0.6, renderer.quality - 0.15);
    slowFrames = 0;
  }

  if (debug && game) {
    ui.setDebug(`fps ${fps.toFixed(0)} q ${renderer.quality.toFixed(2)}  t ${game.t.toFixed(2)}  v ${game.speed.toFixed(0)}  heat ${game.heat}\n`
      + `sync ${game.sync ? (game.sync.tb - game.t).toFixed(2) : '-'}  lat ${(audio.latency() * 1000).toFixed(0)}ms (calib ${(audio.calib * 1000).toFixed(0)})  layers ${game.layers}`);
  }
  requestAnimationFrame(frame);
}

toMenu();
requestAnimationFrame(frame);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// dev helper
(window as unknown as Record<string, unknown>).__puls = {
  get game() { return game; },
  get demo() { return demo; },
  audio, renderer, BAL,
  auto: (s: number | null) => (auto = s === null ? null : new Bot(s, 3)),
  start,
};
