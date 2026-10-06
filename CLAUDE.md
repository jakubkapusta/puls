# Puls — notes for agents

Browser game (phone portrait first; landscape and laptop show the board as a centred column): Breakout where every brick is a note and the song builds from how you play. Vite + TypeScript, raw WebGL2, no engine, no image/audio assets (everything procedural/synthesized). Design doc: `docs/PLAN.md` (Polish, the source of truth for milestones M0–M5). Deploy: GitHub Pages from `dist/` via `.github/workflows/pages.yml`; repo `git@github.com:jakubkapusta/puls.git`, game at https://jakubkapusta.github.io/puls/. Pattern projects: `~/code/fala`, `~/code/roj` — copy code from there, don't import it.

## Status (read first)

- **M0 + M1 built 2026-10-06, accepted by the owner after a phone test** the same day: flick-up swing is comfortable (better than tapping while dragging), the speed steering is not noticeable (fine), melodies from random bricks sound great, calibration / music fine. Changes asked for: the landing ring makes it too easy → **off by default** (stays as a test option); ball medium and fast are both good → **a player choice in the menu, fast pays +25 % points** (`SPEEDS` in `tuning.ts`, `BAL.score.speedMul`); the slow option is gone.
- **M2 (wow pass) built and seen by the owner 2026-10-06.** Feedback applied: the ball glowed too much (after a perfect hit it read as a big ball / comet — the swing flare of the paddle, the hit ring born small and thick, and a shockwave at radius 0 acting as a magnifying lens) → crisp ball, small halo, thin ribbon, thin ring born at r 34, weaker shock that is born as a ring, dimmer swing flare; **the floor must never move its shape** (waving grid lines were nauseating) — bass2 now only brightens the lines. 
- **M3, M4 and M5 built 2026-10-06** in one go at the owner's request ("easier to judge the feel with several songs"); the owner tests later and we tweak. Not done from the M5 list: more albums beyond Lo-fi (Chiptune, Techno, Ambient, Funk, D&B, Orkiestra).
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

## M3: special bricks, power-ups, tempo

- **Tempo map** (`src/music/tempo.ts`): song time ↔ 16th steps, piecewise constant. The game owns it (`game.tempo`); every tempo change starts on the first bar line ≥ `BAL.tempo.lead` s ahead so the sequencer (scheduling `latency + lookahead` ahead) hasn't played it yet. Everything converts through it: `plan()` grids, the sequencer (`stepT = start + tempo.timeAt(step)`, durations from `s16At`, the echo's delay time), `quantize()`, beat envelopes in `main.ts`, the HUD, `game.length` (song end follows the tempo). Never use `song.s16/beat/bar` for timing after the start.
- **Special bricks** (`specials` rows in the song, same shape as `rows`; normal bricks only): `A` chord (the bar's triad voiced under the brick's note, `chordAt`), `P` perc (+1 layer now, drum fill next bar), `R` arpeggiator (≤ `arpMax` neighbours broken one per 16th via `arpQueue`), `F` filter (master low-pass closes over a beat, opens over two; the picture dims, `u_dim`), `E` echo (`echoBalls` clones for `echoTime` s, more delay feedback), `M`/`m` metronome (×/÷ (1 + `tempo.step`), clamped), `D` drop (all of them → from the next safe bar line, `drop.bars` bars: every layer on, sub bass, crash, riser and snare roll before it, white-hot ball piercing `drop.pierce` per flight, score ×`drop.scoreMul`, camera hits on every kick).
- **Power-ups** (`power.*`): a broken plain brick drops a capsule with `chance` (after `after` bricks, one at a time, seeded RNG), caught by the paddle: `multi` (two extra balls; while one flies a lost main ball is replaced, event `saved`), `laser` (the paddle fires on every even 16th; the **sequencer** plays the staccato zap on the same steps so shot and sound coincide), `wide`, `magnet` (the ball sticks after the contact is judged; launch/flick releases it in the direction it would have gone, or by itself after `magnetHold`), `slow` (tempo × `slow` for `slowBars` from the next safe bar line, then back). Durations are in bars.
- Extra balls (`game.extras`) use the same wall/brick code (`walls()`, `collide()`) but no rhythm, heat or lives.
- UI: chips under the HUD for active power-ups (time left), the drop counter and a changed tempo (`fxItems` in `main.ts`); one-time tips the first time each special / power-up happens (`tip()`, stored in `puls.hints.v1` as `sp-*`, `pw-*`); "Jak grać" screen; the song's title card at the start.

## M4–M5: albums, progress, replay, daily, Jam

