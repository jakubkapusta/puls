// The look of each album's kit: the background palette, which scene elements show, the brick
// colours and the post effects. One table, so a new album is one entry here.

import type { Kit } from '../music/song';

type RGB = [number, number, number];

export type Theme = {
  /** background: pink (horizon, glows), violet (sky), cyan (grid, accents), deep (top of the sky), sun */
  pal: [RGB, RGB, RGB, RGB, RGB];
  /** city skyline + wet street instead of ridges, rain, banded sun, sun amount */
  look: [number, number, number, number];
  /** disco spots, speed streaks, grid amount, stars */
  look2: [number, number, number, number];
  /** brick rows bottom → top */
  rows: [RGB, RGB, RGB];
  /** warmth, extra grain, pixel size in css px (0 = off), strobe strength on the kick */
  post: [number, number, number, number];
};

export const THEMES: Record<Kit, Theme> = {
  synth: {
    pal: [[1, 0.12, 0.45], [0.25, 0.05, 0.55], [0.1, 0.8, 1], [0.012, 0.004, 0.03], [1, 0.72, 0.18]],
    look: [0, 0, 1, 1], look2: [0, 0, 1, 1],
    rows: [[0.15, 0.85, 1.25], [0.75, 0.35, 1.35], [1.4, 0.25, 0.75]],
    post: [0, 0, 0, 0],
  },
  lofi: {
    pal: [[1, 0.42, 0.3], [0.22, 0.12, 0.3], [0.35, 0.75, 0.8], [0.01, 0.014, 0.025], [1, 0.78, 0.5]],
    look: [1, 1, 0, 0.55], look2: [0, 0, 1, 0],
    rows: [[0.3, 0.8, 0.8], [1.25, 0.8, 0.4], [1.2, 0.42, 0.5]],
    post: [1, 0.035, 0, 0],
  },
  // primary colours, a big blocky sun, everything in fat pixels
  chip: {
    pal: [[0.2, 0.5, 1], [0.05, 0.05, 0.35], [0.3, 1, 0.4], [0.005, 0.005, 0.04], [1, 0.85, 0.2]],
    look: [0, 0, 1, 1], look2: [0, 0, 1, 1],
    rows: [[0.25, 1.2, 0.45], [1.3, 1.1, 0.2], [1.3, 0.25, 0.65]],
    post: [0, 0.01, 4, 0],
  },
  // concrete grey, red light, no sun, a strobe on the kick once the track is up
  techno: {
    pal: [[1, 0.06, 0.05], [0.12, 0.12, 0.14], [0.85, 0.88, 0.95], [0.008, 0.008, 0.01], [1, 0.15, 0.1]],
    look: [0, 0, 0, 0.25], look2: [0, 0, 0.8, 0],
    rows: [[0.85, 0.9, 1], [1.3, 0.35, 0.3], [1.6, 0.12, 0.1]],
    post: [0, 0.02, 0, 0.22],
  },
  // gold and purple, a mirror ball throwing spots everywhere
  funk: {
    pal: [[1, 0.55, 0.15], [0.35, 0.08, 0.45], [1, 0.8, 0.35], [0.02, 0.005, 0.03], [1, 0.6, 0.2]],
    look: [0, 0, 0, 0.7], look2: [1, 0, 0.7, 1],
    rows: [[1.4, 0.95, 0.3], [1.2, 0.35, 0.95], [0.45, 0.8, 1.35]],
    post: [0.6, 0.01, 0, 0],
  },
  // dark teal night, speed streaks, a pale sun
  dnb: {
    pal: [[0.1, 0.9, 0.6], [0.02, 0.12, 0.15], [0.2, 1, 0.85], [0.003, 0.012, 0.015], [0.6, 1, 0.8]],
    look: [0, 0, 1, 0.6], look2: [0, 1, 1, 1],
    rows: [[0.2, 1.1, 0.8], [0.4, 0.6, 1.4], [0.9, 1.3, 0.4]],
    post: [0, 0.015, 0, 0],
  },
};
