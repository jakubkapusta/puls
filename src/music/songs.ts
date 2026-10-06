// The albums and their songs. Each song: a scale (minor pentatonic) and a chord loop chosen so no
// scale note clashes with a chord; rows are melody phrases; later songs are longer, faster and
// have more layers. Bottom rows stay short and plain, so the first layers come quickly.

import { makeSong, type Chord, type Song, type Kit } from './song';

const MINOR_PENTA = [0, 3, 5, 7, 10];

const m7 = (root: number): Chord => ({ root, tones: [0, 3, 7, 10] });
const m9 = (root: number): Chord => ({ root, tones: [0, 3, 7, 10, 14] });
const maj7 = (root: number): Chord => ({ root, tones: [0, 4, 7, 11] });
const add9 = (root: number): Chord => ({ root, tones: [0, 4, 7, 14] });
const maj = (root: number): Chord => ({ root, tones: [0, 4, 7, 12] });
const sus2 = (root: number): Chord => ({ root, tones: [0, 2, 7, 12] });

export type Album = { id: string; title: string; sub: string; kit: Kit; songs: Song[] };

// ---------------------------------------------------------------- synthwave
const SYNTH_COMMON = { album: 'synthwave', kit: 'synth' as const, scale: MINOR_PENTA, intro: 2, rowBase: 3, rowStep: 1 };

export const NIGHT_DRIVE: Song = makeSong({
  ...SYNTH_COMMON,
  id: 'nocna-jazda',
  title: 'Nocna jazda',
  bpm: 100,
  root: 45, // A2 — Am, Fmaj7, C(add9), Gsus2
  chords: [m7(0), maj7(-4), add9(3), sus2(-2)],
  bars: 56,
  hardHp: 4,
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
  specials: [
    '..D..D..',
    '.A....A.',
    '...R....',
    '........',
    'E......F',
    '...M....',
    '........',
    '.P....D.',
    '....m...',
    '........',
  ],
  layers: ['hat', 'snare', 'pad', 'arp', 'bass2', 'perc'],
  kick: 'x...x...x...x...',
  snare: '....o.......o...',
  hat: '..x...x...x...x.',
  perc: 'x.xxo.xxx.xxo.xx',
  bass: 'x.x.o.x.x.x.o.x.',
  arp: '0123012301230123',
  lead: ['1---3-4-5---4-3-', '3-------2-1-----', '2---4-5-6---5-4-', '5-------4---3-2-'],
  leadBase: 9,
});

const NEON_SHORE: Song = makeSong({
  ...SYNTH_COMMON,
  id: 'neonowy-brzeg',
  title: 'Neonowy brzeg',
  bpm: 104,
  root: 40, // E2 — Em7, Cmaj7, G, Dsus2
  chords: [m7(0), maj7(-4), maj(3), sus2(-2)],
  bars: 60,
  hardHp: 4,
  rows: [
    '.3.55.3.',
    '24.66.42',
    '3a5..5a3',
    '.4e66e54',
    '1.c44c.1',
    '2e.22.e2',
    '.c.44.c.',
    '1b3443b1',
    '.1.33.1.',
    '2..11..2',
  ],
  specials: [
    '.D....D.',
    'A......A',
    '........',
    '.R....E.',
    'F......P',
    '........',
    '...D....',
    'M.......',
    '........',
    '........',
  ],
  layers: ['hat', 'snare', 'pad', 'arp', 'bass2', 'perc'],
  kick: 'x...x...x...x...',
  snare: '....o.......o...',
  hat: '..x...x...x...x.',
  perc: 'x.xxo.x.x.xxo.x.',
  bass: 'x.x.x.x.o.x.x.x.',
  arp: '0123210301232103',
  lead: ['4---3-2-3---1---', '2-3-4-5-4---3---', '5---4-3-4---6---', '5-4-3-2---1-0---'],
  leadBase: 10,
});

const CASSETTE: Song = makeSong({
  ...SYNTH_COMMON,
  id: 'kaseta',
  title: 'Kaseta z 86',
  bpm: 96,
  root: 38, // D2 — Dm7, Gm7, B♭maj7, Csus2
  chords: [m7(0), m7(5), maj7(-4), sus2(-2)],
  bars: 64,
  hardHp: 4,
  rows: [
    '1..ee..1',
    '.b1441b.',
    '3.d55d.3',
    '.5f..f5.',
    '2d.22.d2',
    'c.2112.c',
    '.d.33.d.',
    '5d32.2c4',
    '..2..2..',
    '1.a..a.1',
  ],
  specials: [
    'D......D',
    '........',
    'A......A',
    '.R....R.',
    '........',
    '..E..F..',
    '...D....',
    'P......m',
    '..M.....',
    '........',
  ],
  layers: ['hat', 'snare', 'pad', 'bells', 'arp', 'bass2', 'perc'],
  kick: 'x...x...x...x..x',
  snare: '....o.......o...',
  hat: '..x...x...x...x.',
  perc: 'x.xxo.xxx.xxo.xx',
  bass: 'x.x.5.x.x.x.o.x.',
  arp: '0124012401240124',
  bells: '..0...2...1...3.',
  lead: ['3---4-3-1---0---', '2---3-4-5---4---', '3---4-5-6---5-4-', '5-------4---2---'],
  leadBase: 10,
});

