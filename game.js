import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";

const scene = new THREE.Scene();
scene.background = new THREE.Color("#78b9ff");
scene.fog = new THREE.Fog("#78b9ff", 80, 220);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 600);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const statusEl = document.getElementById("status");
const overlayEl = document.getElementById("overlay");

const world = {
  size: 36,
  gravity: 30,
  eventTimer: 18,
  eventDuration: 0,
  eventName: "Normal gravity",
  windSlide: new THREE.Vector3(0, 0, 0),
};

const player = {
  pos: new THREE.Vector3(0, 8, 0),
  vel: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  grounded: false,
  health: 100,
  jumpCooldown: 0,
};

const keys = {};
let gameStarted = false;

const terrain = [];
const blocksGroup = new THREE.Group();
scene.add(blocksGroup);

const waterfallBounds = {
  min: new THREE.Vector3(10, -8, 10),
  max: new THREE.Vector3(16, 20, 16),
};

const enemies = [];
const enemyCount = 14;

const playerMesh = buildPlayerMesh();
scene.add(playerMesh);

buildWorld();
buildLights();
buildWaterfall();
spawnEnemies();

camera.position.set(0, 10, 16);

overlayEl.addEventListener("click", () => {
  renderer.domElement.requestPointerLock();
});

document.addEventListener("pointerlockchange", () => {
  gameStarted = document.pointerLockElement === renderer.domElement;
  overlayEl.classList.toggle("hidden", gameStarted);
});

document.addEventListener("keydown", (e) => {
  keys[e.code] = true;
});

document.addEventListener("keyup", (e) => {
  keys[e.code] = false;
});

document.addEventListener("mousemove", (e) => {
  if (!gameStarted) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch -= e.movementY * 0.0018;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch));
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
animate();

function animate() {
  const dt = Math.min(clock.getDelta(), 0.033);
  if (gameStarted && player.health > 0) {
    stepEvents(dt);
    stepPlayer(dt);
    stepEnemies(dt);
    updateCamera();
    updateUI();
  }

  playerMesh.position.copy(player.pos);
  playerMesh.rotation.y = player.yaw + Math.PI;
  animatePlayerBody(clock.elapsedTime);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function stepEvents(dt) {
  world.eventTimer -= dt;
  if (world.eventDuration > 0) {
    world.eventDuration -= dt;
    if (world.eventDuration <= 0) resetEvent();
  } else if (world.eventTimer <= 0) {
    triggerRandomEvent();
  }
}

function triggerRandomEvent() {
  const choices = [
    {
      name: "Zero gravity burst",
      duration: 7,
      apply: () => {
        world.gravity = 2;
      },
    },
    {
      name: "Ground-slide anomaly",
      duration: 8,
      apply: () => {
        const angle = Math.random() * Math.PI * 2;
        world.windSlide.set(Math.cos(angle) * 14, 0, Math.sin(angle) * 14);
      },
    },
    {
      name: "Heavy gravity collapse",
      duration: 7,
      apply: () => {
        world.gravity = 55;
      },
    },
  ];
  const event = choices[Math.floor(Math.random() * choices.length)];
  world.eventName = event.name;
  world.eventDuration = event.duration;
  world.eventTimer = 22;
  event.apply();
}

function resetEvent() {
  world.gravity = 30;
  world.windSlide.set(0, 0, 0);
  world.eventName = "Normal gravity";
}

function stepPlayer(dt) {
  const run = keys.ShiftLeft || keys.ShiftRight;
  const speed = run ? 22 : 13;
  const forward = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  const right = new THREE.Vector3(forward.z, 0, -forward.x);

  const move = new THREE.Vector3();
  if (keys.KeyW) move.add(forward);
  if (keys.KeyS) move.sub(forward);
  if (keys.KeyA) move.sub(right);
  if (keys.KeyD) move.add(right);
  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(speed);
    player.vel.x = THREE.MathUtils.lerp(player.vel.x, move.x, 0.2);
    player.vel.z = THREE.MathUtils.lerp(player.vel.z, move.z, 0.2);
  } else {
    player.vel.x *= 0.82;
    player.vel.z *= 0.82;
  }

  player.vel.x += world.windSlide.x * dt;
  player.vel.z += world.windSlide.z * dt;

  player.jumpCooldown -= dt;
  if (keys.Space && player.grounded && player.jumpCooldown <= 0) {
    player.vel.y = Math.max(12, 15 - world.gravity * 0.1);
    player.grounded = false;
    player.jumpCooldown = 0.2;
  }

  player.vel.y -= world.gravity * dt;
  player.pos.addScaledVector(player.vel, dt);

  const groundHeight = sampleGround(player.pos.x, player.pos.z) + 2.4;
  if (player.pos.y <= groundHeight) {
    player.pos.y = groundHeight;
    player.vel.y = 0;
    player.grounded = true;
  }

  const limit = world.size / 2 - 1;
  player.pos.x = THREE.MathUtils.clamp(player.pos.x, -limit, limit);
  player.pos.z = THREE.MathUtils.clamp(player.pos.z, -limit, limit);
}

