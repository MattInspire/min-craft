import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#7fb7ff");
scene.fog = new THREE.Fog("#7fb7ff", 80, 240);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
const statusEl = document.getElementById("status");
const overlayEl = document.getElementById("overlay");
const curseFxEl = document.getElementById("curseFx");

const world = {
  level: 1,
  gravity: 34,
  jumpV: 15.5,
  maxJumpGap: 6.6,
  lavaY: -14,
  tileSize: 4,
  speedScale: 1,
  curseTimer: 0,
  catShootCd: 0,
  rngSeed: Math.random() * 1e6,
};

const player = {
  pos: new THREE.Vector3(0, 8, 0),
  vel: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  grounded: false,
  health: 100,
  maxHealth: 100,
  respawns: 0,
};

const input = {};
let started = false;

const courseGroup = new THREE.Group();
const hazardGroup = new THREE.Group();
const actorGroup = new THREE.Group();
scene.add(courseGroup, hazardGroup, actorGroup);

const colliders = []; // AABB boxes
const courseNodes = []; // platform centers
const movingPlatforms = [];
const curseZones = [];
const arrowTraps = [];
const enemyProjectiles = [];
const enemies = [];
let dog = null;
let playerMesh = null;

initLights();
initLava();
playerMesh = createDalekCan();
actorGroup.add(playerMesh);
buildLevel(1);

overlayEl.addEventListener("click", () => renderer.domElement.requestPointerLock());

document.addEventListener("pointerlockchange", () => {
  started = document.pointerLockElement === renderer.domElement;
  overlayEl.classList.toggle("hidden", started);
});

document.addEventListener("keydown", (e) => (input[e.code] = true));
document.addEventListener("keyup", (e) => (input[e.code] = false));

document.addEventListener("mousemove", (e) => {
  if (!started) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch -= e.movementY * 0.0018;
  player.pitch = THREE.MathUtils.clamp(player.pitch, -1.35, 1.2);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
loop();

function loop() {
  const dt = Math.min(clock.getDelta(), 0.033);
  if (started) {
    tickPlayer(dt);
    tickMovingPlatforms(dt);
    tickEnemies(dt);
    tickProjectiles(dt);
    tickArrowTraps(dt);
    tickCurse(dt);
    checkLevelProgress();
    updateCamera();
    updateUI();
  }

  animateDalek(clock.elapsedTime);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

function buildLevel(level) {
  world.level = level;
  world.speedScale = 1 + (level - 1) * 0.16;
  world.catShootCd = Math.max(1.5, 2.8 - level * 0.16);
  world.rngSeed = Math.random() * 1e6;
  clearGroups();

  const rng = mulberry32(Math.floor(world.rngSeed));
  const width = world.tileSize;
  const platformCount = 16 + Math.min(20, level * 2);
  const maxGap = Math.min(world.maxJumpGap, 4.2 + level * 0.12);
  let pos = new THREE.Vector3(0, 2, 0);
  let heading = new THREE.Vector3(0, 0, 1);

  for (let i = 0; i < platformCount; i++) {
    const box = new THREE.Vector3(width + rng() * 2.2, 1.4 + rng() * 0.9, width + rng() * 2.2);
    addPlatform(pos.clone(), box, "#6faa52");
    courseNodes.push(pos.clone());

    if (i > 2 && rng() > 0.73) addCurseZone(pos.clone(), box);
    if (i > 3 && rng() > 0.79) addMovingPusher(pos.clone(), box, rng);

    const yaw = (rng() - 0.5) * 0.8;
    heading.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).normalize();
    const gap = 2 + rng() * maxGap;
    const dy = (rng() - 0.5) * Math.min(2.2, 0.5 + level * 0.1);

    const next = pos.clone().addScaledVector(heading, box.z * 0.45 + gap + width * 0.45);
    next.y = THREE.MathUtils.clamp(pos.y + dy, 1, 8);

    // Enforce jumpability
    if (!isJumpable(pos, next, gap)) {
      next.copy(pos).addScaledVector(heading, box.z * 0.45 + (1.8 + maxGap * 0.55) + width * 0.45);
      next.y = THREE.MathUtils.clamp(pos.y + Math.sign(dy) * 0.8, 1, 6);
    }
    pos = next;
  }

  // Finish platform and dog
  addPlatform(pos.clone(), new THREE.Vector3(7, 1.5, 7), "#9ac16f");
  dog = createDog();
  dog.position.copy(pos).add(new THREE.Vector3(0, 1.5, 0));
  actorGroup.add(dog);

  // Enemies by level
  spawnCats(Math.min(3 + level, 10), rng);
  if (level >= 3) spawnArrowTraps(Math.min(2 + level, 9), rng);
  if (level >= 5) spawnWolves(Math.min(1 + Math.floor(level / 2), 6), rng);

  // Reset player at start
  player.pos.copy(courseNodes[0]).add(new THREE.Vector3(0, 3.1, 0));
  player.vel.set(0, 0, 0);
  player.health = player.maxHealth;
}

function isJumpable(a, b, gap) {
  const dxz = new THREE.Vector2(b.x - a.x, b.z - a.z).length();
  const dy = b.y - a.y;
  const t = dxz / 10.5; // approx sprint horizontal speed
  const yReach = world.jumpV * t - 0.5 * world.gravity * t * t;
  return gap <= world.maxJumpGap && dy <= 2.6 && yReach > dy - 0.6;
}

function addPlatform(center, size, color) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat);
  mesh.position.copy(center);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  courseGroup.add(mesh);

  colliders.push({
    min: new THREE.Vector3(center.x - size.x / 2, center.y - size.y / 2, center.z - size.z / 2),
    max: new THREE.Vector3(center.x + size.x / 2, center.y + size.y / 2, center.z + size.z / 2),
    movingRef: null,
  });
}

