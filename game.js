import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#82bfff");
scene.fog = new THREE.Fog("#82bfff", 90, 320);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 700);

const statusEl = document.getElementById("status");
const overlayEl = document.getElementById("overlay");
const startPanelEl = document.getElementById("startPanel");
const messagePanelEl = document.getElementById("messagePanel");
const startBtnEl = document.getElementById("startBtn");
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
  catShootCd: 2.5,
};

const player = {
  pos: new THREE.Vector3(0, 8, 0),
  vel: new THREE.Vector3(),
  heading: 0,
  grounded: false,
  radius: 0.62,
  height: 2.2,
  health: 100,
  maxHealth: 100,
  respawns: 0,
  profileKey: null,
  profile: null,
};

const profiles = {
  boy1: { name: "Boy 1", speedMul: 0.95, jumpMul: 0.98, hpMul: 1.2, model: "boy1" },
  boy2: { name: "Boy 2", speedMul: 0.92, jumpMul: 1.0, hpMul: 1.25, model: "boy2" },
  girl1: { name: "Girl 1", speedMul: 1.08, jumpMul: 1.06, hpMul: 0.95, model: "girl1" },
  girl2: { name: "Girl 2", speedMul: 1.1, jumpMul: 1.04, hpMul: 0.92, model: "girl2" },
};

const input = {};
let started = false;

const courseGroup = new THREE.Group();
const hazardGroup = new THREE.Group();
const actorGroup = new THREE.Group();
scene.add(courseGroup, hazardGroup, actorGroup);

const colliders = [];
const courseNodes = [];
const movingPlatforms = [];
const curseZones = [];
const arrowTraps = [];
const enemyProjectiles = [];
const enemies = [];

let dog = null;
let playerMesh = null;

initLights();
initLava();

bindCharacterSelect();

window.addEventListener("keydown", (e) => {
  input[e.code] = true;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
});
window.addEventListener("keyup", (e) => (input[e.code] = false));
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
loop();

function bindCharacterSelect() {
  const buttons = [...document.querySelectorAll(".char-btn")];
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      applyProfile(btn.dataset.char);
      startBtnEl.disabled = false;
    });
  });

  startBtnEl.addEventListener("click", () => {
    if (!player.profile) return;
    if (courseNodes.length === 0) {
      buildLevel(1);
    }
    startPanelEl.classList.add("hidden");
    messagePanelEl.classList.add("hidden");
    overlayEl.classList.add("hidden");
    started = true;
  });
}

function applyProfile(profileKey) {
  player.profileKey = profileKey;
  player.profile = profiles[profileKey];
  player.maxHealth = Math.round(100 * player.profile.hpMul);
  player.health = Math.min(player.health || player.maxHealth, player.maxHealth);

  const nextMesh = createCharacterMesh(player.profile.model);
  if (playerMesh) actorGroup.remove(playerMesh);
  playerMesh = nextMesh;
  playerMesh.position.copy(player.pos);
  actorGroup.add(playerMesh);
}

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
    updateCamera(dt);
    updateUI();
  } else if (playerMesh) {
    updateCamera(dt);
  }

  animateDalek(clock.elapsedTime);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

