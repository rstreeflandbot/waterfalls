import { Vec3Tuple, normalizeVec3 } from './cliffMath';

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

export interface WaterStyle {
  readonly plungeCenterZ: number;
  readonly absorption: readonly [number, number, number];
  readonly deepScatter: readonly [number, number, number];
  readonly aeratedGlow: readonly [number, number, number];
}

export interface IcelandWaterfallConfig {
  readonly title: string;
  readonly eyebrow: string;
  readonly sunDirection: Vec3Tuple;
  readonly sunColorHex: number;
  readonly sunIntensity: number;
  readonly hemiSkyHex: number;
  readonly hemiGroundHex: number;
  readonly hemiIntensity: number;
  readonly bounceHex: number;
  readonly bounceIntensity: number;
  readonly fogColorHex: number;
  readonly godRayStrength: number;
  readonly godRayTint: readonly [number, number, number];
  readonly exposure: number;
  readonly skyPalette: SkyPalette;
  readonly waterStyle: WaterStyle;
  readonly heroCameraPosition: Vec3Tuple;
  readonly heroCameraTarget: Vec3Tuple;
}

export const ICELAND_WATERFALL_CONFIG: IcelandWaterfallConfig = {
  title: 'Skógafoss',
  eyebrow: 'ICELAND · VOLCANIC HIGHLANDS',
  sunDirection: normalizeVec3({ x: -0.72, y: 0.24, z: -0.65 }),
  sunColorHex: 0xffbc80,
  sunIntensity: 3.35,
  hemiSkyHex: 0x8db2db,
  hemiGroundHex: 0x1b222a,
  hemiIntensity: 1.25,
  bounceHex: 0x7c9ec2,
  bounceIntensity: 0.92,
  fogColorHex: 0x28303b,
  godRayStrength: 0.34,
  godRayTint: [1.25, 0.72, 0.34],
  exposure: 1.12,
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
};
