// The rules of one level (one song). Time `t` is the song time the player *hears* (see the audio
// clock in main.ts), so a contact planned for a beat is seen and heard together. Fixed steps;
// no rendering or audio here — everything the outside needs comes out as events.

import { BAL, FIELD_H, FIELD_W } from './balance';
import { makeRng, type Rng } from '../core/rng';
import { clamp, damp } from '../core/math';
import { scaleNote, type Song } from '../music/song';

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
  hp: number;
  maxHp: number;
  alive: boolean;
  /** last hit (game time), for the flash */
  hitT: number;
  /** when it broke (game time), for the shatter animation */
  diedT: number;
};

export type Judge = 'perfect' | 'good';
export type EndReason = 'clear' | 'song' | 'lives';

export type GameEvent =
  | { type: 'brick'; brick: Brick; midi: number; broken: boolean; heat: number; pierce: boolean; x: number; y: number }
  | { type: 'row'; row: number; layers: number }
  | { type: 'contact'; x: number; y: number }
  | { type: 'judge'; judge: Judge; x: number; y: number; mult: number; heat: number }
  | { type: 'catch'; x: number; y: number }
  | { type: 'wall'; x: number; y: number }
  | { type: 'swing' }
  | { type: 'launch' }
  | { type: 'lost'; lives: number; layers: number }
  | { type: 'groove'; on: boolean }
  | { type: 'clear' }
  | { type: 'end'; reason: EndReason; passed: boolean };

export type Phase = 'play' | 'finale' | 'over';

/** where and when the descending ball will cross the paddle line, if nothing is in the way */
export type Landing = { x: number; t: number; synced: boolean };

export class Game {
  readonly song: Song;
  readonly rng: Rng;
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

  // progress
  layers = 0;
  lives = BAL.lives;
  score = 0;
  mult = 1;
  streak = 0;
  groove = false;
  stats = { perfect: 0, good: 0, catches: 0, lost: 0, bestStreak: 0, swings: 0, pierced: 0, contacts: 0, onGrid: 0, clearT: 0, planBlocked: 0, planNone: 0, planGrid: [0, 0, 0], unsyncedContacts: 0 };

  private events: GameEvent[] = [];

