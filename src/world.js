// Shared world definition: terrain height, craters, trench, masks.
// Everything here is deterministic (seeded) so the terrain mesh, tree
// placement and player ground-collision all agree.
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

export const WORLD_SIZE = 360;          // metres, square
export const HALF = WORLD_SIZE / 2;

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const perlin = new ImprovedNoise();
const rng = mulberry32(1991);

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---- Trench: a zig-zag line running roughly east-west -------------------
export const TRENCH = [];
{
  let x = -150, z = 18;
  while (x < 150) {
    TRENCH.push([x, z]);
    x += 9 + rng() * 8;
    z += (rng() - 0.5) * 9;
    z = Math.max(5, Math.min(32, z));
  }
}
export const TRENCH_WIDTH = 1.05;   // half-width of the cut
export const TRENCH_DEPTH = 1.35; // standing eye-line just clears the parapet

function distToTrench(x, z) {
  let best = 1e9;
  for (let i = 0; i < TRENCH.length - 1; i++) {
    const [ax, az] = TRENCH[i], [bx, bz] = TRENCH[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const px = ax + dx * t - x, pz = az + dz * t - z;
    const d = px * px + pz * pz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// ---- Craters: denser toward the "enemy" side (negative z) -----------------
export const CRATERS = [];
for (let i = 0; i < 70; i++) {
  const x = (rng() - 0.5) * WORLD_SIZE * 0.9;
  // bias toward the trench line and the no-man's land north of it
  const z = 20 - Math.pow(rng(), 1.6) * 140 * (rng() < 0.75 ? 1 : -0.9);
  const r = 1.4 + Math.pow(rng(), 2.2) * 6.5;
  CRATERS.push({ x, z, r, depth: r * (0.32 + rng() * 0.12), fresh: rng() < 0.35 });
}

function baseHeight(x, z) {
  return (
    perlin.noise(x * 0.007, z * 0.007, 0.3) * 9 +
    perlin.noise(x * 0.025, z * 0.025, 1.7) * 1.8 +
    perlin.noise(x * 0.11, z * 0.11, 3.1) * 0.3
  );
}

// Returns height plus blend masks used for ground texturing.
export function sample(x, z) {
  let h = baseHeight(x, z);
  let burn = 0, mud = 0;

  for (const c of CRATERS) {
    const dx = x - c.x, dz = z - c.z;
    const reach = c.r * 3;
    if (dx > reach || dx < -reach || dz > reach || dz < -reach) continue;
    const t = Math.sqrt(dx * dx + dz * dz) / c.r;
    if (t < 1) h -= c.depth * (1 - t * t);
    h += c.depth * 0.32 * Math.exp(-Math.pow((t - 1.0) / 0.35, 2));
    burn = Math.max(burn, (c.fresh ? 1 : 0.7) * (1 - smoothstep(0.5, 2.9, t)));
    mud = Math.max(mud, 1 - smoothstep(0.55, 1.05, t));
  }

  const dt = distToTrench(x, z);
  if (dt < 4) {
    const cut = 1 - smoothstep(TRENCH_WIDTH * 0.7, TRENCH_WIDTH, dt);
    h -= TRENCH_DEPTH * cut;
    h += 0.3 * Math.exp(-Math.pow((dt - 1.9) / 0.6, 2)); // spoil bank
    mud = Math.max(mud, 1 - smoothstep(1.2, 3.2, dt));
  }

  // big scorched patches from fires
  const n = perlin.noise(x * 0.018, z * 0.018, 7.7) + perlin.noise(x * 0.07, z * 0.07, 9.1) * 0.35;
  burn = Math.max(burn, smoothstep(0.22, 0.5, n));

  return { h, burn, mud, trench: dt };
}

export const heightAt = (x, z) => sample(x, z).h;

// Fraction 0..1 of how shelled a spot is: drives tree damage.
export function damageAt(x, z) {
  let d = 0.12;
  for (const c of CRATERS) {
    const dist = Math.hypot(x - c.x, z - c.z);
    d += Math.exp(-dist / (c.r * 3.5)) * 0.55;
  }
  const dt = distToTrench(x, z);
  d += Math.exp(-dt / 25) * 0.35;
  d += Math.max(0, -z) / 400; // no-man's land side is worse
  return Math.min(1, d);
}

export function isBuildable(x, z, margin = 1.2) {
  for (const c of CRATERS) {
    if (Math.hypot(x - c.x, z - c.z) < c.r * margin) return false;
  }
  return distToTrench(x, z) > 2.6;
}

export { distToTrench, smoothstep };
