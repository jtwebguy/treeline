// Scatters Poly Haven glTF props (stumps, fallen trunks, crates, ferns...)
// as instanced meshes.
import * as THREE from 'three';
import { loadModel } from './assets.js';
import { HALF, TRENCH, mulberry32, sample, heightAt } from './world.js';

const UP = new THREE.Vector3(0, 1, 0);

function groundNormal(x, z) {
  const e = 0.5;
  return new THREE.Vector3(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
}

// Turn every mesh inside a glTF scene into an InstancedMesh.
function instanceModel(scene, transforms, { shadows = true } = {}) {
  const group = new THREE.Group();
  if (!transforms.length) return group;
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const im = new THREE.InstancedMesh(o.geometry, o.material, transforms.length);
    const local = o.matrixWorld;
    const tmp = new THREE.Matrix4();
    transforms.forEach((t, i) => im.setMatrixAt(i, tmp.multiplyMatrices(t, local)));
    im.castShadow = shadows;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  });
  return group;
}

function placement(x, z, r, { scale = [1, 1], tiltToGround = 1, sink = 0, yaw } = {}) {
  const y = heightAt(x, z) - sink;
  const q = new THREE.Quaternion().setFromUnitVectors(UP, UP.clone().lerp(groundNormal(x, z), tiltToGround).normalize());
  q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw ?? r() * Math.PI * 2));
  const s = scale[0] + r() * (scale[1] - scale[0]);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
}

function randomSpot(r, test, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const x = (r() - 0.5) * (HALF * 2 - 20), z = (r() - 0.5) * (HALF * 2 - 20);
    const s = sample(x, z);
    if (test(s, x, z)) return [x, z];
  }
  return null;
}

function nearTrench(r, maxOff = 4, minOff = 1.8) {
  const i = Math.floor(r() * (TRENCH.length - 1));
  const [ax, az] = TRENCH[i], [bx, bz] = TRENCH[i + 1];
  const t = r();
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
  const side = r() < 0.7 ? 1 : -1; // mostly on the friendly (south) side
  const off = (minOff + r() * (maxOff - minOff)) * side;
  return [ax + dx * t + (-dz / len) * off, az + dz * t + (dx / len) * off];
}

export async function createProps(snappedSpots, onError) {
  const r = mulberry32(77);
  const group = new THREE.Group();

  const spec = {
    tree_stump_01: () => snappedSpots.filter(() => r() < 0.25).slice(0, 60).map(({ x, z }) => {
      const a = r() * 6.28, d = 2 + r() * 5; return placement(x + Math.cos(a) * d, z + Math.sin(a) * d, r, { scale: [0.8, 1.3], sink: 0.05 });
    }),
    dead_tree_trunk: () => Array.from({ length: 35 }, () => randomSpot(r, (s) => s.mud < 0.2)).filter(Boolean)
      .map(([x, z]) => placement(x, z, r, { scale: [0.9, 1.4], sink: 0.1 })),
    boulder_01: () => Array.from({ length: 14 }, () => randomSpot(r, (s) => s.mud < 0.1)).filter(Boolean)
      .map(([x, z]) => placement(x, z, r, { scale: [0.35, 0.9], sink: 0.25 })),
    dry_branches_medium_01: () => Array.from({ length: 220 }, () => randomSpot(r, () => true)).filter(Boolean)
      .map(([x, z]) => placement(x, z, r, { scale: [0.7, 1.4] })),
    fern_02: () => Array.from({ length: 420 }, () => randomSpot(r, (s) => s.burn < 0.25 && s.mud < 0.1)).filter(Boolean)
      .map(([x, z]) => placement(x, z, r, { scale: [0.7, 1.5], tiltToGround: 0.5 })),
    old_military_crate: () => Array.from({ length: 14 }, () => nearTrench(r, 4, 1.6))
      .map(([x, z]) => placement(x, z, r, { scale: [0.95, 1.05], sink: 0.02 })),
    ammo_box: () => Array.from({ length: 24 }, () => nearTrench(r, 3.5, 0))
      .map(([x, z]) => placement(x, z, r, { scale: [0.95, 1.05] })),
    metal_jerrycan_green: () => Array.from({ length: 12 }, () => nearTrench(r, 5, 1.5))
      .map(([x, z]) => placement(x, z, r, { scale: [0.95, 1.05], tiltToGround: 1 })),
    old_tyre: () => Array.from({ length: 10 }, () => nearTrench(r, 9, 2))
      .map(([x, z]) => {
        const m = placement(x, z, r, { scale: [0.95, 1.05] });
        if (r() < 0.6) m.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)).multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.2));
        return m;
      }),
  };

  await Promise.all(Object.entries(spec).map(async ([id, makeTransforms]) => {
    try {
      const scene = await loadModel(id);
      group.add(instanceModel(scene, makeTransforms(), { shadows: id !== 'fern_02' && id !== 'dry_branches_medium_01' }));
    } catch (e) {
      onError?.(id, e);
    }
  }));
  return group;
}
