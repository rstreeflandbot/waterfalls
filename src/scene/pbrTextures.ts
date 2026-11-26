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
  readonly forestCliff: PbrTextureSet;
  readonly forestMossyRock: PbrTextureSet;
  readonly forestFloor: PbrTextureSet;
  readonly forestBark: PbrTextureSet;
  readonly bridgeStone: PbrTextureSet;
  readonly waterfallFoam: THREE.DataTexture;
  readonly dispose: () => void;
}

function configureTexture(options: {
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

function createDirectScannedPbrSet(options: {
  readonly loader: THREE.TextureLoader;
  readonly albedoUrl: string;
  readonly normalUrl: string;
  readonly rmaUrl: string;
  readonly anisotropy: number;
}): PbrTextureSet {
  const albedoMap = configureTexture({
    texture: options.loader.load(options.albedoUrl),
    isSrgb: true,
    anisotropy: options.anisotropy,
  });
  const normalMap = configureTexture({
    texture: options.loader.load(options.normalUrl),
    isSrgb: false,
    anisotropy: options.anisotropy,
  });
  const rmaMap = configureTexture({
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

function createFixedSizeCanvasTexture(options: {
  readonly size: number;
  readonly fillStyle: string;
  readonly anisotropy: number;
}): {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
} {
  const canvas = document.createElement('canvas');
  canvas.width = options.size;
  canvas.height = options.size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = options.fillStyle;
    ctx.fillRect(0, 0, options.size, options.size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  configureTexture({
    texture,
    isSrgb: false,
    anisotropy: options.anisotropy,
  });
  texture.needsUpdate = true;
  return { canvas, texture };
}

function createMossPbrSet(options: {
  readonly loader: THREE.TextureLoader;
  readonly albedoUrl: string;
  readonly derivedSize: number;
  readonly anisotropy: number;
}): PbrTextureSet {
  const normalCanvasPair = createFixedSizeCanvasTexture({
    size: options.derivedSize,
    fillStyle: 'rgb(128, 128, 255)',
    anisotropy: options.anisotropy,
  });
  const rmaCanvasPair = createFixedSizeCanvasTexture({
    size: options.derivedSize,
    fillStyle: 'rgb(220, 232, 128)',
    anisotropy: options.anisotropy,
  });

  let disposed = false;

  const albedoMap = configureTexture({
    texture: options.loader.load(options.albedoUrl, (loadedTexture) => {
      if (disposed) {
        return;
      }
      const imageSource = loadedTexture.image;
      if (!(imageSource instanceof HTMLImageElement)) {
        return;
      }

      const size = options.derivedSize;
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = size;
      sampleCanvas.height = size;
      const sampleCtx = sampleCanvas.getContext('2d');
      const normalCtx = normalCanvasPair.canvas.getContext('2d');
      const rmaCtx = rmaCanvasPair.canvas.getContext('2d');
      if (!sampleCtx || !normalCtx || !rmaCtx) {
        return;
      }

      sampleCtx.drawImage(imageSource, 0, 0, size, size);
      const src = sampleCtx.getImageData(0, 0, size, size).data;
      const heights = new Float32Array(size * size);

      for (let i = 0; i < size * size; i++) {
        const idx = i * 4;
        const r = (src[idx] ?? 0) / 255;
        const g = (src[idx + 1] ?? 0) / 255;
        const b = (src[idx + 2] ?? 0) / 255;
        heights[i] = r * 0.299 + g * 0.587 + b * 0.114;
      }

      const sampleHeight = (coords: { readonly x: number; readonly y: number }): number => {
        const wx = ((coords.x % size) + size) % size;
        const wy = ((coords.y % size) + size) % size;
        return heights[wy * size + wx] ?? 0.5;
      };

      const normalImg = normalCtx.createImageData(size, size);
      const rmaImg = rmaCtx.createImageData(size, size);
      const nData = normalImg.data;
      const rData = rmaImg.data;

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const hC = sampleHeight({ x, y });
          const dx1 = sampleHeight({ x: x + 1, y }) - sampleHeight({ x: x - 1, y });
          const dy1 = sampleHeight({ x, y: y + 1 }) - sampleHeight({ x, y: y - 1 });
          const dx3 = sampleHeight({ x: x + 3, y }) - sampleHeight({ x: x - 3, y });
          const dy3 = sampleHeight({ x, y: y + 3 }) - sampleHeight({ x, y: y - 3 });

          const gx = (dx1 * 0.62 + dx3 * 0.38) * 3.8;
          const gy = (dy1 * 0.62 + dy3 * 0.38) * 3.8;
          const invLen = 1 / Math.hypot(gx, gy, 1.0);

          const avg =
            (sampleHeight({ x: x + 4, y }) +
              sampleHeight({ x: x - 4, y }) +
              sampleHeight({ x, y: y + 4 }) +
              sampleHeight({ x, y: y - 4 })) *
            0.25;
          const ao = clamp({ value: 0.72 + (hC - avg) * 2.1, min: 0.32, max: 1.0 });
          const rough = clamp({ value: 0.76 + (1 - hC) * 0.2, min: 0.7, max: 0.98 });

          const idx = (y * size + x) * 4;
          nData[idx] = Math.round((-gx * invLen * 0.5 + 0.5) * 255);
          nData[idx + 1] = Math.round((-gy * invLen * 0.5 + 0.5) * 255);
          nData[idx + 2] = Math.round((invLen * 0.5 + 0.5) * 255);
          nData[idx + 3] = 255;

          rData[idx] = Math.round(ao * 255);
          rData[idx + 1] = Math.round(rough * 255);
          rData[idx + 2] = Math.round(hC * 255);
          rData[idx + 3] = 255;
        }
      }

      normalCtx.putImageData(normalImg, 0, 0);
      rmaCtx.putImageData(rmaImg, 0, 0);
      normalCanvasPair.texture.needsUpdate = true;
      rmaCanvasPair.texture.needsUpdate = true;
    }),
    isSrgb: true,
    anisotropy: options.anisotropy,
  });

  return {
    albedoMap,
    normalMap: normalCanvasPair.texture,
    rmaMap: rmaCanvasPair.texture,
    dispose: () => {
      disposed = true;
      albedoMap.dispose();
      normalCanvasPair.texture.dispose();
      rmaCanvasPair.texture.dispose();
    },
  };
}

function createAnisotropicWaterfallFoamTexture(options: {
  readonly size: number;
  readonly anisotropy: number;
}): THREE.DataTexture {
  const { size } = options;
  const rand = createSeededRandom(73319);

  const createGradientField = (dims: {
    readonly cols: number;
    readonly rows: number;
  }): Float32Array => {
    const field = new Float32Array(dims.cols * dims.rows * 2);
    for (let i = 0; i < dims.cols * dims.rows; i++) {
      const angle = rand() * Math.PI * 2;
      field[i * 2] = Math.cos(angle);
      field[i * 2 + 1] = Math.sin(angle);
    }
    return field;
  };

  const samplePerlin = (input: {
    readonly u: number;
    readonly v: number;
    readonly cols: number;
    readonly rows: number;
    readonly field: Float32Array;
  }): number => {
    const x = input.u * input.cols;
    const y = input.v * input.rows;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);

    const x0 = ((ix % input.cols) + input.cols) % input.cols;
    const y0 = ((iy % input.rows) + input.rows) % input.rows;
    const x1 = (x0 + 1) % input.cols;
    const y1 = (y0 + 1) % input.rows;

    const dotGrad = (corner: {
      readonly cx: number;
      readonly cy: number;
      readonly dx: number;
      readonly dy: number;
    }): number => {
      const idx = (corner.cy * input.cols + corner.cx) * 2;
      const gx = input.field[idx] ?? 0;
      const gy = input.field[idx + 1] ?? 0;
      return gx * corner.dx + gy * corner.dy;
    };

    const n00 = dotGrad({ cx: x0, cy: y0, dx: fx, dy: fy });
    const n10 = dotGrad({ cx: x1, cy: y0, dx: fx - 1, dy: fy });
    const n01 = dotGrad({ cx: x0, cy: y1, dx: fx, dy: fy - 1 });
    const n11 = dotGrad({ cx: x1, cy: y1, dx: fx - 1, dy: fy - 1 });

    const nx0 = n00 + (n10 - n00) * ux;
    const nx1 = n01 + (n11 - n01) * ux;
    return clamp({ value: (nx0 + (nx1 - nx0) * uy) * 0.65 + 0.5, min: 0, max: 1 });
  };

  const warpField = createGradientField({ cols: 6, rows: 4 });
  const chuteField = createGradientField({ cols: 16, rows: 6 });
  const billowField = createGradientField({ cols: 32, rows: 12 });
  const filamentField = createGradientField({ cols: 64, rows: 16 });
  const microField = createGradientField({ cols: 112, rows: 42 });

  const plumeBuffer = new Float32Array(size * size);
  const filamentBuffer = new Float32Array(size * size);

  const cometCount = 460;
  for (let c = 0; c < cometCount; c++) {
    const cx = rand();
    const cy = rand();
    const isMajorPlume = c < 130;
    const radiusX = isMajorPlume ? 0.018 + rand() * 0.028 : 0.005 + rand() * 0.013;
    const tailLen = isMajorPlume ? 0.12 + rand() * 0.2 : 0.06 + rand() * 0.15;
    const strength = isMajorPlume ? 0.36 + rand() * 0.36 : 0.24 + rand() * 0.34;
    const chevronSpread = isMajorPlume ? 0.35 + rand() * 0.45 : 0.15;

    const minPx = Math.floor((cx - radiusX * 1.8) * size);
    const maxPx = Math.ceil((cx + radiusX * 1.8) * size);
    const minPy = Math.floor((cy - tailLen) * size);
    const maxPy = Math.ceil((cy + radiusX * 1.4) * size);

    for (let py = minPy; py <= maxPy; py++) {
      const wrappedY = ((py % size) + size) % size;
      const dy = (py / size - cy) / tailLen;
      if (dy < -1 || dy > 0.24) {
        continue;
      }

      const alongTail = clamp({ value: (dy + 1) / 1.24, min: 0, max: 1 });
      const headProfile =
        dy <= 0 ? Math.pow(alongTail, 1.55) : Math.max(0, 1 - Math.pow(dy / 0.24, 2));
      const widthAtY = radiusX * (0.24 + (0.76 + (1 - alongTail) * chevronSpread) * alongTail);

      for (let px = minPx; px <= maxPx; px++) {
        const wrappedX = ((px % size) + size) % size;
        const dx = (px / size - cx) / Math.max(widthAtY, 0.001);
        const absDx = Math.abs(dx);
        if (absDx >= 1) {
          continue;
        }

        const vWake = 1 - Math.pow(absDx, 1.6);
        const value = headProfile * vWake * vWake * strength;
        const idx = wrappedY * size + wrappedX;

        if (isMajorPlume) {
          plumeBuffer[idx] = Math.min(1.5, (plumeBuffer[idx] ?? 0) + value);
        } else {
          filamentBuffer[idx] = Math.min(1.5, (filamentBuffer[idx] ?? 0) + value);
        }
      }
    }
  }

  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;

      const warpU = (samplePerlin({ u, v, cols: 6, rows: 4, field: warpField }) - 0.5) * 0.055;
      const warpV =
        (samplePerlin({
          u: (u + 0.37) % 1,
          v: (v + 0.53) % 1,
          cols: 6,
          rows: 4,
          field: warpField,
        }) -
          0.5) *
        0.04;
      const su = (u + warpU + 1) % 1;
      const sv = (v + warpV + 1) % 1;

      const chute = samplePerlin({ u: su, v: sv, cols: 16, rows: 6, field: chuteField });
      const billow = samplePerlin({ u: su, v: sv, cols: 32, rows: 12, field: billowField });
      const filament = samplePerlin({ u: su, v: sv, cols: 64, rows: 16, field: filamentField });
      const micro = samplePerlin({ u: su, v: sv, cols: 112, rows: 42, field: microField });

      const sx = Math.floor(su * size) % size;
      const sy = Math.floor(sv * size) % size;
      const plumeSample = clamp({ value: plumeBuffer[sy * size + sx] ?? 0, min: 0, max: 1 });
      const fineComet = clamp({ value: filamentBuffer[sy * size + sx] ?? 0, min: 0, max: 1 });

      const ridgeFilament = 1 - Math.abs(filament * 2 - 1);
      const plumeHeight = clamp({
        value: plumeSample * 0.62 + billow * 0.28 + chute * 0.18 + fineComet * 0.16,
        min: 0,
        max: 1,
      });
      const silkyStreaks = clamp({
        value: fineComet * 0.58 + Math.pow(ridgeFilament, 1.7) * 0.44 + micro * 0.18,
        min: 0,
        max: 1,
      });
      const microSpray = clamp({
        value: Math.pow(micro, 1.6) * 0.68 + fineComet * 0.48,
        min: 0,
        max: 1,
      });
      const breakupAlpha = clamp({
        value: chute * 0.44 + plumeSample * 0.44 + ridgeFilament * 0.26,
        min: 0,
        max: 1,
      });

      const idx = (y * size + x) * 4;
      data[idx] = Math.round(plumeHeight * 255);
      data[idx + 1] = Math.round(silkyStreaks * 255);
      data[idx + 2] = Math.round(microSpray * 255);
      data[idx + 3] = Math.round(breakupAlpha * 255);
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  configureTexture({
    texture,
    isSrgb: false,
    anisotropy: options.anisotropy,
  });
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
  const loader = new THREE.TextureLoader();

  const basalt = createDirectScannedPbrSet({
    loader,
    albedoUrl: '/textures/basalt_albedo.jpg',
    normalUrl: '/textures/basalt_normal.jpg',
    rmaUrl: '/textures/basalt_rma.jpg',
    anisotropy,
  });

  const moss = createMossPbrSet({
    loader,
    albedoUrl: '/textures/moss_albedo.jpg',
    derivedSize: options.isSoftwareGpu ? 256 : 512,
    anisotropy,
  });

  const volcanicSand = createDirectScannedPbrSet({
    loader,
    albedoUrl: '/textures/volcanic_sand_albedo.jpg',
    normalUrl: '/textures/volcanic_sand_normal.jpg',
    rmaUrl: '/textures/volcanic_sand_rma.jpg',
    anisotropy,
  });

  const forestCliff = createDirectScannedPbrSet({
    loader,
    albedoUrl: '/textures/forest_cliff_albedo.jpg',
    normalUrl: '/textures/forest_cliff_normal.jpg',
    rmaUrl: '/textures/forest_cliff_rma.jpg',
    anisotropy,
  });

  const forestMossyRock = createDirectScannedPbrSet({
    loader,
    albedoUrl: '/textures/forest_mossy_rock_albedo.jpg',
    normalUrl: '/textures/forest_mossy_rock_normal.jpg',
    rmaUrl: '/textures/forest_mossy_rock_rma.jpg',
    anisotropy,
  });

  const forestFloor = createDirectScannedPbrSet({
    loader,
    albedoUrl: '/textures/forest_floor_albedo.jpg',
    normalUrl: '/textures/forest_floor_normal.jpg',
    rmaUrl: '/textures/forest_floor_rma.jpg',
    anisotropy,
  });

  const forestBark = createDirectScannedPbrSet({
    loader,
    albedoUrl: '/textures/forest_bark_albedo.jpg',
    normalUrl: '/textures/forest_bark_normal.jpg',
    rmaUrl: '/textures/forest_bark_rma.jpg',
    anisotropy,
  });

  const bridgeStone = createDirectScannedPbrSet({
    loader,
    albedoUrl: '/textures/bridge_stone_albedo.jpg',
    normalUrl: '/textures/bridge_stone_normal.jpg',
    rmaUrl: '/textures/bridge_stone_rma.jpg',
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
    forestCliff,
    forestMossyRock,
    forestFloor,
    forestBark,
    bridgeStone,
    waterfallFoam,
    dispose: () => {
      basalt.dispose();
      moss.dispose();
      volcanicSand.dispose();
      forestCliff.dispose();
      forestMossyRock.dispose();
      forestFloor.dispose();
      forestBark.dispose();
      bridgeStone.dispose();
      waterfallFoam.dispose();
    },
  };
}
