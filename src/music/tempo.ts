// The tempo map of one level: song time (s) ↔ 16th steps, piecewise constant tempo. The game owns
// it (Metronom bricks and the slow-down power-up change it, always from a bar boundary far enough
// ahead that the audio hasn't scheduled it yet); the sequencer, the visuals and the HUD read it.

type Seg = { t: number; step: number; s16: number };

export class Tempo {
  private segs: Seg[];
  /** bumped on every change, so readers can cache */
  version = 0;

  constructor(readonly baseS16: number) {
    this.segs = [{ t: 0, step: 0, s16: baseS16 }];
  }

  private segAtTime(t: number) {
    const s = this.segs;
    for (let i = s.length - 1; i > 0; i--) if (s[i].t <= t) return s[i];
    return s[0];
  }

  private segAtStep(step: number) {
    const s = this.segs;
    for (let i = s.length - 1; i > 0; i--) if (s[i].step <= step) return s[i];
    return s[0];
  }

  /** seconds per 16th at song time t */
  s16At(t: number) {
    return this.segAtTime(t).s16;
  }

  /** fractional 16th index at song time t */
  stepAt(t: number) {
    const g = this.segAtTime(t);
    return g.step + (t - g.t) / g.s16;
  }

  /** song time of a (fractional) 16th index */
  timeAt(step: number) {
    const g = this.segAtStep(step);
    return g.t + (step - g.step) * g.s16;
  }

  /** BPM at song time t */
  bpmAt(t: number) {
    return 60 / (this.s16At(t) * 4);
  }

  /** From 16th `atStep` on, play at `s16`. Later changes are dropped (the caller re-adds them). */
  set(atStep: number, s16: number) {
    const t = this.timeAt(atStep);
    this.segs = this.segs.filter((g) => g.step < atStep);
    this.segs.push({ t, step: atStep, s16 });
    this.version++;
  }

  /** the first bar line at least `lead` seconds after t, as a 16th index */
  nextBar(t: number, lead: number) {
    return Math.ceil(this.stepAt(t + lead) / 16) * 16;
  }
}