function buildLevel(level) {
  world.level = level;
  world.speedScale = 1 + (level - 1) * 0.16;
  world.catShootCd = Math.max(1.3, 2.5 - level * 0.12);
  clearGroups();

  const rng = mulberry32((Math.random() * 1e9) | 0);
  const width = world.tileSize;
  const platformCount = Math.max(1, level);
  const maxGap = Math.min(world.maxJumpGap, 4.2 + level * 0.12);
  let pos = new THREE.Vector3(0, 2, 0);
  let heading = new THREE.Vector3(0, 0, 1);

  for (let i = 0; i < platformCount; i++) {
    const box = new THREE.Vector3(width + rng() * 2.2, 1.4 + rng() * 0.9, width + rng() * 2.2);
    addPlatform(pos.clone(), box, i % 3 === 0 ? "#83b95e" : "#6daa50");
    courseNodes.push(pos.clone());

    if (i > 2 && rng() > 0.73) addCurseZone(pos.clone(), box);
    if (i > 3 && rng() > 0.79) addMovingPusher(pos.clone(), box, rng);

    heading.applyAxisAngle(new THREE.Vector3(0, 1, 0), (rng() - 0.5) * 0.8).normalize();
    const gap = 2 + rng() * maxGap;
    const dy = (rng() - 0.5) * Math.min(2.2, 0.55 + level * 0.1);

    const next = pos.clone().addScaledVector(heading, box.z * 0.45 + gap + width * 0.45);
    next.y = THREE.MathUtils.clamp(pos.y + dy, 1, 8);

    if (!isJumpable(pos, next, gap)) {
      next.copy(pos).addScaledVector(heading, box.z * 0.45 + (1.8 + maxGap * 0.5) + width * 0.45);
      next.y = THREE.MathUtils.clamp(pos.y + Math.sign(dy || 1) * 0.8, 1, 6);
    }

    pos = next;
  }

  addPlatform(pos.clone(), new THREE.Vector3(8, 1.8, 8), "#b6d88a");
  dog = createDog();
  dog.position.copy(pos).add(new THREE.Vector3(0, 1.5, 0));
  actorGroup.add(dog);

  spawnCats(Math.min(4 + level, 12), rng);
  if (level >= 3) spawnArrowTraps(Math.min(2 + level, 10), rng);
  if (level >= 5) spawnWolves(Math.min(1 + Math.floor(level / 2), 7), rng);

  player.pos.copy(courseNodes[0]).add(new THREE.Vector3(0, 3.1, 0));
  player.vel.set(0, 0, 0);
  player.heading = 0;
  player.health = player.maxHealth;
  if (playerMesh) {
    playerMesh.position.copy(player.pos);
  }
}

function isJumpable(a, b, gap) {
  const speed = 10.5 * player.profile.speedMul;
  const dxz = new THREE.Vector2(b.x - a.x, b.z - a.z).length();
  const dy = b.y - a.y;
  const t = dxz / speed;
  const yReach = world.jumpV * player.profile.jumpMul * t - 0.5 * world.gravity * t * t;
  return gap <= world.maxJumpGap && dy <= 2.6 && yReach > dy - 0.6;
}

function addPlatform(center, size, color) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    new THREE.MeshStandardMaterial({ color, roughness: 0.95 }),
  );
  mesh.position.copy(center);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  courseGroup.add(mesh);

  colliders.push({
    min: new THREE.Vector3(center.x - size.x / 2, center.y - size.y / 2, center.z - size.z / 2),
    max: new THREE.Vector3(center.x + size.x / 2, center.y + size.y / 2, center.z + size.z / 2),
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
    arrowTraps.push({ mesh: trap, dir, cooldown: Math.max(0.85, 1.7 - world.level * 0.08), timer: rng() * 1.3 });
  }
}

function tickPlayer(dt) {
  const speed = 12 * player.profile.speedMul * (1 + Math.min(0.3, world.level * 0.02));
  const turnSpeed = 2.2;

  if (input.ArrowLeft) player.heading += turnSpeed * dt;
  if (input.ArrowRight) player.heading -= turnSpeed * dt;

  const forward = new THREE.Vector3(Math.sin(player.heading), 0, Math.cos(player.heading));
  let moveMag = 0;
  if (input.ArrowUp) moveMag += 1;
  if (input.ArrowDown) moveMag -= 0.7;

  if (moveMag !== 0) {
    const target = forward.multiplyScalar(speed * moveMag);
    player.vel.x = THREE.MathUtils.lerp(player.vel.x, target.x, 0.16);
    player.vel.z = THREE.MathUtils.lerp(player.vel.z, target.z, 0.16);
  } else {
    player.vel.x *= 0.84;
    player.vel.z *= 0.84;
  }

  if (input.Space && player.grounded) {
    player.vel.y = world.jumpV * player.profile.jumpMul;
    player.grounded = false;
  }

  player.vel.y -= world.gravity * dt;
  const prev = player.pos.clone();
  player.pos.addScaledVector(player.vel, dt);

  resolveGroundCollision(prev);

  if (player.pos.y < world.lavaY + 0.5) failRun("You fell into lava. Run reset.");
  if (player.health <= 0) failRun("You were defeated. Run reset.");

  playerMesh.position.copy(player.pos);
  playerMesh.rotation.y = player.heading + Math.PI;
}