function addCurseZone(center, size) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.x * 0.7, 0.4, size.z * 0.7),
    new THREE.MeshStandardMaterial({ color: "#4f1d69", emissive: "#250a3c", emissiveIntensity: 0.6 }),
  );
  mesh.position.copy(center).add(new THREE.Vector3(0, size.y * 0.52 + 0.22, 0));
  hazardGroup.add(mesh);
  curseZones.push({ mesh, radius: Math.max(size.x, size.z) * 0.36 });
}

function addMovingPusher(center, size, rng) {
  const pusher = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1.4, Math.max(2.2, size.z * 0.5)),
    new THREE.MeshStandardMaterial({ color: "#d6b35a", roughness: 0.7 }),
  );
  pusher.position.copy(center).add(new THREE.Vector3(0, size.y * 0.6 + 0.7, 0));
  pusher.castShadow = true;
  hazardGroup.add(pusher);
  movingPlatforms.push({
    mesh: pusher,
    base: pusher.position.clone(),
    amp: 1 + rng() * 1.4,
    speed: (1.2 + rng() * 1.4) * world.speedScale,
    axis: rng() > 0.5 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1),
  });
}

function spawnCats(count, rng) {
  for (let i = 2; i < courseNodes.length - 2 && enemies.length < count; i += Math.max(2, Math.floor(rng() * 4) + 1)) {
    const cat = createCatEnemy();
    cat.group.position.copy(courseNodes[i]).add(new THREE.Vector3(0, 1.25, 0));
    actorGroup.add(cat.group);
    enemies.push(cat);
  }
}

function spawnWolves(count, rng) {
  for (let i = 3; i < courseNodes.length - 2 && count > 0; i += 4) {
    if (rng() < 0.55) continue;
    const wolf = createWolfEnemy();
    wolf.group.position.copy(courseNodes[i]).add(new THREE.Vector3(0, 1.1, 0));
    actorGroup.add(wolf.group);
    enemies.push(wolf);
    count -= 1;
  }
}

function spawnArrowTraps(count, rng) {
  for (let i = 2; i < courseNodes.length - 2 && arrowTraps.length < count; i += 3) {
    if (rng() < 0.35) continue;
    const origin = courseNodes[i].clone().add(new THREE.Vector3((rng() - 0.5) * 2, 2.1, (rng() - 0.5) * 2));
    const dir = courseNodes[Math.min(i + 1, courseNodes.length - 1)].clone().sub(courseNodes[i]).setY(0).normalize();

    const trap = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.8, 0.8),
      new THREE.MeshStandardMaterial({ color: "#8a5d2e" }),
    );
    trap.position.copy(origin);
    trap.castShadow = true;
    hazardGroup.add(trap);
    arrowTraps.push({ mesh: trap, dir, cooldown: Math.max(0.9, 1.7 - world.level * 0.08), timer: rng() * 1.3 });
  }
}

