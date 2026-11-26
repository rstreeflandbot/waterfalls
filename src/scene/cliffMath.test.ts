import { describe, expect, it } from 'vitest';
import {
  SCENE_CONFIG,
  clamp,
  computeAmphitheaterRadius,
  computeParabolicFallPoint,
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
      startY: 18,
      endY: 0,
      startZ: -2,
      forwardReach: 3,
    });
    const mid = computeParabolicFallPoint({
      progress: 0.5,
      startY: 18,
      endY: 0,
      startZ: -2,
      forwardReach: 3,
    });
    const bottom = computeParabolicFallPoint({
      progress: 1,
      startY: 18,
      endY: 0,
      startZ: -2,
      forwardReach: 3,
    });

    expect(top.y).toBe(18);
    expect(top.z).toBe(-2);
    expect(mid.y).toBe(13.5);
    expect(bottom.y).toBe(0);
    expect(bottom.z).toBeCloseTo(1, 5);
    expect(bottom.speedFactor).toBeGreaterThan(mid.speedFactor);
    expect(mid.speedFactor).toBeGreaterThan(top.speedFactor);
  });

  it('assigns maximum wetness near the pool and waterfall splash zone', () => {
    const shoreline = computeRockWetness({ x: 10, y: 0.1, z: 6 });
    const splashZone = computeRockWetness({ x: 1.5, y: 8, z: 0.4 });
    const dryHighCliff = computeRockWetness({ x: 20, y: 24, z: 10 });

    expect(shoreline).toBe(1);
    expect(splashZone).toBeGreaterThan(0.8);
    expect(dryHighCliff).toBe(0);
  });

  it('recesses the amphitheater grotto directly behind the waterfall', () => {
    const behindWaterfall = computeAmphitheaterRadius(0);
    const sideCanyon = computeAmphitheaterRadius(Math.PI * 0.5);

    expect(behindWaterfall).toBeLessThan(sideCanyon);
  });

  it('generates basalt columns while leaving the waterfall channel clear', () => {
    const columns = generateBasaltColumnLayout({
      seed: 1337,
      ringColumnCount: 120,
      hangingColumnCount: 36,
      outerWallCount: 80,
    });

    expect(columns.length).toBeGreaterThan(200);

    const hangingInWaterChannel = columns.filter(
      (column) => column.isHanging && Math.abs(column.x) < 3.55 && column.z < 0.2,
    );
    expect(hangingInWaterChannel).toEqual([]);

    const channelColumns = columns.filter(
      (column) => !column.isHanging && Math.abs(column.x) < 3.6 && column.z < -0.5,
    );
    for (const column of channelColumns) {
      const topY = column.y + column.height * 0.5;
      expect(topY).toBeLessThan(SCENE_CONFIG.crestHeight);
    }
  });
});
