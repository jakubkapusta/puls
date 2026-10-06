// Settings that change BAL. `SPEEDS` is a player choice in the menu (owner after the M1 test:
// medium and fast both fine, fast should pay more). `TEST_GROUPS` are the "Ustawienia testowe"
// feel options; each overrides some BAL knobs and the defaults must equal balance.ts.

import { BAL } from './balance';
import type { SwingMode } from './input';

export type TestSel = { window: string; sync: string; swing: SwingMode; ring: string };

export type SpeedId = 'mid' | 'fast';
export const SPEEDS: Record<SpeedId, { label: string; speed: number; mul: number }> = {
  mid: { label: 'średnia', speed: 800, mul: 1 },
  fast: { label: 'szybka', speed: 920, mul: 1.25 },
};
export function applySpeed(id: SpeedId) {
  const s = SPEEDS[id] ?? SPEEDS.mid;
  BAL.ball.speed = s.speed;
  BAL.score.speedMul = s.mul;
}

type Opt = { id: string; label: string; apply?: () => void };
export type TestGroup = { key: keyof TestSel; label: string; def: string; opts: Opt[] };

export const TEST_GROUPS: TestGroup[] = [
  {
    key: 'window', label: 'Okno uderzenia', def: 'mid',
    opts: [
      { id: 'narrow', label: 'wąskie', apply: () => Object.assign(BAL.hit, { perfect: 0.045, good: 0.1, late: 0.08 }) },
      { id: 'mid', label: 'średnie', apply: () => Object.assign(BAL.hit, { perfect: 0.06, good: 0.13, late: 0.1 }) },
      { id: 'wide', label: 'szerokie', apply: () => Object.assign(BAL.hit, { perfect: 0.08, good: 0.17, late: 0.13 }) },
    ],
  },
  {
    key: 'sync', label: 'Piłka w rytmie', def: 'beat',
    opts: [
      { id: 'off', label: 'wyłączona', apply: () => (BAL.sync.mode = 0) },
      { id: 'eighth', label: 'ósemki', apply: () => (BAL.sync.mode = 1) },
      { id: 'beat', label: 'bity', apply: () => (BAL.sync.mode = 2) },
    ],
  },
  {
    key: 'swing', label: 'Uderzenie (dotyk)', def: 'flick',
    opts: [
      { id: 'flick', label: 'ruch w górę' },
      { id: 'tap', label: 'stuknięcie' },
    ],
  },
  {
    key: 'ring', label: 'Pierścień lądowania', def: 'off',
    opts: [
      { id: 'on', label: 'tak' },
      { id: 'off', label: 'nie' },
    ],
  },
];

export function fullSel(sel: Partial<TestSel> | null): TestSel {
  const out = {} as Record<string, string>;
  for (const g of TEST_GROUPS) {
    const v = sel?.[g.key];
    out[g.key] = g.opts.some((o) => o.id === v) ? (v as string) : g.def;
  }
  return out as unknown as TestSel;
}

export function applyTest(sel: TestSel) {
  for (const g of TEST_GROUPS) g.opts.find((o) => o.id === sel[g.key])?.apply?.();
}

export const testTag = (sel: TestSel) => TEST_GROUPS.map((g) => sel[g.key]).join('/');
