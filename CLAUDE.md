# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vanilla-JS Tetris (HTML5 Canvas). Three files: `index.html`, `style.css`, `game.js`. No `package.json`, no bundler, no transpiler, no test/lint tooling — do not introduce any without being asked.

## Running

```bash
open index.html              # macOS; the file:// path works, there are no module imports
python3 -m http.server 8000  # or any static server, then http://localhost:8000
```

Verification is manual in a browser: there is no test suite and nothing to build.

## Architecture

All game state lives in module-level `let` bindings in `game.js` (`board`, `current`, `next`, `score`, `lines`, `level`, `paused`, `gameOver`, `dropInterval`, `dropAccum`, `animId`, `pendingSingle`, `comboCount`, `b2bActive`, `lastMoveWasRotation`). `init()` resets every one of them — plus the FX buffers via `resetFX()` — and is also the restart handler, so any new piece of state must be reset there or it leaks across games. `theme` and `soundOn` are the deliberate exceptions: they are UI preferences persisted in `localStorage`, not game state.

- **Board**: `ROWS × COLS` array of ints. `0` = empty; `1–12` index into both `COLORS` and `PIECES`, so those two arrays must stay index-aligned (both start with a `null` placeholder at index 0).
- **Pieces**: square-ish matrices rotated by transpose+row-reverse (`rotateCW`). There is no SRS kick table — `tryRotate` just tries x-offsets `[0,-1,1,-2,2]` and gives up. `1–7` are the classic tetrominoes; `8–12` are non-standard (cross/U/Y pentominoes, 1x1, hollow 3x3 donut). `+`, donut and 1x1 are rotation-invariant, so `tryRotate` is a visual no-op for them.
- **Spawn pool**: `randomPiece()` draws from `RARE_TYPES` with probability `RARE_CHANCE` (0.12) and from `STANDARD_TYPES` otherwise; both build via `makePiece(type)`. `SINGLE_TYPE` (1x1) is *not* in either pool — `resolveClear()` sets `pendingSingle` on a 4-line clear and `spawn()` consumes it to force the 1x1 into `next`.
- **Collision**: `collide(shape, ox, oy)` is the single gate for every movement, rotation, ghost projection, and the spawn-time game-over check. It reads the global `board`.
- **Loop**: `requestAnimationFrame` accumulator in `loop()`. Gravity fires when `dropAccum >= dropInterval`; `updateFX(dt)` + drawing happen every frame. Speed: `dropInterval = max(100, 1000 - (level-1)*90)`, level rises every 10 lines, both recomputed inside `resolveClear()`.
- **Rendering**: full clear + redraw each frame in draw order grid → locked board → ghost (`alpha 0.2`) → current piece → `drawFX()`. Everything is wrapped in `save()`/`translate(shakeX, shakeY)`/`restore()` so the screen shake moves the whole board. `drawNext()` is *not* on the frame loop; it is called only from `spawn()`.

### Scoring pipeline

`lockPiece()` is the whole sequence: `detectTSpin()` (must run *before* `merge()`, so it reads the board without the piece) → `merge()` → `clearLines()` → `resolveClear()` → `spawn()`.

- `clearLines()` only deletes rows and returns `{ cleared, rows }`, with each row's cells captured *before* the splice — the particles need those colors and the splice would lose them.
- `resolveClear()` is the single place that mutates `score`, `lines`, `level`, `dropInterval`, `pendingSingle`, `comboCount`, `b2bActive`, and fires FX + audio. Order matters: B2B (×1.5, on Tetris or any line-clearing T-Spin) applies before the combo multiplier, then the flat `combo × 50 × level` bonus and the `2000 × level` Perfect Clear bonus are added, then `Math.floor`.
- **T-Spin**: `lastMoveWasRotation` is the gate. Only `tryRotate()` sets it true; every translation (left/right, soft drop, gravity, a hard drop that actually moves) sets it false, and `spawn()` clears it. **Any new movement code path must maintain it** or T-Spins silently start firing on plain drops. Detection is the 3-corner rule around the T matrix's `[1][1]` center, which `rotateCW` keeps in place; cells above the ceiling (`y < 0`) deliberately do *not* count as blocked.

### Canvas sizing is duplicated

`COLS`, `ROWS`, `BLOCK` in `game.js` and the `width`/`height` attributes of `<canvas id="board">` in `index.html` must be changed together (`COLS*BLOCK` × `ROWS*BLOCK`). Same for `drawNext`'s hardcoded `NB = 30` against `#next-canvas` (120×120): it centres the filled-cell bounding box in `nextCanvas.width / NB` cells, so the canvas must stay at least as wide as the widest piece (4 cells, the `I`).

### rAF lifecycle

`endGame()` and `togglePause()` call `cancelAnimationFrame(animId)`, but that cancel is *not* what stops the loop when game-over is reached from inside `loop()` (gravity → `lockPiece` → `spawn` → `endGame`): there `animId` is the frame already firing, so the cancel is a no-op. The actual stop is the `if (gameOver || paused) return;` guard in `loop()`, placed after `draw()` (so the final state still renders) and before the reschedule, because `lockPiece()` can flip the flag mid-frame. Any new code path that ends or suspends the game must set one of those flags — cancelling `animId` alone is not enough. `init()` also cancels before starting, to avoid duplicated rAF chains.

### FX and audio

Both live in `game.js`, in their own commented sections.

- **FX**: `popups`, `particles` and `shake` are `const` buffers (emptied with `length = 0` in `resetFX()`, never reassigned). They advance in `updateFX(dt)` — driven by the loop's `dt`, clamped to `MAX_DT` so a tab switch doesn't teleport them — and render in `drawFX()`, which takes no `dt` so `applyTheme()` can still call `draw()` outside the loop. Because the loop returns after `draw()` when paused or game-over, the effects freeze on their own. `particles` is capped at `MAX_PARTICLES`.
- **Audio**: pure Web Audio, no files. The `AudioContext` *must* be created inside a user gesture (autoplay policy), so `ensureAudio()` is lazy and is called from the `keydown` and click handlers. `tone()` disconnects its nodes in `onended` — without that, a game accumulates hundreds of orphan nodes. Muting sets `masterGain.gain` to 0 rather than tearing the context down.

## Conventions

- `'use strict'` at the top of `game.js`; ES6+ syntax, no modules — `index.html` loads the script with a plain `<script src>` tag.
- User-facing strings (overlay text, README, HTML copy) are **Spanish**; identifiers and comments in code are English/Spanish-mixed. Keep new UI text in Spanish.
- HUD updates are explicit: call `updateHUD()` after mutating `score`, `lines`, `level`, `comboCount` or `b2bActive`.
- Styling is plain CSS. The palette is a set of custom properties declared on `body` and overridden wholesale in `body.light` (accent `#7aa2f7`, background `#0f0f17` in dark) — add new colors as variables in *both* blocks, never as one-off literals. The exception is `FX_COLORS` in `game.js`: canvas popups are painted over the board and stay the same in both themes.
