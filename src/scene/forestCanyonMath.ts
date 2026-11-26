import { TerrainHeightInput, clamp, ridgedMultifractal2d, smoothstep } from './cliffMath';

export interface ForestWaterfallConfig {
  readonly upperCrestHeight: number;
  readonly upperCrestZ: number;
  readonly upperWidthTop: number;
  readonly upperWidthBottom: number;
  readonly midShelfHeight: number;
  readonly midShelfZ: number;
  readonly lowerWidthTop: number;
  readonly lowerWidthBottom: number;
  readonly plungeCenterZ: number;
}

export const FOREST_WATERFALL_CONFIG: ForestWaterfallConfig = {
  upperCrestHeight: 25.4,
  upperCrestZ: -16.8,
  upperWidthTop: 6.4,
  upperWidthBottom: 7.8,
  midShelfHeight: 11.4,
  midShelfZ: -13.2,
  lowerWidthTop: 9.6,
  lowerWidthBottom: 12.6,
  plungeCenterZ: -8.6,
};

function hashForest2d(coords: { readonly x: number; readonly z: number }): number {
  const s = Math.sin(coords.x * 137.3 + coords.z * 289.7) * 43758.5453;
  return s - Math.floor(s);
}

function noiseForest2d(coords: { readonly x: number; readonly z: number }): number {
  const ix = Math.floor(coords.x);
  const iz = Math.floor(coords.z);
  const fx = coords.x - ix;
  const fz = coords.z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);

  const a = hashForest2d({ x: ix, z: iz });
  const b = hashForest2d({ x: ix + 1, z: iz });
  const c = hashForest2d({ x: ix, z: iz + 1 });
  const d = hashForest2d({ x: ix + 1, z: iz + 1 });

  return (a * (1 - ux) + b * ux) * (1 - uz) + (c * (1 - ux) + d * ux) * uz;
}

export function computeForestRiverCenterX(z: number): number {
  return Math.sin((z + 8) * 0.048) * 4.4 + Math.cos((z + 12) * 0.021) * 2.8 - 1.2;
}

export function computeForestEscarpmentZ(x: number): number {
  const upperNotch = -1.6 * Math.exp(-Math.pow((x + 0.5) / 5.4, 2));
  const canyonBowl = Math.pow(Math.min(Math.abs(x), 42) * 0.048, 1.55) * 4.2;
  const rockyBend =
    Math.sin(x * 0.12 - 0.3) * 1.5 +
    Math.cos(x * 0.26 + 0.7) * 0.75 +
    (noiseForest2d({ x: x * 0.16, z: 4.5 }) - 0.5) * 2.0;
  return FOREST_WATERFALL_CONFIG.upperCrestZ + upperNotch + canyonBowl + rockyBend;
}

export function computeForestUpperCrestY(x: number): number {
  const notch = -0.85 * Math.exp(-Math.pow((x + 0.4) / 2.6, 2));
  const jag =
    Math.sin(x * 0.9 + 0.4) * 0.32 +
    Math.cos(x * 1.8 - 0.7) * 0.16 +
    (noiseForest2d({ x: x * 0.55, z: 9.2 }) - 0.5) * 0.42;
  return FOREST_WATERFALL_CONFIG.upperCrestHeight + notch + jag;
}

export function computeForestMidShelfY(x: number): number {
  const tilt = x * -0.09;
  const rockDip = -0.65 * Math.exp(-Math.pow((x - 1.1) / 2.4, 2));
  const jag = Math.sin(x * 0.75 + 1.1) * 0.36 + Math.cos(x * 1.5) * 0.18;
  return FOREST_WATERFALL_CONFIG.midShelfHeight + tilt + rockDip + jag;
}