function stepEnemies(dt) {
  const waterfallCenter = new THREE.Vector3(13, 0, 13);

  enemies.forEach((enemy) => {
    if (enemy.melted) return;

    const toPlayer = player.pos.clone().sub(enemy.group.position);
    toPlayer.y = 0;
    const distance = toPlayer.length();
    if (distance > 0.2) {
      toPlayer.normalize();
      enemy.vel.lerp(toPlayer.multiplyScalar(5.5), 0.08);
      enemy.group.position.addScaledVector(enemy.vel, dt);
      enemy.group.rotation.y = Math.atan2(enemy.vel.x, enemy.vel.z);
    }

    const gy = sampleGround(enemy.group.position.x, enemy.group.position.z) + 1.35;
    enemy.group.position.y = gy + Math.sin(clock.elapsedTime * 6 + enemy.seed) * 0.12;

    if (distance < 2.2) {
      player.health -= dt * 7;
    }

    if (inWaterfall(enemy.group.position)) {
      enemy.meltTimer += dt;
      enemy.group.scale.setScalar(Math.max(0.05, 1 - enemy.meltTimer * 0.65));
      enemy.group.position.lerp(waterfallCenter, 0.02);
      if (enemy.meltTimer > 1.6) {
        enemy.melted = true;
        enemy.group.visible = false;
      }
    } else {
      enemy.meltTimer = Math.max(0, enemy.meltTimer - dt * 0.5);
      enemy.group.scale.setScalar(1 - enemy.meltTimer * 0.35);
    }
  });
}

function inWaterfall(pos) {
  return (
    pos.x > waterfallBounds.min.x &&
    pos.x < waterfallBounds.max.x &&
    pos.y > waterfallBounds.min.y &&
    pos.y < waterfallBounds.max.y &&
    pos.z > waterfallBounds.min.z &&
    pos.z < waterfallBounds.max.z
  );
}

function updateCamera() {
  const head = new THREE.Vector3(0, 3.2, 0);
  const back = new THREE.Vector3(0, 2.8, 8.8);
  back.applyAxisAngle(new THREE.Vector3(1, 0, 0), player.pitch * 0.4);
  back.applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);

  camera.position.copy(player.pos).add(back);
  const lookTarget = player.pos.clone().add(head);
  lookTarget.x += Math.sin(player.yaw) * 7;
  lookTarget.y += Math.sin(player.pitch) * 5;
  lookTarget.z += Math.cos(player.yaw) * 7;
  camera.lookAt(lookTarget);
}

function updateUI() {
  const remaining = enemies.filter((e) => !e.melted).length;
  statusEl.innerHTML = `Health: ${Math.max(0, player.health).toFixed(0)}<br>Flower fiends left: ${remaining}<br>Gravity event: ${world.eventName}`;

  if (player.health <= 0) {
    overlayEl.textContent = "You wilted. Reload to retry.";
    overlayEl.classList.remove("hidden");
    document.exitPointerLock();
  } else if (remaining === 0) {
    overlayEl.textContent = "Victory! Every flower fiend melted.";
    overlayEl.classList.remove("hidden");
    document.exitPointerLock();
  }
}