const LASER_HORIZON: Song = makeSong({
  ...SYNTH_COMMON,
  id: 'laserowy-horyzont',
  title: 'Laserowy horyzont',
  bpm: 108,
  root: 42, // F#2 — F#m7, Esus2, Dmaj7, Esus2
  chords: [m7(0), sus2(-2), maj7(-4), sus2(-2)],
  bars: 68,
  hardHp: 4,
  rows: [
    '.1.44.1.',
    '2b3553b2',
    '.d.66.d.',
    '3e.55.e3',
    '1b.44.b1',
    '.3d55d3.',
    '2.c33c.2',
    'a4.33.4a',
    '.2.22.2.',
    '3.1..1.3',
  ],
  specials: [
    '.D....D.',
    '........',
    '...AA...',
    'R......R',
    '........',
    '.E....F.',
    '........',
    '.M....P.',
    '...D....',
    '........',
  ],
  layers: ['hat', 'snare', 'pad', 'arp', 'bells', 'bass2', 'perc'],
  kick: 'x...x...x...x...',
  snare: '....o.......o...',
  hat: 'x.x.x.x.x.x.x.x.',
  perc: '..x...x...x.o.x.',
  bass: 'x.xxx.x.x.xxo.x.',
  arp: '0123401234012340',
  bells: '....0.......2...',
  lead: ['5---4-3---1-2---', '3---2-1---0-1---', '2---3-4---5-6---', '5-------4-3-2---'],
  leadBase: 10,
});

const LAST_SUNSET: Song = makeSong({
  ...SYNTH_COMMON,
  id: 'ostatni-zachod',
  title: 'Ostatni zachód',
  bpm: 112,
  root: 36, // C2 — Cm7, A♭maj7, E♭, B♭sus2
  chords: [m7(0), maj7(-4), maj(3), sus2(-2)],
  bars: 76,
  hardHp: 5,
  rows: [
    '..1221..',
    '.a3443a.',
    '2e.66.e2',
    '3.d22d.3',
    '.5f..f5.',
    '4c3..3c4',
    '.b.33.b.',
    '3d5665d3',
    '1.2..2.1',
    '.1....1.',
  ],
  specials: [
    '..D..D..',
    '........',
    'A......A',
    'R......E',
    '.F....M.',
    '........',
    '...D....',
    'P......m',
    '........',
    '........',
  ],
  layers: ['hat', 'snare', 'pad', 'arp', 'bells', 'bass2', 'perc'],
  kick: 'x...x...x...x...',
  snare: '....o.......o...',
  hat: '..x...x...x...x.',
  perc: 'x.xxo.x.x.xxo.xo',
  bass: 'x.o.x.o.x.o.x.o.',
  arp: '0123123423453456',
  bells: '..0...1...2...3.',
  lead: ['5---4-3-4---6---', '5---3-------2---', '3-4-5-6-7---6---', '5-------4---3---'],
  leadBase: 10,
});

// ---------------------------------------------------------------- lo-fi
const LOFI_COMMON = { album: 'lofi', kit: 'lofi' as const, scale: MINOR_PENTA, intro: 2, rowBase: 3, rowStep: 1, swing: 0.2 };

const RAIN: Song = makeSong({
  ...LOFI_COMMON,
  id: 'deszcz-na-szybie',
  title: 'Deszcz na szybie',
  bpm: 80,
  root: 45, // A — Am9, Dm9, Fmaj7, Cmaj7
  chords: [m9(0), m9(5), maj7(-4), maj7(3)],
  bars: 40,
  hardHp: 4,
  rows: [
    '..3443..',
    '.b1551b.',
    '3.d..d.3',
    '.4e..e4.',
    '2.c22c.2',
    '.c.44.c.',
    '1b34.3b1',
    '..2..2..',
    '.1.11.1.',
  ],
  specials: [
    '..D..D..',
    '........',
    'A......A',
    '.E....F.',
    '........',
    '...R....',
    'P......m',
    '........',
    '........',
  ],
  layers: ['hat', 'pad', 'snare', 'arp', 'perc'],
  kick: 'x......x..x.....',
  snare: '....x.......x...',
  hat: 'x.x.x.x.x.x.x.x.',
  perc: 'xxxxxxxxxxxxxxxx',
  bass: 'x.....x...x.....',
  arp: '0.2.1.3.0.2.1.3.',
  lead: ['3---2-1---0-----', '1---2-3---2-----', '4---3-2---1-2---', '3-------2---1---'],
  leadBase: 10,
});

