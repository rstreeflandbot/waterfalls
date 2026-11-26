import * as THREE from 'three';
import { clamp, createSeededRandom } from './cliffMath';

export interface PbrTextureSet {
  readonly albedoMap: THREE.Texture;
  readonly normalMap: THREE.Texture;
  readonly rmaMap: THREE.Texture;
  readonly dispose: () => void;
}

export interface WaterfallTextureBundle {
  readonly basalt: PbrTextureSet;
  readonly moss: PbrTextureSet;
  readonly volcanicSand: PbrTextureSet;
  readonly waterfallFoam: THREE.DataTexture;
  readonly dispose: () => void;
}

function createPlaceholderTexture(options: {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
  readonly isSrgb: boolean;
  readonly anisotropy: number;
}): THREE.DataTexture {
  const data = new Uint8Array([options.r, options.g, options.b, options.a]);
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = options.anisotropy;
  texture.colorSpace = options.isSrgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function configureLoadedTexture(options: {
  readonly texture: THREE.Texture;
  readonly isSrgb: boolean;
  readonly anisotropy: number;
}): THREE.Texture {
  options.texture.wrapS = THREE.RepeatWrapping;
  options.texture.wrapT = THREE.RepeatWrapping;
  options.texture.magFilter = THREE.LinearFilter;
  options.texture.minFilter = THREE.LinearMipmapLinearFilter;
  options.texture.anisotropy = options.anisotropy;
  options.texture.colorSpace = options.isSrgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  options.texture.generateMipmaps = true;
  return options.texture;
}

function makeSeamlessPixels(options: {
  readonly source: Uint8ClampedArray;
  readonly size: number;
}): Uint8Array {
  const { source, size } = options;
  const output = new Uint8Array(size * size * 4);
  const half = size >> 1;

  for (let y = 0; y < size; y++) {
    const ny = Math.abs((y / size) * 2 - 1);
    const wy = 1 - Math.pow(ny, 6);
    const sy = (y + half) % size;

    for (let x = 0; x < size; x++) {
      const nx = Math.abs((x / size) * 2 - 1);
      const wx = 1 - Math.pow(nx, 6);
      const sx = (x + half) % size;

      const weight = clamp({ value: wx * wy, min: 0, max: 1 });
      const invWeight = 1 - weight;

      const idx = (y * size + x) * 4;
      const shiftIdx = (sy * size + sx) * 4;

      output[idx] = Math.round((source[idx] ?? 0) * weight + (source[shiftIdx] ?? 0) * invWeight);
      output[idx + 1] = Math.round(
        (source[idx + 1] ?? 0) * weight + (source[shiftIdx + 1] ?? 0) * invWeight,
      );
      output[idx + 2] = Math.round(
        (source[idx + 2] ?? 0) * weight + (source[shiftIdx + 2] ?? 0) * invWeight,
      );
      output[idx + 3] = 255;
    }
  }

  return output;
}

function derivePbrMapsFromAlbedo(options: {
  readonly albedoPixels: Uint8Array;
  readonly size: number;
  readonly normalStrength: number;
  readonly minRoughness: number;
  readonly maxRoughness: number;
}): {
  readonly normalPixels: Uint8Array;
  readonly rmaPixels: Uint8Array;
} {
  const { albedoPixels, size, normalStrength, minRoughness, maxRoughness } = options;
  const heights = new Float32Array(size * size);

  for (let i = 0; i < size * size; i++) {
    const idx = i * 4;
    const r = (albedoPixels[idx] ?? 0) / 255;
    const g = (albedoPixels[idx + 1] ?? 0) / 255;
    const b = (albedoPixels[idx + 2] ?? 0) / 255;
    heights[i] = r * 0.299 + g * 0.587 + b * 0.114;
  }

  const sampleHeight = (coords: { readonly x: number; readonly y: number }): number => {
    const wx = ((coords.x % size) + size) % size;
    const wy = ((coords.y % size) + size) % size;
    return heights[wy * size + wx] ?? 0.5;
  };

  const normalPixels = new Uint8Array(size * size * 4);
  const rmaPixels = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hCenter = sampleHeight({ x, y });

      const dx1 = sampleHeight({ x: x + 1, y }) - sampleHeight({ x: x - 1, y });
      const dy1 = sampleHeight({ x, y: y + 1 }) - sampleHeight({ x, y: y - 1 });

      const dx3 = sampleHeight({ x: x + 3, y }) - sampleHeight({ x: x - 3, y });
      const dy3 = sampleHeight({ x, y: y + 3 }) - sampleHeight({ x, y: y - 3 });

      const dx6 = sampleHeight({ x: x + 6, y }) - sampleHeight({ x: x - 6, y });
      const dy6 = sampleHeight({ x, y: y + 6 }) - sampleHeight({ x, y: y - 6 });

      const gradX = (dx1 * 0.52 + dx3 * 0.32 + dx6 * 0.16) * normalStrength;
      const gradY = (dy1 * 0.52 + dy3 * 0.32 + dy6 * 0.16) * normalStrength;

      const invLen = 1 / Math.hypot(gradX, gradY, 1.0);
      const nx = -gradX * invLen;
      const ny = -gradY * invLen;
      const nz = invLen;

      const avgNeighbor =
        (sampleHeight({ x: x + 4, y }) +
          sampleHeight({ x: x - 4, y }) +
          sampleHeight({ x, y: y + 4 }) +
          sampleHeight({ x, y: y - 4 })) *
        0.25;
      const cavity = clamp({ value: 0.72 + (hCenter - avgNeighbor) * 2.2, min: 0.28, max: 1.0 });
      const roughness = clamp({
        value: minRoughness + (1 - hCenter) * (maxRoughness - minRoughness),
        min: 0.08,
        max: 0.98,
      });

      const idx = (y * size + x) * 4;
      normalPixels[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      normalPixels[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalPixels[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normalPixels[idx + 3] = 255;

      rmaPixels[idx] = Math.round(cavity * 255);
      rmaPixels[idx + 1] = Math.round(roughness * 255);
      rmaPixels[idx + 2] = Math.round(hCenter * 255);
      rmaPixels[idx + 3] = 255;
    }
  }

  return { normalPixels, rmaPixels };
}

function updateDataTexture(options: {
  readonly texture: THREE.DataTexture;
  readonly pixels: Uint8Array;
  readonly size: number;
}): void {
  options.texture.image = {
    data: options.pixels,
    width: options.size,
    height: options.size,
  };
  options.texture.needsUpdate = true;
}

function loadImagePixels(options: {
  readonly url: string;
  readonly targetSize: number;
}): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = options.targetSize;
      canvas.height = options.targetSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, options.targetSize, options.targetSize);
      const imageData = ctx.getImageData(0, 0, options.targetSize, options.targetSize);
      resolve(imageData.data);
    };
    img.onerror = () => {
      reject(new Error(`Failed to load texture: ${options.url}`));
    };
    img.src = options.url;
  });
}

