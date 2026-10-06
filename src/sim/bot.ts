// A player model for the simulator (and the menu demo). `skill` 0..1 scales reaction time,
// paddle speed, aim and swing timing. It only reads what a player could see: where the ball is
// heading (once the path is clear) and when it lands.

import { BAL, FIELD_W } from '../game/balance';
import type { Game } from '../game/game';
import { makeRng, type Rng } from '../core/rng';
import { clamp } from '../core/math';

export class Bot {
  private rng: Rng;
  private seenAt = -1;
  private seenKey = '';
  private aim = 0;
  private swingAt = -1;
  private swungFor = -1;
  private launchAt = -1;
  /** misjudging where the ball lands: a fixed error per flight that shrinks as the ball nears */
  private err = 0;
  private lapse = 0;

  constructor(public skill: number, seed = 7) {
    this.rng = makeRng(seed);
  }

  private gauss() {
    const u = Math.max(1e-9, this.rng()), v = this.rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  get react() {
    return 0.32 - 0.2 * this.skill;
  }

  update(g: Game, dt: number) {
    const sk = this.skill;
    if (g.onPaddle) {
      if (this.launchAt < 0) this.launchAt = g.t + 0.4 + this.rng() * 0.8;
      if (g.t >= this.launchAt) {
        g.launch();
        this.launchAt = -1;
      }
      return;
    }
    const L = g.landing;
    let want = g.px;
    if (L && g.dy < 0) {
      const key = L.t.toFixed(3);
      if (key !== this.seenKey) {
        this.seenKey = key;
        this.seenAt = g.t;
        this.err = this.gauss();
        this.lapse = this.rng() < 0.08 * (1 - sk) ? 0.15 + this.rng() * 0.25 : 0;
        // aim: skilled players hit with the paddle's side to send the ball towards bricks
        const bricks = g.bricks.filter((b) => b.alive);
        const cx = bricks.length ? bricks.reduce((a, b) => a + b.x, 0) / bricks.length : FIELD_W / 2;
        const off = clamp((cx - L.x) / 300, -0.7, 0.7) * sk + this.gauss() * 0.35 * (1 - sk);
        this.aim = -off * BAL.paddle.w / 2;
        // swing: skilled players swing more often and closer to the contact
        this.swingAt = this.rng() < 0.25 + 0.75 * sk ? L.t + this.gauss() * (0.015 + 0.11 * (1 - sk)) : -1;
      }
      if (g.t - this.seenAt >= this.react + this.lapse) {
        const left = clamp((L.t - g.t) / Math.max(0.2, L.t - this.seenAt), 0, 1);
        const sigma = 4 + 30 * (1 - sk) + left * (10 + 140 * (1 - sk));
        want = L.x + this.aim + this.err * sigma;
      }
    } else {
      // ball going up: drift under it lazily
      want = g.px + (g.bx - g.px) * 0.4;
    }
    // finite hand speed
    const vmax = 900 + 1500 * sk;
    const d = clamp(want - g.target, -vmax * dt, vmax * dt);
    g.target += d;
    if (this.swingAt > 0 && g.t >= this.swingAt && this.swungFor !== this.swingAt) {
      this.swungFor = this.swingAt;
      g.swing(g.t);
    }
  }
}
