import { Vec3Tuple, normalizeVec3 } from './cliffMath';

export type WaterfallPresetId = 'iceland' | 'forest';

export interface SkyPalette {
  readonly zenith: readonly [number, number, number];
  readonly midSky: readonly [number, number, number];
  readonly horizonCool: readonly [number, number, number];
  readonly horizonWarm: readonly [number, number, number];
  readonly cloudShadow: readonly [number, number, number];
  readonly cloudMid: readonly [number, number, number];
  readonly cloudSunRim: readonly [number, number, number];
  readonly lowerMistCool: readonly [number, number, number];
  readonly lowerMistWarm: readonly [number, number, number];
}

export interface WaterBiomeStyle {
  readonly plungeCenterZ: number;
  readonly absorption: readonly [number, number, number];
  readonly deepScatter: readonly [number, number, number];
  readonly aeratedGlow: readonly [number, number, number];
}

export interface WaterfallPresetConfig {
  readonly id: WaterfallPresetId;
  readonly title: string;
  readonly eyebrow: string;
  readonly buttonLabel: string;
  readonly sunDirection: Vec3Tuple;
  readonly sunColorHex: number;
  readonly sunIntensity: number;
  readonly hemiSkyHex: number;
  readonly hemiGroundHex: number;
  readonly hemiIntensity: number;
  readonly bounceHex: number;
  readonly bounceIntensity: number;
  readonly fogColorHex: number;
  readonly fogLinearCool: readonly [number, number, number];
  readonly fogLinearWarm: readonly [number, number, number];
  readonly godRayStrength: number;
  readonly godRayTint: readonly [number, number, number];
  readonly skyPalette: SkyPalette;
  readonly waterStyle: WaterBiomeStyle;
  readonly heroCameraPosition: Vec3Tuple;
  readonly heroCameraTarget: Vec3Tuple;
}

export const WATERFALL_PRESETS: Record<WaterfallPresetId, WaterfallPresetConfig> = {
  iceland: {
    id: 'iceland',
    title: 'Skógafoss',
    eyebrow: 'ICELAND · VOLCANIC HIGHLANDS',
    buttonLabel: 'Iceland',
    sunDirection: normalizeVec3({ x: -0.72, y: 0.24, z: -0.65 }),
    sunColorHex: 0xffbc80,
    sunIntensity: 3.35,
    hemiSkyHex: 0x8db2db,
    hemiGroundHex: 0x1b222a,
    hemiIntensity: 1.25,
    bounceHex: 0x7c9ec2,
    bounceIntensity: 0.92,
    fogColorHex: 0x28303b,
    fogLinearCool: [0.024, 0.034, 0.048],
    fogLinearWarm: [0.16, 0.095, 0.048],
    godRayStrength: 0.34,
    godRayTint: [1.25, 0.72, 0.34],
    skyPalette: {
      zenith: [0.055, 0.085, 0.14],
      midSky: [0.16, 0.21, 0.3],
      horizonCool: [0.35, 0.37, 0.43],
      horizonWarm: [0.98, 0.56, 0.27],
      cloudShadow: [0.085, 0.105, 0.145],
      cloudMid: [0.24, 0.27, 0.33],
      cloudSunRim: [1.22, 0.66, 0.32],
      lowerMistCool: [0.12, 0.15, 0.19],
      lowerMistWarm: [0.32, 0.24, 0.2],
    },
    waterStyle: {
      plungeCenterZ: -9.7,
      absorption: [0.72, 0.34, 0.25],
      deepScatter: [0.009, 0.028, 0.036],
      aeratedGlow: [0.03, 0.065, 0.075],
    },
    heroCameraPosition: { x: 21.3, y: 11.8, z: 47.7 },
    heroCameraTarget: { x: -0.3, y: 10.4, z: -12.4 },
  },
  forest: {
    id: 'forest',
    title: 'Multnomah Gorge',
    eyebrow: 'PACIFIC NORTHWEST · AUTUMN FOREST CANYON',
    buttonLabel: 'Forest Canyon',
    sunDirection: normalizeVec3({ x: -0.26, y: 0.44, z: -0.86 }),
    sunColorHex: 0xffd18a,
    sunIntensity: 4.15,
    hemiSkyHex: 0xbcd4ca,
    hemiGroundHex: 0x261a10,
    hemiIntensity: 1.5,
    bounceHex: 0xd4954e,
    bounceIntensity: 1.12,
    fogColorHex: 0x352f27,
    fogLinearCool: [0.036, 0.04, 0.038],
    fogLinearWarm: [0.28, 0.2, 0.11],
    godRayStrength: 0.72,
    godRayTint: [1.42, 0.98, 0.5],
    skyPalette: {
      zenith: [0.14, 0.22, 0.3],
      midSky: [0.34, 0.4, 0.44],
      horizonCool: [0.58, 0.58, 0.54],
      horizonWarm: [1.28, 1.0, 0.68],
      cloudShadow: [0.24, 0.25, 0.24],
      cloudMid: [0.56, 0.54, 0.5],
      cloudSunRim: [1.5, 1.18, 0.78],
      lowerMistCool: [0.22, 0.24, 0.22],
      lowerMistWarm: [0.64, 0.49, 0.32],
    },
    waterStyle: {
      plungeCenterZ: -8.2,
      absorption: [0.72, 0.46, 0.58],
      deepScatter: [0.011, 0.022, 0.014],
      aeratedGlow: [0.052, 0.068, 0.056],
    },
    heroCameraPosition: { x: 8.6, y: 11.4, z: 46.8 },
    heroCameraTarget: { x: -0.2, y: 15.2, z: -13.5 },
  },
};

export function getNextWaterfallPresetId(current: WaterfallPresetId): WaterfallPresetId {
  return current === 'iceland' ? 'forest' : 'iceland';
}