function createDerivedPbrSet(options: {
  readonly url: string;
  readonly targetSize: number;
  readonly anisotropy: number;
  readonly fallbackRgb: readonly [number, number, number];
  readonly normalStrength: number;
  readonly minRoughness: number;
  readonly maxRoughness: number;
}): PbrTextureSet {
  const albedoMap = createPlaceholderTexture({
    r: options.fallbackRgb[0],
    g: options.fallbackRgb[1],
    b: options.fallbackRgb[2],
    a: 255,
    isSrgb: true,
    anisotropy: options.anisotropy,
  });

  const normalMap = createPlaceholderTexture({
    r: 128,
    g: 128,
    b: 255,
    a: 255,
    isSrgb: false,
    anisotropy: options.anisotropy,
  });

  const rmaMap = createPlaceholderTexture({
    r: 220,
    g: Math.round(options.maxRoughness * 255),
    b: 128,
    a: 255,
    isSrgb: false,
    anisotropy: options.anisotropy,
  });

  let disposed = false;

  void loadImagePixels({ url: options.url, targetSize: options.targetSize })
    .then((rawPixels) => {
      if (disposed) {
        return;
      }
      const seamlessAlbedo = makeSeamlessPixels({
        source: rawPixels,
        size: options.targetSize,
      });
      const { normalPixels, rmaPixels } = derivePbrMapsFromAlbedo({
        albedoPixels: seamlessAlbedo,
        size: options.targetSize,
        normalStrength: options.normalStrength,
        minRoughness: options.minRoughness,
        maxRoughness: options.maxRoughness,
      });

      updateDataTexture({ texture: albedoMap, pixels: seamlessAlbedo, size: options.targetSize });
      updateDataTexture({ texture: normalMap, pixels: normalPixels, size: options.targetSize });
      updateDataTexture({ texture: rmaMap, pixels: rmaPixels, size: options.targetSize });
    })
    .catch(() => {
      return;
    });

  return {
    albedoMap,
    normalMap,
    rmaMap,
    dispose: () => {
      disposed = true;
      albedoMap.dispose();
      normalMap.dispose();
      rmaMap.dispose();
    },
  };
}

function createDirectScannedPbrSet(options: {
  readonly loader: THREE.TextureLoader;
  readonly albedoUrl: string;
  readonly normalUrl: string;
  readonly rmaUrl: string;
  readonly anisotropy: number;
}): PbrTextureSet {
  const albedoMap = configureLoadedTexture({
    texture: options.loader.load(options.albedoUrl),
    isSrgb: true,
    anisotropy: options.anisotropy,
  });
  const normalMap = configureLoadedTexture({
    texture: options.loader.load(options.normalUrl),
    isSrgb: false,
    anisotropy: options.anisotropy,
  });
  const rmaMap = configureLoadedTexture({
    texture: options.loader.load(options.rmaUrl),
    isSrgb: false,
    anisotropy: options.anisotropy,
  });

  return {
    albedoMap,
    normalMap,
    rmaMap,
    dispose: () => {
      albedoMap.dispose();
      normalMap.dispose();
      rmaMap.dispose();
    },
  };
}

