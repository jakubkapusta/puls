import '@fontsource/audiowide/400.css';
import '@fontsource/exo-2/400.css';
import '@fontsource/exo-2/600.css';
import './style.css';

import { Renderer, type Beat } from './render/renderer';
import { Audio } from './audio/audio';
import { Game, type PowerId, type SpecialId } from './game/game';
import { BAL, mergeBal, resetBal } from './game/balance';
import { Input } from './game/input';
import { UI, type AlbumView, type EndInfo } from './ui/ui';
import { applySpeed, applyTest, fullSel, testTag, type TestSel } from './game/tuning';
import { hintSeen, loadMeta, logPlay, markHint, saveMeta, today } from './game/save';
import { Bot } from './sim/bot';
import { ALBUMS, JAM, SONGS, songById } from './music/songs';
import type { LayerId, Song } from './music/song';
import type { Tempo } from './music/tempo';
import type { Recording } from './audio/audio';
import { albumUnlocked, dailyPick, nextSong, rec as songRec, songUnlocked, starsFor, totalStars } from './game/progress';
import { clamp, damp } from './core/math';

type Mode = 'menu' | 'play' | 'pause' | 'end' | 'calib' | 'replay';
/** what is being played: a song from the list, the song of the day, or Jam */
type RunKind = 'song' | 'daily' | 'jam';

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
let song: Song = songById(meta.lastSong) ?? SONGS[0];
let runKind: RunKind = 'song';
let runSeed = 1;
let lastEnd: EndInfo | null = null;
let game: Game | null = null;
let auto: Bot | null = null;
let touchSeen = false;

// the menu shows a silent bot game behind it
let demo: Game | null = null;
let demoBot: Bot | null = null;
let demoSeed = 1;

const LAYER_NAMES: Record<LayerId, string> = {
  hat: 'hi-hat', snare: 'werbel', pad: 'pad', arp: 'arpeggio', bass2: 'bas w szesnastkach', perc: 'perkusjonalia', bells: 'dzwonki',
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
  again: () => start(runKind, runKind === 'daily' ? runSeed : undefined),
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
  songs: () => showSongs(),
  album: (id) => {
    meta.lastAlbum = id;
    saveMeta(meta);
    const a = ALBUMS.find((x) => x.id === id);
    if (a && a.songs[0].kit !== song.kit) {
      // the board behind the list takes the album's look
      demoSong = a.songs[0];
      demo = null;
    }
  },
  pick: (id) => {
    const sg = songById(id);
    if (!sg) return;
    song = sg;
    meta.lastSong = sg.id;
    saveMeta(meta);
    start('song');
  },
  daily: () => {
    const d = dailyPick(today());
    song = d.song;
    start('daily', d.seed);
  },
  jam: () => {
    song = JAM;
    start('jam');
  },
  next: () => {
    const n = nextSong(meta, song);
    if (!n) return;
    song = n;
    meta.lastSong = n.id;
    saveMeta(meta);
    start('song');
  },
  listen: () => listen(),
  stopListen: () => stopListen(),
});
ui.setSound(meta.sound);

// any first touch can start the audio context (iOS needs a gesture)
window.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse') touchSeen = true;
  if (mode !== 'pause') audio.unlock();
}, { capture: true });

