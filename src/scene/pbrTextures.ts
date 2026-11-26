import * as THREE from 'three';
import { clamp, createSeededRandom } from './cliffMath';
import { WaterfallPresetId } from './waterfallPresets';

export interface PbrTextureSet {
  readonly albedoMap: THREE.Texture;
  readonly normalMap: THREE.Texture;
  readonly rmaMap: THREE.Texture;
  readonly dispose: () => void;
}

export interface IcelandTextureSets {
  readonly basalt: PbrTextureSet;
  readonly moss: PbrTextureSet;
  readonly volcanicSand: PbrTextureSet;
}

export interface ForestTextureSets {
  readonly forestCliff: PbrTextureSet;
  readonly forestMossyRock: PbrTextureSet;
  readonly forestFloor: PbrTextureSet;
  readonly forestBark: PbrTextureSet;
  readonly bridgeStone: PbrTextureSet;
  readonly moss: PbrTextureSet;
}

export interface WaterfallTextureBundle {
  readonly waterfallFoam: THREE.DataTexture;
  readonly ensureIcelandTextures: (
    onItemLoaded?: (label: string) => void,
  ) => Promise<IcelandTextureSets>;
  readonly ensureForestTextures: (
    onItemLoaded?: (label: string) => void,
  ) => Promise<ForestTextureSets>;
  readonly isBiomeCached: (presetId: WaterfallPresetId) => boolean;
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

function loadTextureTracked(options: {
  readonly loader: THREE.TextureLoader;
  readonly url: string;
  readonly isSrgb: boolean;
  readonly anisotropy: number;
  readonly label: string;
  readonly onLoaded?: (label: string) => void;
}): { readonly texture: THREE.Texture; readonly ready: Promise<void> } {
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const texture = configureTexture({
    texture: options.loader.load(
      options.url,
      () => {
        options.onLoaded?.(options.label);
        resolveReady();
      },
      undefined,
      () => {
        options.onLoaded?.(options.label);
        resolveReady();
      },
    ),
    isSrgb: options.isSrgb,
    anisotropy: options.anisotropy,
  });

  return { texture, ready };
}

function createDirectScannedPbrSet(options: {
  readonly loader: THREE.TextureLoader;
  readonly albedoUrl: string;
  readonly normalUrl: string;
  readonly rmaUrl: string;
  readonly anisotropy: number;
  readonly label: string;
  readonly onItemLoaded?: (label: string) => void;
}): { readonly set: PbrTextureSet; readonly ready: Promise<void> } {
  const albedo = loadTextureTracked({
    loader: options.loader,
    url: options.albedoUrl,
    isSrgb: true,
    anisotropy: options.anisotropy,
    label: options.label,
    onLoaded: options.onItemLoaded,
  });
  const normal = loadTextureTracked({
    loader: options.loader,
    url: options.normalUrl,
    isSrgb: false,
    anisotropy: options.anisotropy,
    label: options.label,
    onLoaded: options.onItemLoaded,
  });
  const rma = loadTextureTracked({
    loader: options.loader,
    url: options.rmaUrl,
    isSrgb: false,
    anisotropy: options.anisotropy,
    label: options.label,
    onLoaded: options.onItemLoaded,
  });

  return {
    set: {
      albedoMap: albedo.texture,
      normalMap: normal.texture,
      rmaMap: rma.texture,
      dispose: () => {
        albedo.texture.dispose();
        normal.texture.dispose();
        rma.texture.dispose();
      },
    },
    ready: Promise.all([albedo.ready, normal.ready, rma.ready]).then(() => undefined),
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
  readonly onItemLoaded?: (label: string) => void;
}): { readonly set: PbrTextureSet; readonly ready: Promise<void> } {
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
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const albedoMap = configureTexture({
    texture: options.loader.load(
      options.albedoUrl,
      (loadedTexture) => {
        if (disposed) {
          resolveReady();
          return;
        }
        const imageSource = loadedTexture.image;
        if (!(imageSource instanceof HTMLImageElement)) {
          options.onItemLoaded?.('Loading moss textures');
          resolveReady();
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
          options.onItemLoaded?.('Loading moss textures');
          resolveReady();
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
        options.onItemLoaded?.('Loading moss textures');
        resolveReady();
      },
      undefined,
      () => {
        options.onItemLoaded?.('Loading moss textures');
        resolveReady();
      },
    ),
    isSrgb: true,
    anisotropy: options.anisotropy,
  });

  return {
    set: {
      albedoMap,
      normalMap: normalCanvasPair.texture,
      rmaMap: rmaCanvasPair.texture,
      dispose: () => {
        disposed = true;
        albedoMap.dispose();
        normalCanvasPair.texture.dispose();
        rmaCanvasPair.texture.dispose();
      },
    },
    ready,
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
  readonly isMobileGpu: boolean;
}): WaterfallTextureBundle {
  const anisotropy = options.isSoftwareGpu
    ? 2
    : options.isMobileGpu
      ? Math.min(8, options.renderer.capabilities.getMaxAnisotropy())
      : Math.min(16, options.renderer.capabilities.getMaxAnisotropy());
  const loader = new THREE.TextureLoader();

  const waterfallFoam = createAnisotropicWaterfallFoamTexture({
    size: options.isSoftwareGpu ? 256 : options.isMobileGpu ? 384 : 512,
    anisotropy,
  });

  const ownedSets: PbrTextureSet[] = [];
  let mossPromise: Promise<PbrTextureSet> | null = null;
  let icelandPromise: Promise<IcelandTextureSets> | null = null;
  let forestPromise: Promise<ForestTextureSets> | null = null;
  let icelandReady = false;
  let forestReady = false;

  const ensureMoss = (onItemLoaded?: (label: string) => void): Promise<PbrTextureSet> => {
    if (!mossPromise) {
      const mossEntry = createMossPbrSet({
        loader,
        albedoUrl: '/textures/moss_albedo.jpg',
        derivedSize: options.isSoftwareGpu || options.isMobileGpu ? 256 : 512,
        anisotropy,
        onItemLoaded,
      });
      ownedSets.push(mossEntry.set);
      mossPromise = mossEntry.ready.then(() => mossEntry.set);
    }
    return mossPromise;
  };

  const ensureIcelandTextures = (
    onItemLoaded?: (label: string) => void,
  ): Promise<IcelandTextureSets> => {
    if (!icelandPromise) {
      const basaltEntry = createDirectScannedPbrSet({
        loader,
        albedoUrl: '/textures/basalt_albedo.jpg',
        normalUrl: '/textures/basalt_normal.jpg',
        rmaUrl: '/textures/basalt_rma.jpg',
        anisotropy,
        label: 'Loading volcanic basalt textures',
        onItemLoaded,
      });
      const sandEntry = createDirectScannedPbrSet({
        loader,
        albedoUrl: '/textures/volcanic_sand_albedo.jpg',
        normalUrl: '/textures/volcanic_sand_normal.jpg',
        rmaUrl: '/textures/volcanic_sand_rma.jpg',
        anisotropy,
        label: 'Loading riverbed stone textures',
        onItemLoaded,
      });
      ownedSets.push(basaltEntry.set, sandEntry.set);

      icelandPromise = Promise.all([
        basaltEntry.ready,
        sandEntry.ready,
        ensureMoss(onItemLoaded),
      ]).then(([, , moss]) => {
        icelandReady = true;
        return {
          basalt: basaltEntry.set,
          moss,
          volcanicSand: sandEntry.set,
        };
      });
    }
    return icelandPromise;
  };

  const ensureForestTextures = (
    onItemLoaded?: (label: string) => void,
  ): Promise<ForestTextureSets> => {
    if (!forestPromise) {
      const cliffEntry = createDirectScannedPbrSet({
        loader,
        albedoUrl: '/textures/forest_cliff_albedo.jpg',
        normalUrl: '/textures/forest_cliff_normal.jpg',
        rmaUrl: '/textures/forest_cliff_rma.jpg',
        anisotropy,
        label: 'Loading gorge cliff textures',
        onItemLoaded,
      });
      const mossyRockEntry = createDirectScannedPbrSet({
        loader,
        albedoUrl: '/textures/forest_mossy_rock_albedo.jpg',
        normalUrl: '/textures/forest_mossy_rock_normal.jpg',
        rmaUrl: '/textures/forest_mossy_rock_rma.jpg',
        anisotropy,
        label: 'Loading mossy canyon rock textures',
        onItemLoaded,
      });
      const floorEntry = createDirectScannedPbrSet({
        loader,
        albedoUrl: '/textures/forest_floor_albedo.jpg',
        normalUrl: '/textures/forest_floor_normal.jpg',
        rmaUrl: '/textures/forest_floor_rma.jpg',
        anisotropy,
        label: 'Loading autumn forest floor textures',
        onItemLoaded,
      });
      const barkEntry = createDirectScannedPbrSet({
        loader,
        albedoUrl: '/textures/forest_bark_albedo.jpg',
        normalUrl: '/textures/forest_bark_normal.jpg',
        rmaUrl: '/textures/forest_bark_rma.jpg',
        anisotropy,
        label: 'Loading tree bark textures',
        onItemLoaded,
      });
      const bridgeEntry = createDirectScannedPbrSet({
        loader,
        albedoUrl: '/textures/bridge_stone_albedo.jpg',
        normalUrl: '/textures/bridge_stone_normal.jpg',
        rmaUrl: '/textures/bridge_stone_rma.jpg',
        anisotropy,
        label: 'Loading bridge masonry textures',
        onItemLoaded,
      });
      ownedSets.push(
        cliffEntry.set,
        mossyRockEntry.set,
        floorEntry.set,
        barkEntry.set,
        bridgeEntry.set,
      );

      forestPromise = Promise.all([
        cliffEntry.ready,
        mossyRockEntry.ready,
        floorEntry.ready,
        barkEntry.ready,
        bridgeEntry.ready,
        ensureMoss(onItemLoaded),
      ]).then(([, , , , , moss]) => {
        forestReady = true;
        return {
          forestCliff: cliffEntry.set,
          forestMossyRock: mossyRockEntry.set,
          forestFloor: floorEntry.set,
          forestBark: barkEntry.set,
          bridgeStone: bridgeEntry.set,
          moss,
        };
      });
    }
    return forestPromise;
  };

  return {
    waterfallFoam,
    ensureIcelandTextures,
    ensureForestTextures,
    isBiomeCached: (presetId) => (presetId === 'forest' ? forestReady : icelandReady),
    dispose: () => {
      for (const set of ownedSets) {
        set.dispose();
      }
      waterfallFoam.dispose();
    },
  };
}
