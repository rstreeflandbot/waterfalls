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
  readonly bridgeDeckY: number;
  readonly bridgeZ: number;
  readonly bridgeHalfSpan: number;
}

export const FOREST_WATERFALL_CONFIG: ForestWaterfallConfig = {
  upperCrestHeight: 33.4,
  upperCrestZ: -18.8,
  upperWidthTop: 1.85,
  upperWidthBottom: 3.15,
  midShelfHeight: 12.6,
  midShelfZ: -13.4,
  lowerWidthTop: 4.4,
  lowerWidthBottom: 6.4,
  plungeCenterZ: -8.2,
  bridgeDeckY: 15.6,
  bridgeZ: -11.2,
  bridgeHalfSpan: 11.2,
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
  return Math.sin((z + 8) * 0.044) * 3.6 + Math.cos((z + 12) * 0.022) * 2.2 - 0.6;
}

export function computeForestEscarpmentZ(x: number): number {
  const upperAlcove = -1.9 * Math.exp(-Math.pow(x / 4.8, 2));
  const canyonAmphitheater = Math.pow(Math.min(Math.abs(x), 42) * 0.056, 1.55) * 5.2;
  const rockyBend =
    Math.sin(x * 0.13 - 0.25) * 1.45 +
    Math.cos(x * 0.28 + 0.6) * 0.72 +
    (noiseForest2d({ x: x * 0.18, z: 4.5 }) - 0.5) * 1.85;
  return FOREST_WATERFALL_CONFIG.upperCrestZ + upperAlcove + canyonAmphitheater + rockyBend;
}

export function computeForestUpperCrestY(x: number): number {
  const notch = -1.15 * Math.exp(-Math.pow((x + 0.15) / 2.2, 2));
  const jag =
    Math.sin(x * 0.95 + 0.3) * 0.32 +
    Math.cos(x * 1.9 - 0.6) * 0.16 +
    (noiseForest2d({ x: x * 0.58, z: 9.2 }) - 0.5) * 0.4;
  return FOREST_WATERFALL_CONFIG.upperCrestHeight + notch + jag;
}

export function computeForestMidShelfY(x: number): number {
  const tilt = x * -0.08;
  const rockDip = -0.62 * Math.exp(-Math.pow((x - 0.65) / 2.1, 2));
  const jag = Math.sin(x * 0.8 + 1.0) * 0.34 + Math.cos(x * 1.6) * 0.18;
  return FOREST_WATERFALL_CONFIG.midShelfHeight + tilt + rockDip + jag;
}

export function computeForestCanyonTerrainHeight(input: TerrainHeightInput): number {
  const { x, z } = input;
  const cliffZ = computeForestEscarpmentZ(x);

  const upperDrop =
    1 -
    smoothstep({
      edge0: cliffZ - 1.8,
      edge1: cliffZ + 3.2,
      value: z,
    });

  const midShelfBand =
    (1 - smoothstep({ edge0: cliffZ + 2.6, edge1: cliffZ + 6.8, value: z })) *
    Math.exp(-Math.pow(x / 8.8, 2));

  const crag = ridgedMultifractal2d({ x: x * 0.052 + 2.1, z: z * 0.052 - 1.3, octaves: 4 });
  const strata = Math.sin(x * 0.12 + z * 0.09 + crag * 2.1) * 1.35;

  const upperNotch =
    (1 - smoothstep({ edge0: 2.2, edge1: 6.4, value: Math.abs(x + 0.15) })) *
    (1 - smoothstep({ edge0: -52, edge1: cliffZ + 2.0, value: z }));

  const upperPlateau =
    FOREST_WATERFALL_CONFIG.upperCrestHeight + 4.4 + crag * 10.6 - upperNotch * 5.2;
  const crestY = computeForestUpperCrestY(x);
  const blendedUpper = upperPlateau * (1 - upperNotch * 0.8) + (crestY - 0.5) * (upperNotch * 0.8);

  const upperCliffHeight = upperDrop * Math.max(0, blendedUpper + strata * (1 - upperNotch * 0.72));
  const midShelfHeight = midShelfBand * (computeForestMidShelfY(x) - 0.35 + crag * 1.35);

  const riverCenterX = computeForestRiverCenterX(z);
  const distToPlunge = Math.hypot(x * 0.88, z - (FOREST_WATERFALL_CONFIG.plungeCenterZ + 3.2));
  const plungeDepth = -3.4 * (1 - smoothstep({ edge0: 4.8, edge1: 13.8, value: distToPlunge }));

  const riverHalfWidth =
    5.8 +
    Math.exp(-Math.pow((z - (FOREST_WATERFALL_CONFIG.plungeCenterZ + 4.5)) / 9.2, 2)) * 4.8 +
    smoothstep({ edge0: 12, edge1: 86, value: z }) * 8.6;
  const distToRiver = Math.abs(x - riverCenterX);
  const riverMask =
    smoothstep({ edge0: cliffZ + 3.2, edge1: cliffZ + 8.8, value: z }) *
    (1 -
      smoothstep({
        edge0: riverHalfWidth * 0.55,
        edge1: riverHalfWidth + 5.6,
        value: distToRiver,
      }));
  const riverBed = -1.85 * riverMask;

  const valleyOpen = smoothstep({ edge0: cliffZ + 2.6, edge1: cliffZ + 12.5, value: z });
  const valleyMicro = ridgedMultifractal2d({ x: x * 0.042 - 3.2, z: z * 0.042 + 1.9, octaves: 3 });

  const innerGorgeButtress =
    smoothstep({ edge0: cliffZ - 2.0, edge1: cliffZ + 3.2, value: z }) *
    (1 - smoothstep({ edge0: -3.0, edge1: 15.0, value: z })) *
    smoothstep({ edge0: 4.8, edge1: 10.6, value: Math.abs(x) }) *
    (19.2 + valleyMicro * 6.0);

  const canyonFlanks =
    valleyOpen *
    smoothstep({
      edge0: riverHalfWidth + 1.0,
      edge1: riverHalfWidth + 22.0,
      value: distToRiver,
    }) *
    (14.5 + valleyMicro * 11.5) *
    (1 - smoothstep({ edge0: 20, edge1: 64, value: z }) * 0.62);

  const mossBanks =
    valleyOpen *
    smoothstep({ edge0: riverHalfWidth - 0.6, edge1: riverHalfWidth + 13.0, value: distToRiver }) *
    (2.8 + valleyMicro * 2.5);

  const skyNotchMask = smoothstep({ edge0: 14.0, edge1: 42.0, value: Math.abs(x) });
  const distantForestRidges =
    (1 - smoothstep({ edge0: -140, edge1: -44, value: z })) *
    skyNotchMask *
    (4.0 + ridgedMultifractal2d({ x: x * 0.022 + 5.1, z: z * 0.022 + 2.4, octaves: 4 }) * 8.0);

  const rockMicro = (noiseForest2d({ x: x * 0.32, z: z * 0.32 }) - 0.5) * 0.58;
  const waterDepression =
    Math.min(plungeDepth, riverBed) *
    (1 - clamp({ value: upperDrop + midShelfBand, min: 0, max: 1 }));

  const cliffMass = Math.max(upperCliffHeight, midShelfHeight, innerGorgeButtress);
  return cliffMass + waterDepression + mossBanks + canyonFlanks + distantForestRidges + rockMicro;
}