// ------------------------------------------------------------ flow
function songLine() {
  const sg = songById(meta.lastSong) ?? SONGS[0];
  const r = meta.songs[sg.id];
  const best = r?.best ? ` · rekord <b>${r.best.toLocaleString('pl-PL')}</b>` : '';
  return `Ostatnio: <b>${sg.title}</b>${best} · ★ ${totalStars(meta)}`;
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function showSongs() {
  mode = 'menu';
  const albums: AlbumView[] = ALBUMS.map((a, ai) => ({
    id: a.id, title: a.title, sub: a.sub, locked: !albumUnlocked(meta, ai),
    lockNote: `Zalicz „${ALBUMS[ai - 1]?.songs[2]?.title ?? ''}”, żeby otworzyć album`,
    songs: a.songs.map((sg, si) => {
      const r = songRec(meta, sg.id);
      return { id: sg.id, title: sg.title, meta: `${sg.bpm} BPM · ${fmtTime(sg.length)} · ${sg.layers.length} warstw`, stars: r.stars, best: r.best, locked: !songUnlocked(meta, ai, si) };
    }),
  }));
  ui.showSongs(albums, meta.lastAlbum, totalStars(meta));
}

function modesLine() {
  const d = dailyPick(today());
  const done = meta.daily && meta.daily.date === today();
  ui.setModes(done ? `${d.song.title} · ${meta.daily!.score.toLocaleString('pl-PL')} pkt` : `dziś: ${d.song.title}`,
    meta.jamBest ? `bez końca · rekord ${meta.jamBest.toLocaleString('pl-PL')}` : 'bez końca, klocki spadają');
}

function toMenu() {
  mode = 'menu';
  modesLine();
  audio.stopSong(0.3);
  if (audio.paused) audio.resume();
  game = null;
  renderer.clear();
  input.enabled = false;
  ui.hint(null);
  ui.setGroove(false);
  ui.showMenu(sel, songLine(), meta.speed);
}

function start(kind: RunKind = runKind, seed = (Date.now() & 0xffff) + 1) {
  audio.unlock();
  if (audio.paused) audio.resume();
  runKind = kind;
  runSeed = seed;
  layers();
  ui.resetHud();
  renderer.clear();
  game = new Game(song, seed, { endless: kind === 'jam' });
  auto = autoSkill !== null ? new Bot(autoSkill, 5) : null;
  audio.play(song, game);
  mode = 'play';
  ui.hideScreens();
  ui.hudVisible(true);
  input.enabled = true;
  if (kind === 'jam') ui.titleCard('Jam', 'bez końca · klocki spadają');
  else if (kind === 'daily') ui.titleCard(song.title, meta.daily?.date === today() ? 'utwór dnia · trening' : 'utwór dnia · liczy się pierwsza próba');
  else ui.titleCard(song.title, `${song.bpm} BPM`);
  tipUntil = 0;
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
let tipUntil = 0;
/** a one-time tip the first time something happens (not over the swing hint) */
function tip(id: string, html: string) {
  if (hintSeen(id) || hintStage === 3) return;
  markHint(id);
  ui.hint(html);
  tipUntil = performance.now() + 4500;
}

const SPECIAL_NAMES: Record<SpecialId, string> = {
  chord: 'Akord', perc: 'Perkusja', arp: 'Arpeggiator', filter: 'Filtr', echo: 'Echo', tempoUp: 'Szybciej', tempoDown: 'Wolniej', drop: 'Drop',
};
const SPECIAL_TIPS: Record<SpecialId, string> = {
  chord: 'Klocek <b>Akord</b> gra trzy nuty naraz.',
  perc: '<b>Perkusja</b> od razu dokłada do utworu nową ścieżkę.',
  arp: '<b>Arpeggiator</b> rozbija sąsiednie klocki jeden po drugim, w rytmie.',
  filter: '<b>Filtr</b> na chwilę zamyka i otwiera brzmienie całego utworu.',
  echo: '<b>Echo</b>: piłka na chwilę się klonuje, a klony też zbijają klocki.',
  tempoUp: '<b>Metronom</b> zmienia tempo utworu od następnego taktu (strzałka w górę: szybciej, w dół: wolniej).',
  tempoDown: '<b>Metronom</b> zmienia tempo utworu od następnego taktu (strzałka w górę: szybciej, w dół: wolniej).',
  drop: 'Zbij wszystkie białe klocki <b>Drop</b>, a utwór wybuchnie: 4 takty rozgrzanej piłki i podwójnych punktów.',
};
const POWER_NAMES: Record<PowerId, string> = { multi: 'Polifonia', laser: 'Laser', wide: 'Szeroka paletka', magnet: 'Magnes', slow: 'Zwolnienie' };
const POWER_TIPS: Record<PowerId, string> = {
  multi: '<b>Polifonia</b>: dwie dodatkowe piłki. Dopóki któraś leci, nie tracisz życia.',
  laser: '<b>Laser</b>: paletka strzela na każdą ósemkę, staccato.',
  wide: '<b>Szeroka paletka</b> na kilka taktów.',
  magnet: '<b>Magnes</b>: piłka przykleja się do paletki. Stuknij albo pchnij palcem w górę, żeby ją wypuścić.',
  slow: '<b>Zwolnienie</b>: utwór zwalnia na 4 takty.',
};

/** HUD chips: active power-ups (with time left), the drop counter, a changed tempo */
function fxItems(g: Game) {
  const out: { id: string; label: string; k: number; color: string }[] = [];
  const left = (until: number, bars: number) => clamp((until - g.t) / Math.max(0.1, g.tempo.s16At(g.t) * 16 * bars), 0, 1);
  const P = BAL.power;
  if (g.active('laser')) out.push({ id: 'laser', label: POWER_NAMES.laser, k: left(g.fx.laser, P.laserBars), color: '#ff6a5a' });
  if (g.active('wide')) out.push({ id: 'wide', label: POWER_NAMES.wide, k: left(g.fx.wide, P.wideBars), color: '#5dffa8' });
  if (g.active('magnet')) out.push({ id: 'magnet', label: POWER_NAMES.magnet, k: left(g.fx.magnet, P.magnetBars), color: '#7fa8ff' });
  if (g.active('slow')) out.push({ id: 'slow', label: POWER_NAMES.slow, k: left(g.fx.slow, P.slowBars + 1), color: '#ffd27a' });
  const multi = g.extras.filter((e) => e.kind === 'multi').length;
  if (multi) out.push({ id: 'multi', label: `${POWER_NAMES.multi} +${multi}`, k: 1, color: '#ff7ae0' });
  if (g.dropping) out.push({ id: 'drop', label: 'Drop ×2', k: clamp((g.dropUntil - g.t) / (g.dropUntil - g.dropAt), 0, 1), color: '#ffffff' });
  else if (g.dropTotal && g.dropStep < 0) out.push({ id: 'dropc', label: `Drop ${g.dropTotal - g.dropLeft}/${g.dropTotal}`, k: (g.dropTotal - g.dropLeft) / g.dropTotal, color: '#ffffff' });
  const bpm = Math.round(g.tempo.bpmAt(g.t));
  if (bpm !== g.song.bpm) out.push({ id: 'bpm', label: `${bpm} BPM`, k: 1, color: '#ffd27a' });
  return out;
}
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
      case 'special': {
        const p = renderer.toCss(e.brick.x, e.brick.y - 40);
        if (e.special !== 'drop') ui.pop(SPECIAL_NAMES[e.special], p.x, p.y, 'special');
        tip('sp-' + (e.special === 'tempoDown' ? 'tempoUp' : e.special), SPECIAL_TIPS[e.special]);
        break;
      }
      case 'layer': {
        const p = renderer.toCss(360, 560);
        const name = LAYER_NAMES[g.song.layers[e.layers - 1]];
        if (name) ui.pop('+ ' + name, p.x, p.y, 'row');
        break;
      }
      case 'tempo': {
        const p = renderer.toCss(360, 640);
        ui.pop(`Tempo ${e.bpm} BPM`, p.x, p.y, 'special');
        break;
      }
      case 'dropArm': {
        const p = renderer.toCss(360, 600);
        ui.pop(`Drop ${e.total - e.left}/${e.total}`, p.x, p.y, 'drop');
        break;
      }
      case 'drop': {
        const p = renderer.toCss(360, 600);
        ui.pop('Drop!', p.x, p.y, 'drop big');
        break;
      }
      case 'power': {
        const p = renderer.toCss(g.px, BAL.paddle.y + 90);
        ui.pop(POWER_NAMES[e.kind], p.x, p.y, 'power');
        tip('pw-' + e.kind, POWER_TIPS[e.kind]);
        break;
      }
      case 'saved': {
        const p = renderer.toCss(g.bx, g.by + 50);
        ui.pop('Druga piłka przejmuje', p.x, p.y, 'power');
        break;
      }
      case 'push':
        renderer.shakeBy(3);
        break;
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
  const pctB = Math.round((100 * broken) / Math.max(1, g.total));
  const st = g.stats;
  const rhythm = st.contacts ? Math.round((100 * (st.perfect + st.good)) / st.contacts) : 0;
  const score = Math.round(g.score);
  const stars = runKind === 'jam' ? -1 : starsFor(g);
  let isBest = false;
  if (!auto) {
    if (runKind === 'song') {
      const r = songRec(meta, song.id);
      isBest = score > r.best;
      r.plays++;
      if (isBest) r.best = score;
      if (g.passed) r.passed = true;
      if (g.endReason === 'clear') r.cleared = true;
      r.stars = Math.max(r.stars, stars);
      meta.songs[song.id] = r;
    } else if (runKind === 'daily') {
      // the first attempt of the day counts
      if (!meta.daily || meta.daily.date !== today()) {
        meta.daily = { date: today(), song: song.id, score };
        isBest = true;
      }
    } else {
      isBest = score > meta.jamBest;
      if (isBest) meta.jamBest = score;
    }
    saveMeta(meta);
    logPlay({
      date: today(), song: runKind === 'song' ? song.id : `${runKind}:${song.id}`, reason: g.endReason ?? '', passed: g.passed, score, time: Math.round(g.t),
      bricks: pctB, speed: meta.speed, perfect: st.perfect, good: st.good, catches: st.catches, lost: st.lost, bestStreak: st.bestStreak,
      test: testTag(sel), calib: Math.round(audio.calib * 1000),
    });
  }
  const barsLeft = Math.max(0, song.bars - Math.ceil(g.tempo.stepAt(st.clearT) / 16));
  const jam = runKind === 'jam';
  const info: EndInfo = {
    title: jam ? 'Klocki dotarły na dół' : g.endReason === 'clear' ? 'Wszystko zbite!' : g.endReason === 'lives' ? 'Koniec żyć' : g.passed ? 'Utwór zaliczony' : 'Za mało klocków',
    sub: jam ? `${g.jamRows} rzędów · ${Math.round(g.tempo.bpmAt(g.t))} BPM na koniec`
      : g.endReason === 'clear' ? `Finał ${barsLeft} taktów przed końcem utworu` : g.endReason === 'lives' ? `Zbite ${pctB}% klocków`
        : g.passed ? `Zbite ${pctB}% klocków` : `Potrzeba ${Math.round(BAL.passFrac * 100)}%, zbite ${pctB}%`,
    passed: g.passed || (jam && score > 0),
    score,
    best: isBest && score > 0,
    rows: [
      jam ? ['Klocki', String(broken)] : ['Klocki', pctB + '%'],
      ['W rytm', rhythm + '%'],
      ['Idealne', String(st.perfect)],
      ['Najdłuższa seria', String(st.bestStreak)],
    ],
    stars,
    canNext: runKind === 'song' && g.passed && !!nextSong(meta, song),
    canListen: false,
  };
  lastEnd = info;
  setTimeout(() => {
    if (mode !== 'end') return;
    info.canListen = !!audio.lastTake;
    ui.showEnd(info);
  }, 500);
}

// ------------------------------------------------------------ "Twoja wersja"
let replayRec: Recording | null = null;
function listen() {
  const r = audio.lastTake;
  if (!r) return;
  audio.unlock();
  replayRec = r;
  mode = 'replay';
  renderer.clear();
  audio.playReplay(r);
  ui.showReplay(r.song.id === JAM.id ? 'Jam' : r.song.title);
}
function stopListen() {
  audio.stopSong(0.3);
  replayRec = null;
  renderer.layersOverride = null;
  mode = 'end';
  if (lastEnd) ui.showEnd(lastEnd);
}
/** the replay's visuals: no game, the beat and layers from the recording */
function replayBeat(r: Recording, dt: number): Beat {
  const t = audio.now();
  const st = Math.max(0, Math.floor(r.tempo.stepAt(t)));
  const f = r.flags[Math.min(st, r.flags.length - 1)] ?? 0;
  renderer.layersOverride = { n: f & 15, ids: r.song.layers };
  const s = r.song;
  const kick = t < 0 ? 0 : Math.exp(-since(r.tempo, s.kick, t) * 7);
  const hat = (f & 15) > 0 ? Math.exp(-since(r.tempo, s.hat, t) * 12) : 0;
  const snare = (f & 15) > 1 ? Math.exp(-since(r.tempo, s.snare, t) * 9) : 0;
  liveSpectrum(kick, hat, snare, t);
  grooveK += ((f & 16 ? 1 : 0) - grooveK) * damp(4, dt);
  return { kick, snare, hat, bass: bandsNow.bass, mid: bandsNow.mid, high: bandsNow.high, energy: (f & 15) / s.layers.length, groove: grooveK, scroll: r.tempo.stepAt(t) / 4, spec };
}

// ------------------------------------------------------------ the music, for the visuals
function since(tempo: Tempo, pat: string, t: number) {
  const i = Math.floor(tempo.stepAt(t));
  for (let k = 0; k < 32; k++) {
    const j = i - k;
    if (j < 0) break;
    if (pat[((j % 16) + 16) % 16] !== '.') return t - tempo.timeAt(j);
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
  const over = t >= g.length;
  const all = g.dropping;
  const has = (id: LayerId) => (all || g.layers > s.layers.indexOf(id)) && t > g.tempo.timeAt(s.intro * 16);
  const kick = over ? 0 : Math.exp(-since(g.tempo, s.kick, t) * 7);
  const hat = has('hat') && !over ? Math.exp(-since(g.tempo, s.hat, t) * 12) : 0;
  const snare = has('snare') && !over ? Math.exp(-since(g.tempo, s.snare, t) * 9) : 0;
  liveSpectrum(kick, hat, snare, t, live);
  grooveK += ((g.groove ? 1 : 0) - grooveK) * damp(4, dt);
  return { kick, snare, hat, bass: bandsNow.bass, mid: bandsNow.mid, high: bandsNow.high, energy: all ? 1 : g.layers / s.layers.length, groove: grooveK, scroll: g.tempo.stepAt(t) / 4, spec };
}

const bandsNow = { bass: 0, mid: 0, high: 0 };
/** bands and the 32-bin spectrum from the analyser (or faked from the drums without audio) */
function liveSpectrum(kick: number, hat: number, snare: number, t: number, live = true) {
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
  bandsNow.bass = bass;
  bandsNow.mid = mid;
  bandsNow.high = high;
}

// ------------------------------------------------------------ loop
let lastFrame = performance.now() / 1000;
const FREEZE_MS = 40;
let freezeUntil = 0;
let fps = 60;
let slowFrames = 0;
let fastFrames = 0;
/** the menu's background game (an album tab can switch its look) */
let demoSong: Song | null = null;
// weaker phones start a notch lower; the loop adapts from there
if (matchMedia('(pointer: coarse)').matches && (navigator.hardwareConcurrency || 4) <= 4) renderer.quality = 0.8;

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
      if (tipUntil && performance.now() > tipUntil && hintStage !== 3) {
        ui.hint(null);
        tipUntil = 0;
      }
      if (hintStage === 3 && performance.now() > hintUntil) {
        ui.hint(null);
        hintStage = 2;
      }
    }
    shown = game;
    ui.updateHud(game);
    ui.setFx(fxItems(game));
  } else if (mode === 'pause' && game) {
    shown = game;
  } else if (mode === 'replay' && replayRec) {
    ui.replayProgress(audio.replayProgress());
    if (!audio.replaying) stopListen();
  } else {
    // menu / calibration: a silent demo game
    if (!demo || demo.phase === 'over') {
      layers();
      demo = new Game(demoSong ?? song, demoSeed++, { endless: (demoSong ?? song) === JAM });
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

  const kitNow = mode === 'replay' && replayRec ? replayRec.song.kit : (shown?.song.kit ?? song.kit);
  const beat = mode === 'replay' && replayRec ? replayBeat(replayRec, dt) : beatOf(shown, dt, mode === 'play');
  renderer.render(shown, beat, sel.ring === 'on', kitNow === 'lofi');

  // quality: drop the render scale if frames are slow for a while
  if (fps < 45) slowFrames++;
  else slowFrames = Math.max(0, slowFrames - 1);
  if (slowFrames > 90 && renderer.quality > 0.6) {
    renderer.quality = Math.max(0.6, renderer.quality - 0.15);
    slowFrames = 0;
    fastFrames = 0;
  }
  // and give it back slowly when there is headroom
  if (fps > 58) fastFrames++;
  else fastFrames = 0;
  if (fastFrames > 900 && renderer.quality < 1) {
    renderer.quality = Math.min(1, renderer.quality + 0.1);
    fastFrames = 0;
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
  get meta() { return meta; },
  listen,
};