function tickPlayer(dt) {
  const sprint = input.ShiftLeft || input.ShiftRight;
  const speed = (sprint ? 14 : 10) * (1 + Math.min(0.3, world.level * 0.02));
  const forward = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  const right = new THREE.Vector3(forward.z, 0, -forward.x);
  const move = new THREE.Vector3();

  if (input.KeyW) move.add(forward);
  if (input.KeyS) move.sub(forward);
  if (input.KeyA) move.sub(right);
  if (input.KeyD) move.add(right);

  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(speed);
    player.vel.x = THREE.MathUtils.lerp(player.vel.x, move.x, 0.18);
    player.vel.z = THREE.MathUtils.lerp(player.vel.z, move.z, 0.18);
  } else {
    player.vel.x *= 0.84;
    player.vel.z *= 0.84;
  }

  if (input.Space && player.grounded) {
    player.vel.y = world.jumpV;
    player.grounded = false;
  }

  player.vel.y -= world.gravity * dt;
  const prev = player.pos.clone();
  player.pos.addScaledVector(player.vel, dt);

  resolveGroundCollision(prev);

  if (player.pos.y < world.lavaY + 0.5) {
    failRun("You fell into lava. Run reset.");
  }

  if (player.health <= 0) {
    failRun("You were defeated. Run reset.");
  }

  playerMesh.position.copy(player.pos);
  playerMesh.rotation.y = player.yaw + Math.PI;
}

function resolveGroundCollision(prev) {
  player.grounded = false;
  const px = player.pos.x;
  const pz = player.pos.z;

  for (const c of colliders) {
    const insideXZ = px > c.min.x && px < c.max.x && pz > c.min.z && pz < c.max.z;
    if (!insideXZ) continue;

    const top = c.max.y + 1.8;
    const prevAbove = prev.y >= top - 0.2;
    if (player.pos.y <= top && prevAbove && player.vel.y <= 0) {
      player.pos.y = top;
      player.vel.y = 0;
      player.grounded = true;
      break;
    }
  }
}

function tickMovingPlatforms(dt) {
  const t = clock.elapsedTime;
  movingPlatforms.forEach((m) => {
    const offset = Math.sin(t * m.speed) * m.amp;
    m.mesh.position.copy(m.base).addScaledVector(m.axis, offset);

    const dist = player.pos.distanceTo(m.mesh.position);
    if (dist < 3.2 && player.grounded && Math.abs(player.pos.y - (m.mesh.position.y + 1.2)) < 1.2) {
      player.pos.addScaledVector(m.axis, Math.cos(t * m.speed) * m.amp * m.speed * dt * 0.45);
    }
  });
}

function tickCurse(dt) {
  let onCurse = false;
  for (const zone of curseZones) {
    const d = zone.mesh.position.clone().setY(player.pos.y).distanceTo(player.pos);
    if (d < zone.radius) {
      onCurse = true;
      break;
    }
  }

  if (onCurse) world.curseTimer = Math.min(5, world.curseTimer + dt * 1.8);
  else world.curseTimer = Math.max(0, world.curseTimer - dt * 0.9);

  const k = world.curseTimer / 5;
  scene.fog.near = 8 + (1 - k) * 72;
  scene.fog.far = 24 + (1 - k) * 216;
  curseFxEl.style.opacity = (k * 0.9).toFixed(2);
}

function tickEnemies(dt) {
  const player2D = player.pos.clone().setY(0);
  enemies.forEach((e) => {
    if (!e.alive) return;

    const self2D = e.group.position.clone().setY(0);
    const toP = player2D.clone().sub(self2D);
    const d = toP.length();

    if (d > 0.1) {
      const dir = toP.normalize();
      e.vel.lerp(dir.multiplyScalar(e.speed * world.speedScale), 0.08);
      e.group.position.addScaledVector(e.vel, dt);
      e.group.rotation.y = Math.atan2(e.vel.x, e.vel.z);
    }

    e.group.position.y += Math.sin(clock.elapsedTime * 6 + e.seed) * 0.01;

    if (d < e.hitRange) player.health -= dt * e.meleeDamage;

    e.shootTimer -= dt;
    if (e.type === "cat" && e.shootTimer <= 0 && d < 34) {
      fireLaser(e.group.position.clone().add(new THREE.Vector3(0, 1.4, 0)), player.pos.clone().add(new THREE.Vector3(0, 1.5, 0)));
      e.shootTimer = world.catShootCd + Math.random() * 0.8;
    }
  });
}

function fireLaser(start, target) {
  const dir = target.sub(start).normalize();
  const laser = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 1.2, 8),
    new THREE.MeshBasicMaterial({ color: "#ff3940" }),
  );
  laser.position.copy(start);
  laser.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone());
  hazardGroup.add(laser);
  enemyProjectiles.push({ mesh: laser, vel: dir.multiplyScalar(26), ttl: 2.3, damage: 12 });
}

