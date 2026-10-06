// The frame: background (synthwave night that grows with the unlocked layers and reacts to the
// music) -> neon shapes (glass bricks, glass shards, paddle, ball with a light ribbon, sparks,
// rings, row sweeps) -> bloom chain -> composite (camera breathing and shake, shockwaves,
// chromatic aberration, glitch, ACES, scanlines, grain).

import { Program, Target, DynBuffer, type GL } from '../gl/gl';
import * as S from './shaders';
import { BAL, FIELD_H, FIELD_W } from '../game/balance';
import type { Game, GameEvent, PowerId, SpecialId } from '../game/game';
import type { LayerId } from '../music/song';
import { clamp, damp, lerp } from '../core/math';

type RGB = [number, number, number];
type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; w: number; c: RGB; g: number };
type Shard = { x: number; y: number; vx: number; vy: number; rot: number; spin: number; hw: number; hh: number; fx: number; fy: number; life: number; max: number; c: RGB };
type Ring = { x: number; y: number; t0: number; dur: number; r0: number; r1: number; c: RGB; thick: number; a: number };
type Shock = { x: number; y: number; t0: number; amp: number; speed: number; dur: number };
type Pulse = { id: number; x: number; y: number; t: number; c: RGB; done: boolean };
type Sweep = { y: number; t0: number; c: RGB };

/** what the music is doing right now, for the visuals */
export type Beat = {
  kick: number; snare: number; hat: number;
  bass: number; mid: number; high: number;
  energy: number; groove: number; scroll: number;
  /** 32 spectrum bins 0..255 */
  spec: Uint8Array;
};

const MAX_SPARKS = 500;
const MAX_SHARDS = 260;
const LAYER_IDS: LayerId[] = ['hat', 'snare', 'pad', 'arp', 'bass2', 'perc'];

const HEAT: RGB[] = [
  [0.75, 1.1, 1.5],
  [1.2, 1.25, 0.8],
  [1.8, 1.1, 0.35],
  [2.2, 0.6, 0.25],
  [2.6, 1.2, 1.9],
];

export function rowColor(k: number): RGB {
  // bottom rows cyan, through violet, top rows hot pink
  const a: RGB = [0.15, 0.85, 1.25], b: RGB = [0.75, 0.35, 1.35], c: RGB = [1.4, 0.25, 0.75];
  const m = (x: RGB, y: RGB, t: number): RGB => [lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)];
  return k < 0.5 ? m(a, b, k * 2) : m(b, c, (k - 0.5) * 2);
}
const HARD: RGB = [1.6, 1.15, 0.45];
export const POWER_COLOR: Record<PowerId, RGB> = {
  multi: [1.5, 0.5, 1.4], laser: [1.6, 0.35, 0.3], wide: [0.35, 1.4, 0.7], magnet: [0.5, 0.7, 1.7], slow: [1.5, 1.2, 0.35],
};
const DROP: RGB = [1.9, 1.7, 1.9];
const mul = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

