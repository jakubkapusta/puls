// Every number the rules read. Don't hardcode numbers in game.ts — add a knob here.
// `#bal={"ball":{"speed":800}}` in the URL deep-merges over these (see main.ts).

export const FIELD_W = 720;
export const FIELD_H = 1280;

export const BAL = {
  field: {
    /** top of the brick area (below the HUD strip) */
    bricksTop: 1130,
    rowPitch: 42,
    brickH: 33,
    colPitch: 88,
    brickW: 80,
  },
  paddle: {
    y: 170,
    w: 140,
    h: 22,
    /** max bounce angle from vertical at the paddle's edge (degrees) */
    maxAngle: 62,
    /** smoothing of the paddle towards its target (per second) */
    follow: 40,
    /** finger movement → paddle movement on touch (relative control) */
    touchGain: 1.25,
    /** keyboard speed, units/s */
    keySpeed: 1100,
    /** the swing: how high the paddle kicks up and how long it takes to come back */
    swingLift: 26,
    swingTime: 0.16,
    /** minimum time between swings */
    swingCooldown: 0.12,
  },
  ball: {
    r: 13,
    /** base speed, units/s */
    speed: 800,
    /** speed gained per heat step */
    heatSpeed: 0.035,
    /** never flatter than this from horizontal (degrees) */
    minAngle: 18,
    /** on the paddle before launch, auto launch after this many seconds */
    autoLaunch: 6,
  },
  sync: {
    /** 0 = off, 1 = 8ths only, 2 = quarter beats, 8ths as fallback */
    mode: 2,
    /** allowed speed range while steering the arrival onto the grid (× current base speed) */
    min: 0.8,
    max: 1.28,
    /** how fast the speed settles onto the planned value (per second) */
    settle: 10,
  },
  hit: {
    /** swing vs. contact, seconds: perfect / good */
    perfect: 0.06,
    good: 0.13,
    /** a swing this long after a contact still upgrades it */
    late: 0.1,
    /** consecutive rhythm hits for the "w rytmie" state */
    grooveStreak: 4,
    multMax: 8,
  },
  heat: {
    max: 4,
    /** heat at which the ball pierces normal bricks, and how many per flight (paddle to paddle) */
    pierce: 4,
    pierceMax: 1,
    /** heat lost by a plain catch (no swing) */
    coolCatch: 1,
  },
  hard: {
    /** hits a hard brick takes; each one sounds a scale step higher */
    hp: 4,
  },
  score: {
    /** every score × this (the fast ball pays more) */
    speedMul: 1,
    brick: 100,
    hardHit: 40,
    perfect: 150,
    good: 60,
    /** brick score × (1 + heat × this) */
    heatBrick: 0.25,
    lifeLeft: 1000,
    /** per bar left when every brick is down */
    barLeft: 200,
  },
  special: {
    /** neighbours an arpeggiator brick breaks, one per 16th */
    arpMax: 4,
    /** echo clones: how many, for how long (s) */
    echoBalls: 2,
    echoTime: 5,
  },
  tempo: {
    /** a Metronom brick changes the tempo by this fraction, within min..max of the song's own */
    step: 0.1,
    min: 0.8,
    max: 1.3,
    /** tempo changes start on the first bar line at least this far ahead (s): the audio must not
     *  have scheduled it yet (lookahead + output latency) */
    lead: 0.6,
  },
  drop: {
    /** bars the drop lasts; score multiplier while it does */
    bars: 4,
    scoreMul: 2,
    /** bricks the white-hot ball goes through per flight while the drop lasts */
    pierce: 3,
  },
  power: {
    /** chance a broken brick drops a power-up (only one falls at a time) */
    chance: 0.08,
    /** no power-ups until this many bricks are down */
    after: 4,
    fall: 260,
    /** durations in bars */
    laserBars: 4,
    wideBars: 8,
    magnetBars: 8,
    slowBars: 4,
    wide: 1.45,
    slow: 0.82,
    multiBalls: 2,
    laserSpeed: 1800,
    /** a ball held by the magnet goes by itself after this many seconds */
    magnetHold: 1.2,
  },
  lives: 3,
  /** fraction of bricks needed to pass when the song ends */
  passFrac: 0.6,
  /** a ball that hasn't touched the paddle this long gets nudged off a horizontal loop */
  loopNudge: 7,
  /** simulation step (s) */
  dt: 1 / 240,
};

export type Bal = typeof BAL;

const DEFAULTS: Bal = JSON.parse(JSON.stringify(BAL));

type Deep = { [k: string]: unknown };
export function mergeBal(over: Deep, into: Deep = BAL as unknown as Deep) {
  for (const k of Object.keys(over)) {
    const v = over[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof into[k] === 'object') mergeBal(v as Deep, into[k] as Deep);
    else if (k in into) into[k] = v;
  }
}

export function resetBal() {
  mergeBal(JSON.parse(JSON.stringify(DEFAULTS)));
}
