// The rules of one level (one song). Time `t` is the song time the player *hears* (see the audio
// clock in main.ts), so a contact planned for a beat is seen and heard together. Fixed steps;
// no rendering or audio here — everything the outside needs comes out as events.

import { BAL, FIELD_H, FIELD_W } from './balance';
import { makeRng, type Rng } from '../core/rng';
import { clamp, damp } from '../core/math';
import { scaleNote, type Song } from '../music/song';
import { Tempo } from '../music/tempo';

export type SpecialId = 'chord' | 'perc' | 'arp' | 'filter' | 'echo' | 'tempoUp' | 'tempoDown' | 'drop';
export type PowerId = 'multi' | 'laser' | 'wide' | 'magnet' | 'slow';

const SPECIAL_CHARS: Record<string, SpecialId> = {
  A: 'chord', P: 'perc', R: 'arp', F: 'filter', E: 'echo', M: 'tempoUp', m: 'tempoDown', D: 'drop',
};
export const POWERS: PowerId[] = ['multi', 'laser', 'wide', 'magnet', 'slow'];

export type Brick = {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** row from the top (as in the song) and from the bottom */
  row: number;
  rowUp: number;
  col: number;
  /** scale step of its note (a hard brick climbs one step per hit) */
  step: number;
  kind: 'normal' | 'hard';
  special: SpecialId | null;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** last hit (game time), for the flash */
  hitT: number;
  /** when it broke (game time), for the shatter animation */
  diedT: number;
};

/** what broke a brick */
export type HitSrc = 'ball' | 'extra' | 'arp' | 'laser';

/** echo clones and multiball balls: simple physics, no rhythm, no lives */
export type Extra = { id: number; kind: 'echo' | 'multi'; x: number; y: number; dx: number; dy: number; speed: number; until: number; trail: { x: number; y: number }[] };
export type Power = { id: number; kind: PowerId; x: number; y: number };
export type Shot = { x: number; y: number };

export type Judge = 'perfect' | 'good';
export type EndReason = 'clear' | 'song' | 'lives';

export type GameEvent =
  | { type: 'brick'; brick: Brick; midi: number; chord: number[] | null; broken: boolean; heat: number; pierce: boolean; src: HitSrc; x: number; y: number }
  | { type: 'special'; special: SpecialId; brick: Brick }
  | { type: 'row'; row: number; layers: number }
  | { type: 'layer'; layers: number }
  | { type: 'contact'; x: number; y: number }
  | { type: 'judge'; judge: Judge; x: number; y: number; mult: number; heat: number }
  | { type: 'catch'; x: number; y: number }
  | { type: 'wall'; x: number; y: number }
  | { type: 'swing' }
  | { type: 'launch' }
  | { type: 'lost'; lives: number; layers: number }
  | { type: 'saved' }
  | { type: 'groove'; on: boolean }
  | { type: 'tempo'; bpm: number; atStep: number }
  | { type: 'filter' }
  | { type: 'echo'; x: number; y: number }
  | { type: 'dropArm'; left: number; total: number }
  | { type: 'drop'; atStep: number }
  | { type: 'power'; kind: PowerId; x: number; y: number }
  | { type: 'laser'; x: number; y: number }
  | { type: 'extraGone'; x: number; y: number }
  | { type: 'clear' }
  | { type: 'end'; reason: EndReason; passed: boolean };

export type Phase = 'play' | 'finale' | 'over';

/** where and when the descending ball will cross the paddle line, if nothing is in the way */
export type Landing = { x: number; t: number; synced: boolean };

type Body = { x: number; y: number; dx: number; dy: number };

export class Game {
  readonly song: Song;
  readonly rng: Rng;
  readonly tempo: Tempo;
  t = 0;
  phase: Phase = 'play';
  endReason: EndReason | null = null;
  passed = false;
  private endAt = Infinity;

  // paddle
  px = FIELD_W / 2;
  target = FIELD_W / 2;
  swingT = -9;
  private swings: number[] = [];

  // ball
  bx = FIELD_W / 2;
  by = 0;
  dx = 0;
  dy = 1;
  speed: number;
  onPaddle = true;
  private stuckOffset = 0;
  private stuckSince = 0;
  /** held by the magnet: where it will go when released */
  private held: { dx: number; dy: number } | null = null;
  heat = 0;
  /** bricks a hot ball may still go through on this flight */
  pierceLeft = 0;
  /** the beat the ball is steered onto */
  sync: { tb: number } | null = null;
  landing: Landing | null = null;
  private needPlan = true;
  private replan = 0;
  private lastPaddleT = 0;
  /** paddle top on the previous step (the swing moves it into the ball) */
  private prevTop = 0;
  /** a contact waiting for a late swing */
  private pending: { t: number; x: number; y: number } | null = null;
  /** recent ball positions for the trail (renderer reads) */
  trail: { x: number; y: number; heat: number }[] = [];

