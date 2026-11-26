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
  plungeWidth: 12.8,
  poolSurfaceY: 0.0,
  sunDirection: normalizeVec3({ x: -0.72, y: 0.22, z: -0.66 }),
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
  readonly cliffClusterCount: number;
  readonly ledgeOutcropCount: number;
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
  const alcoveRecess = -3.4 * Math.exp(-Math.pow(x / 8.5, 2));
  const sweepingCurve = -Math.pow(Math.abs(x) * 0.055, 1.45) * 3.2;
  const rockyMeander = Math.sin(x * 0.085) * 2.4 + Math.cos(x * 0.19) * 1.1;
  return SCENE_CONFIG.crestZ + alcoveRecess + sweepingCurve + rockyMeander;
}

export function computeOpenVolcanicTerrainHeight(input: TerrainHeightInput): number {
  const { x, z } = input;
  const cliffLineZ = computeEscarpmentLineZ(x);

  const escarpmentTransition =
    1 -
    smoothstep({
      edge0: cliffLineZ - 4.5,
      edge1: cliffLineZ + 6.5,
      value: z,
    });

  const riverNotchDist = Math.abs(x - Math.sin((z + 14) * 0.05) * 1.4);
  const upperGorgeNotch =
    (1 - smoothstep({ edge0: 4.4, edge1: 10.5, value: riverNotchDist })) *
    (1 - smoothstep({ edge0: -38, edge1: -11, value: z }));

  const lateralSlopeDown = 1 - smoothstep({ edge0: 36, edge1: 115, value: Math.abs(x) }) * 0.42;

  const plateauBase =
    (SCENE_CONFIG.crestHeight +
      2.6 +
      Math.sin(x * 0.055) * 3.4 +
      Math.cos(z * 0.065 + x * 0.03) * 2.6) *
      lateralSlopeDown -
    upperGorgeNotch * 3.4;

  const steppedTerrace =
    Math.sin(x * 0.13 + z * 0.09) * 1.65 + Math.cos(x * 0.29 - z * 0.22) * 0.65;

  const escarpmentHeight = escarpmentTransition * Math.max(0, plateauBase + steppedTerrace);

  const distToPlunge = Math.hypot(x * 0.85, z - (SCENE_CONFIG.plungeCenterZ + 3.2));
  const plungePoolDepth = -3.2 * (1 - smoothstep({ edge0: 5.5, edge1: 15.5, value: distToPlunge }));

  const riverCenterX = computeRiverCenterX(z);
  const riverHalfWidth =
    7.8 +
    Math.exp(-Math.pow((z - (SCENE_CONFIG.plungeCenterZ + 4)) / 10, 2)) * 5.6 +
    smoothstep({ edge0: 14, edge1: 95, value: z }) * 9.0;
  const distToRiver = Math.abs(x - riverCenterX);
  const riverMask =
    smoothstep({ edge0: cliffLineZ + 1.0, edge1: cliffLineZ + 7.5, value: z }) *
    (1 -
      smoothstep({
        edge0: riverHalfWidth * 0.6,
        edge1: riverHalfWidth + 6.5,
        value: distToRiver,
      }));
  const riverBedDepth = -1.75 * riverMask;

  const valleyOpenMask = smoothstep({
    edge0: cliffLineZ + 2.0,
    edge1: cliffLineZ + 14.0,
    value: z,
  });
  const bankRise =
    valleyOpenMask *
    smoothstep({ edge0: riverHalfWidth - 0.5, edge1: riverHalfWidth + 28.0, value: distToRiver }) *
    (4.6 + Math.sin(x * 0.06 + z * 0.04) * 2.2 + Math.cos(x * 0.14 - z * 0.11) * 0.9);

  const farRollingHills =
    valleyOpenMask *
    smoothstep({ edge0: 42, edge1: 118, value: Math.abs(x) }) *
    (11.0 + Math.abs(Math.sin(z * 0.045 + x * 0.03)) * 11.0);

  const distantMountainMask = 1 - smoothstep({ edge0: -135, edge1: -44, value: z });
  const mesaWaveA = Math.sin(x * 0.028 + 0.7) * 0.5 + 0.5;
  const mesaWaveB = Math.cos(x * 0.052 - z * 0.024 + 1.2) * 0.5 + 0.5;
  const volcanicMesa =
    smoothstep({ edge0: 0.15, edge1: 0.85, value: mesaWaveA * 0.65 + mesaWaveB * 0.35 }) * 28.0;
  const ridgeCrenellation =
    Math.sin(x * 0.11 + z * 0.06) * 4.2 + Math.cos(x * 0.19 - z * 0.12) * 2.1;
  const distantMountains = distantMountainMask * (12.0 + volcanicMesa + ridgeCrenellation);

  const rockDetail =
    Math.sin(x * 0.34 + z * 0.28) * 0.38 +
    Math.cos(x * 0.78 - z * 0.66) * 0.18 +
    Math.sin(x * 1.55 + z * 1.25) * 0.07;

  const waterDepression = Math.min(plungePoolDepth, riverBedDepth);
  const valleyElevation = waterDepression + bankRise + farRollingHills;

  return Math.max(valleyElevation, escarpmentHeight) + distantMountains + rockDetail;
}

