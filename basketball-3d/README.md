# Basketball 3D

A from-scratch 3D basketball game for the browser: TypeScript + Three.js +
Rapier3D (WASM) physics + Vite. No copyrighted NBA 2K assets, logos, player
likenesses, or audio are used — all geometry is procedural placeholder art.

## Run it

```
npm install
npm run dev
```

Then open the printed `http://localhost:.../` URL. `npm run build` produces
a production bundle in `dist/`; `npm run typecheck` runs strict TypeScript
checks alone.

## Controls (Phase 1)

- `WASD` / arrow keys — move
- `Shift` — sprint
- `F1` — debug overlay (FPS, physics step, player transform, ball velocity,
  body/collider counts)

## Status: Phase 1 complete

Regulation-dimension 3D court (`src/basketball/CourtDimensions.ts` is the
single source of truth for every measurement), a real physics floor, two
full hoop assemblies (rim as an actual trimesh collider baked from the
rendered torus geometry, a collidable glass-look backboard, a cosmetic net,
and support structure), a physics-driven basketball (dynamic rigid body,
CCD-enabled so hard shots can't tunnel through the rim), a procedural
placeholder player with a kinematic character controller for movement, and
a smoothly-damped third-person camera. Physics runs at a fixed 60Hz
timestep decoupled from the render loop (`src/core/Time.ts` /
`GameLoop.ts`), so simulation results don't change with frame rate.

Verified: `npm run typecheck`, `npm run build`, and both the dev server and
a production `vite preview` were exercised in a real headless browser with
console-error checking and movement/camera/physics screenshots.

## Architecture

```
src/
  core/        Game orchestration, fixed-timestep loop, input
  physics/     Rapier world setup, materials, collision layers
  basketball/  Court, Ball, Hoop, Backboard, Net, CourtDimensions
  player/      Player (visual + physics body), movement, controller
  camera/      Third-person CameraController
  utils/       Small math helpers
```

Not yet implemented (later phases, per the project's staged plan): real
dribble/pass/shoot systems and ball-hand IK, basketball rules (scoring,
violations, fouls), player animation, AI/defense, game-mode UI, and the
performance/mobile optimization pass. Each phase is meant to land and be
verified in-browser before the next one starts.