const COFFEE: Song = makeSong({
  ...LOFI_COMMON,
  id: 'kawa-o-trzeciej',
  title: 'Kawa o trzeciej',
  bpm: 76,
  root: 38, // D — Dm9, Gm9, B♭maj7, Fmaj7
  chords: [m9(0), m9(5), maj7(-4), maj7(3)],
  bars: 44,
  hardHp: 4,
  rows: [
    '.4.cc.4.',
    '3a.55.a3',
    '.b.44.b.',
    '4e.33.e4',
    '.c.22.c.',
    'b.4..4.b',
    '.1c..c1.',
    '2.a22a.2',
    '..1..1..',
  ],
  specials: [
    '.D....D.',
    '........',
    '...A....',
    'R......R',
    '........',
    '.....F..',
    '.E......',
    'M.......',
    '........',
  ],
  layers: ['hat', 'pad', 'snare', 'arp', 'bass2', 'perc'],
  kick: 'x.......x..x....',
  snare: '....x.......x..x',
  hat: 'x.x.x.x.x.x.x.x.',
  perc: '..x...x...x...x.',
  bass: 'x.....x.x.......',
  arp: '0...2...1...3...',
  lead: ['3---4---5---4---', '2---3---4---3-2-', '3---2---1---0---', '1---2---3-------'],
  leadBase: 10,
});

const TRAM: Song = makeSong({
  ...LOFI_COMMON,
  id: 'tramwaj-noca',
  title: 'Tramwaj nocą',
  bpm: 84,
  root: 40, // E — Em9, Am9, Cmaj7, Gmaj7
  chords: [m9(0), m9(5), maj7(-4), maj7(3)],
  bars: 48,
  hardHp: 4,
  rows: [
    '..4554..',
    '.c1..1c.',
    '2.d66d.2',
    '.3e..e3.',
    '4.b22b.4',
    '.c.44.c.',
    '2c.11.c2',
    '.4.bb.4.',
    '1.3..3.1',
    '..1..1..',
  ],
  specials: [
    '..D..D..',
    '........',
    'A......A',
    '.R....E.',
    '........',
    '...D....',
    'F......P',
    '.m....M.',
    '........',
    '........',
  ],
  layers: ['hat', 'pad', 'snare', 'arp', 'bells', 'bass2', 'perc'],
  kick: 'x......x.x......',
  snare: '....x.......x...',
  hat: 'x.x.x.x.x.x.x.x.',
  perc: 'x.xxx.xxx.xxx.xx',
  bass: 'x.....x...x...x.',
  arp: '0.1.2.3.2.1.0.1.',
  bells: '......0.......2.',
  lead: ['4---3---2---3---', '5---4---3-------', '2---3---4---3-2-', '1-------0-------'],
  leadBase: 10,
});

// ---------------------------------------------------------------- jam (endless, rows generated)
export const JAM: Song = makeSong({
  ...SYNTH_COMMON,
  id: 'jam',
  title: 'Jam',
  bpm: 100,
  root: 45,
  chords: [m7(0), maj7(-4), add9(3), sus2(-2)],
  bars: 100000,
  rows: [],
  layers: ['hat', 'snare', 'pad', 'arp', 'bells', 'bass2', 'perc'],
  kick: 'x...x...x...x...',
  snare: '....o.......o...',
  hat: '..x...x...x...x.',
  perc: 'x.xxo.xxx.xxo.xx',
  bass: 'x.x.o.x.x.x.o.x.',
  arp: '0123012301230123',
  bells: '..0...1...2...3.',
  lead: ['1---3-4-5---4-3-', '3-------2-1-----', '2---4-5-6---5-4-', '5-------4---3-2-'],
  leadBase: 9,
});

export const ALBUMS: Album[] = [
  { id: 'synthwave', title: 'Synthwave', sub: 'neonowa noc · 96–112 BPM', kit: 'synth', songs: [NIGHT_DRIVE, NEON_SHORE, CASSETTE, LASER_HORIZON, LAST_SUNSET] },
  { id: 'lofi', title: 'Lo-fi', sub: 'deszczowe miasto · 76–84 BPM', kit: 'lofi', songs: [RAIN, COFFEE, TRAM] },
];

export const SONGS: Song[] = ALBUMS.flatMap((a) => a.songs);

export function songById(id: string): Song | null {
  return SONGS.find((s) => s.id === id) ?? (id === JAM.id ? JAM : null);
}
