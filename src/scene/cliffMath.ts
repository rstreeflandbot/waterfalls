export interface Vec3Tuple {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface WaterfallConfig {
  readonly crestHeight: number;
  readonly crestZ: number;
  readonly crestWidth: number;
  readonly plungeCenterZ: number;
  readonly plungeWidth: number;
  readonly poolSurfaceY: number;
  readonly sunDirection: Vec3Tuple;
}

export const SCENE_CONFIG: WaterfallConfig = {
  crestHeight: 23.5,
  crestZ: -14.2,
  crestWidth: 10.6,
  plungeCenterZ: -10.3,
  plungeWidth: 12.6,
  poolSurfaceY: 0.0,
  sunDirection: normalizeVec3({ x: -0.72, y: 0.24, z: -0.65 }),
};

export interface ParabolicPointInput {
  readonly progress: number;
  readonly startY: number;
  readonly endY: number;
  readonly startZ: number;
  readonly forwardReach: number;
}

export interface ParabolicPoint {
  readonly y: number;
  readonly z: number;
  readonly speedFactor: number;
}

export interface WetnessInput {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface TerrainHeightInput {
  readonly x: number;
  readonly z: number;
}

export interface BasaltColumnPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly height: number;
  readonly rotationY: number;
  readonly tiltX: number;
  readonly tiltZ: number;
  readonly isHanging: boolean;
}

export interface ColumnLayoutOptions {
  readonly seed: number;
  readonly hexRadius: number;
  readonly rowsDeep: number;
  readonly halfSpanX: number;
}

export function clamp(input: {
  readonly value: number;
  readonly min: number;
  readonly max: number;
}): number {
  return Math.max(input.min, Math.min(input.max, input.value));
}

export function smoothstep(input: {
  readonly edge0: number;
  readonly edge1: number;
  readonly value: number;
}): number {
  if (input.edge0 === input.edge1) {
    return input.value < input.edge0 ? 0 : 1;
  }
  const normalized = clamp({
    value: (input.value - input.edge0) / (input.edge1 - input.edge0),
    min: 0,
    max: 1,
  });
  return normalized * normalized * (3 - 2 * normalized);
}

export function normalizeVec3(vec: Vec3Tuple): Vec3Tuple {
  const length = Math.hypot(vec.x, vec.y, vec.z);
  if (length === 0) {
    return { x: 0, y: 1, z: 0 };
  }
  return {
    x: vec.x / length,
    y: vec.y / length,
    z: vec.z / length,
  };
}

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2d(coords: { readonly x: number; readonly z: number }): number {
  const s = Math.sin(coords.x * 127.1 + coords.z * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function valueNoise2d(coords: { readonly x: number; readonly z: number }): number {
  const ix = Math.floor(coords.x);
  const iz = Math.floor(coords.z);
  const fx = coords.x - ix;
  const fz = coords.z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);

  const a = hash2d({ x: ix, z: iz });
  const b = hash2d({ x: ix + 1, z: iz });
  const c = hash2d({ x: ix, z: iz + 1 });
  const d = hash2d({ x: ix + 1, z: iz + 1 });

  return (a * (1 - ux) + b * ux) * (1 - uz) + (c * (1 - ux) + d * ux) * uz;
}

export function ridgedMultifractal2d(coords: {
  readonly x: number;
  readonly z: number;
  readonly octaves: number;
}): number {
  let sum = 0;
  let amplitude = 0.52;
  let freq = 1;
  let weight = 1;

  for (let i = 0; i < coords.octaves; i++) {
    const n = valueNoise2d({ x: coords.x * freq, z: coords.z * freq });
    const ridge = 1 - Math.abs(n * 2 - 1);
    const sharpened = ridge * ridge * weight;
    weight = clamp({ value: sharpened * 1.85, min: 0.15, max: 1.0 });
    sum += sharpened * amplitude;
    freq *= 2.07;
    amplitude *= 0.48;
  }

  return sum;
}

export function computeParabolicFallPoint(input: ParabolicPointInput): ParabolicPoint {
  const clampedProgress = clamp({ value: input.progress, min: 0, max: 1 });
  const dropDistance = input.startY - input.endY;
  const fallCurve = clampedProgress * clampedProgress;
  const y = input.startY - dropDistance * fallCurve;
  const z = input.startZ + input.forwardReach * Math.pow(clampedProgress, 0.84);
  const speedFactor = 0.35 + clampedProgress * 1.45;
  return { y, z, speedFactor };
}

export function computeGravityFallTime(progress: number): number {
  const clamped = clamp({ value: progress, min: 0, max: 1 });
  return Math.sqrt(clamped * 0.92 + 0.08) - Math.sqrt(0.08);
}

export function computeRockWetness(input: WetnessInput): number {
  const poolProximity =
    1 -
    smoothstep({
      edge0: 0.15,
      edge1: 2.8,
      value: input.y - SCENE_CONFIG.poolSurfaceY,
    });

  const horizontalDistToFall = Math.hypot(input.x * 0.65, input.z - SCENE_CONFIG.plungeCenterZ);
  const sprayProximity =
    1 -
    smoothstep({
      edge0: 4.5,
      edge1: 16.5,
      value: horizontalDistToFall,
    });

  const heightMask =
    1 -
    smoothstep({
      edge0: SCENE_CONFIG.crestHeight + 0.5,
      edge1: SCENE_CONFIG.crestHeight + 3.5,
      value: input.y,
    });

  return clamp({
    value: Math.max(poolProximity, sprayProximity * heightMask * 0.92),
    min: 0,
    max: 1,
  });
}

export function computeRiverCenterX(z: number): number {
  return Math.sin((z + 10) * 0.042) * 5.2 + Math.sin((z + 10) * 0.017) * 3.8;
}

export function computeEscarpmentLineZ(x: number): number {
  const cavernRecess = -5.8 * Math.exp(-Math.pow(x / 7.8, 2));
  const sweepingCurve = -Math.pow(Math.abs(x) * 0.052, 1.42) * 2.8;
  const rockyMeander =
    Math.sin(x * 0.082) * 2.2 +
    Math.cos(x * 0.19) * 0.95 +
    (valueNoise2d({ x: x * 0.14, z: 3.1 }) - 0.5) * 2.4;
  return SCENE_CONFIG.crestZ + cavernRecess + sweepingCurve + rockyMeander;
}

export function warpTerrainCoordinate(normalized: number): number {
  const absN = Math.abs(normalized);
  const sign = normalized < 0 ? -1 : 1;
  return sign * (absN * 24.0 + Math.pow(absN, 2.7) * 118.0);
}

export function computeOpenVolcanicTerrainHeight(input: TerrainHeightInput): number {
  const { x, z } = input;
  const cliffLineZ = computeEscarpmentLineZ(x);

  const escarpmentTransition =
    1 -
    smoothstep({
      edge0: cliffLineZ - 3.2,
      edge1: cliffLineZ + 5.8,
      value: z,
    });

  const riverNotchDist = Math.abs(x - Math.sin((z + 14) * 0.05) * 1.2);
  const upperGorgeNotch =
    (1 - smoothstep({ edge0: 4.6, edge1: 10.2, value: riverNotchDist })) *
    (1 - smoothstep({ edge0: -42, edge1: -11, value: z }));

  const lateralSlopeDown = 1 - smoothstep({ edge0: 34, edge1: 118, value: Math.abs(x) }) * 0.44;

  const cragNoise = ridgedMultifractal2d({ x: x * 0.045, z: z * 0.045, octaves: 4 });
  const strataStep = Math.sin(x * 0.12 + z * 0.08 + cragNoise * 2.2) * 1.4;

  const plateauBase =
    (SCENE_CONFIG.crestHeight + 1.8 + cragNoise * 9.5) * lateralSlopeDown - upperGorgeNotch * 3.6;

  const escarpmentHeight = escarpmentTransition * Math.max(0, plateauBase + strataStep);

  const talusDistance = z - cliffLineZ;
  const outsideWaterfallMask = smoothstep({ edge0: 5.5, edge1: 12.0, value: Math.abs(x) });
  const talusScree =
    outsideWaterfallMask *
    smoothstep({ edge0: -1.5, edge1: 2.5, value: talusDistance }) *
    (1 - smoothstep({ edge0: 2.5, edge1: 14.5, value: talusDistance })) *
    (5.2 + cragNoise * 3.6);

  const distToPlunge = Math.hypot(x * 0.85, z - (SCENE_CONFIG.plungeCenterZ + 3.2));
  const plungePoolDepth = -3.4 * (1 - smoothstep({ edge0: 5.5, edge1: 15.5, value: distToPlunge }));

  const riverCenterX = computeRiverCenterX(z);
  const riverHalfWidth =
    8.0 +
    Math.exp(-Math.pow((z - (SCENE_CONFIG.plungeCenterZ + 4)) / 10, 2)) * 5.6 +
    smoothstep({ edge0: 14, edge1: 95, value: z }) * 9.5;
  const distToRiver = Math.abs(x - riverCenterX);
  const riverMask =
    smoothstep({ edge0: cliffLineZ + 0.5, edge1: cliffLineZ + 7.0, value: z }) *
    (1 -
      smoothstep({
        edge0: riverHalfWidth * 0.58,
        edge1: riverHalfWidth + 6.5,
        value: distToRiver,
      }));
  const riverBedDepth = -1.85 * riverMask;

  const valleyOpenMask = smoothstep({
    edge0: cliffLineZ + 2.0,
    edge1: cliffLineZ + 14.0,
    value: z,
  });
  const valleyMicro = ridgedMultifractal2d({ x: x * 0.035 + 4.1, z: z * 0.035 - 2.3, octaves: 3 });
  const bankRise =
    valleyOpenMask *
    smoothstep({ edge0: riverHalfWidth - 0.5, edge1: riverHalfWidth + 28.0, value: distToRiver }) *
    (3.8 + valleyMicro * 4.8);

  const farRollingHills =
    valleyOpenMask *
    smoothstep({ edge0: 40, edge1: 118, value: Math.abs(x) }) *
    (9.5 + valleyMicro * 14.0);

  const distantMountainMask = 1 - smoothstep({ edge0: -135, edge1: -44, value: z });
  const mountainRidge = ridgedMultifractal2d({
    x: x * 0.018 + 1.4,
    z: z * 0.018 - 0.8,
    octaves: 4,
  });
  const mesaCap = Math.min(mountainRidge * 38.0, 31.0) + mountainRidge * 6.5;
  const distantMountains = distantMountainMask * (10.0 + mesaCap);

  const rockDetail = (valueNoise2d({ x: x * 0.28, z: z * 0.28 }) - 0.5) * 0.65;

  const waterDepression = Math.min(plungePoolDepth, riverBedDepth) * (1 - escarpmentTransition);
  const valleyElevation = waterDepression + bankRise + farRollingHills + talusScree;

  return valleyElevation + escarpmentHeight + distantMountains + rockDetail;
}

export function generateBasaltColumnLayout(options: ColumnLayoutOptions): BasaltColumnPlacement[] {
  const nextRand = createSeededRandom(options.seed);
  const columns: BasaltColumnPlacement[] = [];

  const spacingX = options.hexRadius * 1.72;
  const spacingZ = options.hexRadius * 1.49;

  for (let row = 0; row < options.rowsDeep; row++) {
    const rowOffsetX = row % 2 === 1 ? spacingX * 0.5 : 0;
    const minQ = Math.floor(-options.halfSpanX / spacingX);
    const maxQ = Math.ceil(options.halfSpanX / spacingX);

    for (let q = minQ; q <= maxQ; q++) {
      const x = q * spacingX + rowOffsetX;
      const absX = Math.abs(x);

      const cliffZ = computeEscarpmentLineZ(x);
      const z = cliffZ - row * spacingZ + 0.8;

      if (z > -8.5) {
        continue;
      }

      const isBehindWaterfall = absX < 5.1;
      if (isBehindWaterfall && row === 0) {
        continue;
      }

      const distanceFade =
        1 - smoothstep({ edge0: 16, edge1: options.halfSpanX, value: absX }) * 0.52;
      const steppedTier =
        row === 0
          ? 0.58 + nextRand() * 0.36
          : row === 1
            ? 0.78 + nextRand() * 0.3
            : 0.96 + nextRand() * 0.26;

      let topY = (SCENE_CONFIG.crestHeight + 1.5) * distanceFade * steppedTier;
      if (isBehindWaterfall) {
        topY = Math.min(topY, SCENE_CONFIG.crestHeight - 0.5 - nextRand() * 1.8);
      }

      const baseY = -3.0;
      const height = Math.max(4.5, topY - baseY);

      columns.push({
        x,
        y: baseY + height * 0.5,
        z,
        radius: options.hexRadius * (0.97 + nextRand() * 0.08),
        height,
        rotationY: 0,
        tiltX: (nextRand() - 0.5) * 0.015,
        tiltZ: (nextRand() - 0.5) * 0.015,
        isHanging: false,
      });
    }
  }

  return columns;
}
