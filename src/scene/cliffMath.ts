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
  crestHeight: 18.6,
  crestZ: -2.4,
  crestWidth: 7.4,
  plungeCenterZ: 0.75,
  plungeWidth: 9.2,
  poolSurfaceY: 0.0,
  sunDirection: normalizeVec3({ x: -0.66, y: 0.23, z: -0.71 }),
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
  readonly ringColumnCount: number;
  readonly hangingColumnCount: number;
  readonly outerWallCount: number;
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
  const z = input.startZ + input.forwardReach * Math.pow(clampedProgress, 0.85);
  const speedFactor = 0.35 + clampedProgress * 1.45;
  return { y, z, speedFactor };
}

export function computeRockWetness(input: WetnessInput): number {
  const poolProximity =
    1 -
    smoothstep({
      edge0: 0.2,
      edge1: 3.8,
      value: input.y - SCENE_CONFIG.poolSurfaceY,
    });

  const horizontalDistToFall = Math.hypot(
    input.x * 0.72,
    input.z - SCENE_CONFIG.plungeCenterZ * 0.6,
  );
  const sprayProximity =
    1 -
    smoothstep({
      edge0: 3.5,
      edge1: 12.5,
      value: horizontalDistToFall,
    });

  const heightMask =
    1 -
    smoothstep({
      edge0: SCENE_CONFIG.crestHeight + 1.2,
      edge1: SCENE_CONFIG.crestHeight + 4.5,
      value: input.y,
    });

  const combinedSpray = sprayProximity * heightMask;
  return clamp({
    value: Math.max(poolProximity, combinedSpray * 0.92),
    min: 0,
    max: 1,
  });
}

export function computeAmphitheaterRadius(angleRadians: number): number {
  const cosAngle = Math.cos(angleRadians);
  const sinAngle = Math.sin(angleRadians);
  const baseRadius = 11.4 + 4.8 * Math.pow(Math.abs(sinAngle), 1.35);
  const grottoRecess = cosAngle > 0 ? -2.2 * Math.pow(cosAngle, 2.2) : 0;
  return baseRadius + grottoRecess;
}

export function generateBasaltColumnLayout(options: ColumnLayoutOptions): BasaltColumnPlacement[] {
  const nextRand = createSeededRandom(options.seed);
  const columns: BasaltColumnPlacement[] = [];

  for (let i = 0; i < options.ringColumnCount; i++) {
    const t = i / Math.max(1, options.ringColumnCount - 1);
    const angle = -Math.PI * 0.76 + t * Math.PI * 1.52;
    const sinAngle = Math.sin(angle);
    const cosAngle = Math.cos(angle);
    const radialJitter = (nextRand() - 0.5) * 2.1;
    const baseRadius = computeAmphitheaterRadius(angle) + radialJitter;

    const x = sinAngle * baseRadius;
    const z = -cosAngle * baseRadius + 3.2;

    const isWaterfallChannel = Math.abs(x) < 3.6 && z < -0.5;
    const radius = 0.62 + nextRand() * 0.42;

    let topY: number;
    if (isWaterfallChannel) {
      topY = SCENE_CONFIG.crestHeight - 0.45 - nextRand() * 0.65;
    } else {
      const sideLift = smoothstep({ edge0: 3.4, edge1: 9.5, value: Math.abs(x) }) * 5.2;
      const canyonFade =
        1 -
        smoothstep({
          edge0: 11.0,
          edge1: 21.0,
          value: z,
        }) *
          0.42;
      topY = (SCENE_CONFIG.crestHeight + sideLift + (nextRand() - 0.35) * 4.4) * canyonFade;
    }

    const baseY = -3.0;
    const height = Math.max(4.0, topY - baseY);
    columns.push({
      x,
      y: baseY + height * 0.5,
      z,
      radius,
      height,
      rotationY: Math.floor(nextRand() * 6) * (Math.PI / 3) + (nextRand() - 0.5) * 0.14,
      tiltX: (nextRand() - 0.5) * 0.04,
      tiltZ: (nextRand() - 0.5) * 0.04,
      isHanging: false,
    });
  }

  for (let i = 0; i < options.hangingColumnCount; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const sideProgress =
      Math.floor(i / 2) / Math.max(1, Math.floor(options.hangingColumnCount / 2));
    const angle = side * (0.26 + sideProgress * 0.92 + (nextRand() - 0.5) * 0.08);
    const radiusDist = computeAmphitheaterRadius(angle) - 1.45 - nextRand() * 1.1;
    const x = Math.sin(angle) * radiusDist;
    const z = -Math.cos(angle) * radiusDist + 3.2;

    if (Math.abs(x) < 3.55 && z < 0.2) {
      continue;
    }

    const columnRadius = 0.44 + nextRand() * 0.26;
    const topY = SCENE_CONFIG.crestHeight + 3.2 + nextRand() * 4.5;
    const bottomY = 7.8 + nextRand() * 6.8;
    const height = Math.max(4.2, topY - bottomY);

    columns.push({
      x,
      y: bottomY + height * 0.5,
      z,
      radius: columnRadius,
      height,
      rotationY: Math.floor(nextRand() * 6) * (Math.PI / 3),
      tiltX: (nextRand() - 0.5) * 0.03,
      tiltZ: (nextRand() - 0.5) * 0.03,
      isHanging: true,
    });
  }

  for (let i = 0; i < options.outerWallCount; i++) {
    const t = i / Math.max(1, options.outerWallCount - 1);
    const angle = -Math.PI * 0.85 + t * Math.PI * 1.7;
    const tierOffset = 3.2 + nextRand() * 7.8;
    const baseRadius = computeAmphitheaterRadius(angle) + tierOffset;
    const x = Math.sin(angle) * baseRadius;
    const z = -Math.cos(angle) * baseRadius + 3.0;

    if (Math.abs(x) < 4.4 && z < -3.0 && z > -22.0) {
      continue;
    }

    const radius = 0.85 + nextRand() * 0.65;
    const distanceFromCenter = Math.hypot(x, z);
    const topY =
      SCENE_CONFIG.crestHeight +
      2.5 +
      smoothstep({ edge0: 10, edge1: 24, value: distanceFromCenter }) * 8.5 +
      (nextRand() - 0.4) * 5.2;
    const baseY = -4.0;
    const height = Math.max(6.0, topY - baseY);

    columns.push({
      x,
      y: baseY + height * 0.5,
      z,
      radius,
      height,
      rotationY: Math.floor(nextRand() * 6) * (Math.PI / 3) + (nextRand() - 0.5) * 0.12,
      tiltX: (nextRand() - 0.5) * 0.05,
      tiltZ: (nextRand() - 0.5) * 0.05,
      isHanging: false,
    });
  }

  return columns;
}
