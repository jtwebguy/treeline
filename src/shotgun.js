// Pump-action 12-gauge shotgun (models/shotgun.obj) shared by the player's
// viewmodel, enemy soldiers and dropped weapons.
//
// The OBJ comes without textures, so steel and wood are painted into vertex
// colours by region. OBJ space: muzzle toward -X, top toward +Y, ~18 units
// long (stock butt at x≈+9, muzzle at x≈-8.9, bore at y≈3.05).
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { manager } from './assets.js';

const OBJ_LEN = 17.95;             // units, butt to muzzle
export const REAL_LEN = 1.0;       // metres, roughly a Remington 870

let promise = null;
export function loadShotgun() {
  if (promise) return promise;
  promise = new Promise((resolve, reject) => {
    new OBJLoader(manager).load('./models/shotgun.obj', (group) => {
      let geometry = null;
      group.traverse((o) => { if (o.isMesh && !geometry) geometry = o.geometry; });
      if (!geometry) return reject(new Error('shotgun.obj has no mesh'));
      paint(geometry);
      geometry.computeBoundingSphere();
      const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.45, envMapIntensity: 0.6 });
      resolve({ geometry, material });
    }, undefined, reject);
  });
  return promise;
}

// wood: stock (behind the receiver) and the pump forend around the magazine tube
function paint(g) {
  const pos = g.attributes.position, n = pos.count;
  const col = new Float32Array(n * 3);
  const steel = new THREE.Color(0x2a2c2f), wood = new THREE.Color(0x6a4024), bead = new THREE.Color(0x9a9a92);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const fromTube = Math.hypot(y - 2.49, z);
    if (x > 2.78) c.copy(wood);
    else if (x > -5.4 && x < -2.5 && fromTube > 0.27 && y < 2.95) c.copy(wood);
    else if (x < -8.6 && y > 3.25) c.copy(bead);
    else c.copy(steel);
    // a touch of wear variation
    const k = 0.9 + 0.2 * Math.abs(Math.sin(x * 3.1 + y * 7.7));
    col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

// ---------------------------------------------------------------- soldier mount
// The soldier's Weapon_Root bone (centimetres): +Y runs down the barrel to the
// muzzle, +Z points up through the sights, the origin is at the pistol grip and
// the M4's trigger sits 6.8 cm forward of it with the bore about 7 cm above.
const S = (REAL_LEN * 100) / OBJ_LEN;               // obj units -> cm
export const BONE_MATRIX = new THREE.Matrix4().set(
  0, 0, -S, 0,
  -S, 0, 0, 20.2,      // obj trigger (x≈2.4) lands on y≈6.8
  0, S, 0, -9.2,       // obj bore (y≈2.9) lands on z≈7
  0, 0, 0, 1,
);
export const BONE_MUZZLE = new THREE.Vector3(-8.93, 3.05, 0).applyMatrix4(BONE_MATRIX);

// mesh positioned in Weapon_Root space
export function boneMesh({ geometry, material }) {
  const m = new THREE.Mesh(geometry, material);
  BONE_MATRIX.decompose(m.position, m.quaternion, m.scale);
  m.castShadow = true;
  return m;
}

// ---------------------------------------------------------------- viewmodel
// Viewmodel convention (see weapons.js): origin at the eye's sight line, the
// barrel along -Z, metres. Sight line = top of the receiver to the bead (y≈3.4).
const VM_S = REAL_LEN / OBJ_LEN;
const EYE = new THREE.Vector3(2.6, 3.41, 0);         // rear of the receiver, level with the bead
export function viewmodelMesh({ geometry, material }) {
  const m = new THREE.Mesh(geometry, material);
  m.scale.setScalar(VM_S);
  m.rotation.y = -Math.PI / 2;                       // obj -X (muzzle) -> -Z
  // obj (x,y,z) -> (-z, y, x) * s; put the eye point at the origin
  m.position.set(EYE.z * VM_S, -EYE.y * VM_S, -EYE.x * VM_S);
  m.frustumCulled = false;
  return m;
}
export const VM_MUZZLE = new THREE.Vector3(0, (3.05 - EYE.y) * VM_S, (-8.93 - EYE.x) * VM_S);

// ---------------------------------------------------------------- hand grip
// Hand targets in viewmodel space (metres, origin at the rear of the receiver, -Z forward; see hands.js).
export const HAND_POSE = {
  // right hand round the wrist of the stock, index finger to the trigger
  R: {
    wrist: new THREE.Vector3(0.035, -0.075, 0.085),
    fingers: new THREE.Vector3(-0.6, -0.35, -0.7), palm: new THREE.Vector3(-0.75, 0.35, 0.2),
    elbow: new THREE.Vector3(0.5, -0.6, 0.6),
    curl: { index: [0.3, 0.5, 0.4], middle: 0.9, ring: 0.9, pinky: 0.9, thumb: [-0.9, -0.6, -0.4] },
  },
  // left hand cupping the pump from below
  L: {
    wrist: new THREE.Vector3(-0.03, -0.11, -0.27),
    fingers: new THREE.Vector3(0.45, 0.25, -0.85), palm: new THREE.Vector3(0.35, 0.93, 0),
    elbow: new THREE.Vector3(-0.45, -0.55, 0.7),
    curl: { index: 0.5, middle: 0.5, ring: 0.5, pinky: 0.5, thumb: [-0.9, -0.5, -0.3] },
  },
};