function tickProjectiles(dt) {
  for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
    const p = enemyProjectiles[i];
    p.ttl -= dt;
    p.mesh.position.addScaledVector(p.vel, dt);

    if (p.mesh.position.distanceTo(player.pos.clone().add(new THREE.Vector3(0, 1.2, 0))) < 1.2) {
      player.health -= p.damage;
      destroyProjectile(i);
      continue;
    }

    if (p.ttl <= 0 || p.mesh.position.y < world.lavaY) destroyProjectile(i);
  }
}

function destroyProjectile(i) {
  const p = enemyProjectiles[i];
  hazardGroup.remove(p.mesh);
  p.mesh.geometry.dispose();
  p.mesh.material.dispose();
  enemyProjectiles.splice(i, 1);
}

function tickArrowTraps(dt) {
  arrowTraps.forEach((t) => {
    t.timer -= dt;
    if (t.timer > 0) return;
    t.timer = t.cooldown;

    const arrow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.08, 1.1, 6),
      new THREE.MeshStandardMaterial({ color: "#9a7a52" }),
    );
    arrow.position.copy(t.mesh.position);
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), t.dir.clone());
    hazardGroup.add(arrow);
    enemyProjectiles.push({ mesh: arrow, vel: t.dir.clone().multiplyScalar(19 + world.level), ttl: 3.2, damage: 18 });
  });
}

function checkLevelProgress() {
  if (!dog) return;
  if (player.pos.distanceTo(dog.position) < 2.5) {
    overlayEl.textContent = `Dog saved! Advancing to level ${world.level + 1}...`;
    overlayEl.classList.remove("hidden");
    started = false;
    setTimeout(() => {
      buildLevel(world.level + 1);
      overlayEl.textContent = "Click to Start";
    }, 950);
  }
}

function failRun(msg) {
  player.respawns += 1;
  started = false;
  overlayEl.textContent = msg + " Click to try again.";
  overlayEl.classList.remove("hidden");
  document.exitPointerLock();
  buildLevel(world.level);
}

function updateCamera() {
  const camOffset = new THREE.Vector3(0, 3.1, 8.8);
  camOffset.applyAxisAngle(new THREE.Vector3(1, 0, 0), player.pitch * 0.45);
  camOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
  camera.position.copy(player.pos).add(camOffset);

  const look = player.pos.clone().add(new THREE.Vector3(0, 2.1, 0));
  look.x += Math.sin(player.yaw) * 7;
  look.y += Math.sin(player.pitch) * 4.4;
  look.z += Math.cos(player.yaw) * 7;
  camera.lookAt(look);
}

function updateUI() {
  statusEl.innerHTML = `Level: ${world.level}<br>Health: ${Math.max(0, player.health).toFixed(0)}<br>Cats/Wolves: ${enemies.filter((e) => e.alive).length}<br>Arrow traps: ${arrowTraps.length}<br>Respawns: ${player.respawns}`;
}

function clearGroups() {
  [courseGroup, hazardGroup, actorGroup].forEach((group) => {
    while (group.children.length) {
      const c = group.children.pop();
      c.traverse?.((n) => {
        if (n.geometry) n.geometry.dispose();
        if (n.material) {
          if (Array.isArray(n.material)) n.material.forEach((m) => m.dispose());
          else n.material.dispose();
        }
      });
    }
  });

  colliders.length = 0;
  courseNodes.length = 0;
  movingPlatforms.length = 0;
  curseZones.length = 0;
  arrowTraps.length = 0;
  enemyProjectiles.length = 0;
  enemies.length = 0;

  actorGroup.add(playerMesh);
}

function initLights() {
  scene.add(new THREE.HemisphereLight("#c2e0ff", "#3e2b1f", 0.42));
  const sunColors = ["#ffd685", "#ffe7a1", "#ffc29d", "#f9e6b8", "#fff7cc"];
  const sunPos = [[45, 78, 20], [-50, 72, -35], [0, 88, 0], [25, 67, -62], [-40, 65, 55]];
  sunPos.forEach((p, i) => {
    const d = new THREE.DirectionalLight(sunColors[i], 0.35);
    d.position.set(...p);
    d.castShadow = i === 0;
    if (i === 0) {
      d.shadow.mapSize.set(2048, 2048);
      d.shadow.camera.left = -120;
      d.shadow.camera.right = 120;
      d.shadow.camera.top = 120;
      d.shadow.camera.bottom = -120;
    }
    scene.add(d);

    const sphere = new THREE.Mesh(new THREE.SphereGeometry(2.8, 16, 16), new THREE.MeshBasicMaterial({ color: sunColors[i] }));
    sphere.position.copy(d.position.clone().multiplyScalar(0.62));
    scene.add(sphere);
  });
}