  bricks: Brick[] = [];
  private rowAlive: number[] = [];
  alive = 0;
  total = 0;

  // M3: extras, power-ups, effects
  extras: Extra[] = [];
  powers: Power[] = [];
  shots: Shot[] = [];
  /** until when (game time) each power-up is active */
  fx: Record<PowerId, number> = { multi: -1, laser: -1, wide: -1, magnet: -1, slow: -1 };
  private nextId = 1;
  private arpQueue: { id: number; at: number }[] = [];
  private nextLaserStep = 0;
  private laserSide = 1;
  /** tempo: the player's Metronom factor and the slow-down window (16th steps) */
  tempoFactor = 1;
  private slowFrom = -1;
  private slowTo = -1;
  dropTotal = 0;
  dropLeft = 0;
  /** the drop: from / until (game time); dropStep for the sequencer */
  dropAt = Infinity;
  dropUntil = -1;
  dropStep = -1;

  // progress
  layers = 0;
  lives = BAL.lives;
  score = 0;
  mult = 1;
  streak = 0;
  groove = false;
  stats = {
    perfect: 0, good: 0, catches: 0, lost: 0, bestStreak: 0, swings: 0, pierced: 0, contacts: 0, onGrid: 0, clearT: 0,
    planBlocked: 0, planNone: 0, planGrid: [0, 0, 0], unsyncedContacts: 0, powers: 0, specials: 0, saved: 0, drops: 0,
  };

  private events: GameEvent[] = [];

  constructor(song: Song, seed = 1) {
    this.song = song;
    this.rng = makeRng(seed);
    this.tempo = new Tempo(song.s16);
    this.speed = this.baseSpeed();
    this.buildBricks();
    this.placeOnPaddle();
  }

  // ------------------------------------------------------------ setup
  private buildBricks() {
    const F = BAL.field, s = this.song;
    const left = (FIELD_W - F.colPitch * 8) / 2;
    const nRows = s.rows.length;
    let id = 0;
    s.rows.forEach((row, r) => {
      const rowUp = nRows - 1 - r;
      this.rowAlive[r] = 0;
      for (let c = 0; c < 8; c++) {
        const ch = row[c];
        if (!ch || ch === '.') continue;
        // digits: normal bricks; letters a–i: hard bricks with notes 1–9
        const hard = ch >= 'a' && ch <= 'i';
        const deg = hard ? ch.charCodeAt(0) - 96 : parseInt(ch, 10);
        const hp = hard ? BAL.hard.hp : 1;
        const special = hard ? null : SPECIAL_CHARS[s.specials?.[r]?.[c] ?? '.'] ?? null;
        this.bricks.push({
          id: id++, row: r, rowUp, col: c,
          x: left + F.colPitch * (c + 0.5), y: F.bricksTop - F.brickH / 2 - r * F.rowPitch,
          w: F.brickW, h: F.brickH, step: s.rowBase + rowUp * s.rowStep + deg - 1,
          kind: hard ? 'hard' : 'normal', special, hp, maxHp: hp, alive: true, diedT: -9, hitT: -9,
        });
        if (special === 'drop') this.dropTotal++;
        this.rowAlive[r]++;
      }
    });
    this.dropLeft = this.dropTotal;
    this.alive = this.total = this.bricks.length;
  }

  /** song length in seconds (follows tempo changes) */
  get length() {
    return this.tempo.timeAt(this.song.bars * 16);
  }

  baseSpeed() {
    return BAL.ball.speed * (1 + this.heat * BAL.ball.heatSpeed);
  }

  active(p: PowerId) {
    return this.t < this.fx[p];
  }

  get dropping() {
    return this.t >= this.dropAt && this.t < this.dropUntil;
  }

  get paddleW() {
    return BAL.paddle.w * (this.active('wide') ? BAL.power.wide : 1);
  }

  get paddleTop() {
    return BAL.paddle.y + BAL.paddle.h / 2 + this.lift();
  }

  /** how far the paddle is kicked up by a swing right now */
  lift() {
    const k = (this.t - this.swingT) / BAL.paddle.swingTime;
    if (k < 0 || k > 1) return 0;
    return BAL.paddle.swingLift * Math.sin(Math.PI * Math.sqrt(k));
  }

  /** game time `bars` from now (for power-up durations) */
  private barsFromNow(bars: number) {
    return this.tempo.timeAt(this.tempo.stepAt(this.t) + bars * 16);
  }

  private placeOnPaddle() {
    this.onPaddle = true;
    this.held = null;
    this.stuckOffset = 0;
    this.stuckSince = this.t;
    this.sync = null;
    this.landing = null;
    this.trail.length = 0;
    this.bx = this.px;
    this.by = BAL.paddle.y + BAL.paddle.h / 2 + BAL.ball.r;
  }