export class Renderer {
  readonly gl: GL;
  private hdr: boolean;
  quality = 1;
  bloomAmt = 0.4;
  bloomThresh = 1.1;
  W = 0;
  H = 0;
  /** field placement in device px (GL origin bottom-left) and px per world unit */
  x0 = 0;
  y0 = 0;
  s = 1;
  private scene: Target;
  private bloom: Target[];
  private pBg: Program;
  private pShape: Program;
  private pDown: Program;
  private pUp: Program;
  private pComp: Program;
  private emptyVao: WebGLVertexArrayObject;
  private shapes: DynBuffer;
  private specTex: WebGLTexture;
  private sparks: Spark[] = [];
  private shards: Shard[] = [];
  private rings: Ring[] = [];
  private shocks: Shock[] = [];
  private pulses: Pulse[] = [];
  private sweeps: Sweep[] = [];
  private lay = new Float32Array(6);
  private flash = 0;
  private tint = 0;
  private ca = 0;
  private glitch = 0;
  private shake = 0;
  private fireworks = 0;
  private dim = 0;
  private dropSeen = false;
  private rnd = 12345;
  private lastT = 0;
  private time = 0;
  private gameT = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 niedostępny');
    this.gl = gl;
    this.hdr = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');
    this.scene = new Target(gl, this.hdr);
    this.bloom = [0, 1, 2, 3, 4].map(() => new Target(gl, this.hdr));
    this.pBg = new Program(gl, S.FULLSCREEN_VS, S.BG_FS, 'bg');
    this.pShape = new Program(gl, S.SHAPE_VS, S.SHAPE_FS, 'shape');
    this.pDown = new Program(gl, S.FULLSCREEN_VS, S.DOWN_FS, 'down');
    this.pUp = new Program(gl, S.FULLSCREEN_VS, S.UP_FS, 'up');
    this.pComp = new Program(gl, S.FULLSCREEN_VS, S.COMPOSITE_FS, 'comp');
    this.emptyVao = gl.createVertexArray()!;
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.shapes = new DynBuffer(gl, 16, [
      { loc: 1, size: 4, offset: 0, divisor: 1 },
      { loc: 2, size: 4, offset: 4, divisor: 1 },
      { loc: 3, size: 4, offset: 8, divisor: 1 },
      { loc: 4, size: 4, offset: 12, divisor: 1 },
    ], 16 * 1024, (g) => {
      g.bindBuffer(g.ARRAY_BUFFER, quad);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 2, g.FLOAT, false, 8, 0);
    });
    this.specTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.specTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 32, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(32));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private r() {
    this.rnd = (this.rnd * 16807) % 2147483647;
    return this.rnd / 2147483647;
  }

  resize() {
    const cssW = this.canvas.clientWidth || window.innerWidth;
    const cssH = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.quality;
    const W = Math.max(2, Math.round(cssW * dpr)), H = Math.max(2, Math.round(cssH * dpr));
    if (W !== this.W || H !== this.H) {
      this.W = W;
      this.H = H;
      this.canvas.width = W;
      this.canvas.height = H;
      this.scene.resize(W, H);
      let bw = W / 2, bh = H / 2;
      for (const b of this.bloom) {
        b.resize(bw, bh);
        bw /= 2;
        bh /= 2;
      }
    }
    this.s = Math.min(W / FIELD_W, H / FIELD_H);
    this.x0 = (W - FIELD_W * this.s) / 2;
    this.y0 = (H - FIELD_H * this.s) / 2;
  }

  /** world → CSS px from the top-left (for DOM pops) */
  toCss(x: number, y: number) {
    const k = (this.canvas.clientWidth || window.innerWidth) / this.W;
    return { x: (this.x0 + x * this.s) * k, y: (this.H - (this.y0 + y * this.s)) * k };
  }

  /** CSS px → world x (mouse control) */
  worldX(cssX: number) {
    const k = this.W / (this.canvas.clientWidth || window.innerWidth);
    return (cssX * k - this.x0) / this.s;
  }

  /** CSS px per world unit */
  get cssScale() {
    return this.s * (this.canvas.clientWidth || window.innerWidth) / this.W;
  }

  /** forget the effects of a finished game */
  clear() {
    this.sparks.length = 0;
    this.shards.length = 0;
    this.rings.length = 0;
    this.pulses.length = 0;
    this.sweeps.length = 0;
    this.lay.fill(0);
    this.fireworks = 0;
    this.dropSeen = false;
    this.dim = 0;
  }

  // ------------------------------------------------------------ effects from game events
  onEvent(e: GameEvent, g: Game, noteT: number | null) {
    const t = g.t;
    switch (e.type) {
      case 'brick': {
        const b = e.brick;
        const c = b.kind === 'hard' ? HARD : rowColor(b.rowUp / Math.max(1, g.song.rows.length - 1));
        if (e.broken) {
          this.shatter(b.x, b.y, b.w, b.h, c, e.x, e.y, e.heat);
          if (e.heat >= 3) this.shock(b.x, b.y, 0.25 + e.heat * 0.05);
        } else {
          this.sparkBurst(e.x, e.y, mul(c, 1.3), 10, 260);
          this.shake = Math.max(this.shake, 2);
        }
        this.pulses.push({ id: b.id, x: b.x, y: b.y, t: noteT ?? t, c, done: false });
        break;
      }
      case 'judge': {
        const perfect = e.judge === 'perfect';
        const c: RGB = perfect ? [1.1, 0.95, 1.5] : [0.4, 0.85, 1.1];
        this.rings.push({ x: e.x, y: e.y, t0: t, dur: 0.45, r0: 34, r1: perfect ? 220 : 130, c, thick: perfect ? 2.5 : 1.8, a: 0.9 });
        if (perfect) this.rings.push({ x: e.x, y: e.y, t0: t, dur: 0.6, r0: 20, r1: 300, c: HEAT[Math.min(4, e.heat)], thick: 1.5, a: 0.35 });
        this.shock(e.x, e.y, perfect ? 0.5 : 0.28);
        this.shake = Math.max(this.shake, perfect ? 6 : 3);
        if (perfect) {
          this.ca = Math.max(this.ca, 0.45);
          this.flash = Math.max(this.flash, 0.025);
        }
        this.sparkBurst(e.x, e.y, mul(HEAT[Math.min(4, e.heat)], 0.6), perfect ? 14 : 8, perfect ? 420 : 320, true);
        break;
      }
      case 'contact':
        this.sparkBurst(e.x, e.y, [0.4, 0.9, 1.2], 6, 180, true);
        break;
      case 'wall':
        this.sparkBurst(e.x, e.y, [0.6, 0.4, 1.4], 4, 160);
        break;
      case 'row': {
        const y = BAL.field.bricksTop - BAL.field.brickH / 2 - e.row * BAL.field.rowPitch;
        this.sweeps.push({ y, t0: t, c: rowColor((g.song.rows.length - 1 - e.row) / Math.max(1, g.song.rows.length - 1)) });
        this.flash = Math.max(this.flash, 0.04);
        break;
      }
      case 'lost':
        this.tint = 1;
        this.glitch = 1;
        this.shake = Math.max(this.shake, 9);
        this.ca = Math.max(this.ca, 1);
        this.shock(clamp(g.bx, 0, FIELD_W), 0, 0.8);
        break;
      case 'special': {
        const b = e.brick;
        const c = rowColor(b.rowUp / Math.max(1, g.song.rows.length - 1));
        if (e.special === 'chord') for (let k = 0; k < 3; k++) this.rings.push({ x: b.x, y: b.y, t0: t + k * 0.06, dur: 0.6, r0: 20, r1: 120 + k * 40, c, thick: 2, a: 0.8 });
        if (e.special === 'echo') for (let k = 0; k < 3; k++) this.rings.push({ x: b.x, y: b.y, t0: t + k * 0.15, dur: 0.7, r0: 20, r1: 160, c: [0.8, 0.9, 1.6], thick: 1.5, a: 0.7 });
        if (e.special === 'tempoUp' || e.special === 'tempoDown') this.sweeps.push({ y: b.y, t0: t, c: [1.4, 1.2, 0.5] });
        if (e.special === 'perc') this.shock(b.x, b.y, 0.35);
        break;
      }
      case 'filter':
        this.dim = 1;
        break;
      case 'drop':
        this.shake = Math.max(this.shake, 4);
        break;
      case 'dropArm':
        this.flash = Math.max(this.flash, 0.05);
        break;
      case 'power': {
        const c = POWER_COLOR[e.kind];
        this.rings.push({ x: g.px, y: BAL.paddle.y, t0: t, dur: 0.5, r0: 30, r1: 200, c, thick: 2.5, a: 0.9 });
        this.sparkBurst(e.x, e.y, c, 18, 380, true);
        break;
      }
      case 'laser':
        this.sparkBurst(e.x, e.y, POWER_COLOR.laser, 3, 160, true);
        break;
      case 'extraGone':
        this.sparkBurst(e.x, e.y, [0.7, 0.8, 1.4], 8, 200);
        break;
      case 'saved':
        this.rings.push({ x: g.bx, y: g.by, t0: t, dur: 0.5, r0: 10, r1: 90, c: POWER_COLOR.multi, thick: 2, a: 0.8 });
        break;
      case 'clear':
        this.flash = 0.3;
        this.ca = 1.2;
        this.shake = 12;
        this.fireworks = 1;
        this.shock(FIELD_W / 2, FIELD_H * 0.6, 1.6);
        break;
      default:
        break;
    }
  }

  private shock(x: number, y: number, amp: number) {
    this.shocks.push({ x, y, t0: this.time, amp, speed: 950, dur: 0.6 });
    if (this.shocks.length > 4) this.shocks.shift();
  }

  /** sparks: short streaks flying out (`up` = mostly upwards, for paddle hits) */
  private sparkBurst(x: number, y: number, c: RGB, n: number, sp: number, up = false) {
    for (let i = 0; i < n * this.quality; i++) {
      const a = up ? Math.PI * (0.1 + 0.8 * this.r()) : this.r() * Math.PI * 2;
      const v = sp * (0.35 + this.r() * 0.65);
      this.addSpark({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.25 + this.r() * 0.35, w: 1.6 + this.r() * 1.6, c, g: 500 });
    }
  }

  private addSpark(p: Spark) {
    if (this.sparks.length >= MAX_SPARKS * this.quality) this.sparks.shift();
    this.sparks.push(p);
  }

  /** a brick breaks into glass triangles of its own shape, blown away from the impact */
  private shatter(x: number, y: number, w: number, h: number, c: RGB, ix: number, iy: number, heat: number) {
    const nx = this.quality < 0.75 ? 3 : 4, ny = 2;
    const cw = w / nx, ch = h / ny;
    const force = 1 + heat * 0.25;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        for (let k = 0; k < 2; k++) {
          const fx = k ? -1 : 1, fy = k ? -1 : 1;
          // the triangle's centroid sits off the cell centre
          const cx = x - w / 2 + cw * (i + 0.5), cy = y - h / 2 + ch * (j + 0.5);
          const dx = cx - ix, dy = cy - iy, dl = Math.hypot(dx, dy) || 1;
          const v = (120 + this.r() * 260) * force;
          if (this.shards.length >= MAX_SHARDS * this.quality) this.shards.shift();
          this.shards.push({
            x: cx, y: cy, vx: (dx / dl) * v + (this.r() - 0.5) * 80, vy: (dy / dl) * v * 0.7 + 60 + this.r() * 120,
            rot: 0, spin: (this.r() - 0.5) * 16, hw: cw / 2, hh: ch / 2, fx, fy, life: 0, max: 0.9 + this.r() * 0.6, c,
          });
        }
      }
    }
    this.sparkBurst(ix, iy, mul(c, 1.4), 8 + heat * 3, 300);
  }

  // ------------------------------------------------------------ frame
  render(g: Game | null, beat: Beat, showLanding: boolean) {
    const gl = this.gl;
    const now = performance.now() / 1000;
    const rdt = clamp(now - this.lastT, 0, 0.1);
    this.lastT = now;
    this.time += rdt;
    this.resize();

    // layers fade in and out
    for (let i = 0; i < LAYER_IDS.length; i++) {
      const on = g ? g.layers > g.song.layers.indexOf(LAYER_IDS[i]) && g.song.layers.includes(LAYER_IDS[i]) : false;
      this.lay[i] += ((on ? 1 : 0) - this.lay[i]) * damp(1.5, rdt);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.specTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 32, 1, gl.RED, gl.UNSIGNED_BYTE, beat.spec);

    // background
    this.scene.bind();
    gl.disable(gl.BLEND);
    const hz = (this.y0 + 560 * this.s) / this.H;
    // the laser fan counts 16ths: pass the step as "time" with a 16th of 1
    const step16 = g ? Math.max(0, g.tempo.stepAt(g.t)) : this.time / 0.15;
    this.pBg.use().f2('u_res', this.W, this.H).f1('u_time', this.time).f1('u_songT', step16).f1('u_s16', 1)
      .f1('u_scroll', beat.scroll).f1('u_kick', beat.kick).f1('u_snare', beat.snare).f1('u_hat', beat.hat)
      .f1('u_bass', beat.bass).f1('u_mid', beat.mid).f1('u_high', beat.high).f1('u_energy', beat.energy).f1('u_groove', beat.groove)
      .f4('u_layA', this.lay[0], this.lay[1], this.lay[2], this.lay[3]).f2('u_layB', this.lay[4], this.lay[5])
      .tex('u_spec', 0, this.specTex)
      .f4('u_field', this.x0, this.y0, this.x0 + FIELD_W * this.s, this.y0 + FIELD_H * this.s).f1('u_hz', hz).f1('u_detail', this.quality);
    this.fullscreen();

    // shapes
    const b = this.shapes;
    b.reset();
    this.frame(beat);
    if (g) this.drawGame(g, beat, showLanding, rdt);
    this.drawShards(rdt);
    this.drawSparks(rdt);
    if (b.n) {
      b.upload();
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.pShape.use().f4('u_view', this.x0, this.y0, this.s, 0).f2('u_res', this.W, this.H).f1('u_px', 1 / this.s).f1('u_time', this.time);
      gl.bindVertexArray(b.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, b.count);
      gl.disable(gl.BLEND);
    }

    this.flash *= Math.exp(-rdt * 12);
    this.dim *= Math.exp(-rdt * 0.9);
    this.tint *= Math.exp(-rdt * 3);
    this.ca *= Math.exp(-rdt * 6);
    this.glitch *= Math.exp(-rdt * 5);
    this.shake *= Math.exp(-rdt * 14);
    const zoom = 1 + beat.kick * (0.004 + 0.008 * beat.energy) + beat.groove * 0.004;
    this.post(zoom);
  }

  /** neon walls around the playfield */
  private frame(beat: Beat) {
    const k = 0.35 + beat.kick * 0.5 + beat.groove * 0.4;
    const c: RGB = beat.groove > 0.5 ? [1.2 * k, 0.25 * k, 0.9 * k] : [0.5 * k, 0.25 * k, 1.3 * k];
    this.box(-3, FIELD_H / 2, 2, FIELD_H / 2, 2, 0, 10, 0, c, 1);
    this.box(FIELD_W + 3, FIELD_H / 2, 2, FIELD_H / 2, 2, 0, 10, 0, c, 1);
    this.box(FIELD_W / 2, FIELD_H + 3, FIELD_W / 2 + 5, 2, 2, 0, 10, 0, c, 1);
  }

  private drawGame(g: Game, beat: Beat, showLanding: boolean, rdt: number) {
    const t = g.t;
    const gdt = clamp(t - this.gameT, 0, 0.1);
    this.gameT = t;
    const nRows = Math.max(1, g.song.rows.length - 1);
    // the drop lands: a blast; while it lasts every kick hits the camera
    if (g.dropping) {
      if (!this.dropSeen) {
        this.dropSeen = true;
        this.flash = 0.35;
        this.ca = 1.4;
        this.shake = 14;
        this.shock(FIELD_W / 2, FIELD_H * 0.55, 1.6);
        this.shock(g.px, BAL.paddle.y, 1);
      }
      this.ca = Math.max(this.ca, beat.kick * 0.5);
      this.shake = Math.max(this.shake, beat.kick * 3);
    }
    // a note sounding lights its brick (or the gap it left) on time with the audio
    for (const p of this.pulses) {
      if (p.done || t < p.t) continue;
      p.done = true;
      this.rings.push({ x: p.x, y: p.y, t0: p.t, dur: 0.5, r0: 30, r1: 90, c: p.c, thick: 2, a: 0.7 });
    }
    this.pulses = this.pulses.filter((p) => !p.done || t - p.t < 0.4);

    // row sweeps: a bar of light running along a cleared row
    this.sweeps = this.sweeps.filter((s) => t - s.t0 < 0.6);
    for (const s of this.sweeps) {
      const k = (t - s.t0) / 0.6;
      const x = lerp(-60, FIELD_W + 60, k);
      this.box(x, s.y, 50, BAL.field.brickH * 0.45, 12, 0, 22, 0, mul(s.c, 2.2 * (1 - k * 0.5)), 1, 0, 1);
      this.box(FIELD_W / 2, s.y, FIELD_W / 2, 1.5, 1.5, 0, 10, 0, mul(s.c, 1.6 * (1 - k)), 1, 0, 1);
    }

    for (const br of g.bricks) {
      if (!br.alive) continue;
      const c = br.kind === 'hard' ? HARD : rowColor(br.rowUp / nRows);
      const hit = Math.exp(-(t - br.hitT) * 10);
      const pulse = this.pulses.find((p) => p.done && p.id === br.id);
      const sing = pulse ? Math.exp(-(t - pulse.t) * 8) : 0;
      const k = 0.85 + hit * 1.5 + sing * 1.2 + beat.kick * 0.12 + beat.groove * 0.15;
      // a hit brick jolts; everything shakes during the drop
      const jx = hit * Math.sin(t * 90) * 2.5 + (g.dropping ? Math.sin(t * 60 + br.id) * beat.kick * 3 : 0);
      if (br.special === 'drop') {
        // drop bricks: white-hot, pulsing with the kick
        const dk = 0.9 + beat.kick * 0.8 + 0.3 * Math.sin(this.time * 6 + br.id);
        this.box(br.x + jx, br.y, br.w / 2, br.h / 2, 6, 1, 14, 1, mul(DROP, dk * k * 0.7), 1);
      } else this.box(br.x + jx, br.y, br.w / 2, br.h / 2, 6, br.kind === 'hard' ? 3 : 1, 9, br.hp / br.maxHp, mul(c, k), 1);
      if (br.special) this.glyph(br.special, br.x + jx, br.y, br.special === 'drop' ? [2.2, 2, 2.2] : mul([1.4, 1.4, 1.5], 0.7 + sing * 0.8 + hit * 0.8));
    }

    // rings
    this.rings = this.rings.filter((r) => t - r.t0 < r.dur);
    for (const r of this.rings) {
      const k = clamp((t - r.t0) / r.dur, 0, 1);
      const rad = lerp(r.r0, r.r1, 1 - (1 - k) * (1 - k));
      this.box(r.x, r.y, rad, rad, rad, 2, 5, r.thick * (1 - k * 0.5), r.c, r.a * (1 - k), 0, 1);
    }

    // paddle: glass bar with a neon edge, flares on a swing
    const P = BAL.paddle;
    const lift = g.lift();
    const swingK = clamp(lift / P.swingLift, 0, 1);
    const pc: RGB = g.groove ? [1.5, 0.45, 1.5] : [0.3, 1.1, 1.5];
    const pk = 1 + swingK * 0.5 + beat.kick * 0.2;
    const py = P.y + lift;
    const pw = g.paddleW;
    const pcol: RGB = g.active('laser') ? POWER_COLOR.laser : g.active('magnet') ? POWER_COLOR.magnet : pc;
    this.box(g.px, py, pw / 2, P.h / 2, P.h / 2, 1, 9, 0, mul(pcol, pk), 1);
    this.box(g.px, py + P.h * 0.18, pw / 2 - 10, 2, 2, 0, 4, 0, mul([1.2, 1.2, 1.4], 0.7 + swingK * 0.4), 0.9, 0, 1);
    if (swingK > 0.05) this.box(g.px, py - P.h * 0.8, pw / 2 * (0.6 + swingK * 0.4), 2, 2, 0, 6, 0, mul(pc, swingK * 0.7), 1, 0, 1);
    if (g.active('laser')) {
      for (const sx of [-1, 1]) this.box(g.px + sx * (pw / 2 - 10), py + P.h * 0.7, 4, 7, 2, 0, 6, 0, mul(POWER_COLOR.laser, 1.2), 1);
    }
    if (g.active('magnet')) {
      const mk = 0.5 + 0.5 * Math.sin(this.time * 8);
      for (let k = 0; k < 2; k++) {
        const r = 22 + ((this.time * 40 + k * 20) % 40);
        this.box(g.px, py + 8, r * 1.8, r * 0.5, r * 0.5, 2, 4, 1, mul(POWER_COLOR.magnet, 0.6), (1 - (r - 22) / 40) * (0.4 + 0.3 * mk), 0, 1);
      }
    }
    // laser shots
    for (const sh of g.shots) this.box(sh.x, sh.y + 18, 2.5, 22, 2.5, 0, 8, 0, mul(POWER_COLOR.laser, 1.6), 1, 0, 1);
    // falling power-ups: a glass capsule with a glyph
    for (const pw2 of g.powers) {
      const c = POWER_COLOR[pw2.kind];
      const bob = 1 + 0.15 * Math.sin(this.time * 10 + pw2.id);
      this.box(pw2.x, pw2.y, 30, 13, 13, 1, 10, 0, mul(c, bob), 1);
      this.powerGlyph(pw2.kind, pw2.x, pw2.y);
    }
    // extra balls (echo clones fade out, multiball balls stay)
    for (const e of g.extras) {
      const R = BAL.ball.r;
      const fade = e.kind === 'echo' ? clamp((e.until - t) / 1.2, 0, 1) : 1;
      const ec: RGB = e.kind === 'echo' ? [0.6, 0.8, 1.6] : POWER_COLOR.multi;
      const n = e.trail.length;
      for (let i = 1; i < n; i++) {
        const a = e.trail[i - 1], p = e.trail[i];
        const dx = p.x - a.x, dy = p.y - a.y, len = Math.hypot(dx, dy);
        if (len < 0.01 || len > 200) continue;
        const k = i / n, w = R * (0.1 + 0.35 * k * k);
        this.box((a.x + p.x) / 2, (a.y + p.y) / 2, len / 2 + w, w, w, 0, 3, 0, mul(ec, 0.3 * k), k * 0.6 * fade, Math.atan2(dy, dx), 1);
      }
      this.box(e.x, e.y, R * 0.85, R * 0.85, R * 0.85, 0, 5, 0, mul(ec, 0.9), fade * (e.kind === 'echo' ? 0.75 : 1));
      this.box(e.x, e.y, R * 0.45, R * 0.45, R * 0.45, 0, 0, 0, [1.4, 1.4, 1.5], fade);
    }

    // the landing ring (test option, off by default)
    const L = g.landing;
    if (showLanding && L && L.synced && g.dy < 0 && !g.onPaddle) {
      const rem = L.t - t;
      if (rem > 0 && rem < 0.75) {
        const k = rem / 0.75;
        const rad = BAL.ball.r + 4 + k * 120;
        const y = P.y + P.h / 2;
        this.box(L.x, y, rad, rad, rad, 2, 6, 2.5, [1.1, 1.0, 1.5], (1 - k) * 0.7, 0, 1);
      }
    }

    // ball: a ribbon of light behind it, a halo coloured by heat, a white-hot core
    const showBall = g.phase !== 'finale' || g.endReason === 'song';
    if (showBall) {
      const R = BAL.ball.r;
      const tr = g.trail;
      const n = tr.length;
      // only the last few positions: a short streak, not a comet
      for (let i = Math.max(1, n - 18); i < n; i++) {
        const a = tr[i - 1], p = tr[i];
        const k = (i - (n - 18)) / 18;
        const dx = p.x - a.x, dy = p.y - a.y, len = Math.hypot(dx, dy);
        if (len < 0.01 || len > 200) continue;
        const tc = HEAT[Math.min(HEAT.length - 1, p.heat)];
        const w = R * (0.08 + 0.32 * k * k);
        this.box((a.x + p.x) / 2, (a.y + p.y) / 2, len / 2 + w, w, w, 0, 2, 0, mul(tc, 0.12 + 0.22 * k), k * 0.6, Math.atan2(dy, dx), 1);
      }
      const hc = HEAT[Math.min(HEAT.length - 1, g.heat)];
      const pierce = g.heat >= BAL.heat.pierce;
      // a crisp ball first: the halo stays small so it never turns into a comet
      this.box(g.bx, g.by, R, R, R, 0, 5 + g.heat, 0, mul(hc, 0.7), 1);
      this.box(g.bx, g.by, R * 0.6, R * 0.6, R * 0.6, 0, 0, 0, [1.6, 1.6, 1.6], 1);
      if (pierce) {
        const pr = R * (1.7 + 0.2 * Math.sin(this.time * 30));
        this.box(g.bx, g.by, pr, pr, pr, 2, 5, 1.2, mul(hc, 0.8), 0.5, 0, 1);
      }
      // a hot ball sheds sparks
      if (g.heat >= 3 && !g.onPaddle && this.r() < (g.heat - 2) * 0.2 * this.quality * Math.min(1, rdt * 60)) {
        this.addSpark({ x: g.bx, y: g.by, vx: (this.r() - 0.5) * 120 - g.dx * 60, vy: (this.r() - 0.5) * 120 - g.dy * 60, life: 0, max: 0.3 + this.r() * 0.3, w: 1.5, c: hc, g: 200 });
      }
    }

    // the finale: fireworks over the last bar
    if (this.fireworks > 0 && g.phase === 'finale' && g.endReason === 'clear') {
      if (this.r() < gdt * 14) {
        const x = 80 + this.r() * (FIELD_W - 160), y = 600 + this.r() * 520;
        const c = rowColor(this.r());
        this.sparkBurst(x, y, mul(c, 1.6), 26, 420);
        this.rings.push({ x, y, t0: t, dur: 0.6, r0: 10, r1: 110, c, thick: 2, a: 0.8 });
      }
    }
  }

  private drawShards(dt: number) {
    const ss = this.shards;
    let w = 0;
    for (let i = 0; i < ss.length; i++) {
      const p = ss[i];
      p.life += dt;
      if (p.life >= p.max || p.y < -60) continue;
      p.vy -= 900 * dt;
      p.vx *= Math.exp(-dt * 0.8);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      const k = 1 - p.life / p.max;
      const glow = 0.5 + 1.4 * k * k;
      this.box(p.x, p.y, p.hw, p.hh, 0, 4, 4, 0, mul(p.c, glow), Math.min(1, k * 1.6), p.rot, 0, p.fx, p.fy);
      ss[w++] = p;
    }
    ss.length = w;
  }

  private drawSparks(dt: number) {
    const ps = this.sparks;
    let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life += dt;
      if (p.life >= p.max) continue;
      p.vy -= p.g * dt;
      p.vx *= Math.exp(-dt * 2);
      p.vy *= Math.exp(-dt * 2);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = 1 - p.life / p.max;
      const sp = Math.hypot(p.vx, p.vy);
      const len = Math.max(p.w, sp * 0.02);
      this.box(p.x, p.y, len + p.w, p.w, p.w, 0, 3, 0, mul(p.c, 1.4), k, Math.atan2(p.vy, p.vx), 1);
      ps[w++] = p;
    }
    ps.length = w;
  }

  /** a little sign on a special brick, drawn with the same neon shapes */
  private glyph(sp: SpecialId, x: number, y: number, c: RGB) {
    const L = (dx: number, dy: number, hw: number, hh: number, rot = 0) => this.box(x + dx, y + dy, hw, hh, Math.min(hw, hh), 0, 3, 0, c, 1, rot, 1);
    switch (sp) {
      case 'chord': // three stacked notes
        for (let k = -1; k <= 1; k++) L(0, k * 7, 12, 1.6);
        break;
      case 'perc': // a drum: ring
        this.box(x, y, 9, 9, 9, 2, 3, 1.4, c, 1, 0, 1);
        L(0, 0, 2, 2);
        break;
      case 'arp': // a staircase
        for (let k = 0; k < 4; k++) L(-12 + k * 8, -6 + k * 4, 2.2, 3 + k * 2.2);
        break;
      case 'filter': // a closing slope
        for (let k = 0; k < 5; k++) L(-14 + k * 7, 4 - (k * k) * 0.9, 2.2, 1.6 + (4 - k) * 1.2);
        break;
      case 'echo': // two rings
        this.box(x - 5, y, 7, 7, 7, 2, 3, 1.2, c, 1, 0, 1);
        this.box(x + 6, y, 7, 7, 7, 2, 3, 1.2, mul(c, 0.6), 1, 0, 1);
        break;
      case 'tempoUp':
      case 'tempoDown': { // a metronome arm and its triangle
        const up = sp === 'tempoUp';
        this.box(x, y, 8, 8, 0, 4, 3, 0, mul(c, 0.8), 1, up ? Math.PI * 0.75 : -Math.PI * 0.25, 1);
        L(up ? 10 : -10, 0, 1.4, 9, up ? -0.4 : 0.4);
        break;
      }
      case 'drop': // an arrow down
        L(0, 5, 2, 7);
        this.box(x, y - 5, 7, 7, 0, 4, 3, 0, c, 1, -Math.PI * 0.75, 1);
        break;
    }
  }

  private powerGlyph(kind: PowerId, x: number, y: number) {
    const c: RGB = [1.8, 1.8, 1.9];
    const L = (dx: number, dy: number, hw: number, hh: number) => this.box(x + dx, y + dy, hw, hh, Math.min(hw, hh), 0, 2, 0, c, 1, 0, 1);
    switch (kind) {
      case 'multi':
        for (let k = -1; k <= 1; k++) L(k * 9, 0, 3, 3);
        break;
      case 'laser':
        L(-7, 0, 1.6, 7);
        L(7, 0, 1.6, 7);
        break;
      case 'wide':
        L(0, 0, 12, 2);
        this.box(x - 16, y, 4, 4, 0, 4, 2, 0, c, 1, Math.PI * 0.25, 1);
        this.box(x + 16, y, 4, 4, 0, 4, 2, 0, c, 1, -Math.PI * 0.75, 1);
        break;
      case 'magnet':
        this.box(x, y + 1, 9, 7, 7, 2, 2, 1.6, c, 1, 0, 1);
        break;
      case 'slow':
        this.box(x, y + 4, 5, 5, 0, 4, 2, 0, c, 1, Math.PI * 0.75, 1);
        this.box(x, y - 4, 5, 5, 0, 4, 2, 0, c, 1, -Math.PI * 0.25, 1);
        break;
    }
  }

  private box(x: number, y: number, hw: number, hh: number, r: number, kind: number, glow: number, extra: number, c: RGB, a: number,
    rot = 0, add = 0, fx = 1, fy = 1) {
    if (!Number.isFinite(x + y + hw + hh + c[0] + c[1] + c[2] + a + rot)) return;
    const b = this.shapes;
    b.ensure(16);
    const d = b.data;
    let i = b.n;
    d[i++] = x; d[i++] = y; d[i++] = hw; d[i++] = hh;
    d[i++] = r; d[i++] = kind; d[i++] = glow; d[i++] = extra;
    d[i++] = c[0]; d[i++] = c[1]; d[i++] = c[2]; d[i++] = a;
    d[i++] = rot; d[i++] = fx; d[i++] = fy; d[i++] = add;
    b.n = i;
  }

  // ------------------------------------------------------------ post
  private post(zoom: number) {
    const gl = this.gl;
    let src = this.scene;
    const levels = this.quality < 0.7 ? 3 : this.bloom.length;
    for (let i = 0; i < levels; i++) {
      const dst = this.bloom[i];
      dst.bind();
      this.pDown.use().tex('u_src', 0, src.tex).f2('u_texel', 1 / src.w, 1 / src.h).f1('u_pre', i === 0 ? 1 : 0).f1('u_thresh', this.bloomThresh);
      this.fullscreen();
      src = dst;
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = levels - 1; i > 0; i--) {
      const from = this.bloom[i], to = this.bloom[i - 1];
      to.bind();
      this.pUp.use().tex('u_src', 0, from.tex).f2('u_texel', 1 / from.w, 1 / from.h).f1('u_amt', 1);
      this.fullscreen();
    }
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.W, this.H);
    const sh = this.shake * this.s;
    const p = this.pComp.use().tex('u_scene', 0, this.scene.tex).tex('u_bloom', 1, this.bloom[0].tex)
      .f2('u_res', this.W, this.H).f1('u_time', this.time).f1('u_bloomAmt', this.bloomAmt).f1('u_ca', this.ca * 0.012)
      .f1('u_flash', this.flash).f3('u_tint', this.tint * 0.12, 0, this.tint * 0.02)
      .f1('u_dim', this.dim * 0.55).f1('u_zoom', zoom).f2('u_shake', (this.r() - 0.5) * sh, (this.r() - 0.5) * sh).f1('u_glitch', this.glitch);
    this.shocks = this.shocks.filter((s) => this.time - s.t0 < s.dur);
    for (let i = 0; i < 4; i++) {
      const s = this.shocks[i];
      if (!s) {
        p.f4(`u_shock[${i}]`, 0, 0, 0, 0);
        continue;
      }
      const k = (this.time - s.t0) / s.dur;
      // born as a ring already: a shock at radius 0 is a lens that blows up whatever glows there
      const age = this.time - s.t0;
      const grow = Math.min(1, age / 0.08);
      p.f4(`u_shock[${i}]`, this.x0 + s.x * this.s, this.y0 + s.y * this.s, (40 + s.speed * age) * this.s, s.amp * (1 - k) * (1 - k) * grow);
    }
    this.fullscreen();
  }

  private fullscreen() {
    const gl = this.gl;
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
