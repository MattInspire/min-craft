# Dalek Can: Dog Rescue Run

A browser 3D obstacle-course game with procedural level generation and escalating hazards.

## Gameplay

- Controls: **Arrow keys** move/turn, **Space** jumps.
- Camera is automatic and follows behind from a wider, pulled-back perspective.
- Pick your character before starting:
  - Boy 1 / Boy 2: ugly + strong (more health)
  - Girl 1 / Girl 2: cute + quick (faster movement)
- Rescue the dog at the end of each generated course.
- Courses regenerate and get harder every level.

## Hazards and enemies

- Laser-eye cats chase and shoot at you.
- Moving pushers can knock you off.
- Curse pads darken/reduce visibility.
- Level 3+: arrow traps fire projectiles.
- Level 5+: wolves start attacking.
- Falling in lava resets the run at current level.

## Generation rules

- Platforms are procedurally connected with variable gaps/heights.
- Jump feasibility checks constrain segments to remain winnable.
- Difficulty scales by level (enemy count, speed, and trap pressure).

## Run

```bash
python3 -m http.server 4173
```

Open http://localhost:4173.