- **Albums** (`src/music/songs.ts`): Synthwave (5 songs, 96–112 BPM, 56–76 bars, 6–7 layers) and Lo-fi (3 songs, 76–84 BPM, swing 0.2). `SongDef` has `album`, `kit` ('synth' | 'lofi' — the sound and the look), `swing`, `hardHp` (per song), `bells` (the new `bells` layer: FM bells on chord tones). Hard-brick placement in songs 2–8 was generated by rule (middle rows first, mirrored pairs) so the hits needed ≈ 0.62 × song length; Nocna jazda is hand-made. Keep the chord/scale rule and put specials only on plain digits (a check script is easy: rows and specials 8 wide, special → digit).
- **Lo-fi kit** (`audio.ts`, `*L` voices): round kick, dusty snare, dull hats, shaker/rim for `perc`, sine bass (`bass2` walks in 8ths, not 16ths), Rhodes-like pad with tremolo, muted keys, breathy flute lead, soft-key bricks, vinyl hiss bed + random pops, master filter "open" at 7.5 kHz instead of 20 kHz (`this.open`). Swing delays odd 16ths in `schedule()`.
- **Lo-fi look** (`u_theme` in `BG_FS` and the composite, `paletteLofi` for `rowColor`): warm dusk, a city skyline with lit windows (flicker with the hats) instead of ridges, a soft unbanded sun, wet asphalt with window reflections, slanted rain, more grain, warm grade.
- **Progress** (`src/game/progress.ts`, `save.ts`): songs open in order inside an album; Lo-fi opens when the 3rd synthwave song is passed. Stars: ★ passed, ★★ everything broken, ★★★ everything broken with ≥ 60 % of contacts in rhythm (`RHYTHM_STAR`). Saved per song in `puls.meta.v1` (`songs[id].stars/best/passed/cleared/plays`), plus `daily`, `jamBest`, `lastSong`, `lastAlbum`. Old saves get stars from passed/cleared.
- **Song of the day**: `dailyPick(date)` — FNV of the date picks any song (locked ones too, as a taste) and a seed; the first attempt of the day counts (`meta.daily`), later ones are practice; "Jeszcze raz" keeps the seed.
- **Jam** (`new Game(JAM, seed, { endless: true })`): rows are generated (melodic random walk over the scale, gaps, hard and special bricks incl. Drop sets — drops repeat), `startRows`; on bar lines everything slides a row down (`slideT`, eased in the renderer) and a new row appears, every `pushBars` bars, one bar less every `faster` rows, down to `minBars`; the tempo rises by `tempoStep` every `tempoEvery` bars; the game ends when a brick passes `dangerY` (a red line glowing as they approach). An emptied board gives a bonus and the next row at once. `npm run sim -- --jam`.
- **"Twoja wersja"** (`Recording` in `audio.ts`): while a level plays, the sequencer records per 16th the layer count, groove and laser flags and the drop steps, and every brick note / accent / filter-dip / sweep / echo / riser at the time it really sounded (`note()`, `rec.fx`). `playReplay()` runs the same sequencer on a fake `SeqState` fed from the flags and schedules the recorded notes inside the lookahead window — so the take sounds exactly as played. End screen → "Posłuchaj swojej wersji" (`mode 'replay'`, progress bar, back to the end screen when done). The replay's visuals use `renderer.layersOverride` and the recorded tempo.
- **UI**: menu → "Graj" opens the song list (album tabs, stars, best, locks, BPM · length · layers), "Utwór dnia" and "Jam" cards in the menu, end screen with animated stars, "Dalej" (next unlocked song), "Jeszcze raz", "Posłuchaj swojej wersji", "Utwory".
- **Performance**: coarse-pointer devices with ≤ 4 cores start at render quality 0.8; quality drops after ~1.5 s under 45 fps and climbs back after ~15 s above 58 fps.

## Samples: candidates to replace Lo-fi (2026-10-06)

- Owner: "lo-fi doesn't convince me, it lacks character — give me samples of alternatives". The album **"Próbki"** (`lab: true` in `ALBUMS`; always open, outside progress, stars, the daily pick and `SONGS`) has one ~1-minute song per candidate, each with its own kit and theme: **Chiptune** "Pikselowy świt" (140 BPM: pulse waves via `createPeriodicWave`, chords as 32nd arpeggios, noise drums, coin bricks; fat-pixel post), **Techno** "Betonowa hala" (128: driven kick + rumble, metallic hats from detuned squares, 303-style acid bass, dub stabs into the echo; grey/red, kick strobe), **Funk / disco** "Kula disco" (112: slap bass, wah clavinet, brass stabs, string swells, vibraphone bricks; gold/purple, mirror-ball spots), **Drum & bass** "Nocny ekspres" (174: breakbeat with ghost snares, reese bass, wide pads, glassy plucks; teal night, speed streaks). In the song list each has a "Bot" button (a skill-0.92 bot plays, nothing is saved).
- **Kits**: `Kit` = synth | lofi | chip | techno | funk | dnb. A kit overrides voices through `voice()` (a table of bound methods: kick, snare, hat, clap, bass, pad, arp, lead, brick, bells); anything missing falls back to the synthwave voice. Lo-fi and D&B walk `bass2` in 8ths.
- **Themes** (`src/render/themes.ts`): per kit the background palette (`u_pal[5]`), look flags (`u_look`: city skyline + wet street, rain, banded sun, sun amount; `u_look2`: disco spots, speed streaks, grid amount, stars), brick row colours and post (`u_post`: warmth, grain, pixel size, kick strobe). A new album = a kit's voices + one theme entry.
- After the owner picks: move that kit into a real album (3–5 songs like the synthwave ones), drop or keep Lo-fi as they say, remove the samples album.

## Balance

`npm run sim` plays every song at skills 0.2 / 0.5 / 0.9 and prints pass / clear (clear time) / out of lives per cell; `--song id`, `--runs`, `--skill`, `--jam`; knobs without editing: `BAL='{"ball":{"speed":700}}' npm run sim`.

After M3 (bot only, 2026-10-06; hard bricks 4 hits, arp 4, power chance 8 %): skill 0.2 passes ~85 %, out of lives ~15 %, clears ~45 %; 0.5 passes ~98 %, clears ~63 % at ~108 s; 0.9 clears ~98 % at ~106 s of a 134 s song. The bot ignores capsules (catches ~1 per game by accident). Layers: first after 6–10 s, all six by ~45–70 s. The bot reads `landing` with a perception error, a reaction time and a finite hand speed — it is probably better than a human at catching; recalibrate after the owner's test (`puls.stats.v1`).

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
