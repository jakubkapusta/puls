// All sound is synthesized with Web Audio (no files). Three jobs:
//   clock     — the song time the player hears: ctx.currentTime − song start − output latency −
//               calibration, smoothed against performance.now() (currentTime moves in chunks on
//               some browsers). The game runs on this clock, so what's seen is what's heard.
//   sequencer — a lookahead scheduler: every few ms it schedules the 16ths that fall in the next
//               window: kick + bass always, the layers the player has unlocked, the lead while
//               "w rytmie", fills, the ending or the finale.
//   events    — brick notes quantized to the 16th grid, accents for rhythm hits, the filter dip
//               when a ball is lost, small UI blips.
// The context starts on the first user gesture (browsers require it).

import { midiHz, scaleNote, type Song, type LayerId } from '../music/song';
import type { Game, GameEvent } from '../game/game';

const LOOKAHEAD = 0.12;
const TICK_MS = 20;
/** a brick note this close after a grid point plays at once instead of waiting for the next */
const GRACE = 0.035;
const ACCENT_GRACE = 0.05;

type Bus = GainNode;

export class Audio {
  ctx: AudioContext | null = null;
  enabled = true;
  /** extra latency from the calibration (s), on top of the reported output latency */
  calib = 0;

  private master!: GainNode;
  private filt!: BiquadFilterNode;
  analyser: AnalyserNode | null = null;
  private drums!: Bus;
  private duck!: Bus; // bass + pad, pumped by the kick
  private music!: Bus;
  private notes!: Bus;
  private sfx!: Bus;
  private verb!: Bus;
  private delay!: Bus;
  private noise!: AudioBuffer;

  // song
  song: Song | null = null;
  private game: Game | null = null;
  private start = 0;
  private stepI = 0;
  private stepT = 0;
  private timer = 0;
  private finaleStep = -1;
  private stopped = true;
  /** for the renderer: ctx times of scheduled kicks and hats */
  readonly beats: { t: number; kind: 'kick' | 'snare' | 'hat' }[] = [];

  // smoothed clock
  private off = 0;
  private offOk = false;
  private last = -Infinity;
  private perfSong = 0; // fallback clock without audio
  private perfStart = 0;

  /** Call from a user gesture. Safe to call again. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !this.paused) this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    // a silent buffer kicks iOS into playing
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start();

    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.85 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.15;
    this.filt = ctx.createBiquadFilter();
    this.filt.type = 'lowpass';
    this.filt.frequency.value = 20000;
    this.filt.Q.value = 0.9;
    this.filt.connect(this.master).connect(comp).connect(ctx.destination);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.6;
    comp.connect(this.analyser);

    const bus = (g: number, to: AudioNode = this.filt) => {
      const b = ctx.createGain();
      b.gain.value = g;
      b.connect(to);
      return b;
    };
    this.drums = bus(1);
    this.duck = bus(1);
    this.music = bus(1, this.duck);
    this.notes = bus(1);
    this.sfx = bus(1);

    // reverb: generated impulse response (decaying stereo noise)
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    conv.buffer = ir;
    this.verb = ctx.createGain();
    this.verb.gain.value = 0.32;
    this.verb.connect(conv).connect(this.filt);

    // dotted-8th echo, darkened in the feedback
    const dl = ctx.createDelay(2);
    const fb = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    fb.gain.value = 0.38;
    this.delay = ctx.createGain();
    this.delay.gain.value = 0.5;
    this.delay.connect(dl);
    dl.connect(lp).connect(fb).connect(dl);
    lp.connect(this.filt);
    this.delayNode = dl;

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }
  private delayNode: DelayNode | null = null;

  get running() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.85 : 0, this.ctx.currentTime, 0.05);
  }

  /** output latency the browser reports plus the calibration */
  latency() {
    const c = this.ctx;
    if (!c) return this.calib;
    const out = (c as AudioContext & { outputLatency?: number }).outputLatency;
    return (out && out < 1 ? out : c.baseLatency || 0) + this.calib;
  }

