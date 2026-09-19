# HoopMaster — 2D Basketball

A dependency-free HTML5 Canvas basketball game inspired by NBA 2K's
shot-meter and dribble-move systems. Just open `index.html` in a browser
(or serve the folder with any static file server) — no build step needed.

## Controls

- **Move**: `←` `→` or `A` `D`
- **Shoot**: hold `Space` to charge the shot meter, release inside the
  green zone for a swish, or a touch too strong (blue zone) for a bank
  shot off the backboard.
- **Dribble moves**:
  - `Q` — Crossover
  - `W` — Hesitation
  - `E` — Step-back
  - `R` — In-and-out
  - `F` — Between the legs (legs-through)

## How it works

- The rim (two collision posts), backboard, and net are real physics
  objects — the ball bounces off the rim, banks off the backboard, and
  gets drag/funneled by the net, all via collision physics in
  `js/physics.js`.
- `js/shot.js` turns the shot-meter release value into a real launch
  velocity using projectile-motion targeting (numerically solved against
  the game's own stepped physics, self-calibrated to your monitor's
  refresh rate) rather than scripting makes/misses — the outcome always
  emerges from the actual simulated flight and collisions.
- Each dribble move in `js/dribbleMoves.js` is a short keyframed
  animation curve that drives the ball's hand offset, bounce rhythm, and
  the player's move speed, then hands control back to the normal dribble
  loop in `js/player.js`.