export function generateBasaltColumnLayout(options: ColumnLayoutOptions): BasaltColumnPlacement[] {
  const nextRand = createSeededRandom(options.seed);
  const columns: BasaltColumnPlacement[] = [];

  for (let i = 0; i < options.cliffClusterCount; i++) {
    const t = i / Math.max(1, options.cliffClusterCount - 1);
    const x = -34 + t * 68 + (nextRand() - 0.5) * 1.6;

    if (Math.abs(x) < 5.0) {
      continue;
    }

    const cliffZ = computeEscarpmentLineZ(x);
    const z = cliffZ - 0.8 + (nextRand() - 0.5) * 3.8;

    if (z > -8.5) {
      continue;
    }

    const radius = 0.62 + nextRand() * 0.55;
    const distanceFromFalls = Math.abs(x);
    const heightScale = 1 - smoothstep({ edge0: 14, edge1: 35, value: distanceFromFalls }) * 0.42;
    const topY = (SCENE_CONFIG.crestHeight + 1.8 + (nextRand() - 0.42) * 7.5) * heightScale;
    const baseY = -2.5;
    const height = Math.max(6.0, topY - baseY);

    columns.push({
      x,
      y: baseY + height * 0.5,
      z,
      radius,
      height,
      rotationY: Math.floor(nextRand() * 6) * (Math.PI / 3) + (nextRand() - 0.5) * 0.14,
      tiltX: (nextRand() - 0.5) * 0.05,
      tiltZ: (nextRand() - 0.5) * 0.05,
      isHanging: false,
    });
  }

  for (let i = 0; i < options.ledgeOutcropCount; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const rank = Math.floor(i / 2) / Math.max(1, Math.floor(options.ledgeOutcropCount / 2));
    const x = side * (5.3 + rank * 19.0 + (nextRand() - 0.5) * 1.4);
    const cliffZ = computeEscarpmentLineZ(x);
    const z = cliffZ + 0.6 + nextRand() * 2.6;

    if (z > -7.5) {
      continue;
    }

    const radius = 0.46 + nextRand() * 0.36;
    const isSteppedShelf = nextRand() > 0.42;
    const bottomY = isSteppedShelf ? -2.0 : 8.5 + nextRand() * 7.0;
    const topY = isSteppedShelf
      ? 4.0 + nextRand() * 11.5
      : SCENE_CONFIG.crestHeight + 1.2 + nextRand() * 4.0;
    const height = Math.max(3.5, topY - bottomY);

    columns.push({
      x,
      y: bottomY + height * 0.5,
      z,
      radius,
      height,
      rotationY: Math.floor(nextRand() * 6) * (Math.PI / 3),
      tiltX: (nextRand() - 0.5) * 0.04,
      tiltZ: (nextRand() - 0.5) * 0.04,
      isHanging: !isSteppedShelf,
    });
  }

  return columns;
}
