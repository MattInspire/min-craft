# Dalek Can: Dog Rescue Run

A browser 3D obstacle-course game with Minecraft-style movement, procedural level generation, and escalating hazards.

## Gameplay

- You play as a Dalek-like watering can with funny legs and three arms.
- Reach the trapped dog at the end of each obstacle course.
- If you fall into lava or die, the run resets to the current level start.
- Completing a level generates a new, harder level automatically.

## Hazards and enemies

- Cats chase you on back legs and fire laser-eye shots.
- Moving pushers can knock you off platforms.
- Cursed pads reduce visibility/darken the world.
- Level 3+: arrow traps begin firing projectiles.
- Level 5+: wolves start hunting you too.

## Procedural generation rules

- Courses are generated from connected platforms with variable gaps and height changes.
- A jump feasibility rule constrains each segment so routes remain winnable.
- Difficulty scales by enemy count, trap count, enemy speed, and fire cadence.

## Run

```bash
python3 -m http.server 4173
```

Open http://localhost:4173.
