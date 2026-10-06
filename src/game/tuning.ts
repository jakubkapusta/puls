// M1 test settings ("Ustawienia testowe" in the menu): a few feel options for the owner's phone
// test. Each option overrides some BAL knobs; the defaults must equal balance.ts.

import { BAL } from './balance';
import type { SwingMode } from './input';

export type TestSel = { speed: string; window: string; sync: string; swing: SwingMode; ring: string };

type Opt = { id: string; label: string; apply?: () => void };
export type TestGroup = { key: keyof TestSel; label: string; def: string; opts: Opt[] };

export const TEST_GROUPS: TestGroup[] = [
  {
    key: 'speed', label: 'Piłka', def: 'mid',
    opts: [
      { id: 'slow', label: 'wolna', apply: () => (BAL.ball.speed = 680) },
      { id: 'mid', label: 'średnia', apply: () => (BAL.ball.speed = 800) },
      { id: 'fast', label: 'szybka', apply: () => (BAL.ball.speed = 920) },
    ],
  },
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
    key: 'ring', label: 'Pierścień lądowania', def: 'on',
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
