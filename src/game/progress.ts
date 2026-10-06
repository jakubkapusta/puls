// Unlocking, stars and the song of the day.

import { ALBUMS, SONGS } from '../music/songs';
import type { Song } from '../music/song';
import type { Game } from './game';
import type { Meta, SongRec } from './save';
import { hashString } from '../core/rng';

/** ★ passed, ★★ every brick down, ★★★ every brick down with ≥ RHYTHM_STAR of the contacts in rhythm */
export const RHYTHM_STAR = 0.6;

export function starsFor(g: Game) {
  if (!g.passed) return 0;
  if (g.endReason !== 'clear') return 1;
  const st = g.stats;
  const rhythm = st.contacts ? (st.perfect + st.good) / st.contacts : 0;
  return rhythm >= RHYTHM_STAR ? 3 : 2;
}

export const rec = (m: Meta, id: string): SongRec => m.songs[id] ?? { best: 0, passed: false, cleared: false, plays: 0, stars: 0 };

/** the Lo-fi album opens when the third synthwave song is passed */
export function albumUnlocked(m: Meta, albumIdx: number) {
  if (albumIdx === 0 || ALBUMS[albumIdx].lab) return true;
  const prev = ALBUMS[albumIdx - 1];
  return rec(m, prev.songs[Math.min(2, prev.songs.length - 1)].id).passed;
}

/** songs open in order inside an album */
export function songUnlocked(m: Meta, albumIdx: number, songIdx: number) {
  if (!albumUnlocked(m, albumIdx)) return false;
  return songIdx === 0 || !!ALBUMS[albumIdx].lab || rec(m, ALBUMS[albumIdx].songs[songIdx - 1].id).passed;
}

export function nextSong(m: Meta, song: Song): Song | null {
  for (let a = 0; a < ALBUMS.length; a++) {
    const i = ALBUMS[a].songs.indexOf(song);
    if (i < 0) continue;
    if (ALBUMS[a].lab) return null;
    if (i + 1 < ALBUMS[a].songs.length) return songUnlocked(m, a, i + 1) ? ALBUMS[a].songs[i + 1] : null;
    return a + 1 < ALBUMS.length && !ALBUMS[a + 1].lab && albumUnlocked(m, a + 1) ? ALBUMS[a + 1].songs[0] : null;
  }
  return null;
}

export function totalStars(m: Meta) {
  return SONGS.reduce((n, s) => n + rec(m, s.id).stars, 0);
}

/** the song of the day: any song (a taste of the locked ones too), a fixed seed */
export function dailyPick(date: string) {
  const h = hashString('puls-' + date);
  return { song: SONGS[h % SONGS.length], seed: h };
}
