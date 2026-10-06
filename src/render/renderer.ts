// The frame: background (synthwave night pulsing with the music) -> neon shapes (bricks, paddle,
// ball, trail, rings, shards) -> bloom chain -> composite (shockwaves, chromatic aberration,
// ACES, scanlines, grain). M1 graphics: readable feedback first; the wow pass is M2.

import { Program, Target, DynBuffer, type GL } from '../gl/gl';
import * as S from './shaders';
import { BAL, FIELD_H, FIELD_W } from '../game/balance';
import type { Game, GameEvent } from '../game/game';
import { clamp, lerp } from '../core/math';

type RGB = [number, number, number];
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; c: RGB };
type Ring = { x: number; y: number; t0: number; dur: number; r0: number; r1: number; c: RGB; thick: number; a: number };
type Shock = { x: number; y: number; t0: number; amp: number; speed: number; dur: number };
type Pulse = { x: number; y: number; w: number; h: number; t: number; c: RGB; done: boolean };

/** what the music is doing right now, for the visuals */
export type Beat = { kick: number; hat: number; bass: number; energy: number; groove: number; scroll: number };

const MAX_PARTS = 600;

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

export class Renderer {
  readonly gl: GL;
  private hdr: boolean;
  quality = 1;
  bloomAmt = 0.35;
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
  private parts: Particle[] = [];
  private rings: Ring[] = [];
  private shocks: Shock[] = [];
  private pulses: Pulse[] = [];
  private flash = 0;
  private tint = 0;
  private ca = 0;
  private rnd = 12345;
  private lastT = 0;
  private time = 0;

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
    this.shapes = new DynBuffer(gl, 12, [
      { loc: 1, size: 4, offset: 0, divisor: 1 },
      { loc: 2, size: 4, offset: 4, divisor: 1 },
      { loc: 3, size: 4, offset: 8, divisor: 1 },
    ], 12 * 1024, (g) => {
      g.bindBuffer(g.ARRAY_BUFFER, quad);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 2, g.FLOAT, false, 8, 0);
    });
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

  // ------------------------------------------------------------ effects from game events
  onEvent(e: GameEvent, g: Game, noteT: number | null) {
    const t = g.t;
    switch (e.type) {
      case 'brick': {
        const b = e.brick;
        const c = b.kind === 'hard' ? HARD : rowColor(b.rowUp / Math.max(1, g.song.rows.length - 1));
        if (e.broken) this.shatter(b.x, b.y, b.w, b.h, c, e.heat);
        else this.burst(e.x, e.y, c, 6, 160);
        this.pulses.push({ x: b.x, y: b.y, w: b.w, h: b.h, t: noteT ?? t, c, done: false });
        break;
      }
      case 'judge': {
        const perfect = e.judge === 'perfect';
        const c: RGB = perfect ? [1.6, 1.4, 2.2] : [0.6, 1.3, 1.6];
        this.rings.push({ x: e.x, y: e.y, t0: t, dur: 0.45, r0: 10, r1: perfect ? 190 : 120, c, thick: perfect ? 5 : 3, a: 1 });
        this.shock(e.x, e.y, perfect ? 1 : 0.55);
        if (perfect) {
          this.ca = Math.max(this.ca, 0.6);
          this.flash = Math.max(this.flash, 0.06);
        }
        this.burst(e.x, e.y, HEAT[Math.min(4, e.heat)], perfect ? 22 : 12, 320);
        break;
      }
      case 'contact':
        this.burst(e.x, e.y, [0.4, 0.9, 1.2], 5, 120);
        break;
      case 'wall':
        this.burst(e.x, e.y, [0.5, 0.4, 1.2], 3, 80);
        break;
      case 'row':
        break;
      case 'lost':
        this.tint = 1;
        this.shock(g.bx, 0, 0.6);
        break;
      case 'clear':
        this.flash = 0.25;
        this.ca = 1;
        this.shock(FIELD_W / 2, FIELD_H * 0.6, 1.4);
        break;
      default:
        break;
    }
  }

  private shock(x: number, y: number, amp: number) {
    this.shocks.push({ x, y, t0: this.time, amp, speed: 900, dur: 0.6 });
    if (this.shocks.length > 4) this.shocks.shift();
  }

  private burst(x: number, y: number, c: RGB, n: number, sp: number) {
    for (let i = 0; i < n * this.quality; i++) {
      const a = this.r() * Math.PI * 2, v = sp * (0.3 + this.r() * 0.7);
      this.add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.25 + this.r() * 0.3, size: 2 + this.r() * 3, c });
    }
  }

  private shatter(x: number, y: number, w: number, h: number, c: RGB, heat: number) {
    const n = 16 + heat * 3;
    for (let i = 0; i < n * this.quality; i++) {
      const px = x + (this.r() - 0.5) * w, py = y + (this.r() - 0.5) * h;
      const a = Math.atan2(py - y, px - x);
      const v = 60 + this.r() * 220;
      this.add({ x: px, y: py, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6 + 80, life: 0, max: 0.6 + this.r() * 0.6, size: 3 + this.r() * 6, c });
    }
  }

  private add(p: Particle) {
    if (this.parts.length >= MAX_PARTS * this.quality) this.parts.shift();
    this.parts.push(p);
  }

  // ------------------------------------------------------------ frame
  render(g: Game | null, beat: Beat, showLanding: boolean) {
    const gl = this.gl;
    const now = performance.now() / 1000;
    const rdt = clamp(now - this.lastT, 0, 0.1);
    this.lastT = now;
    this.time += rdt;
    this.resize();

    // background
    this.scene.bind();
    gl.disable(gl.BLEND);
    const hz = (this.y0 + 560 * this.s) / this.H;
    this.pBg.use().f2('u_res', this.W, this.H).f1('u_time', this.time).f1('u_scroll', beat.scroll)
      .f1('u_kick', beat.kick).f1('u_hat', beat.hat).f1('u_bass', beat.bass).f1('u_energy', beat.energy).f1('u_groove', beat.groove)
      .f4('u_field', this.x0, this.y0, this.x0 + FIELD_W * this.s, this.y0 + FIELD_H * this.s).f1('u_hz', hz);
    this.fullscreen();

    // shapes
    const b = this.shapes;
    b.reset();
    this.frame(beat);
    if (g) this.drawGame(g, beat, showLanding);
    this.drawParticles(rdt);
    if (b.n) {
      b.upload();
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.pShape.use().f4('u_view', this.x0, this.y0, this.s, 0).f2('u_res', this.W, this.H).f1('u_px', 1 / this.s);
      gl.bindVertexArray(b.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, b.count);
      gl.disable(gl.BLEND);
    }

    this.flash *= Math.exp(-rdt * 12);
    this.tint *= Math.exp(-rdt * 3);
    this.ca *= Math.exp(-rdt * 6);
    this.post();
  }

  /** neon walls around the playfield */
  private frame(beat: Beat) {
    const k = 0.35 + beat.kick * 0.5 + beat.groove * 0.3;
    const c: RGB = [0.5 * k, 0.25 * k, 1.3 * k];
    this.box(-3, FIELD_H / 2, 2, FIELD_H / 2, 2, 0, 10, 0, c, 1);
    this.box(FIELD_W + 3, FIELD_H / 2, 2, FIELD_H / 2, 2, 0, 10, 0, c, 1);
    this.box(FIELD_W / 2, FIELD_H + 3, FIELD_W / 2 + 5, 2, 2, 0, 10, 0, c, 1);
  }

  private drawGame(g: Game, beat: Beat, showLanding: boolean) {
    const t = g.t;
    const nRows = Math.max(1, g.song.rows.length - 1);
    // a note sounding lights its brick (or the gap it left) on time with the audio
    for (const p of this.pulses) {
      if (p.done || t < p.t) continue;
      p.done = true;
      this.rings.push({ x: p.x, y: p.y, t0: p.t, dur: 0.5, r0: 20, r1: 80, c: p.c, thick: 2.5, a: 0.8 });
    }
    this.pulses = this.pulses.filter((p) => !p.done || t - p.t < 0.3);

    for (const br of g.bricks) {
      const c = br.kind === 'hard' ? HARD : rowColor(br.rowUp / nRows);
      if (br.alive) {
        const hit = Math.exp(-(t - br.hitT) * 10);
        const pulse = this.pulses.find((p) => p.done && p.x === br.x && p.y === br.y);
        const sing = pulse ? Math.exp(-(t - pulse.t) * 8) : 0;
        const k = 0.85 + hit * 1.5 + sing * 1.2 + beat.kick * 0.12;
        const cc: RGB = [c[0] * k, c[1] * k, c[2] * k];
        const hp = br.hp / br.maxHp;
        this.box(br.x, br.y, br.w / 2, br.h / 2, 6, br.kind === 'hard' ? 3 : 1, 9, hp, cc, 1);
      } else {
        const a = t - br.diedT;
        if (a < 0.22) {
          const k = a / 0.22;
          const e = 1 + k * 0.4;
          this.box(br.x, br.y, br.w / 2 * e, br.h / 2 * e, 6, 2, 14, 2 * (1 - k), [c[0] * 2, c[1] * 2, c[2] * 2], 1 - k);
        }
      }
    }

    // rings
    this.rings = this.rings.filter((r) => t - r.t0 < r.dur);
    for (const r of this.rings) {
      const k = clamp((t - r.t0) / r.dur, 0, 1);
      const rad = lerp(r.r0, r.r1, 1 - (1 - k) * (1 - k));
      const a = r.a * (1 - k);
      this.box(r.x, r.y, rad, rad, rad, 2, 8, r.thick * (1 - k * 0.5), r.c, a);
    }

    // paddle
    const P = BAL.paddle;
    const lift = g.lift();
    const swingK = clamp(lift / P.swingLift, 0, 1);
    const pc: RGB = g.groove ? [1.4, 0.5, 1.6] : [0.3, 1.1, 1.5];
    const pk = 1 + swingK * 1.2 + beat.kick * 0.25;
    this.box(g.px, P.y + lift, P.w / 2, P.h / 2, P.h / 2, 0, 14, 0, [pc[0] * pk, pc[1] * pk, pc[2] * pk], 1);
    this.box(g.px, P.y + lift + 3, P.w / 2 - 8, 2.5, 2.5, 0, 0, 0, [2, 2, 2.2], 0.8);

    // the landing: a ring closing in on the paddle line, timed to the contact
    const L = g.landing;
    if (showLanding && L && L.synced && g.dy < 0 && !g.onPaddle) {
      const rem = L.t - t;
      if (rem > 0 && rem < 0.75) {
        const k = rem / 0.75;
        const rad = BAL.ball.r + 4 + k * 120;
        const y = P.y + P.h / 2;
        this.box(L.x, y, rad, rad, rad, 2, 6, 2.5, [1.1, 1.0, 1.5], (1 - k) * 0.7);
        this.box(L.x, y, 4, 4, 4, 0, 6, 0, [1.4, 1.3, 1.8], (1 - k) * 0.9);
      }
    }

    // ball and trail
    if (g.phase !== 'finale' || g.endReason === 'song') {
      const hc = HEAT[Math.min(HEAT.length - 1, g.heat)];
      const R = BAL.ball.r;
      const n = g.trail.length;
      for (let i = 0; i < n; i++) {
        const p = g.trail[i];
        const k = i / n;
        const tc = HEAT[Math.min(HEAT.length - 1, p.heat)];
        const s = R * (0.25 + 0.6 * k);
        this.box(p.x, p.y, s, s, s, 0, 6, 0, [tc[0] * 0.6, tc[1] * 0.6, tc[2] * 0.6], k * 0.5);
      }
      this.box(g.bx, g.by, R, R, R, 0, 14 + g.heat * 5, 0, [hc[0] * 1.4, hc[1] * 1.4, hc[2] * 1.4], 1);
      this.box(g.bx, g.by, R * 0.55, R * 0.55, R * 0.55, 0, 0, 0, [2.5, 2.5, 2.5], 1);
    }
  }

  private drawParticles(dt: number) {
    const ps = this.parts;
    let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life += dt;
      if (p.life >= p.max) continue;
      p.vy -= 700 * dt;
      p.vx *= Math.exp(-dt * 1.5);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = 1 - p.life / p.max;
      this.box(p.x, p.y, p.size * 0.5, p.size * 0.5, 1, 0, 3, 0, [p.c[0] * 1.6, p.c[1] * 1.6, p.c[2] * 1.6], k);
      ps[w++] = p;
    }
    ps.length = w;
  }

  private box(x: number, y: number, hw: number, hh: number, r: number, kind: number, glow: number, extra: number, c: RGB, a: number) {
    if (!Number.isFinite(x + y + hw + hh + c[0] + c[1] + c[2] + a)) return;
    const b = this.shapes;
    b.ensure(12);
    const d = b.data;
    let i = b.n;
    d[i++] = x; d[i++] = y; d[i++] = hw; d[i++] = hh;
    d[i++] = r; d[i++] = kind; d[i++] = glow; d[i++] = extra;
    d[i++] = c[0]; d[i++] = c[1]; d[i++] = c[2]; d[i++] = a;
    b.n = i;
  }

  // ------------------------------------------------------------ post
  private post() {
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
    const p = this.pComp.use().tex('u_scene', 0, this.scene.tex).tex('u_bloom', 1, this.bloom[0].tex)
      .f2('u_res', this.W, this.H).f1('u_time', this.time).f1('u_bloomAmt', this.bloomAmt).f1('u_ca', this.ca * 0.012)
      .f1('u_flash', this.flash).f3('u_tint', this.tint * 0.12, 0, this.tint * 0.02);
    this.shocks = this.shocks.filter((s) => this.time - s.t0 < s.dur);
    for (let i = 0; i < 4; i++) {
      const s = this.shocks[i];
      if (!s) {
        p.f4(`u_shock[${i}]`, 0, 0, 0, 0);
        continue;
      }
      const k = (this.time - s.t0) / s.dur;
      p.f4(`u_shock[${i}]`, this.x0 + s.x * this.s, this.y0 + s.y * this.s, s.speed * (this.time - s.t0) * this.s, s.amp * (1 - k) * (1 - k));
    }
    this.fullscreen();
  }

  private fullscreen() {
    const gl = this.gl;
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
