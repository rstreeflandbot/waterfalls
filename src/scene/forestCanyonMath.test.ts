import { describe, expect, it } from 'vitest';
import {
  FOREST_WATERFALL_CONFIG,
  computeForestCanyonTerrainHeight,
  computeForestEscarpmentZ,
  computeForestMidShelfY,
  computeForestRiverCenterX,
  computeForestUpperCrestY,
} from './forestCanyonMath';
import { WATERFALL_PRESETS, getNextWaterfallPresetId } from './waterfallPresets';

describe('forestCanyonMath', () => {
  it('sculpts a stepped upper cliff, mid-tier shelf, and underwater plunge pool', () => {
    const upperPlateau = computeForestCanyonTerrainHeight({ x: 0, z: -26 });
    const midShelf = computeForestCanyonTerrainHeight({
      x: 0,
      z: computeForestEscarpmentZ(0) + 2.8,
    });
    const plungePool = computeForestCanyonTerrainHeight({
      x: 0,
      z: FOREST_WATERFALL_CONFIG.plungeCenterZ + 3.2,
    });
    const riverMid = computeForestCanyonTerrainHeight({
      x: computeForestRiverCenterX(24),
      z: 24,
    });
    const canyonFlank = computeForestCanyonTerrainHeight({ x: 26, z: 4 });
    const skyNotchBehindFalls = computeForestCanyonTerrainHeight({ x: 0, z: -72 });

    expect(upperPlateau).toBeGreaterThan(28);
    expect(midShelf).toBeGreaterThan(8);
    expect(midShelf).toBeLessThan(upperPlateau);
    expect(plungePool).toBeLessThan(0);
    expect(riverMid).toBeLessThan(0);
    expect(canyonFlank).toBeGreaterThan(10);
    expect(skyNotchBehindFalls).toBeLessThan(48);
  });

  it('varies upper crest and mid-shelf elevations asymmetrically across x', () => {
    const upperCenter = computeForestUpperCrestY(-0.4);
    const upperFlank = computeForestUpperCrestY(3.4);
    const shelfLeft = computeForestMidShelfY(-3.5);
    const shelfRight = computeForestMidShelfY(3.5);

    expect(upperCenter).toBeLessThan(upperFlank);
    expect(shelfLeft).not.toBeCloseTo(shelfRight, 1);
  });

  it('switches cleanly between iceland and forest waterfall presets', () => {
    expect(getNextWaterfallPresetId('iceland')).toBe('forest');
    expect(getNextWaterfallPresetId('forest')).toBe('iceland');
    expect(WATERFALL_PRESETS.iceland.title).toBe('Skógafoss');
    expect(WATERFALL_PRESETS.forest.title).toBe('Multnomah Gorge');
  });
});
