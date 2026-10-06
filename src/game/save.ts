// Persistence. Every read and write is wrapped: storage can be missing, full or blocked.

import type { SpeedId, TestSel } from './tuning';

export type SongRec = { best: number; passed: boolean; cleared: boolean; plays: number };
export type Meta = {
  v: 1;
  sound: boolean;
  /** extra audio latency from the calibration (s); null = never calibrated */
  calib: number | null;
  test: Partial<TestSel> | null;
  speed: SpeedId;
  songs: Record<string, SongRec>;
};
export type PlayStat = {
  date: string; song: string; reason: string; passed: boolean; score: number; time: number;
  bricks: number; speed: string; perfect: number; good: number; catches: number; lost: number; bestStreak: number; test: string; calib: number;
};

const KEY_META = 'puls.meta.v1';
const KEY_STATS = 'puls.stats.v1';
const KEY_HINTS = 'puls.hints.v1';

function read<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch { /* storage unavailable */ }
}

export function loadMeta(): Meta {
  const m = read<Partial<Meta>>(KEY_META);
  return { v: 1, sound: m?.sound ?? true, calib: m?.calib ?? null, test: m?.test ?? null, speed: m?.speed === 'fast' ? 'fast' : 'mid', songs: m?.songs ?? {} };
}
export const saveMeta = (m: Meta) => write(KEY_META, m);

export function logPlay(r: PlayStat) {
  const list = read<PlayStat[]>(KEY_STATS) ?? [];
  list.push(r);
  write(KEY_STATS, list.slice(-300));
}
export const loadStats = () => read<PlayStat[]>(KEY_STATS) ?? [];

export function hintSeen(id: string) {
  return !!read<Record<string, boolean>>(KEY_HINTS)?.[id];
}
export function markHint(id: string) {
  const h = read<Record<string, boolean>>(KEY_HINTS) ?? {};
  h[id] = true;
  write(KEY_HINTS, h);
}

export const today = () => new Date().toISOString().slice(0, 10);