  constructor(song: Song, seed = 1) {
    this.song = song;
    this.rng = makeRng(seed);
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
        this.bricks.push({
          id: id++, row: r, rowUp, col: c,
          x: left + F.colPitch * (c + 0.5), y: F.bricksTop - F.brickH / 2 - r * F.rowPitch,
          w: F.brickW, h: F.brickH, step: s.rowBase + rowUp * s.rowStep + deg - 1,
          kind: hard ? 'hard' : 'normal', hp, maxHp: hp, alive: true, diedT: -9, hitT: -9,
        });
        this.rowAlive[r]++;
      }
    });
    this.alive = this.total = this.bricks.length;
  }

  baseSpeed() {
    return BAL.ball.speed * (1 + this.heat * BAL.ball.heatSpeed);
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

  private placeOnPaddle() {
    this.onPaddle = true;
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
    const a = (this.rng() * 2 - 1) * 0.25;
    this.dx = Math.sin(a);
    this.dy = Math.cos(a);
    this.onPaddle = false;
    this.speed = this.baseSpeed();
    this.lastPaddleT = this.t;
    this.needPlan = true;
    this.emit({ type: 'launch' });
  }

  drain() {
    const e = this.events;
    this.events = [];
    return e;
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
    this.target = clamp(this.target, P.w / 2, FIELD_W - P.w / 2);
    this.px += (this.target - this.px) * damp(P.follow, dt);

    if (this.phase === 'finale') return;

    if (this.pending && this.t - this.pending.t > BAL.hit.late) this.resolveCatch();

    if (this.onPaddle) {
      this.bx = this.px + this.stuckOffset;
      this.by = this.paddleTop + BAL.ball.r;
      if (this.t - this.stuckSince > BAL.ball.autoLaunch) this.launch();
    } else {
      this.moveBall(dt);
    }

    if (this.phase === 'play' && this.t >= this.song.length) {
      this.finish('song', (this.total - this.alive) / this.total >= BAL.passFrac);
    }
  }

  private finish(reason: EndReason, passed: boolean, delay = 0) {
    this.endReason = reason;
    this.passed = passed;
    this.phase = 'finale';
    this.sync = null;
    this.landing = null;
    this.endAt = this.t + delay;
    if (passed) this.score += this.lives * BAL.score.lifeLeft;
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
    if (this.bx < R && this.dx < 0) this.bounceWall(1, 0);
    else if (this.bx > FIELD_W - R && this.dx > 0) this.bounceWall(-1, 0);
    if (this.by > FIELD_H - R && this.dy > 0) this.bounceWall(0, -1);

    this.hitBricks();

    // paddle
    const top = this.paddleTop;
    const wasAbove = py - R >= Math.min(top, this.prevTop) - 1;
    this.prevTop = top;
    if (this.dy < 0 && this.by - R <= top && wasAbove) {
      const half = BAL.paddle.w / 2 + R * 0.6;
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

  private bounceWall(nx: number, ny: number) {
    if (nx) {
      this.dx = Math.abs(this.dx) * nx;
      this.bx = nx > 0 ? BAL.ball.r : FIELD_W - BAL.ball.r;
    }
    if (ny) {
      this.dy = Math.abs(this.dy) * ny;
      this.by = FIELD_H - BAL.ball.r;
      this.needPlan = true;
    }
    this.emit({ type: 'wall', x: this.bx, y: this.by });
  }

  private hitBricks() {
    const R = BAL.ball.r;
    let flipX = false, flipY = false;
    for (const b of this.bricks) {
      if (!b.alive) continue;
      const hw = b.w / 2, hh = b.h / 2;
      const cx = clamp(this.bx, b.x - hw, b.x + hw), cy = clamp(this.by, b.y - hh, b.y + hh);
      const ex = this.bx - cx, ey = this.by - cy;
      if (ex * ex + ey * ey > R * R) continue;
      const pierce = b.kind === 'normal' && this.heat >= BAL.heat.pierce && this.pierceLeft > 0;
      if (!pierce) {
        // which face: compare penetration relative to the brick's shape
        const ox = (this.bx - b.x) / (hw + R), oy = (this.by - b.y) / (hh + R);
        if (Math.abs(ox) > Math.abs(oy)) {
          if (Math.sign(ox) !== Math.sign(this.dx) || this.dx === 0) flipX = true;
          else continue; // moving away already
        } else if (Math.sign(oy) !== Math.sign(this.dy) || this.dy === 0) flipY = true;
        else continue;
      } else this.pierceLeft--;
      this.damage(b, pierce);
    }
    if (flipX) this.dx = -this.dx;
    if (flipY) this.dy = -this.dy;
    if (flipX || flipY) {
      this.sync = null;
      this.needPlan = true;
    }
  }

  private damage(b: Brick, pierce: boolean) {
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
    this.score += (broken ? BAL.score.brick : BAL.score.hardHit) * (1 + this.heat * BAL.score.heatBrick) * this.mult;
    this.emit({ type: 'brick', brick: b, midi, broken, heat: this.heat, pierce, x: this.bx, y: this.by });
    if (!broken) return;
    if (--this.rowAlive[b.row] === 0) {
      this.layers = Math.min(s.layers.length, this.layers + 1);
      this.emit({ type: 'row', row: b.row, layers: this.layers });
    }
    if (this.alive === 0) {
      // the finale: lands on the next downbeat and rings for a bar
      const nextBar = Math.ceil((this.t + 0.05) / s.bar) * s.bar;
      const barsLeft = Math.max(0, Math.floor((s.length - nextBar) / s.bar));
      this.score += barsLeft * BAL.score.barLeft * this.mult;
      this.stats.clearT = this.t;
      this.finish('clear', true, nextBar - this.t + s.bar);
      this.emit({ type: 'clear' });
    }
  }

  private paddleContact() {
    const P = BAL.paddle;
    // the moment the swing is judged against: the planned beat when the ball was in rhythm (a
    // swing lifts the paddle into the ball a little early), the contact otherwise
    const ref = this.sync && Math.abs(this.sync.tb - this.t) < 0.06 ? this.sync.tb : this.t;
    if (!this.sync) this.stats.unsyncedContacts++;
    const off = clamp((this.bx - this.px) / (P.w / 2), -1, 1);
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
    const g16 = this.song.s16;
    if (Math.abs(ref / g16 - Math.round(ref / g16)) * g16 < 0.012) this.stats.onGrid++;

    const early = ref - this.swingT;
    if (early >= -BAL.hit.late && early <= BAL.hit.good) {
      this.swingT = -9; // one swing, one hit
      this.rhythmHit(Math.abs(early), this.bx, this.by);
    } else {
      if (this.pending) this.resolveCatch();
      this.pending = { t: ref, x: this.bx, y: this.by };
    }
    this.speed = this.baseSpeed();
  }

  private rhythmHit(off: number, x: number, y: number) {
    const H = BAL.hit;
    const judge: Judge = off <= H.perfect ? 'perfect' : 'good';
    this.stats[judge]++;
    this.heat = Math.min(BAL.heat.max, this.heat + 1);
    this.mult = Math.min(H.multMax, this.mult + 1);
    this.streak++;
    this.stats.bestStreak = Math.max(this.stats.bestStreak, this.streak);
    this.score += (judge === 'perfect' ? BAL.score.perfect : BAL.score.good) * this.mult;
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
    this.heat = Math.max(0, this.heat - BAL.heat.coolCatch);
    this.streak = 0;
    if (this.groove) {
      this.groove = false;
      this.emit({ type: 'groove', on: false });
    }
    this.emit({ type: 'catch', x: p.x, y: p.y });
  }

  private loseBall() {
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
      this.finish('lives', false, this.song.beat * 2);
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
   * crosses it and pick a beat (or an 8th) it can reach within the allowed speed range.
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
    const b = this.song.beat;
    const grids = mode === 2 ? [b, b / 2, b / 4] : [b / 2, b / 4];
    for (const g of grids) {
      let best = -1, bestErr = Infinity;
      const k0 = Math.ceil((this.t + 0.05) / g);
      for (let k = k0; k < k0 + 12; k++) {
        const tb = k * g;
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
        this.stats.planGrid[grids.indexOf(g)]++;
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