  // ------------------------------------------------------------ clock
  /** The song time the player hears now. */
  now(): number {
    const perf = performance.now() / 1000;
    if (!this.ctx) return perf - this.perfStart + this.perfSong;
    if (!this.running) return this.last === -Infinity ? 0 : this.last;
    const raw = this.ctx.currentTime - this.start - this.latency();
    const est = perf + this.off;
    if (!this.offOk || Math.abs(raw - est) > 0.06) {
      this.off = raw - perf;
      this.offOk = true;
    } else this.off += (raw - est) * 0.04;
    const t = Math.max(this.last, perf + this.off);
    this.last = t;
    return t;
  }

  /** Heard song time of an input event (its timeStamp is in performance.now() ms). */
  heardAt(eventMs: number) {
    return this.now() - Math.max(0, performance.now() - eventMs) / 1000;
  }

  // ------------------------------------------------------------ song
  play(song: Song, game: Game) {
    this.stopSong(0);
    this.song = song;
    this.game = game;
    this.finaleStep = -1;
    this.offOk = false;
    this.last = -Infinity;
    this.beats.length = 0;
    if (!this.ctx) {
      // no Web Audio: the game still runs, on performance.now()
      this.perfStart = performance.now() / 1000;
      this.perfSong = 0;
      this.stopped = false;
      return;
    }
    const ctx = this.ctx;
    this.start = ctx.currentTime + 0.12;
    this.stepI = 0;
    this.stepT = this.start;
    this.stopped = false;
    this.filt.frequency.cancelScheduledValues(ctx.currentTime);
    this.filt.frequency.setValueAtTime(380, this.start);
    this.filt.frequency.exponentialRampToValueAtTime(20000, this.start + song.intro * song.bar);
    if (this.delayNode) this.delayNode.delayTime.value = song.s16 * 3;
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  /** stop the sequencer (notes already scheduled ring out unless `fade`) */
  stopSong(fade = 0.4) {
    clearInterval(this.timer);
    this.timer = 0;
    this.stopped = true;
    this.song = null;
    this.game = null;
    if (this.ctx && fade > 0) {
      const t = this.ctx.currentTime;
      this.filt.frequency.cancelScheduledValues(t);
      this.filt.frequency.setValueAtTime(this.filt.frequency.value, t);
      this.filt.frequency.exponentialRampToValueAtTime(200, t + fade);
      this.filt.frequency.setValueAtTime(20000, t + fade + 0.6);
    }
  }

  paused = false;
  pause() {
    this.paused = true;
    this.ctx?.suspend().catch(() => {});
    if (!this.ctx) this.perfSong = this.now();
  }
  resume() {
    this.paused = false;
    this.offOk = false;
    this.ctx?.resume().catch(() => {});
    if (!this.ctx) this.perfStart = performance.now() / 1000;
  }

  private schedule() {
    const ctx = this.ctx, song = this.song;
    if (!ctx || !song || this.stopped) return;
    while (this.stepT < ctx.currentTime + LOOKAHEAD) {
      if (!this.step(this.stepI, this.stepT)) {
        clearInterval(this.timer);
        this.timer = 0;
        return;
      }
      this.stepI++;
      this.stepT = this.start + this.stepI * song.s16;
    }
    // forget old beat marks
    while (this.beats.length && this.beats[0].t < ctx.currentTime - 2) this.beats.shift();
  }

  /** Schedules everything on 16th `i` at ctx time `T`. Returns false when the song is over. */
  private step(i: number, T: number): boolean {
    const song = this.song!, g = this.game!;
    const bar = Math.floor(i / 16), s = i % 16;
    const chord = song.chords[bar % song.chords.length];
    const croot = song.root + chord.root;

    if (this.finaleStep >= 0 && i >= this.finaleStep) {
      this.finale(T, chord, croot);
      return false;
    }
    if (i >= song.bars * 16) {
      this.ending(T, song.chords[0], song.root);
      return false;
    }

    const intro = bar < song.intro;
    const on = new Set<LayerId>(intro ? [] : song.layers.slice(0, g.layers));
    const pat = (p: string) => p[s] ?? '.';

    // kick (always)
    const k = pat(song.kick);
    if (k !== '.') {
      this.kick(T, k === 'o' ? 1 : 0.9);
      this.pump(T, song.beat * 0.55);
      this.beats.push({ t: T, kind: 'kick' });
    }
    // bass (always); the bass2 layer drives it in 16ths
    const bch = on.has('bass2') ? (pat(song.bass) === '.' ? 'x' : pat(song.bass)) : pat(song.bass);
    if (bch !== '.') {
      const m = croot + (bch === 'o' ? 12 : bch === '5' ? 7 : 0);
      this.bass(T, m, song.s16 * (on.has('bass2') ? 0.9 : 1.7), on.has('bass2') ? 0.85 : 1);
    }
    if (on.has('hat') && pat(song.hat) !== '.') {
      this.hat(T, 0.5, true);
      this.beats.push({ t: T, kind: 'hat' });
    }
    if (on.has('snare')) {
      const fill = bar % 8 === 7 && s >= 12;
      if (fill) this.snare(T, 0.35 + (s - 12) * 0.15);
      else if (pat(song.snare) !== '.') {
        this.snare(T, 1);
        this.beats.push({ t: T, kind: 'snare' });
      }
    }
    if (on.has('perc')) {
      const c = pat(song.perc);
      if (c === 'x') this.hat(T, 0.22, false);
      else if (c === 'o') this.clap(T, 0.5);
    }
    if (on.has('pad') && s === 0) this.pad(T, chord.tones.map((t) => croot + 24 + t), song.bar * 0.98);
    if (on.has('arp')) {
      const c = pat(song.arp);
      if (c !== '.') {
        const idx = parseInt(c, 10), n = chord.tones.length;
        this.arp(T, croot + 24 + chord.tones[idx % n] + 12 * Math.floor(idx / n));
      }
    }
    if (g.groove && !intro) {
      const line = song.lead[bar % song.lead.length];
      const c = line[s];
      if (c && c !== '.' && c !== '-') {
        let len = 1;
        while (line[s + len] === '-') len++;
        this.lead(T, scaleNote(song, song.leadBase + parseInt(c, 36)), len * song.s16);
      }
    }
    return true;
  }

  // ------------------------------------------------------------ game events
  onEvent(e: GameEvent) {
    const ctx = this.ctx;
    if (!ctx || !this.song) return;
    switch (e.type) {
      case 'brick': {
        const t = this.quantize(GRACE);
        this.brick(t, e.midi, e.heat, e.pierce);
        this.noteTimes.push({ id: e.brick.id, t });
        if (this.noteTimes.length > 64) this.noteTimes.shift();
        break;
      }
      case 'judge': {
        const t = this.quantize(ACCENT_GRACE);
        this.accent(t, e.judge === 'perfect', e.heat);
        break;
      }
      case 'catch':
        this.tick(ctx.currentTime + 0.005, 0.25);
        break;
      case 'swing':
        this.whoosh(ctx.currentTime + 0.003);
        break;
      case 'launch':
        this.tick(this.quantize(GRACE), 0.5);
        break;
      case 'row':
        this.sparkle(this.quantize(GRACE));
        break;
      case 'lost':
        this.dip();
        break;
      case 'clear': {
        // the finale lands on the next downbeat (the game ends the level a bar after it)
        const song = this.song;
        const pos = (ctx.currentTime + 0.03 - this.start) / song.s16;
        this.finaleStep = Math.max(this.stepI, Math.ceil(pos / 16) * 16);
        break;
      }
      case 'end':
        if (e.reason === 'lives') this.stopSong(1.2);
        break;
      default:
        break;
    }
  }

  /** for the renderer: when each brick's note actually sounds (ctx time) */
  readonly noteTimes: { id: number; t: number }[] = [];

  /** ctx time → heard song time */
  songTimeOf(ctxT: number) {
    return ctxT - this.start;
  }

  /** The earliest grid-aligned ctx time from now (a 16th, or now if a grid point just passed). */
  private quantize(grace: number) {
    const ctx = this.ctx!, song = this.song!;
    const earliest = ctx.currentTime + 0.01;
    const pos = (earliest - this.start) / song.s16;
    const prev = Math.floor(pos);
    if ((pos - prev) * song.s16 <= grace) return earliest;
    return this.start + (prev + 1) * song.s16;
  }

  // ------------------------------------------------------------ voices
  private env(g: AudioParam, t: number, peak: number, a: number, d: number) {
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + a);
    g.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private osc(type: OscillatorType, f: number, t: number, dur: number, to: AudioNode, detune = 0) {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.detune.value = detune;
    o.connect(to);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private noiseSrc(t: number, dur: number, to: AudioNode) {
    const n = this.ctx!.createBufferSource();
    n.buffer = this.noise;
    n.connect(to);
    n.start(t, Math.random() * 1.5);
    n.stop(t + dur + 0.05);
    return n;
  }

  private gain(to: AudioNode, v = 0) {
    const g = this.ctx!.createGain();
    g.gain.value = v;
    g.connect(to);
    return g;
  }

  private filter(type: BiquadFilterType, f: number, q: number, to: AudioNode) {
    const b = this.ctx!.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    b.connect(to);
    return b;
  }

  /** sidechain: pad and bass duck under the kick */
  private pump(t: number, len: number) {
    const g = this.duck.gain;
    g.setValueAtTime(0.3, t);
    g.linearRampToValueAtTime(1, t + len);
  }

  private kick(t: number, v: number) {
    const g = this.gain(this.drums);
    this.env(g.gain, t, v, 0.002, 0.42);
    const o = this.osc('sine', 165, t, 0.45, g);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.13);
    const c = this.gain(this.drums);
    this.env(c.gain, t, v * 0.35, 0.001, 0.012);
    this.noiseSrc(t, 0.02, this.filter('highpass', 2500, 0.7, c));
  }

  private snare(t: number, v: number) {
    const g = this.gain(this.drums);
    this.env(g.gain, t, 0.42 * v, 0.002, 0.2);
    const send = this.gain(this.verb, 0.9 * v);
    const bp = this.filter('bandpass', 1900, 0.7, g);
    bp.connect(send);
    this.noiseSrc(t, 0.25, this.filter('highpass', 700, 0.5, bp));
    const tg = this.gain(this.drums);
    this.env(tg.gain, t, 0.3 * v, 0.001, 0.08);
    const o = this.osc('triangle', 200, t, 0.1, tg);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
  }

  private hat(t: number, v: number, open: boolean) {
    const g = this.gain(this.drums);
    this.env(g.gain, t, 0.16 * v, 0.001, open ? 0.2 : 0.04);
    this.noiseSrc(t, open ? 0.25 : 0.06, this.filter('highpass', open ? 7500 : 9000, 0.6, g));
  }

  private clap(t: number, v: number) {
    const g = this.gain(this.drums);
    const p = g.gain;
    p.setValueAtTime(0.0001, t);
    for (let k = 0; k < 3; k++) {
      p.setValueAtTime(0.4 * v, t + k * 0.011);
      p.exponentialRampToValueAtTime(0.02, t + k * 0.011 + 0.009);
    }
    p.setValueAtTime(0.35 * v, t + 0.033);
    p.exponentialRampToValueAtTime(0.0001, t + 0.2);
    const send = this.gain(this.verb, 0.5 * v);
    const bp = this.filter('bandpass', 1300, 1.2, g);
    bp.connect(send);
    this.noiseSrc(t, 0.25, bp);
  }

  private bass(t: number, m: number, dur: number, v: number) {
    const g = this.gain(this.music);
    const p = g.gain;
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(0.26 * v, t + 0.005);
    p.setValueAtTime(0.26 * v, t + dur * 0.7);
    p.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = this.filter('lowpass', 900, 5, g);
    lp.frequency.setValueAtTime(1100, t);
    lp.frequency.exponentialRampToValueAtTime(240, t + dur * 0.8);
    const f = midiHz(m);
    this.osc('sawtooth', f, t, dur, lp);
    this.osc('square', f / 2, t, dur, this.gain(lp, 0.5));
  }

  private pad(t: number, ms: number[], dur: number) {
    const g = this.gain(this.music);
    const p = g.gain;
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(0.045, t + 0.35);
    p.setValueAtTime(0.045, t + dur - 0.3);
    p.linearRampToValueAtTime(0.0001, t + dur + 0.4);
    const lp = this.filter('lowpass', 1500, 0.8, g);
    g.connect(this.gain(this.verb, 0.8));
    for (const m of ms) {
      const f = midiHz(m);
      this.osc('sawtooth', f, t, dur + 0.4, lp, -9);
      this.osc('sawtooth', f, t, dur + 0.4, lp, 9);
    }
  }

  private arp(t: number, m: number) {
    const g = this.gain(this.music);
    this.env(g.gain, t, 0.07, 0.003, 0.16);
    g.connect(this.gain(this.delay, 0.6));
    const lp = this.filter('lowpass', 3200, 4, g);
    lp.frequency.setValueAtTime(3600, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + 0.14);
    this.osc('square', midiHz(m), t, 0.2, lp);
  }

  private lead(t: number, m: number, dur: number) {
    const g = this.gain(this.music);
    const p = g.gain;
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(0.075, t + 0.02);
    p.setValueAtTime(0.06, t + Math.max(0.03, dur - 0.05));
    p.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
    g.connect(this.gain(this.delay, 0.7));
    g.connect(this.gain(this.verb, 0.5));
    const lp = this.filter('lowpass', 2600, 1.5, g);
    const f = midiHz(m);
    const o1 = this.osc('sawtooth', f, t, dur + 0.15, lp, -6);
    const o2 = this.osc('sawtooth', f, t, dur + 0.15, lp, 6);
    // slow vibrato
    const lfo = this.ctx!.createOscillator();
    lfo.frequency.value = 5.5;
    const lg = this.ctx!.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(14, t + Math.min(0.5, dur));
    lg.connect(o1.detune);
    lg.connect(o2.detune);
    lfo.connect(lg);
    lfo.start(t);
    lfo.stop(t + dur + 0.2);
  }

  /** a brick: a plucked note, brighter and fuller as the ball heats up */
  private brick(t: number, m: number, heat: number, pierce: boolean) {
    const g = this.gain(this.notes);
    this.env(g.gain, t, 0.2, 0.003, 0.55 + heat * 0.05);
    g.connect(this.gain(this.delay, 0.45));
    g.connect(this.gain(this.verb, 0.35));
    const lp = this.filter('lowpass', 900, 6, g);
    lp.frequency.setValueAtTime(1400 + heat * 900, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.35);
    const f = midiHz(m);
    this.osc('sawtooth', f, t, 0.7, lp, -5);
    this.osc('square', f, t, 0.7, this.gain(lp, 0.6), 5);
    if (heat >= 2) this.osc('sawtooth', f * 2, t, 0.5, this.gain(lp, 0.35));
    if (heat >= 3 || pierce) this.bell(t, m + 12, 0.08);
  }

  private bell(t: number, m: number, v: number) {
    const g = this.gain(this.notes);
    this.env(g.gain, t, v, 0.002, 1.2);
    g.connect(this.gain(this.verb, 0.6));
    const f = midiHz(m);
    const car = this.osc('sine', f, t, 1.3, g);
    const mg = this.ctx!.createGain();
    mg.gain.setValueAtTime(f * 2, t);
    mg.gain.exponentialRampToValueAtTime(1, t + 0.8);
    mg.connect(car.frequency);
    this.osc('sine', f * 3.5, t, 1.3, mg);
  }

  private accent(t: number, perfect: boolean, heat: number) {
    this.clap(t, perfect ? 0.7 : 0.45);
    if (perfect) {
      const song = this.song!;
      const bar = Math.floor((t - this.start) / song.bar);
      const ch = song.chords[((bar % song.chords.length) + song.chords.length) % song.chords.length];
      this.bell(t, song.root + ch.root + 36 + (heat >= 3 ? 12 : 0), 0.06);
    }
  }

  private tick(t: number, v: number) {
    const g = this.gain(this.sfx);
    this.env(g.gain, t, 0.12 * v, 0.001, 0.05);
    this.osc('triangle', 1400, t, 0.06, g);
  }

  private whoosh(t: number) {
    const g = this.gain(this.sfx);
    this.env(g.gain, t, 0.08, 0.01, 0.1);
    const bp = this.filter('bandpass', 1200, 2, g);
    bp.frequency.setValueAtTime(800, t);
    bp.frequency.exponentialRampToValueAtTime(3500, t + 0.1);
    this.noiseSrc(t, 0.12, bp);
  }

  private sparkle(t: number) {
    const song = this.song!;
    for (let k = 0; k < 4; k++) this.bell(t + k * song.s16, scaleNote(song, 15 + k * 2), 0.045);
  }

  /** a lost ball: the whole mix sinks under a closing filter and comes back */
  private dip() {
    const ctx = this.ctx!, f = this.filt.frequency, t = ctx.currentTime;
    const beat = this.song?.beat ?? 0.5;
    f.cancelScheduledValues(t);
    f.setValueAtTime(Math.min(20000, f.value), t);
    f.exponentialRampToValueAtTime(320, t + 0.18);
    f.setValueAtTime(320, t + beat);
    f.exponentialRampToValueAtTime(20000, t + beat * 3);
    const g = this.gain(this.sfx);
    this.env(g.gain, t, 0.14, 0.01, 0.7);
    const o = this.osc('sawtooth', 440, t, 0.75, this.filter('lowpass', 1500, 2, g));
    o.frequency.exponentialRampToValueAtTime(70, t + 0.7);
  }

  private ending(T: number, chord: { root: number; tones: number[] }, root: number) {
    this.kick(T, 1);
    this.crash(T);
    this.pad(T, chord.tones.map((t) => root + chord.root + 24 + t), 2.5);
    this.bass(T, root + chord.root, 1.6, 1);
  }

  private finale(T: number, chord: { root: number; tones: number[] }, croot: number) {
    const song = this.song!;
    this.kick(T, 1);
    this.crash(T);
    this.snare(T, 1);
    this.pad(T, chord.tones.map((t) => croot + 24 + t), song.bar * 1.5);
    this.bass(T, croot, song.bar, 1);
    for (let k = 0; k < 8; k++) {
      const idx = k % chord.tones.length;
      this.bell(T + k * song.s16, croot + 36 + chord.tones[idx] + 12 * Math.floor(k / chord.tones.length), 0.06);
    }
  }

  private crash(t: number) {
    const g = this.gain(this.drums);
    this.env(g.gain, t, 0.22, 0.002, 1.8);
    g.connect(this.gain(this.verb, 0.6));
    this.noiseSrc(t, 1.9, this.filter('highpass', 5000, 0.4, g));
  }

  // ------------------------------------------------------------ calibration
  /** Schedules `n` clicks every `period` s from now; returns their ctx times. */
  clicks(n: number, period: number): number[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    const t0 = ctx.currentTime + 0.3;
    const out: number[] = [];
    for (let k = 0; k < n; k++) {
      const t = t0 + k * period;
      this.kick(t, 0.8);
      this.tick(t, k % 4 === 0 ? 1 : 0.6);
      out.push(t);
    }
    return out;
  }

  /** ctx time of an input event, minus the reported output latency (calibration excluded) */
  tapCtx(eventMs: number) {
    const ctx = this.ctx!;
    const c = this.calib;
    this.calib = 0;
    const lat = this.latency();
    this.calib = c;
    return ctx.currentTime - Math.max(0, performance.now() - eventMs) / 1000 - lat;
  }
}