function initLava() {
  const lava = new THREE.Mesh(
    new THREE.BoxGeometry(420, 2, 420),
    new THREE.MeshStandardMaterial({ color: "#ff5f0f", emissive: "#a72f00", emissiveIntensity: 0.6, roughness: 0.8 }),
  );
  lava.position.set(0, world.lavaY, 0);
  lava.receiveShadow = true;
  scene.add(lava);
}

function createDalekCan() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: "#8badbb", metalness: 0.35, roughness: 0.45 });
  const legMat = new THREE.MeshStandardMaterial({ color: "#7a4a21", roughness: 0.8 });
  const armMat = new THREE.MeshStandardMaterial({ color: "#b8d5df", metalness: 0.2, roughness: 0.45 });

  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 16), bodyMat);
  dome.position.y = 3.1;
  g.add(dome);

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, 2.4, 20), bodyMat);
  torso.position.y = 1.8;
  g.add(torso);

  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.23, 1.7, 10), bodyMat);
  spout.rotation.z = -Math.PI / 2.8;
  spout.position.set(1.6, 2.4, 0);
  g.add(spout);

  [-0.7, 0, 0.7].forEach((x) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.2, 8), legMat);
    leg.position.set(x, 0.6, 0.45);
    g.add(leg);
  });

  [[1.6, 2.5, 0.7], [1.7, 2.15, 0], [1.6, 2.5, -0.7]].forEach(([x, y, z]) => {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.1, 8), armMat);
    arm.position.set(x, y, z);
    arm.rotation.z = -Math.PI / 3;
    g.add(arm);
  });

  g.traverse((n) => {
    if (n.isMesh) {
      n.castShadow = true;
      n.receiveShadow = true;
    }
  });
  return g;
}

function animateDalek(t) {
  const swing = Math.sin(t * 11) * Math.min(0.5, player.vel.length() * 0.04);
  playerMesh.children.forEach((c, i) => {
    if (i >= 4) c.rotation.x = swing * (i % 2 ? 1 : -1);
  });
}

function createCatEnemy() {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: "#707070", roughness: 0.8 });
  const eye = new THREE.MeshBasicMaterial({ color: "#ff3434" });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.3, 0.9), fur);
  body.position.y = 1.1;
  g.add(body);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), fur);
  head.position.set(0, 2, 0.05);
  g.add(head);

  const earL = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.35, 4), fur);
  const earR = earL.clone();
  earL.position.set(-0.22, 2.5, 0.05);
  earR.position.set(0.22, 2.5, 0.05);
  g.add(earL, earR);

  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), eye);
  const eyeR = eyeL.clone();
  eyeL.position.set(-0.16, 2.06, 0.42);
  eyeR.position.set(0.16, 2.06, 0.42);
  g.add(eyeL, eyeR);

  g.traverse((m) => m.isMesh && ((m.castShadow = true), (m.receiveShadow = true)));

  return { type: "cat", group: g, alive: true, vel: new THREE.Vector3(), speed: 5.5, hitRange: 1.6, meleeDamage: 10, shootTimer: 1.5, seed: Math.random() * 10 };
}

function createWolfEnemy() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: "#50555f", roughness: 0.75 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 0.8), mat);
  body.position.y = 0.8;
  g.add(body);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), mat);
  head.position.set(0.8, 1.05, 0);
  g.add(head);

  g.traverse((m) => m.isMesh && ((m.castShadow = true), (m.receiveShadow = true)));
  return { type: "wolf", group: g, alive: true, vel: new THREE.Vector3(), speed: 7.2, hitRange: 1.8, meleeDamage: 18, shootTimer: 999, seed: Math.random() * 10 };
}

function createDog() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: "#c18c54", roughness: 0.75 });
  const glow = new THREE.MeshBasicMaterial({ color: "#fff4bc" });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.7), mat);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.6, 0.6), mat);
  head.position.set(0.9, 0.5, 0);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), glow);
  beacon.position.set(0, 1, 0);

  g.add(body, head, beacon);
  g.traverse((m) => m.isMesh && ((m.castShadow = true), (m.receiveShadow = true)));
  return g;
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
