# Puls — notes for agents

Browser game (phone portrait first; landscape and laptop show the board as a centred column): Breakout where every brick is a note and the song builds from how you play. Vite + TypeScript, raw WebGL2, no engine, no image/audio assets (everything procedural/synthesized). Design doc: `docs/PLAN.md` (Polish, the source of truth for milestones M0–M5). Deploy: GitHub Pages from `dist/` via `.github/workflows/pages.yml`; repo `git@github.com:jakubkapusta/puls.git`, game at https://jakubkapusta.github.io/puls/. Pattern projects: `~/code/fala`, `~/code/roj` — copy code from there, don't import it.

## Status (read first)

- **M0 + M1 built 2026-10-06, accepted by the owner after a phone test** the same day: flick-up swing is comfortable (better than tapping while dragging), the speed steering is not noticeable (fine), melodies from random bricks sound great, calibration / music fine. Changes asked for: the landing ring makes it too easy → **off by default** (stays as a test option); ball medium and fast are both good → **a player choice in the menu, fast pays +25 % points** (`SPEEDS` in `tuning.ts`, `BAL.score.speedMul`); the slow option is gone.
- **M2 (wow pass) built and seen by the owner 2026-10-06.** Feedback applied: the ball glowed too much (after a perfect hit it read as a big ball / comet — the swing flare of the paddle, the hit ring born small and thick, and a shockwave at radius 0 acting as a magnifying lens) → crisp ball, small halo, thin ribbon, thin ring born at r 34, weaker shock that is born as a ring, dimmer swing flare; **the floor must never move its shape** (waving grid lines were nauseating) — bass2 now only brightens the lines. Next: M3.
- Owner decisions (2026-10-06): board always portrait (column in landscape); losing a ball costs a life + a music layer (3 lives, out of lives = level not passed); rhythm = **the ball is steered onto the beat + the player swings** (flick up / Space / click) at contact.
- Workflow like Fala: owner tests on a phone from GitHub Pages, gives feel feedback in Polish; iterate in small commits, push, say what changed and why. Numbers in `balance.ts` are first guesses tuned against the bot.
- Local preview: `~/code/.claude/launch.json` entries `puls` (dev, port 5199) and `puls-dist` (preview, 4199).

## Commands

```bash
npm run dev          # vite --host
npx tsc --noEmit     # typecheck after every change
npm run build        # typecheck + static build
npm run sim          # headless balance report (see "Balance")
npm run icons        # regenerate PWA icons (scripts/icons.mjs)
```

URL hash: `#debug` (fps, time, ball speed, planned beat, latency), `#bal={"ball":{"speed":700}}` (deep-merged over `BAL`, also turns on debug), `#auto=0.85` (a bot plays the level — screenshots).
Dev helper: `window.__puls` — `game`, `demo`, `audio`, `renderer`, `BAL`, `auto(0.8)` / `auto(null)`, `start()`. Freeze for a screenshot: `__puls.audio.ctx.suspend()` (the game runs on the audio clock).

## Time: the audio clock is the master

- `Audio.now()` = song time the player **hears**: `ctx.currentTime − start − latency()`, where `latency()` = reported `outputLatency` (or `baseLatency`) + `calib` (from the calibration screen, saved in `puls.meta.v1`). Smoothed against `performance.now()` because `currentTime` moves in chunks on some browsers; monotonic.
- `main.ts` steps the `Game` in fixed `BAL.dt` steps until `game.t` reaches `audio.now()`. So the game world is drawn at the time that is being heard; a contact planned for a beat is seen and heard together. Pause = `ctx.suspend()` (the clock stops).
- Input events carry `timeStamp`; `audio.heardAt(ms)` converts them, `game.swing(ts)` queues the swing until the sim reaches it.
- No Web Audio → the clock falls back to `performance.now()`.

## Code map

