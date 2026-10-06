// Headless balance report: plays whole songs with the bot.
//   npm run sim                         every song, skills 0.2 / 0.5 / 0.9, summary table
//   npm run sim -- --song kaseta --runs 60 --skill 0.5     one song, details
//   npm run sim -- --jam                Jam (endless): how long the bot lasts
import { Game } from '../src/game/game';
import { BAL, mergeBal } from '../src/game/balance';
import { Bot } from '../src/sim/bot';
import { JAM, SONGS } from '../src/music/songs';
import type { Song } from '../src/music/song';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const runs = parseInt(arg('runs', '24'), 10);
const skills = arg('skill', '0.2,0.5,0.9').split(',').map(Number);
if (process.env.BAL) mergeBal(JSON.parse(process.env.BAL));

const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(0) + '%' : '-');
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function play(song: Song, skill: number, r: number, endless = false) {
  const g = new Game(song, 1000 + r, { endless });
  const bot = new Bot(skill, 77 + r * 13);
  while (g.phase !== 'over' && g.t < (endless ? 1800 : g.length + 10)) {
    bot.update(g, BAL.dt);
    g.step(BAL.dt);
    g.drain();
  }
  return g;
}

if (args.includes('--jam')) {
  console.log(`Jam, ${runs} runs per skill\nskill  time    rows  score   lost`);
  for (const skill of skills) {
    const gs = Array.from({ length: runs }, (_, r) => play(JAM, skill, r, true));
    console.log(`${skill.toFixed(2).padEnd(6)} ${avg(gs.map((g) => g.t)).toFixed(0).padStart(4)}s  ${avg(gs.map((g) => g.jamRows)).toFixed(0).padStart(4)}  ${avg(gs.map((g) => g.score)).toFixed(0).padStart(6)}  ${avg(gs.map((g) => g.stats.lost)).toFixed(1).padStart(4)}`);
  }
  process.exit(0);
}

const only = arg('song', '');
const list = only ? SONGS.filter((s) => s.id === only) : SONGS;
console.log(`${runs} runs per song and skill. Cells: pass / clear (clear time) / out of lives\n`);
console.log('song'.padEnd(20) + skills.map((s) => `skill ${s}`.padEnd(28)).join(''));
for (const song of list) {
  let line = `${song.title} (${Math.round(song.length)}s)`.padEnd(20);
  for (const skill of skills) {
    let pass = 0, clear = 0, out = 0;
    const ct: number[] = [];
    for (let r = 0; r < runs; r++) {
      const g = play(song, skill, r);
      if (g.passed) pass++;
      if (g.endReason === 'clear') {
        clear++;
        ct.push(g.stats.clearT);
      }
      if (g.endReason === 'lives') out++;
    }
    line += `${pct(pass, runs)} / ${pct(clear, runs)} (${ct.length ? avg(ct).toFixed(0) + 's' : '-'}) / ${pct(out, runs)}`.padEnd(28);
  }
  console.log(line);
}