export function computeForestCanyonTerrainHeight(input: TerrainHeightInput): number {
  const { x, z } = input;
  const cliffZ = computeForestEscarpmentZ(x);

  const upperDrop =
    1 -
    smoothstep({
      edge0: cliffZ - 1.8,
      edge1: cliffZ + 3.4,
      value: z,
    });

  const midShelfBand =
    (1 - smoothstep({ edge0: cliffZ + 2.2, edge1: cliffZ + 6.4, value: z })) *
    Math.exp(-Math.pow(x / 10.5, 2));

  const crag = ridgedMultifractal2d({ x: x * 0.048 + 2.1, z: z * 0.048 - 1.3, octaves: 4 });
  const strata = Math.sin(x * 0.11 + z * 0.09 + crag * 2.0) * 1.25;

  const upperNotch =
    (1 - smoothstep({ edge0: 3.2, edge1: 8.4, value: Math.abs(x + 0.4) })) *
    (1 - smoothstep({ edge0: -48, edge1: cliffZ + 2.0, value: z }));

  const upperPlateau =
    FOREST_WATERFALL_CONFIG.upperCrestHeight + 3.2 + crag * 9.8 - upperNotch * 4.4;
  const crestY = computeForestUpperCrestY(x);
  const blendedUpper =
    upperPlateau * (1 - upperNotch * 0.78) + (crestY - 0.55) * (upperNotch * 0.78);

  const upperCliffHeight = upperDrop * Math.max(0, blendedUpper + strata * (1 - upperNotch * 0.7));
  const midShelfHeight = midShelfBand * (computeForestMidShelfY(x) - 0.35 + crag * 1.4);

  const riverCenterX = computeForestRiverCenterX(z);
  const distToPlunge = Math.hypot(x * 0.85, z - (FOREST_WATERFALL_CONFIG.plungeCenterZ + 3.2));
  const plungeDepth = -3.2 * (1 - smoothstep({ edge0: 5.2, edge1: 14.5, value: distToPlunge }));

  const riverHalfWidth =
    6.8 +
    Math.exp(-Math.pow((z - (FOREST_WATERFALL_CONFIG.plungeCenterZ + 4.0)) / 9.5, 2)) * 5.4 +
    smoothstep({ edge0: 14, edge1: 88, value: z }) * 8.2;
  const distToRiver = Math.abs(x - riverCenterX);
  const riverMask =
    smoothstep({ edge0: cliffZ + 3.0, edge1: cliffZ + 8.5, value: z }) *
    (1 -
      smoothstep({
        edge0: riverHalfWidth * 0.55,
        edge1: riverHalfWidth + 6.0,
        value: distToRiver,
      }));
  const riverBed = -1.75 * riverMask;

  const valleyOpen = smoothstep({ edge0: cliffZ + 3.0, edge1: cliffZ + 14.0, value: z });
  const valleyMicro = ridgedMultifractal2d({ x: x * 0.036 - 3.2, z: z * 0.036 + 1.9, octaves: 3 });

  const canyonFlanks =
    valleyOpen *
    smoothstep({
      edge0: riverHalfWidth + 1.5,
      edge1: riverHalfWidth + 24.0,
      value: distToRiver,
    }) *
    (12.0 + valleyMicro * 10.5) *
    (1 - smoothstep({ edge0: 26, edge1: 68, value: z }) * 0.56);

  const mossBanks =
    valleyOpen *
    smoothstep({ edge0: riverHalfWidth - 0.5, edge1: riverHalfWidth + 14.0, value: distToRiver }) *
    (2.6 + valleyMicro * 2.4);

  const distantForestRidges =
    (1 - smoothstep({ edge0: -135, edge1: -42, value: z })) *
    (12.0 + ridgedMultifractal2d({ x: x * 0.02 + 5.1, z: z * 0.02 + 2.4, octaves: 4 }) * 30.0);

  const rockMicro = (noiseForest2d({ x: x * 0.3, z: z * 0.3 }) - 0.5) * 0.55;
  const waterDepression =
    Math.min(plungeDepth, riverBed) *
    (1 - clamp({ value: upperDrop + midShelfBand, min: 0, max: 1 }));

  const cliffMass = Math.max(upperCliffHeight, midShelfHeight);
  return cliffMass + waterDepression + mossBanks + canyonFlanks + distantForestRidges + rockMicro;
}
