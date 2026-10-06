// A song is data: tempo, scale, chord loop, the brick layout (rows = melody phrases) and the
// patterns of the layers the player unlocks. No audio files — the engine synthesizes everything.

export type LayerId = 'hat' | 'snare' | 'pad' | 'arp' | 'perc' | 'bass2' | 'bells';
/** the sound and look of an album */
export type Kit = 'synth' | 'lofi';

export type Chord = {
  /** semitones above the song root */
  root: number;
  /** chord tones as semitones above the chord root */
  tones: number[];
};

export type SongDef = {
  id: string;
  title: string;
  /** album id and the sound/look (see albums.ts) */
  album: string;
  kit: Kit;
  /** delay of every odd 16th, as a fraction of a 16th (lo-fi swing) */
  swing?: number;
  bpm: number;
  /** MIDI note of the tonic (bass register) */
  root: number;
  /** scale as semitones above the tonic, one octave */
  scale: number[];
  /** one chord per bar, looping */
  chords: Chord[];
  /** length in bars (the level ends with the song) */
  bars: number;
  /** hits a hard brick takes in this song (BAL.hard.hp if missing) */
  hardHp?: number;
  /** bars at the start with only the base layer opening up */
  intro: number;
  /**
   * Brick rows, top row first, 8 columns. '.' = no brick; '1'–'9' = scale step above the row's
   * base step (rows go up the scale from the bottom); 'a'–'i' = a hard brick on step 1–9.
   * Read left to right a row is a phrase.
   */
  rows: string[];
  /**
   * Special bricks, same shape as `rows` ('.' = plain): A akord, P perkusja, R arpeggiator,
   * F filtr, E echo, M metronom w górę, m metronom w dół, D drop.
   */
  specials?: string[];
  /** scale step (across octaves) of '1' in the bottom row, and how far each row up moves it */
  rowBase: number;
  rowStep: number;
  /** extra layers in the order cleared rows add them (the base layer — kick and bass — is always on) */
  layers: LayerId[];
  /** 16-step patterns per bar. 'x' hit, 'o' accent, '.' rest */
  kick: string;
  snare: string;
  hat: string;
  perc: string;
  /** bass: 'x' root, 'o' octave up, '5' fifth, '.' rest */
  bass: string;
  /** arpeggio: chord tone index per 16th ('0'–'5', wraps up an octave), '.' rest */
  arp: string;
  /** bells layer: chord tone index per 16th like `arp` */
  bells?: string;
  /**
   * The lead hook, played while the player is "w rytmie": one 16-char bar per chord bar,
   * scale steps above `leadBase` ('0'–'9', 'a'–'c' for 10–12), '-' hold, '.' rest.
   */
  lead: string[];
  leadBase: number;
};

export type Song = SongDef & {
  /** seconds per 16th / beat / bar */
  s16: number;
  beat: number;
  bar: number;
  /** total length in seconds */
  length: number;
};

export function makeSong(d: SongDef): Song {
  const beat = 60 / d.bpm;
  return { ...d, beat, s16: beat / 4, bar: beat * 4, length: d.bars * beat * 4 };
}

/** MIDI note of a scale step counted across octaves from the tonic (step 0 = root). */
export function scaleNote(song: SongDef, step: number) {
  const n = song.scale.length;
  const oct = Math.floor(step / n);
  return song.root + oct * 12 + song.scale[((step % n) + n) % n];
}

export const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