function createAnisotropicWaterfallFoamTexture(options: {
  readonly size: number;
  readonly anisotropy: number;
}): THREE.DataTexture {
  const { size } = options;
  const data = new Uint8Array(size * size * 4);
  const rand = createSeededRandom(73319);

  const makeGrid = (dims: { readonly cols: number; readonly rows: number }): Float32Array => {
    const g = new Float32Array(dims.cols * dims.rows);
    for (let i = 0; i < g.length; i++) {
      g[i] = rand();
    }
    return g;
  };

  const sampleAniso = (input: {
    readonly u: number;
    readonly v: number;
    readonly cols: number;
    readonly rows: number;
    readonly grid: Float32Array;
  }): number => {
    const x = input.u * input.cols;
    const y = input.v * input.rows;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);

    const x0 = ((ix % input.cols) + input.cols) % input.cols;
    const y0 = ((iy % input.rows) + input.rows) % input.rows;
    const x1 = (x0 + 1) % input.cols;
    const y1 = (y0 + 1) % input.rows;

    const a = input.grid[y0 * input.cols + x0] ?? 0.5;
    const b = input.grid[y0 * input.cols + x1] ?? 0.5;
    const c = input.grid[y1 * input.cols + x0] ?? 0.5;
    const d = input.grid[y1 * input.cols + x1] ?? 0.5;

    return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
  };

  const warpGrid = makeGrid({ cols: 8, rows: 4 });
  const chuteGrid = makeGrid({ cols: 16, rows: 4 });
  const streakGrid = makeGrid({ cols: 32, rows: 8 });
  const filamentGrid = makeGrid({ cols: 64, rows: 16 });
  const dropletGrid = makeGrid({ cols: 96, rows: 32 });

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;

      const warpX = (sampleAniso({ u, v, cols: 8, rows: 4, grid: warpGrid }) - 0.5) * 0.09;
      const warpedU = (u + warpX + 1) % 1;

      const chute = sampleAniso({ u: warpedU, v, cols: 16, rows: 4, grid: chuteGrid });
      const streak = sampleAniso({ u: warpedU, v, cols: 32, rows: 8, grid: streakGrid });
      const filament = sampleAniso({ u: warpedU, v, cols: 64, rows: 16, grid: filamentGrid });
      const droplets = sampleAniso({ u: warpedU, v, cols: 96, rows: 32, grid: dropletGrid });

      const ridge = 1 - Math.abs(streak * 2 - 1);
      const sharpFilament = Math.pow(filament, 1.35);
      const sprayBurst = Math.pow(droplets, 1.8) * 0.42;

      const combined = clamp({
        value: chute * 0.34 + ridge * 0.32 + sharpFilament * 0.28 + sprayBurst,
        min: 0,
        max: 1,
      });
      const highContrast = clamp({
        value: Math.pow(combined, 1.15) * 1.12,
        min: 0,
        max: 1,
      });

      const byte = Math.round(highContrast * 255);
      const idx = (y * size + x) * 4;
      data[idx] = byte;
      data[idx + 1] = Math.round(
        clamp({ value: ridge * 0.6 + droplets * 0.4, min: 0, max: 1 }) * 255,
      );
      data[idx + 2] = Math.round(clamp({ value: droplets, min: 0, max: 1 }) * 255);
      data[idx + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = options.anisotropy;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function createWaterfallTextureBundle(options: {
  readonly renderer: THREE.WebGLRenderer;
  readonly isSoftwareGpu: boolean;
}): WaterfallTextureBundle {
  const anisotropy = options.isSoftwareGpu
    ? 2
    : Math.min(16, options.renderer.capabilities.getMaxAnisotropy());
  const targetSize = options.isSoftwareGpu ? 512 : 1024;
  const loader = new THREE.TextureLoader();

  const basalt = createDerivedPbrSet({
    url: '/textures/basalt_albedo.jpg',
    targetSize,
    anisotropy,
    fallbackRgb: [38, 40, 44],
    normalStrength: 5.2,
    minRoughness: 0.42,
    maxRoughness: 0.92,
  });

  const moss = createDerivedPbrSet({
    url: '/textures/moss_albedo.jpg',
    targetSize,
    anisotropy,
    fallbackRgb: [58, 76, 36],
    normalStrength: 3.8,
    minRoughness: 0.72,
    maxRoughness: 0.96,
  });

  const volcanicSand = createDirectScannedPbrSet({
    loader,
    albedoUrl: '/textures/volcanic_sand_albedo.jpg',
    normalUrl: '/textures/volcanic_sand_normal.jpg',
    rmaUrl: '/textures/volcanic_sand_rma.jpg',
    anisotropy,
  });

  const waterfallFoam = createAnisotropicWaterfallFoamTexture({
    size: options.isSoftwareGpu ? 256 : 512,
    anisotropy,
  });

  return {
    basalt,
    moss,
    volcanicSand,
    waterfallFoam,
    dispose: () => {
      basalt.dispose();
      moss.dispose();
      volcanicSand.dispose();
      waterfallFoam.dispose();
    },
  };
}
