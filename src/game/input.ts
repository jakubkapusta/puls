// Input. Touch: relative — the paddle moves as far as the finger does (anywhere on the screen, the
// finger stays under the paddle so it never hides it); a quick flick upwards is the swing (or, in
// the "tap" test mode, every new touch is). Mouse: the paddle sits under the cursor, click =
// launch / swing. Keys: arrows move, Space / ArrowUp = launch / swing, Esc / P = pause.

export type SwingMode = 'flick' | 'tap';

export type InputHandlers = {
  /** launch or swing; `ms` is the event's timeStamp (performance.now() clock) */
  action: (ms: number) => void;
  /** move the paddle by world units (touch) */
  nudge: (dxCss: number) => void;
  /** put the paddle under this CSS x (mouse) */
  point: (cssX: number) => void;
  pause: () => void;
};

type Sample = { t: number; x: number; y: number };

export class Input {
  swingMode: SwingMode = 'flick';
  /** css px/s upwards that counts as a flick */
  flickSpeed = 700;
  /** −1 / 0 / 1 from the arrow keys */
  keyDir = 0;
  enabled = false;
  private touchId: number | null = null;
  private last = { x: 0, y: 0 };
  private samples: Sample[] = [];
  private armed = true;
  private keys = new Set<string>();

  constructor(private el: HTMLElement, private h: InputHandlers) {
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.keyDir = 0;
    });
  }

  private down(e: PointerEvent) {
    if (!this.enabled) return;
    e.preventDefault();
    if (e.pointerType === 'mouse') {
      this.h.point(e.clientX);
      this.h.action(e.timeStamp);
      return;
    }
    // a second finger while one drags: in tap mode it swings, otherwise ignored
    if (this.touchId !== null) {
      if (this.swingMode === 'tap') this.h.action(e.timeStamp);
      return;
    }
    this.touchId = e.pointerId;
    this.el.setPointerCapture?.(e.pointerId);
    this.last = { x: e.clientX, y: e.clientY };
    this.samples = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];
    this.armed = true;
    this.downT = e.timeStamp;
    this.moved = 0;
    if (this.swingMode === 'tap') this.h.action(e.timeStamp);
  }
  private downT = 0;
  private moved = 0;

  private move(e: PointerEvent) {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse') {
      this.h.point(e.clientX);
      return;
    }
    if (e.pointerId !== this.touchId) return;
    e.preventDefault();
    // coalesced events give the finger's path between frames
    const evs = (e.getCoalescedEvents?.() ?? []).length ? e.getCoalescedEvents() : [e];
    for (const c of evs) {
      const dx = c.clientX - this.last.x;
      this.moved += Math.abs(dx) + Math.abs(c.clientY - this.last.y);
      this.h.nudge(dx);
      this.last = { x: c.clientX, y: c.clientY };
      this.samples.push({ t: c.timeStamp, x: c.clientX, y: c.clientY });
    }
    const now = e.timeStamp;
    while (this.samples.length > 2 && now - this.samples[0].t > 70) this.samples.shift();
    if (this.swingMode !== 'flick') return;
    const s0 = this.samples[0];
    const dt = (now - s0.t) / 1000;
    if (dt <= 0.005) return;
    const up = s0.y - e.clientY; // css px upwards
    const vy = up / dt;
    const vx = Math.abs(e.clientX - s0.x) / dt;
    if (this.armed && up > 12 && vy > this.flickSpeed && vy > vx * 0.8) {
      this.armed = false;
      this.h.action(e.timeStamp);
    } else if (!this.armed && vy < this.flickSpeed * 0.25) this.armed = true;
  }

  private up(e: PointerEvent) {
    if (e.pointerId !== this.touchId) return;
    this.touchId = null;
    if (!this.enabled) return;
    // a short tap launches the ball (in flick mode; in tap mode the touch already acted)
    if (this.swingMode === 'flick' && e.timeStamp - this.downT < 260 && this.moved < 14) this.h.action(this.downT);
  }

  private key(e: KeyboardEvent, down: boolean) {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'a' || k === 'd') {
      if (down) this.keys.add(k);
      else this.keys.delete(k);
      this.keyDir = (this.keys.has('ArrowRight') || this.keys.has('d') ? 1 : 0) - (this.keys.has('ArrowLeft') || this.keys.has('a') ? 1 : 0);
      e.preventDefault();
      return;
    }
    if (!down || e.repeat) return;
    if (k === ' ' || k === 'ArrowUp' || k === 'w') {
      if (this.enabled) this.h.action(e.timeStamp);
      e.preventDefault();
    } else if (k === 'Escape' || k === 'p') this.h.pause();
  }
}
