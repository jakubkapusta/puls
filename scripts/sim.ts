// Headless balance report: plays whole songs with the bot. `npm run sim -- --runs 60 --skill 0.5`
import { Game } from '../src/game/game';
import { BAL, mergeBal } from '../src/game/balance';
import { Bot } from '../src/sim/bot';
import { SONGS } from '../src/music/songs';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const runs = parseInt(arg('runs', '40'), 10);
const skills = arg('skill', '0.2,0.5,0.9').split(',').map(Number);
const song = SONGS.find((s) => s.id === arg('song', SONGS[0].id)) ?? SONGS[0];
if (process.env.BAL) mergeBal(JSON.parse(process.env.BAL));

const diag = { blocked: 0, none: 0, grid: [0, 0, 0], unsynced: 0, contacts: 0, powers: 0, specials: 0, saved: 0, drops: 0, games: 0 };
const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(0) + '%' : '-');
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

console.log(`${song.title}: ${song.bpm} BPM, ${song.bars} bars (${song.length.toFixed(0)} s), ${runs} runs per skill\n`);
console.log('skill  pass  clear  lives-out  bricks  clear@   lost  rhythm  perfect  onGrid  firstLoss');
for (const skill of skills) {
  let pass = 0, clear = 0, livesOut = 0;
  const bricks: number[] = [], clearT: number[] = [], lost: number[] = [], rhythm: number[] = [], perfect: number[] = [], grid: number[] = [], firstLoss: number[] = [];
  for (let r = 0; r < runs; r++) {
    const g = new Game(song, 1000 + r);
    const bot = new Bot(skill, 77 + r * 13);
    let fl = -1;
    while (g.phase !== 'over' && g.t < g.length + 10) {
      bot.update(g, BAL.dt);
      g.step(BAL.dt);
      for (const e of g.drain()) if (e.type === 'lost' && fl < 0) fl = g.t;
    }
    diag.blocked += g.stats.planBlocked;
    diag.none += g.stats.planNone;
    diag.unsynced += g.stats.unsyncedContacts;
    diag.powers += g.stats.powers;
    diag.specials += g.stats.specials;
    diag.saved += g.stats.saved;
    diag.drops += g.stats.drops;
    diag.games++;
    diag.contacts += g.stats.contacts;
    g.stats.planGrid.forEach((v, i) => (diag.grid[i] += v));
    if (g.passed) pass++;
    if (g.endReason === 'clear') {
      clear++;
      clearT.push(g.stats.clearT);
    }
    if (g.endReason === 'lives') livesOut++;
    if (fl >= 0) firstLoss.push(fl);
    bricks.push(1 - g.alive / g.total);
    lost.push(g.stats.lost);
    const c = g.stats.contacts;
    rhythm.push(c ? (g.stats.perfect + g.stats.good) / c : 0);
    perfect.push(c ? g.stats.perfect / c : 0);
    grid.push(c ? g.stats.onGrid / c : 0);
  }
  console.log(
    `${skill.toFixed(2).padEnd(6)} ${pct(pass, runs).padStart(4)}  ${pct(clear, runs).padStart(5)}  ${pct(livesOut, runs).padStart(9)}  ` +
    `${(avg(bricks) * 100).toFixed(0).padStart(5)}%  ${(clearT.length ? avg(clearT).toFixed(0) + 's' : '-').padStart(6)}  ${avg(lost).toFixed(1).padStart(5)}  ` +
    `${(avg(rhythm) * 100).toFixed(0).padStart(5)}%  ${(avg(perfect) * 100).toFixed(0).padStart(6)}%  ${(avg(grid) * 100).toFixed(0).padStart(5)}%  ` +
    `${(firstLoss.length ? avg(firstLoss).toFixed(0) + 's' : '-').padStart(8)}`,
  );
}
const tot = diag.blocked + diag.none + diag.grid.reduce((a, b) => a + b, 0);
console.log(`\nplans: blocked ${pct(diag.blocked, tot)}, no grid in range ${pct(diag.none, tot)}, beat ${pct(diag.grid[0], tot)}, 8th ${pct(diag.grid[1], tot)}, 16th ${pct(diag.grid[2], tot)}`);
console.log(`contacts without a planned beat: ${pct(diag.unsynced, diag.contacts)}`);
console.log(`per game: power-ups caught ${(diag.powers / diag.games).toFixed(1)}, specials ${(diag.specials / diag.games).toFixed(1)}, balls saved by multiball ${(diag.saved / diag.games).toFixed(2)}, drops ${pct(diag.drops, diag.games)}`);