  // ------------------------------------------------------------ input
  /** A swing at heard time `ts` (may be slightly in the future of the sim; it waits). */
  swing(ts: number) {
    this.swings.push(ts);
  }

  launch() {
    if (!this.onPaddle || this.phase !== 'play') return;
    if (this.held) {
      this.dx = this.held.dx;
      this.dy = this.held.dy;
    } else {
      const a = (this.rng() * 2 - 1) * 0.25;
      this.dx = Math.sin(a);
      this.dy = Math.cos(a);
    }
    this.held = null;
    this.onPaddle = false;
    this.speed = this.baseSpeed();
    this.lastPaddleT = this.t;
    this.needPlan = true;
    this.pierceLeft = BAL.heat.pierceMax;
    this.emit({ type: 'launch' });
  }

  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }

  private add(points: number) {
    this.score += points * BAL.score.speedMul * (this.dropping ? BAL.drop.scoreMul : 1);
  }

  private emit(e: GameEvent) {
    this.events.push(e);
  }

  // ------------------------------------------------------------ step
  step(dt: number) {
    this.t += dt;
    if (this.phase === 'over') return;
    if (this.t >= this.endAt) {
      this.phase = 'over';
      this.emit({ type: 'end', reason: this.endReason!, passed: this.passed });
      return;
    }

    while (this.swings.length && this.swings[0] <= this.t) this.doSwing(this.swings.shift()!);

    // paddle
    const P = BAL.paddle;
    const hw = this.paddleW / 2;
    this.target = clamp(this.target, hw, FIELD_W - hw);
    this.px += (this.target - this.px) * damp(P.follow, dt);

    if (this.phase === 'finale') return;

    if (this.pending && this.t - this.pending.t > BAL.hit.late) this.resolveCatch();

    // the drop: the ball is white-hot and goes through everything soft
    if (this.dropping) {
      this.heat = BAL.heat.max;
      this.pierceLeft = Math.max(this.pierceLeft, BAL.drop.pierce);
    }

    if (this.onPaddle) {
      this.bx = this.px + this.stuckOffset;
      this.by = this.paddleTop + BAL.ball.r;
      const wait = this.held ? BAL.power.magnetHold : BAL.ball.autoLaunch;
      if (this.t - this.stuckSince > wait) this.launch();
    } else {
      this.moveBall(dt);
    }
    if (this.phase !== 'play') return;

    this.stepArp();
    this.stepExtras(dt);
    this.stepPowers(dt);
    this.stepLaser(dt);

    if (this.phase === 'play' && this.t >= this.length) {
      this.finish('song', (this.total - this.alive) / this.total >= BAL.passFrac);
    }
  }

  private finish(reason: EndReason, passed: boolean, delay = 0) {
    this.endReason = reason;
    this.passed = passed;
    this.phase = 'finale';
    this.sync = null;
    this.landing = null;
    this.extras.length = 0;
    this.powers.length = 0;
    this.shots.length = 0;
    this.arpQueue.length = 0;
    this.endAt = this.t + delay;
    if (passed) this.add(this.lives * BAL.score.lifeLeft);
  }

  private doSwing(ts: number) {
    if (ts - this.swingT < BAL.paddle.swingCooldown) return;
    this.swingT = ts;
    this.stats.swings++;
    this.emit({ type: 'swing' });
    // late: the ball already bounced a moment ago
    const d = this.pending ? ts - this.pending.t : Infinity;
    if (this.pending && d >= -BAL.hit.good && d <= BAL.hit.late) {
      const p = this.pending;
      this.pending = null;
      this.rhythmHit(Math.abs(d), p.x, p.y);
    }
  }

  // ------------------------------------------------------------ the ball
  private moveBall(dt: number) {
    const R = BAL.ball.r;
    // plan when the ball turns down; while bricks block the way, keep retrying as it falls
    if (this.dy < 0 && (this.needPlan || (!this.landing && ++this.replan % 6 === 0))) {
      this.plan();
      this.needPlan = false;
    }
    this.steer(dt);

    const px = this.bx, py = this.by;
    this.bx += this.dx * this.speed * dt;
    this.by += this.dy * this.speed * dt;

    // walls and ceiling
    const ball: Body = { x: this.bx, y: this.by, dx: this.dx, dy: this.dy };
    const w = this.walls(ball);
    this.bx = ball.x;
    this.by = ball.y;
    this.dx = ball.dx;
    this.dy = ball.dy;
    if (w) {
      this.emit({ type: 'wall', x: this.bx, y: this.by });
      if (w === 'top') this.needPlan = true;
    }

    this.hitBricks();

    // paddle
    const top = this.paddleTop;
    const wasAbove = py - R >= Math.min(top, this.prevTop) - 1;
    this.prevTop = top;
    if (this.dy < 0 && this.by - R <= top && wasAbove) {
      const half = this.paddleW / 2 + R * 0.6;
      if (Math.abs(this.bx - this.px) <= half) {
        // place on the contact line (sub-step accuracy)
        const k = (py - R - top) / Math.max(1e-6, py - this.by);
        this.bx = px + (this.bx - px) * clamp(k, 0, 1);
        this.by = top + R;
        this.paddleContact();
      }
    }

    if (this.by < -R * 2) {
      this.loseBall();
      return;
    }

    // a ball stuck bouncing almost flat between walls and bricks gets tipped downwards
    if (this.t - this.lastPaddleT > BAL.loopNudge) {
      this.dy -= 0.25;
      this.normalize();
      this.lastPaddleT = this.t - BAL.loopNudge * 0.5;
      this.needPlan = true;
    }

    this.trail.push({ x: this.bx, y: this.by, heat: this.heat });
    if (this.trail.length > 40) this.trail.shift();
  }

  /** side walls and the ceiling; returns which one it hit */
  private walls(b: Body): 'side' | 'top' | null {
    const R = BAL.ball.r;
    let hit: 'side' | 'top' | null = null;
    if (b.x < R && b.dx < 0) {
      b.dx = -b.dx;
      b.x = R;
      hit = 'side';
    } else if (b.x > FIELD_W - R && b.dx > 0) {
      b.dx = -b.dx;
      b.x = FIELD_W - R;
      hit = 'side';
    }
    if (b.y > FIELD_H - R && b.dy > 0) {
      b.dy = -b.dy;
      b.y = FIELD_H - R;
      hit = 'top';
    }
    return hit;
  }

  /** a body against the bricks: reflects it, damages what it touches; returns true if it turned */
  private collide(b: Body, canPierce: boolean, src: HitSrc): boolean {
    const R = BAL.ball.r;
    let flipX = false, flipY = false;
    for (const br of this.bricks) {
      if (!br.alive) continue;
      const hw = br.w / 2, hh = br.h / 2;
      const cx = clamp(b.x, br.x - hw, br.x + hw), cy = clamp(b.y, br.y - hh, br.y + hh);
      const ex = b.x - cx, ey = b.y - cy;
      if (ex * ex + ey * ey > R * R) continue;
      const pierce = canPierce && br.kind === 'normal' && this.heat >= BAL.heat.pierce && this.pierceLeft > 0;
      if (!pierce) {
        // which face: compare penetration relative to the brick's shape
        const ox = (b.x - br.x) / (hw + R), oy = (b.y - br.y) / (hh + R);
        if (Math.abs(ox) > Math.abs(oy)) {
          if (Math.sign(ox) !== Math.sign(b.dx) || b.dx === 0) flipX = true;
          else continue; // moving away already
        } else if (Math.sign(oy) !== Math.sign(b.dy) || b.dy === 0) flipY = true;
        else continue;
      } else this.pierceLeft--;
      this.damage(br, pierce, src, b.x, b.y);
      if (this.phase !== 'play') break;
    }
    if (flipX) b.dx = -b.dx;
    if (flipY) b.dy = -b.dy;
    return flipX || flipY;
  }

  private hitBricks() {
    const ball: Body = { x: this.bx, y: this.by, dx: this.dx, dy: this.dy };
    if (this.collide(ball, true, 'ball')) {
      this.dx = ball.dx;
      this.dy = ball.dy;
      this.sync = null;
      this.needPlan = true;
    }
  }

  private damage(b: Brick, pierce: boolean, src: HitSrc, x: number, y: number) {
    const s = this.song;
    const midi = scaleNote(s, b.step + (b.maxHp - b.hp));
    b.hitT = this.t;
    b.hp--;
    const broken = b.hp <= 0;
    if (broken) {
      b.alive = false;
      b.diedT = this.t;
      this.alive--;
    }
    if (pierce) {
      this.stats.pierced++;
      this.needPlan = true;
    }
    const heat = src === 'ball' ? this.heat : 0;
    this.add((broken ? BAL.score.brick : BAL.score.hardHit) * (1 + heat * BAL.score.heatBrick) * this.mult);
    const chord = broken && b.special === 'chord' ? this.chordAt(midi) : null;
    this.emit({ type: 'brick', brick: b, midi, chord, broken, heat, pierce, src, x, y });
    if (!broken) return;
    if (b.special) this.special(b);
    else if (src !== 'laser') this.maybePower(b);
    if (--this.rowAlive[b.row] === 0) {
      this.layers = Math.min(s.layers.length, this.layers + 1);
      this.emit({ type: 'row', row: b.row, layers: this.layers });
    }
    if (this.alive === 0) {
      // the finale: lands on the next downbeat and rings for a bar
      const next = this.tempo.nextBar(this.t, 0.05);
      const barsLeft = Math.max(0, s.bars - next / 16);
      this.add(barsLeft * BAL.score.barLeft * this.mult);
      this.stats.clearT = this.t;
      this.finish('clear', true, this.tempo.timeAt(next + 16) - this.t);
      this.emit({ type: 'clear' });
    }
  }

  /** the chord of the bar now, voiced from just under the brick's note */
  private chordAt(midi: number) {
    const s = this.song;
    const bar = Math.floor(this.tempo.stepAt(this.t) / 16);
    const ch = s.chords[((bar % s.chords.length) + s.chords.length) % s.chords.length];
    let r = s.root + ch.root;
    while (r + 12 <= midi) r += 12;
    const notes = ch.tones.slice(0, 3).map((x) => r + x);
    if (!notes.includes(midi)) notes.push(midi);
    return notes;
  }

  // ------------------------------------------------------------ special bricks
  private special(b: Brick) {
    this.stats.specials++;
    this.emit({ type: 'special', special: b.special!, brick: b });
    switch (b.special) {
      case 'perc':
        if (this.layers < this.song.layers.length) {
          this.layers++;
          this.emit({ type: 'layer', layers: this.layers });
        }
        break;
      case 'arp': {
        // the neighbours go one per 16th, nearest first
        const near = this.bricks
          .filter((o) => o.alive && Math.abs(o.col - b.col) <= 1 && Math.abs(o.row - b.row) <= 1)
          .sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y))
          .slice(0, BAL.special.arpMax);
        const s0 = Math.floor(this.tempo.stepAt(this.t)) + 1;
        near.forEach((o, i) => this.arpQueue.push({ id: o.id, at: this.tempo.timeAt(s0 + i) }));
        break;
      }
      case 'filter':
        this.emit({ type: 'filter' });
        break;
      case 'echo': {
        const n = BAL.special.echoBalls;
        for (let i = 0; i < n; i++) {
          const a = Math.atan2(this.dx, this.dy) + (i - (n - 1) / 2) * 0.7;
          this.spawnExtra('echo', b.x, b.y, a, this.t + BAL.special.echoTime);
        }
        this.emit({ type: 'echo', x: b.x, y: b.y });
        break;
      }
      case 'tempoUp':
      case 'tempoDown': {
        const T = BAL.tempo;
        const k = b.special === 'tempoUp' ? 1 + T.step : 1 / (1 + T.step);
        this.tempoFactor = clamp(this.tempoFactor * k, T.min, T.max);
        this.retempo();
        break;
      }
      case 'drop':
        this.dropLeft--;
        if (this.dropLeft > 0) this.emit({ type: 'dropArm', left: this.dropLeft, total: this.dropTotal });
        else {
          const at = this.tempo.nextBar(this.t, BAL.tempo.lead);
          this.dropStep = at;
          this.dropAt = this.tempo.timeAt(at);
          this.dropUntil = this.tempo.timeAt(at + BAL.drop.bars * 16);
          this.stats.drops++;
          this.emit({ type: 'drop', atStep: at });
        }
        break;
      default:
        break;
    }
  }

  /** applies the Metronom factor and the slow-down window from the next safe bar line */
  private retempo() {
    const at = this.tempo.nextBar(this.t, BAL.tempo.lead);
    const base = this.song.s16 / this.tempoFactor;
    const slowAt = at >= this.slowFrom && at < this.slowTo;
    this.tempo.set(at, slowAt ? base / BAL.power.slow : base);
    if (this.slowFrom > at) {
      this.tempo.set(this.slowFrom, base / BAL.power.slow);
      this.tempo.set(this.slowTo, base);
    } else if (this.slowTo > at) this.tempo.set(this.slowTo, base);
    this.emit({ type: 'tempo', bpm: Math.round(60 / (4 * this.tempo.s16At(this.tempo.timeAt(at)))), atStep: at });
  }

  private stepArp() {
    if (!this.arpQueue.length) return;
    const due = this.arpQueue.filter((q) => q.at <= this.t);
    if (!due.length) return;
    this.arpQueue = this.arpQueue.filter((q) => q.at > this.t);
    for (const q of due) {
      const b = this.bricks[q.id];
      if (b?.alive) this.damage(b, false, 'arp', b.x, b.y);
      if (this.phase !== 'play') return;
    }
  }

  // ------------------------------------------------------------ extra balls
  private spawnExtra(kind: Extra['kind'], x: number, y: number, ang: number, until: number) {
    let dx = Math.sin(ang), dy = Math.cos(ang);
    const m = Math.sin((BAL.ball.minAngle * Math.PI) / 180);
    if (Math.abs(dy) < m) {
      dy = Math.sign(dy || 1) * m;
      dx = Math.sign(dx || 1) * Math.sqrt(1 - m * m);
    }
    this.extras.push({ id: this.nextId++, kind, x, y, dx, dy, speed: this.baseSpeed(), until, trail: [] });
  }

  private stepExtras(dt: number) {
    const R = BAL.ball.r;
    for (const e of this.extras) {
      const py = e.y;
      e.x += e.dx * e.speed * dt;
      e.y += e.dy * e.speed * dt;
      this.walls(e);
      this.collide(e, false, 'extra');
      if (this.phase !== 'play') return;
      // the paddle returns them too (no rhythm, no heat)
      const top = this.paddleTop;
      if (e.dy < 0 && e.y - R <= top && py - R >= top - 8 && Math.abs(e.x - this.px) <= this.paddleW / 2 + R * 0.6) {
        const off = clamp((e.x - this.px) / (this.paddleW / 2), -1, 1);
        const a = (off * BAL.paddle.maxAngle * Math.PI) / 180;
        e.dx = Math.sin(a);
        e.dy = Math.cos(a);
        e.y = top + R;
        this.emit({ type: 'contact', x: e.x, y: e.y });
      }
      e.trail.push({ x: e.x, y: e.y });
      if (e.trail.length > 20) e.trail.shift();
    }
    const keep: Extra[] = [];
    for (const e of this.extras) {
      if (e.y < -R * 2) continue;
      if (this.t > e.until) {
        this.emit({ type: 'extraGone', x: e.x, y: e.y });
        continue;
      }
      keep.push(e);
    }
    this.extras = keep;
  }

  // ------------------------------------------------------------ power-ups
  private maybePower(b: Brick) {
    const P = BAL.power;
    if (this.powers.length || this.total - this.alive < P.after || this.rng() >= P.chance) return;
    const kind = POWERS[Math.floor(this.rng() * POWERS.length)];
    this.powers.push({ id: this.nextId++, kind, x: b.x, y: b.y });
  }

  private stepPowers(dt: number) {
    if (!this.powers.length) return;
    const top = this.paddleTop, bottom = BAL.paddle.y - BAL.paddle.h / 2;
    const keep: Power[] = [];
    for (const p of this.powers) {
      p.y -= BAL.power.fall * dt;
      if (p.y - 14 <= top && p.y + 14 >= bottom && Math.abs(p.x - this.px) <= this.paddleW / 2 + 24) {
        this.applyPower(p);
        continue;
      }
      if (p.y > -30) keep.push(p);
    }
    this.powers = keep;
  }

  private applyPower(p: Power) {
    const P = BAL.power;
    this.stats.powers++;
    switch (p.kind) {
      case 'multi': {
        const fromX = this.onPaddle ? this.px : this.bx, fromY = this.onPaddle ? this.paddleTop + 20 : this.by;
        const base = this.onPaddle ? 0 : Math.atan2(this.dx, Math.abs(this.dy));
        for (let i = 0; i < P.multiBalls; i++) this.spawnExtra('multi', fromX, fromY, base + (i ? 0.45 : -0.45), Infinity);
        this.fx.multi = this.t + 1;
        break;
      }
      case 'laser':
        this.fx.laser = this.barsFromNow(P.laserBars);
        this.nextLaserStep = Math.ceil(this.tempo.stepAt(this.t) / 2) * 2;
        break;
      case 'wide':
        this.fx.wide = this.barsFromNow(P.wideBars);
        break;
      case 'magnet':
        this.fx.magnet = this.barsFromNow(P.magnetBars);
        break;
      case 'slow': {
        const at = this.tempo.nextBar(this.t, BAL.tempo.lead);
        this.slowFrom = at;
        this.slowTo = at + P.slowBars * 16;
        this.retempo();
        this.fx.slow = this.tempo.timeAt(this.slowTo);
        break;
      }
    }
    this.emit({ type: 'power', kind: p.kind, x: p.x, y: p.y });
  }

  /** laser: the paddle fires on every 8th, alternating sides (staccato) */
  private stepLaser(dt: number) {
    if (this.active('laser')) {
      while (this.tempo.timeAt(this.nextLaserStep) <= this.t) {
        const x = this.px + this.laserSide * (this.paddleW / 2 - 10);
        this.laserSide = -this.laserSide;
        this.shots.push({ x, y: this.paddleTop });
        this.emit({ type: 'laser', x, y: this.paddleTop });
        this.nextLaserStep += 2;
      }
    }
    if (!this.shots.length) return;
    const keep: Shot[] = [];
    outer: for (const s of this.shots) {
      s.y += BAL.power.laserSpeed * dt;
      if (s.y > FIELD_H) continue;
      for (const b of this.bricks) {
        if (!b.alive || Math.abs(s.x - b.x) > b.w / 2 || Math.abs(s.y - b.y) > b.h / 2) continue;
        this.damage(b, false, 'laser', s.x, s.y);
        if (this.phase !== 'play') return;
        continue outer;
      }
      keep.push(s);
    }
    this.shots = keep;
  }

  // ------------------------------------------------------------ paddle contact and rhythm
  private paddleContact() {
    const P = BAL.paddle;
    // the moment the swing is judged against: the planned beat when the ball was in rhythm (a
    // swing lifts the paddle into the ball a little early), the contact otherwise
    const ref = this.sync && Math.abs(this.sync.tb - this.t) < 0.06 ? this.sync.tb : this.t;
    if (!this.sync) this.stats.unsyncedContacts++;
    const off = clamp((this.bx - this.px) / (this.paddleW / 2), -1, 1);
    const a = (off * P.maxAngle * Math.PI) / 180;
    this.dx = Math.sin(a);
    this.dy = Math.cos(a);
    this.lastPaddleT = this.t;
    this.sync = null;
    this.landing = null;
    this.needPlan = true;
    this.pierceLeft = BAL.heat.pierceMax;
    this.emit({ type: 'contact', x: this.bx, y: this.by });
    this.stats.contacts++;
    const st = this.tempo.stepAt(ref);
    if (Math.abs(st - Math.round(st)) * this.tempo.s16At(ref) < 0.012) this.stats.onGrid++;

    const early = ref - this.swingT;
    if (early >= -BAL.hit.late && early <= BAL.hit.good) {
      this.swingT = -9; // one swing, one hit
      this.rhythmHit(Math.abs(early), this.bx, this.by);
    } else {
      if (this.pending) this.resolveCatch();
      this.pending = { t: ref, x: this.bx, y: this.by };
    }
    this.speed = this.baseSpeed();
    // the magnet holds the ball; a tap / flick (or a moment) sends it where it would have gone
    if (this.active('magnet')) {
      this.held = { dx: this.dx, dy: this.dy };
      this.onPaddle = true;
      this.stuckOffset = clamp(this.bx - this.px, -this.paddleW / 2, this.paddleW / 2);
      this.stuckSince = this.t;
      this.trail.length = 0;
    }
  }

  private rhythmHit(off: number, x: number, y: number) {
    const H = BAL.hit;
    const judge: Judge = off <= H.perfect ? 'perfect' : 'good';
    this.stats[judge]++;
    this.heat = Math.min(BAL.heat.max, this.heat + 1);
    this.mult = Math.min(H.multMax, this.mult + 1);
    this.streak++;
    this.stats.bestStreak = Math.max(this.stats.bestStreak, this.streak);
    this.add((judge === 'perfect' ? BAL.score.perfect : BAL.score.good) * this.mult);
    // the ball leaves hotter
    if (!this.onPaddle) this.speed = this.baseSpeed();
    this.emit({ type: 'judge', judge, x, y, mult: this.mult, heat: this.heat });
    if (!this.groove && this.streak >= H.grooveStreak) {
      this.groove = true;
      this.emit({ type: 'groove', on: true });
    }
  }

  private resolveCatch() {
    const p = this.pending!;
    this.pending = null;
    this.stats.catches++;
    if (!this.dropping) this.heat = Math.max(0, this.heat - BAL.heat.coolCatch);
    this.streak = 0;
    if (this.groove) {
      this.groove = false;
      this.emit({ type: 'groove', on: false });
    }
    this.emit({ type: 'catch', x: p.x, y: p.y });
  }

  private loseBall() {
    // with multiball, another ball takes over and nothing is lost
    const i = this.extras.findIndex((e) => e.kind === 'multi');
    if (i >= 0) {
      const e = this.extras.splice(i, 1)[0];
      this.bx = e.x;
      this.by = e.y;
      this.dx = e.dx;
      this.dy = e.dy;
      this.speed = e.speed;
      this.trail.length = 0;
      this.sync = null;
      this.landing = null;
      this.needPlan = true;
      this.pending = null;
      this.stats.saved++;
      this.emit({ type: 'saved' });
      return;
    }
    this.stats.lost++;
    this.lives--;
    this.layers = Math.max(0, this.layers - 1);
    this.mult = 1;
    this.streak = 0;
    this.heat = 0;
    this.pending = null;
    if (this.groove) {
      this.groove = false;
      this.emit({ type: 'groove', on: false });
    }
    this.emit({ type: 'lost', lives: this.lives, layers: this.layers });
    if (this.lives <= 0) {
      this.finish('lives', false, this.tempo.s16At(this.t) * 8);
      return;
    }
    this.placeOnPaddle();
  }

  private normalize() {
    const m = BAL.ball.minAngle * Math.PI / 180;
    let l = Math.hypot(this.dx, this.dy) || 1;
    this.dx /= l;
    this.dy /= l;
    if (Math.abs(this.dy) < Math.sin(m)) {
      this.dy = Math.sign(this.dy || -1) * Math.sin(m);
      this.dx = Math.sign(this.dx || 1) * Math.cos(m);
    }
    l = Math.hypot(this.dx, this.dy);
    this.dx /= l;
    this.dy /= l;
  }

  // ------------------------------------------------------------ the ball in rhythm
  /**
   * The ball is heading down: if nothing stands between it and the paddle line, find where it
   * crosses it and pick a beat (or an 8th, or a 16th) it can reach within the allowed speed range.
   */
  private plan() {
    this.normalize();
    this.sync = null;
    this.landing = null;
    const path = this.tracePath();
    if (path === null) {
      this.stats.planBlocked++;
      return;
    }
    const vy = -this.dy;
    const lineY = BAL.paddle.y + BAL.paddle.h / 2 + BAL.ball.r;
    const dist = (this.by - lineY) / vy; // path length to the line
    const tNow = dist / this.speed;
    this.landing = { x: path, t: this.t + tNow, synced: false };
    const mode = BAL.sync.mode;
    if (!mode) return;
    this.stats.planNone++;
    const base = this.baseSpeed();
    const units = mode === 2 ? [4, 2, 1] : [2, 1];
    const from = this.tempo.stepAt(this.t + 0.05);
    for (let u = 0; u < units.length; u++) {
      const g = units[u];
      let best = -1, bestErr = Infinity;
      const k0 = Math.ceil(from / g);
      for (let k = k0; k < k0 + 12; k++) {
        const tb = this.tempo.timeAt(k * g);
        const s = dist / (tb - this.t);
        // the average speed must stay in range; the ball eases into it, so leave some margin
        if (s < base * BAL.sync.min * 1.03 || s > base * BAL.sync.max * 0.97) continue;
        const err = Math.abs(s - this.speed);
        if (err < bestErr) {
          bestErr = err;
          best = tb;
        }
      }
      if (best > 0) {
        this.stats.planGrid[u + (mode === 2 ? 0 : 1)]++;
        this.sync = { tb: best };
        this.landing.t = best;
        this.landing.synced = true;
        this.stats.planNone--;
        return;
      }
    }
  }

  private steer(dt: number) {
    if (!this.sync) {
      // drift back to the base speed after a synced flight or a heat change
      this.speed += (this.baseSpeed() - this.speed) * damp(3, dt);
      return;
    }
    const lineY = BAL.paddle.y + BAL.paddle.h / 2 + BAL.ball.r;
    const remain = this.sync.tb - this.t;
    const dist = (this.by - lineY) / Math.max(0.05, -this.dy);
    if (remain <= dt || dist <= 0) return;
    const want = dist / remain;
    const base = this.baseSpeed();
    if (want < base * BAL.sync.min * 0.85 || want > base * BAL.sync.max * 1.15) {
      this.sync = null;
      if (this.landing) this.landing.synced = false;
      return;
    }
    this.speed = remain < 0.08 ? want : this.speed + (want - this.speed) * damp(BAL.sync.settle, dt);
  }

  /**
   * Follows the ball (reflecting off the side walls) down to the paddle line. Returns the x where
   * it crosses the line, or null if a brick is in the way.
   */
  private tracePath(): number | null {
    const R = BAL.ball.r;
    const lineY = BAL.paddle.y + BAL.paddle.h / 2 + R;
    let x = this.bx, y = this.by, dx = this.dx;
    const dy = this.dy;
    for (let seg = 0; seg < 8; seg++) {
      // distance (in t along the unit direction) to the line and to the next wall
      const tLine = (lineY - y) / dy;
      const tWall = dx > 0 ? (FIELD_W - R - x) / dx : dx < 0 ? (R - x) / dx : Infinity;
      const tEnd = Math.min(tLine, tWall);
      const ex = x + dx * tEnd, ey = y + dy * tEnd;
      if (this.segmentBlocked(x, y, ex, ey)) return null;
      if (tLine <= tWall) return ex;
      x = ex;
      y = ey;
      dx = -dx;
    }
    return null;
  }

  private segmentBlocked(x0: number, y0: number, x1: number, y1: number) {
    // a hot ball goes through normal bricks (roughly: while it has pierces left)
    const through = this.heat >= BAL.heat.pierce && this.pierceLeft > 0;
    const R = BAL.ball.r;
    const minY = Math.min(y0, y1) - R, maxY = Math.max(y0, y1) + R;
    for (const b of this.bricks) {
      if (!b.alive || (through && b.kind === 'normal')) continue;
      if (b.y - b.h / 2 > maxY || b.y + b.h / 2 < minY) continue;
      if (segBox(x0, y0, x1, y1, b.x - b.w / 2 - R, b.y - b.h / 2 - R, b.x + b.w / 2 + R, b.y + b.h / 2 + R)) return true;
    }
    return false;
  }
}

/** segment vs axis-aligned box (slab test) */
function segBox(x0: number, y0: number, x1: number, y1: number, ax: number, ay: number, bx: number, by: number) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - ax, bx - x0, y0 - ay, by - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return true;
}

export { FIELD_W, FIELD_H };