function resolveGroundCollision(prev) {
  player.grounded = false;
  for (const c of colliders) {
    const insideXZ =
      player.pos.x > c.min.x - player.radius &&
      player.pos.x < c.max.x + player.radius &&
      player.pos.z > c.min.z - player.radius &&
      player.pos.z < c.max.z + player.radius;
    if (!insideXZ) continue;

    const top = c.max.y + player.height;
    const prevAbove = prev.y >= top - 0.45;
    if (player.pos.y <= top + 0.25 && prevAbove && player.vel.y <= 0) {
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
  world.curseTimer = onCurse ? Math.min(5, world.curseTimer + dt * 1.8) : Math.max(0, world.curseTimer - dt * 0.9);

  const k = world.curseTimer / 5;
  scene.fog.near = 14 + (1 - k) * 80;
  scene.fog.far = 35 + (1 - k) * 290;
  curseFxEl.style.opacity = (k * 0.92).toFixed(2);
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

function destroyProjectile(i) {
  const p = enemyProjectiles[i];
  hazardGroup.remove(p.mesh);
  p.mesh.geometry.dispose();
  p.mesh.material.dispose();
  enemyProjectiles.splice(i, 1);
}

function checkLevelProgress() {
  if (!dog) return;
  if (player.pos.distanceTo(dog.position) < 2.5) {
    started = false;
    overlayEl.classList.remove("hidden");
    startPanelEl.classList.add("hidden");
    messagePanelEl.classList.remove("hidden");
    messagePanelEl.textContent = `Dog saved! Building level ${world.level + 1}...`;
    setTimeout(() => {
      buildLevel(world.level + 1);
      messagePanelEl.textContent = "Level ready. Press Start Run to continue.";
      startPanelEl.classList.remove("hidden");
    }, 900);
  }
}

function failRun(msg) {
  player.respawns += 1;
  started = false;
  overlayEl.classList.remove("hidden");
  startPanelEl.classList.remove("hidden");
  messagePanelEl.classList.remove("hidden");
  messagePanelEl.textContent = `${msg} Press Start Run.`;
  buildLevel(world.level);
}

function updateCamera(dt) {
  if (!playerMesh) return;

  const desired = player.pos
    .clone()
    .add(new THREE.Vector3(0, 8.5, 0))
    .add(new THREE.Vector3(-Math.sin(player.heading) * 18, 0, -Math.cos(player.heading) * 18));

  camera.position.lerp(desired, Math.min(1, dt * 3.2));

  const look = player.pos.clone().add(new THREE.Vector3(0, 3.6, 0));
  const ahead = new THREE.Vector3(Math.sin(player.heading), 0.18, Math.cos(player.heading)).multiplyScalar(8);
  camera.lookAt(look.add(ahead));
}

function updateUI() {
  statusEl.innerHTML = `Character: ${player.profile?.name || "-"}<br>Level: ${world.level}<br>Health: ${Math.max(0, player.health).toFixed(0)} / ${player.maxHealth}<br>Cats/Wolves: ${enemies.filter((e) => e.alive).length}<br>Arrow traps: ${arrowTraps.length}<br>Respawns: ${player.respawns}`;
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
  if (playerMesh) actorGroup.add(playerMesh);
}

function initLights() {
  scene.add(new THREE.HemisphereLight("#d0e7ff", "#39291f", 0.42));
  const sunColors = ["#ffd685", "#ffe7a1", "#ffc29d", "#f9e6b8", "#fff7cc"];
  const sunPos = [[45, 78, 20], [-50, 72, -35], [0, 88, 0], [25, 67, -62], [-40, 65, 55]];
  sunPos.forEach((p, i) => {
    const d = new THREE.DirectionalLight(sunColors[i], 0.33);
    d.position.set(...p);
    d.castShadow = i === 0;
    if (i === 0) {
      d.shadow.mapSize.set(2048, 2048);
      d.shadow.camera.left = -160;
      d.shadow.camera.right = 160;
      d.shadow.camera.top = 160;
      d.shadow.camera.bottom = -160;
    }
    scene.add(d);

    const sphere = new THREE.Mesh(new THREE.SphereGeometry(2.8, 16, 16), new THREE.MeshBasicMaterial({ color: sunColors[i] }));
    sphere.position.copy(d.position.clone().multiplyScalar(0.62));
    scene.add(sphere);
  });
}

function initLava() {
  const lava = new THREE.Mesh(
    new THREE.BoxGeometry(520, 2, 520),
    new THREE.MeshStandardMaterial({ color: "#ff5f0f", emissive: "#a72f00", emissiveIntensity: 0.6, roughness: 0.8 }),
  );
  lava.position.set(0, world.lavaY, 0);
  lava.receiveShadow = true;
  scene.add(lava);
}

function createCharacterMesh(model) {
  switch (model) {
    case "boy1":
      return createBoy1();
    case "boy2":
      return createBoy2();
    case "girl1":
      return createGirl1();
    case "girl2":
      return createGirl2();
    default:
      return createBoy1();
  }
}

function createBoy1() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: "#b3835b", roughness: 0.75 });
  const shirt = new THREE.MeshStandardMaterial({ color: "#556677", roughness: 0.6 });
  const pants = new THREE.MeshStandardMaterial({ color: "#2f3340", roughness: 0.7 });
  const hair = new THREE.MeshStandardMaterial({ color: "#332522", roughness: 0.85 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 0.8), shirt);
  body.position.y = 2.4;
  g.add(body);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.95, 0.95), skin);
  head.position.y = 3.6;
  g.add(head);

  const hairCap = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.35, 1.02), hair);
  hairCap.position.y = 4.05;
  g.add(hairCap);

  [-0.33, 0.33].forEach((x) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.1, 0.45), pants);
    leg.position.set(x, 1.1, 0);
    g.add(leg);
  });

  [-0.85, 0.85].forEach((x) => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.1, 0.35), skin);
    arm.position.set(x, 2.45, 0);
    g.add(arm);
  });

  finalizeCharacter(g);
  return g;
}