function buildWorld() {
  const grassMat = new THREE.MeshStandardMaterial({ color: "#4f8a3e", roughness: 0.95 });
  const dirtMat = new THREE.MeshStandardMaterial({ color: "#7d5f3c", roughness: 1 });
  const blockGeo = new THREE.BoxGeometry(2, 2, 2);

  for (let x = -world.size / 2; x < world.size / 2; x++) {
    for (let z = -world.size / 2; z < world.size / 2; z++) {
      const h = Math.floor(Math.sin(x * 0.25) * 1.5 + Math.cos(z * 0.2) * 1.5 + Math.sin((x + z) * 0.18));
      terrain.push({ x, z, h });

      const top = new THREE.Mesh(blockGeo, grassMat);
      top.castShadow = true;
      top.receiveShadow = true;
      top.position.set(x * 2, h * 2, z * 2);
      blocksGroup.add(top);

      for (let y = h - 1; y >= -3; y--) {
        const dirt = new THREE.Mesh(blockGeo, dirtMat);
        dirt.castShadow = true;
        dirt.receiveShadow = true;
        dirt.position.set(x * 2, y * 2, z * 2);
        blocksGroup.add(dirt);
      }
    }
  }
}

function buildWaterfall() {
  const rockMat = new THREE.MeshStandardMaterial({ color: "#6d7078", roughness: 0.95 });
  const waterMat = new THREE.MeshStandardMaterial({
    color: "#67b9ff",
    roughness: 0.1,
    transparent: true,
    opacity: 0.72,
    emissive: "#2255aa",
    emissiveIntensity: 0.25,
  });

  for (let y = 8; y >= -2; y--) {
    const water = new THREE.Mesh(new THREE.BoxGeometry(6, 2, 2), waterMat);
    water.position.set(13, y * 2, 13);
    water.receiveShadow = true;
    scene.add(water);
  }

  const pool = new THREE.Mesh(new THREE.BoxGeometry(8, 1, 8), waterMat);
  pool.position.set(13, -4.6, 13);
  pool.receiveShadow = true;
  scene.add(pool);

  const cliff = new THREE.Mesh(new THREE.BoxGeometry(10, 14, 5), rockMat);
  cliff.position.set(13, 10, 16);
  cliff.castShadow = true;
  cliff.receiveShadow = true;
  scene.add(cliff);
}

function buildLights() {
  const hemi = new THREE.HemisphereLight("#a8d1ff", "#334455", 0.45);
  scene.add(hemi);

  const sunColors = ["#ffe58a", "#ffd68a", "#fff3a8", "#f9de9f", "#fff0c4"];
  const sunPositions = [
    [60, 80, 10],
    [-70, 78, -30],
    [25, 70, -85],
    [-25, 65, 75],
    [0, 95, 0],
  ];

  sunPositions.forEach((p, idx) => {
    const dir = new THREE.DirectionalLight(sunColors[idx], 0.45);
    dir.position.set(...p);
    dir.castShadow = idx === 0;
    if (idx === 0) {
      dir.shadow.mapSize.set(2048, 2048);
      dir.shadow.camera.left = -90;
      dir.shadow.camera.right = 90;
      dir.shadow.camera.top = 90;
      dir.shadow.camera.bottom = -90;
    }
    scene.add(dir);

    const sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(3.2, 16, 16),
      new THREE.MeshBasicMaterial({ color: sunColors[idx] }),
    );
    sunMesh.position.copy(dir.position.clone().multiplyScalar(0.65));
    scene.add(sunMesh);
  });
}

