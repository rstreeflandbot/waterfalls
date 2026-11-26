import * as THREE from 'three';
import { clamp, createSeededRandom } from './cliffMath';

function createTiledGrid(options: {
  readonly period: number;
  readonly seed: number;
}): Float32Array {
  const rand = createSeededRandom(options.seed);
  const grid = new Float32Array(options.period * options.period);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = rand();
  }
  return grid;
}

function sampleTiledValueNoise(options: {
  readonly u: number;
  readonly v: number;
  readonly period: number;
  readonly grid: Float32Array;
}): number {
  const x = options.u * options.period;
  const y = options.v * options.period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const p = options.period;
  const x0 = ((ix % p) + p) % p;
  const y0 = ((iy % p) + p) % p;
  const x1 = (x0 + 1) % p;
  const y1 = (y0 + 1) % p;

  const a = options.grid[y0 * p + x0] ?? 0.5;
  const b = options.grid[y0 * p + x1] ?? 0.5;
  const c = options.grid[y1 * p + x0] ?? 0.5;
  const d = options.grid[y1 * p + x1] ?? 0.5;

  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}

function createTiledWorleyPoints(options: {
  readonly cells: number;
  readonly seed: number;
}): Float32Array {
  const rand = createSeededRandom(options.seed);
  const points = new Float32Array(options.cells * options.cells * 2);
  for (let i = 0; i < points.length; i++) {
    points[i] = rand();
  }
  return points;
}

function sampleTiledWorley(options: {
  readonly u: number;
  readonly v: number;
  readonly cells: number;
  readonly points: Float32Array;
}): number {
  const x = options.u * options.cells;
  const y = options.v * options.cells;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const c = options.cells;

  let minDistSq = 4.0;
  for (let dy = -1; dy <= 1; dy++) {
    const cy = (((iy + dy) % c) + c) % c;
    for (let dx = -1; dx <= 1; dx++) {
      const cx = (((ix + dx) % c) + c) % c;
      const idx = (cy * c + cx) * 2;
      const px = (options.points[idx] ?? 0.5) + dx - fx;
      const py = (options.points[idx + 1] ?? 0.5) + dy - fy;
      const distSq = px * px + py * py;
      if (distSq < minDistSq) {
        minDistSq = distSq;
      }
    }
  }

  return clamp({ value: 1 - Math.sqrt(minDistSq), min: 0, max: 1 });
}

export function createProceduralNoiseTexture(): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);

  const grid4 = createTiledGrid({ period: 4, seed: 101 });
  const grid8 = createTiledGrid({ period: 8, seed: 202 });
  const grid16 = createTiledGrid({ period: 16, seed: 303 });
  const grid32 = createTiledGrid({ period: 32, seed: 404 });
  const grid64 = createTiledGrid({ period: 64, seed: 505 });

  const worley8 = createTiledWorleyPoints({ cells: 8, seed: 606 });
  const worley16 = createTiledWorleyPoints({ cells: 16, seed: 707 });

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;

      const n4 = sampleTiledValueNoise({ u, v, period: 4, grid: grid4 });
      const n8 = sampleTiledValueNoise({ u, v, period: 8, grid: grid8 });
      const n16 = sampleTiledValueNoise({ u, v, period: 16, grid: grid16 });
      const n32 = sampleTiledValueNoise({ u, v, period: 32, grid: grid32 });
      const n64 = sampleTiledValueNoise({ u, v, period: 64, grid: grid64 });

      const fbmVal = clamp({
        value: n4 * 0.44 + n8 * 0.28 + n16 * 0.16 + n32 * 0.08 + n64 * 0.04,
        min: 0,
        max: 1,
      });

      const w8 = sampleTiledWorley({ u, v, cells: 8, points: worley8 });
      const w16 = sampleTiledWorley({ u, v, cells: 16, points: worley16 });
      const foamVal = clamp({
        value: w8 * 0.58 + w16 * 0.42,
        min: 0,
        max: 1,
      });

      const fineVal = clamp({
        value: n16 * 0.42 + n32 * 0.36 + n64 * 0.22,
        min: 0,
        max: 1,
      });

      const warpedU = (u + (n8 - 0.5) * 0.18 + 1) % 1;
      const warpedV = (v + (n16 - 0.5) * 0.18 + 1) % 1;
      const wispBase = sampleTiledValueNoise({ u: warpedU, v: warpedV, period: 8, grid: grid8 });
      const wispDetail = sampleTiledValueNoise({
        u: warpedU,
        v: warpedV,
        period: 16,
        grid: grid16,
      });
      const cloudVal = clamp({
        value: wispBase * 0.62 + wispDetail * 0.26 + n32 * 0.12,
        min: 0,
        max: 1,
      });

      const idx = (y * size + x) * 4;
      data[idx] = Math.floor(fbmVal * 255);
      data[idx + 1] = Math.floor(foamVal * 255);
      data[idx + 2] = Math.floor(fineVal * 255);
      data[idx + 3] = Math.floor(cloudVal * 255);
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;

  return texture;
}