function createBoy2() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: "#a97856", roughness: 0.75 });
  const shirt = new THREE.MeshStandardMaterial({ color: "#6b5768", roughness: 0.6 });
  const pants = new THREE.MeshStandardMaterial({ color: "#3a3643", roughness: 0.72 });
  const hair = new THREE.MeshStandardMaterial({ color: "#2d2220", roughness: 0.85 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.65, 0.9), shirt);
  body.position.y = 2.35;
  g.add(body);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), skin);
  head.position.y = 3.6;
  g.add(head);

  const brow = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.2, 0.3), hair);
  brow.position.set(0, 3.9, 0.35);
  g.add(brow);

  [-0.37, 0.37].forEach((x) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.46, 1.05, 0.46), pants);
    leg.position.set(x, 1.08, 0);
    g.add(leg);
  });

  [-0.9, 0.9].forEach((x) => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 0.4), skin);
    arm.position.set(x, 2.42, 0);
    g.add(arm);
  });

  finalizeCharacter(g);
  return g;
}

function createGirl1() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: "#f0c4a0", roughness: 0.7 });
  const dress = new THREE.MeshStandardMaterial({ color: "#ff8fcf", roughness: 0.55 });
  const legMat = new THREE.MeshStandardMaterial({ color: "#ffd9ef", roughness: 0.65 });
  const hair = new THREE.MeshStandardMaterial({ color: "#5a3d2e", roughness: 0.85 });

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.8, 1.6, 10), dress);
  torso.position.y = 2.35;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.48, 12, 12), skin);
  head.position.y = 3.55;
  g.add(head);

  const pony = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), hair);
  pony.position.set(-0.45, 3.45, -0.1);
  g.add(pony);

  [-0.27, 0.27].forEach((x) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.1, 0.32), legMat);
    leg.position.set(x, 1.1, 0);
    g.add(leg);
  });

  [-0.7, 0.7].forEach((x) => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1.0, 0.26), skin);
    arm.position.set(x, 2.5, 0);
    g.add(arm);
  });

  finalizeCharacter(g);
  return g;
}

function createGirl2() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: "#f2c9ae", roughness: 0.7 });
  const outfit = new THREE.MeshStandardMaterial({ color: "#ffb4da", roughness: 0.55 });
  const legMat = new THREE.MeshStandardMaterial({ color: "#ffe4f1", roughness: 0.66 });
  const hair = new THREE.MeshStandardMaterial({ color: "#784f39", roughness: 0.82 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.52, 1.2, 4, 8), outfit);
  torso.position.y = 2.35;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.47, 12, 12), skin);
  head.position.y = 3.55;
  g.add(head);

  const hairBack = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.75, 0.35), hair);
  hairBack.position.set(0, 3.45, -0.35);
  g.add(hairBack);

  [-0.26, 0.26].forEach((x) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.15, 0.3), legMat);
    leg.position.set(x, 1.08, 0);
    g.add(leg);
  });

  [-0.68, 0.68].forEach((x) => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.02, 0.24), skin);
    arm.position.set(x, 2.48, 0);
    g.add(arm);
  });

  finalizeCharacter(g);
  return g;
}

function finalizeCharacter(g) {
  g.scale.setScalar(1.05);
  g.traverse((n) => {
    if (n.isMesh) {
      n.castShadow = true;
      n.receiveShadow = true;
    }
  });
}

function animateDalek(t) {
  if (!playerMesh) return;
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