function buildPlayerMesh() {
  const g = new THREE.Group();

  const metal = new THREE.MeshStandardMaterial({ color: "#7fa8b7", roughness: 0.35, metalness: 0.45 });
  const legMat = new THREE.MeshStandardMaterial({ color: "#7b4b22", roughness: 0.8 });
  const armMat = new THREE.MeshStandardMaterial({ color: "#a8d4df", roughness: 0.4, metalness: 0.3 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.45, 2.4, 18), metal);
  body.position.y = 2.1;
  body.castShadow = true;
  g.add(body);

  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 1.9, 12), metal);
  spout.rotation.z = Math.PI / 2.8;
  spout.position.set(1.1, 2.45, 0);
  spout.castShadow = true;
  g.add(spout);

  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.1, 8, 20, Math.PI), metal);
  handle.rotation.y = Math.PI / 2;
  handle.position.set(-0.7, 2.5, 0);
  handle.castShadow = true;
  g.add(handle);

  const limbGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.25, 8);
  const legOffsets = [-0.55, 0, 0.55];
  legOffsets.forEach((x) => {
    const leg = new THREE.Mesh(limbGeo, legMat);
    leg.position.set(x, 0.7, 0.25);
    leg.castShadow = true;
    g.add(leg);
  });

  const armOffsets = [
    [1.05, 2.35, 0.7],
    [1.1, 2.15, -0.2],
    [1.0, 2.5, -0.8],
  ];
  armOffsets.forEach(([x, y, z]) => {
    const arm = new THREE.Mesh(limbGeo, armMat);
    arm.rotation.z = -Math.PI / 3.8;
    arm.position.set(x, y, z);
    arm.castShadow = true;
    g.add(arm);
  });

  g.position.copy(player.pos);
  return g;
}

function spawnEnemies() {
  for (let i = 0; i < enemyCount; i++) {
    const enemy = createFlowerEnemy();
    const angle = (i / enemyCount) * Math.PI * 2;
    const r = 20 + Math.random() * 8;
    enemy.group.position.set(Math.cos(angle) * r, 1, Math.sin(angle) * r);
    scene.add(enemy.group);
    enemies.push(enemy);
  }
}

function createFlowerEnemy() {
  const group = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.12, 1.2, 8),
    new THREE.MeshStandardMaterial({ color: "#85c76d", roughness: 0.7 }),
  );
  stem.position.y = 0.7;
  group.add(stem);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 14, 14),
    new THREE.MeshStandardMaterial({ color: "#c14dd3", roughness: 0.4 }),
  );
  head.position.y = 1.45;
  head.castShadow = true;
  group.add(head);

  for (let i = 0; i < 7; i++) {
    const petal = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.42, 0.72),
      new THREE.MeshStandardMaterial({ color: "#ff83c2", roughness: 0.45 }),
    );
    const ang = (i / 7) * Math.PI * 2;
    petal.position.set(Math.cos(ang) * 0.45, 1.45, Math.sin(ang) * 0.45);
    petal.lookAt(0, 1.45, 0);
    petal.rotation.x = Math.PI / 5;
    group.add(petal);
  }

  const eyeMat = new THREE.MeshBasicMaterial({ color: "#0a0a0a" });
  const eyeGeo = new THREE.SphereGeometry(0.06, 8, 8);
  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.12, 1.5, 0.42);
  rightEye.position.set(0.12, 1.5, 0.42);
  group.add(leftEye, rightEye);

  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });

  return {
    group,
    vel: new THREE.Vector3(),
    melted: false,
    meltTimer: 0,
    seed: Math.random() * Math.PI * 2,
  };
}

function animatePlayerBody(t) {
  const swing = Math.sin(t * 9) * Math.min(1, player.vel.length() * 0.1);
  playerMesh.children.forEach((child, idx) => {
    if (idx >= 3) {
      child.rotation.x = swing * 0.4 * (idx % 2 ? 1 : -1);
    }
  });
}

function sampleGround(worldX, worldZ) {
  const x = Math.round(worldX / 2);
  const z = Math.round(worldZ / 2);
  return Math.sin(x * 0.25) * 3 + Math.cos(z * 0.2) * 3 + Math.sin((x + z) * 0.18) * 2;
}
