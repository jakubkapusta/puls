// The songs. M1 has one synthwave track; the album (5 songs) comes in M4.

import { makeSong, type Song } from './song';

const MINOR_PENTA = [0, 3, 5, 7, 10];

/** Am – Fmaj7 – C(add9) – Gsus2: every note of A minor pentatonic sits well over each chord. */
const NIGHT_DRIVE_CHORDS = [
  { root: 0, tones: [0, 3, 7, 10] },
  { root: -4, tones: [0, 4, 7, 11] },
  { root: 3, tones: [0, 4, 7, 14] },
  { root: -2, tones: [0, 2, 7, 12] },
];

export const NIGHT_DRIVE: Song = makeSong({
  id: 'nocna-jazda',
  title: 'Nocna jazda',
  bpm: 100,
  root: 45, // A2
  scale: MINOR_PENTA,
  chords: NIGHT_DRIVE_CHORDS,
  bars: 56,
  intro: 2,
  rows: [
    '..4554..',
    '.3e66e3.',
    '24565542',
    'a.3bb3.a',
    '35.dd.53',
    '2345.432',
    '1.2cc2.1',
    '13533531',
    '.2.44.2.',
    '..3..3..',
  ],
  rowBase: 3, // E3
  rowStep: 1,
  layers: ['hat', 'snare', 'pad', 'arp', 'bass2', 'perc'],
  kick: 'x...x...x...x...',
  snare: '....o.......o...',
  hat: '..x...x...x...x.',
  perc: 'x.xxo.xxx.xxo.xx',
  bass: 'x.x.o.x.x.x.o.x.',
  arp: '0123012301230123',
  lead: [
    '1---3-4-5---4-3-',
    '3-------2-1-----',
    '2---4-5-6---5-4-',
    '5-------4---3-2-',
  ],
  leadBase: 9, // G4
});

export const SONGS: Song[] = [NIGHT_DRIVE];