- `src/music/song.ts` — `SongDef`/`Song`: bpm, root, scale, chord loop (1 chord/bar), bars, intro, **brick rows** (top first, 8 columns: `'.'` empty, `'1'–'9'` scale step above the row's base, `'a'–'i'` hard brick), layer order, 16-step patterns (kick, snare, hat, perc, bass, arp), the lead hook (plays while "w rytmie"). `scaleNote(song, step)`.
- `src/music/songs.ts` — the songs. M1: `Nocna jazda` (A minor pentatonic over Am–Fmaj7–C–Gsus2, 100 BPM, 56 bars). Chords are chosen so no scale note clashes; keep that rule for new songs. Bottom rows short and normal, so the first layers come quickly.
- `src/game/balance.ts` — `BAL`: every rule number. `mergeBal`, `resetBal`. Field is 720×1280 world units, y up.
- `src/game/game.ts` — one level: paddle (`target` → `px`, swing lift), ball, bricks (normal / hard with `hp`, each hit a scale step higher), walls, lives, layers (`layers` = unlocked extra layers; +1 per cleared row, −1 per lost ball), heat (+1 per rhythm hit, −`coolCatch` per plain catch; at `pierce` the ball goes through `pierceMax` normal bricks per flight), multiplier, streak → `groove` ("w rytmie"), end: `clear` (finale on the next downbeat + 1 bar) / `song` (pass if `passFrac` of bricks) / `lives`. Emits `GameEvent`s; no audio or rendering inside.
  - **Ball in rhythm** (`plan()` / `steer()`): when the ball heads down and `tracePath()` (with side-wall reflections) finds no brick in the way, it picks the grid time (beat, else 8th, else 16th — `BAL.sync.mode`) reachable within `sync.min..max` × base speed and closest to the current speed, then steers the speed so the ball crosses the paddle line exactly then. While blocked it retries every few steps. `landing` (x, t, synced) is what the renderer's closing ring and the bot read.
  - **Swing judging**: against the planned beat (`ref`), not the contact (a swing lifts the paddle into the ball a little early). Early swing ≤ `hit.good` before → judged at contact; contact first → `pending` for `hit.late`, a later swing upgrades it; otherwise a plain catch. The paddle-contact test uses the previous paddle top too (the swing moves the paddle into the ball — without it the ball tunnelled through).
- `src/game/input.ts` — touch is relative (finger anywhere moves the paddle by its own movement × `touchGain`); flick up = swing (`flickSpeed` css px/s); short tap = launch/swing; `swingMode 'tap'` = every touch-down swings. Mouse absolute, click = action. Arrows / A D move, Space / ↑ / W act, Esc / P pause.
- `src/game/tuning.ts` — `SPEEDS` (player choice: medium / fast +25 % points, saved as `meta.speed`) and the **test options** in the menu ("Ustawienia testowe"): swing window, ball-in-rhythm mode, touch swing mode, landing ring (default off). Defaults must equal `balance.ts`. Saved in `puls.meta.v1` (`test`) and logged per play in `puls.stats.v1`.
- `src/game/save.ts` — `puls.meta.v1` (sound, calib, test, per-song best/passed/cleared), `puls.stats.v1` (every play), `puls.hints.v1`; all storage in try/catch.
- `src/audio/audio.ts` — clock (above), lookahead sequencer (`schedule()` every 20 ms, 120 ms ahead; `step()` per 16th: kick + bass always, unlocked layers, fills every 8th bar, lead while groove, ending at `bars`, finale after `clear`), sidechain pump on bass/pad, master low-pass (intro opening, dip on a lost ball), reverb (generated IR) and dotted-8th delay sends, analyser. Brick notes and accents are **quantized** to the next 16th (`quantize()`; a grid point that passed less than `GRACE` ago plays at once). `noteTimes` tells the renderer when each brick's note really sounds. Calibration: `clicks()` + `tapCtx()`.
- `src/render/renderer.ts` + `shaders.ts` — **background** (`BG_FS`): sky, banded sun, two ridges with neon rims, perspective grid (`fwidth` lines) with the sun's reflection; it grows with the unlocked layers (`u_layA`/`u_layB`, eased in the renderer): hat → stars twinkle, snare → sky flashes, pad → aurora ribbons, arp → laser fan (the beam of the current 16th lit), bass2 → the floor lines glow with the bass (never move the floor: owner), perc → a mirrored spectrum skyline from `u_spec` (32-bin R8 texture filled in `main.ts` from the analyser, faked from drum envelopes in the menu demo). **Shapes**: instanced SDF quads, 16 floats each (box, params, colour, ext = rotation / triangle flip / additive); `kind` 0 glow box/capsule/circle, 1 glass brick (dark body, rim, inner glow, bevel, sweeping glint), 2 ring, 3 hard brick (frame, rivets, cracks as hp drops), 4 glass shard (right triangle). Breaking a brick → 16 glass shards blown away from the impact + spark streaks; ball → ribbon of capsules + heat-coloured halo + pierce aura + sparks when hot; row cleared → a light bar sweeps the row; note pulses ring a brick when its quantized note really sounds. **Composite**: camera breathing on the kick (`u_zoom`), shake, 4 shockwaves, CA, glitch slices + red tint on a lost ball, flash, ACES, scanlines, grain. Finale (`clear`): fireworks over the last bar. **Freeze frame**: `main.ts` stops the sim for `FREEZE_MS` on a perfect hit and catches up at ≤1.6× (snaps if > 0.3 s behind).
- `src/ui/ui.ts` + `src/style.css` — DOM HUD (score, multiplier, lives, layer pips, song progress, "w rytmie", pops, hints, debug), screens: menu (with test chips), pause, end, calibration.
- `src/sim/bot.ts` + `scripts/sim.ts` — player model and report. The menu also runs a silent bot game behind the overlay.

## Balance

`npm run sim [-- --runs 40 --skill 0.2,0.5,0.9]`, knobs without editing: `BAL='{"ball":{"speed":700}}' npm run sim`. Prints pass / clear / lives-out, bricks %, clear time, lost balls, rhythm-hit %, perfect %, contacts on the 16th grid (should be 100%), plan diagnostics.

First-pass numbers (bot only, 2026-10-06): skill 0.2 passes ~65 %, out of lives ~35 %; 0.5 always passes, clears ~55 % at ~115 s; 0.9 clears ~93 % at ~95 s of a 134 s song. Layers: first after 6–10 s, all six by ~45–70 s. The bot reads `landing` with a perception error, a reaction time and a finite hand speed — it is probably better than a human at catching; recalibrate after the owner's test (`puls.stats.v1`).

## Rules that bite

- Colors in shaders are **linear**; the composite tone-maps and applies gamma. `safe()` scrubs HDR inputs; `box()` drops non-finite shapes.
- GLSL `pow(x, y)` with `x < 0` is NaN on Mali/Adreno.
- Grid lines need `fwidth` (screen-space width) or the near floor turns into a grey smear.
- Keep bloom modest: five levels add up; sources above ~1.1 bloom.
- A glow must reach zero before its quad's edge (the shape shader fades it out by 4.4 radii; the quad is 4.5 radii wider) — otherwise every glowing thing shows a hazy rectangle.
- Don't use `smoothstep` with edge0 > edge1 for new code (undefined in GLSL); the fill uses `clamp(.5 - d / (2 * aa))`.
- Use the seeded RNG (`game.rng`), never `Math.random()`, in game logic (the audio IR/noise buffers may use it).
- Hidden screens must not catch taps: `.screen` uses `visibility: hidden` when not `.show`.
- Never schedule Web Audio events in the past and keep automation per param in time order (the sidechain pump relies on it).
- Player-facing text Polish; code, comments and names English; commit messages Polish.
- After `git push` don't wait for / poll GitHub Actions.

## Verifying

Typecheck, `npm run sim`, build, then look at it at 375×812 and 812×375 with `#auto=0.85&debug`. Start the game with a real click on "Graj" (the AudioContext needs a gesture; without it the clock falls back to `performance.now()` only when there is no Web Audio at all).
