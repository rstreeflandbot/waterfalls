import { describe, expect, it } from 'vitest';
import {
  SCENE_CONFIG,
  clamp,
  computeEscarpmentLineZ,
  computeGravityFallTime,
  computeOpenVolcanicTerrainHeight,
  computeParabolicFallPoint,
  computeRiverCenterX,
  computeRockWetness,
  createSeededRandom,
  generateBasaltColumnLayout,
  normalizeVec3,
  smoothstep,
} from './cliffMath';

describe('cliffMath', () => {
  it('clamps values to inclusive bounds', () => {
    expect(clamp({ value: -3, min: 0, max: 1 })).toBe(0);
    expect(clamp({ value: 0.4, min: 0, max: 1 })).toBe(0.4);
    expect(clamp({ value: 5, min: 0, max: 1 })).toBe(1);
  });

  it('evaluates smoothstep edges and midpoint', () => {
    expect(smoothstep({ edge0: 2, edge1: 6, value: 1 })).toBe(0);
    expect(smoothstep({ edge0: 2, edge1: 6, value: 4 })).toBe(0.5);
    expect(smoothstep({ edge0: 2, edge1: 6, value: 9 })).toBe(1);
  });

  it('normalizes 3D vectors and handles zero vector safely', () => {
    const unit = normalizeVec3({ x: 3, y: 4, z: 0 });
    expect(unit.x).toBeCloseTo(0.6, 5);
    expect(unit.y).toBeCloseTo(0.8, 5);
    expect(unit.z).toBe(0);

    expect(normalizeVec3({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('produces deterministic random sequences for the same seed', () => {
    const first = createSeededRandom(42);
    const second = createSeededRandom(42);

    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
  });

  it('computes parabolic free-fall trajectory with gravity acceleration', () => {
    const top = computeParabolicFallPoint({
      progress: 0,
      startY: 23.5,
      endY: 0,
      startZ: -14.2,
      forwardReach: 3.8,
    });
    const mid = computeParabolicFallPoint({
      progress: 0.5,
      startY: 23.5,
      endY: 0,
      startZ: -14.2,
      forwardReach: 3.8,
    });
    const bottom = computeParabolicFallPoint({
      progress: 1,
      startY: 23.5,
      endY: 0,
      startZ: -14.2,
      forwardReach: 3.8,
    });

    expect(top.y).toBe(23.5);
    expect(top.z).toBe(-14.2);
    expect(mid.y).toBeCloseTo(17.625, 5);
    expect(bottom.y).toBe(0);
    expect(bottom.z).toBeCloseTo(-10.4, 5);
    expect(bottom.speedFactor).toBeGreaterThan(mid.speedFactor);
    expect(mid.speedFactor).toBeGreaterThan(top.speedFactor);
  });

  it('maps vertical fall progress to concave downward gravity fall time', () => {
    const t0 = computeGravityFallTime(0);
    const tQuarter = computeGravityFallTime(0.25);
    const tHalf = computeGravityFallTime(0.5);
    const tBottom = computeGravityFallTime(1);

    expect(t0).toBeCloseTo(0, 5);
    expect(tQuarter).toBeGreaterThan(t0);
    expect(tHalf).toBeGreaterThan(tQuarter);
    expect(tBottom).toBeGreaterThan(tHalf);
    expect(tQuarter - t0).toBeGreaterThan(tBottom - tHalf);
  });

  it('assigns maximum wetness near the pool and waterfall splash zone', () => {
    const shoreline = computeRockWetness({ x: 10, y: 0.1, z: 6 });
    const splashZone = computeRockWetness({ x: 1.5, y: 8, z: SCENE_CONFIG.plungeCenterZ });
    const dryHighCliff = computeRockWetness({ x: 35, y: 28, z: -24 });

    expect(shoreline).toBe(1);
    expect(splashZone).toBeGreaterThan(0.8);
    expect(dryHighCliff).toBe(0);
  });

  it('creates an open valley in front of the cliff escarpment', () => {
    const behindFalls = computeOpenVolcanicTerrainHeight({ x: 12, z: -24 });
    const plungePool = computeOpenVolcanicTerrainHeight({
      x: 0,
      z: SCENE_CONFIG.plungeCenterZ + 3,
    });
    const openValleyShore = computeOpenVolcanicTerrainHeight({ x: 16, z: 22 });
    const riverMid = computeOpenVolcanicTerrainHeight({
      x: computeRiverCenterX(24),
      z: 24,
    });

    expect(behindFalls).toBeGreaterThan(18);
    expect(plungePool).toBeLessThan(0);
    expect(riverMid).toBeLessThan(0);
    expect(openValleyShore).toBeLessThan(5);
    expect(computeEscarpmentLineZ(0)).toBeLessThan(SCENE_CONFIG.crestZ);
  });

  it('keeps all basalt columns along the back cliff without enclosing the viewer', () => {
    const columns = generateBasaltColumnLayout({
      seed: 202611,
      cliffClusterCount: 150,
      ledgeOutcropCount: 56,
    });

    expect(columns.length).toBeGreaterThan(120);

    const columnsInFrontValley = columns.filter((column) => column.z > -7.5);
    expect(columnsInFrontValley).toEqual([]);

    const columnsInWaterfallChannel = columns.filter((column) => Math.abs(column.x) < 4.9);
    expect(columnsInWaterfallChannel).toEqual([]);
  });
});
