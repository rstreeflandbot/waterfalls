# Skógafoss WebGL Waterfall

A real-time, GPU-accelerated 3D Icelandic volcanic waterfall scene built with Three.js, TypeScript, and custom WebGL2 GLSL shaders.

**Live demo:** [https://waterfalls.streefland.co.uk/](https://waterfalls.streefland.co.uk/)

## Highlights

- **Animated waterfall curtain & volumetric plumes**: Multi-layer parabolic waterfall geometry driven by gravity-accelerated UV advection, anisotropic foam textures, chevron breakup, depth-softened intersections, and dual-lobe Mie scattering.
- **Glacial plunge pool & river**: Flow-advected surface ripples, depth-based Beer-Lambert absorption, screen-space refraction, planar reflections, and trailing foam lace.
- **Volcanic escarpment & basalt columns**: Triplanar-shaded volcanic basalt, highland moss, black volcanic sand, instanced beveled hexagonal basalt columns, and photogrammetry-scanned 3D boulders.
- **Atmospheric lighting & post-processing**: Procedural sky dome with PMREM environment lighting, PCF shadows, volumetric sun god-rays, bloom, AgX tone mapping, and SMAA.
- **Procedural Web Audio ambience**: Synthesized waterfall roar, low-frequency rumble, and sparkling spray shimmer with no audio file downloads.
- **Mobile-friendly rendering**: Progressive loading screen with asset preloading, adaptive DPR, half-resolution mobile god-rays, throttled planar reflections, static shadow caching, and automatic pause when hidden.

## Controls

- **Drag**: Orbit camera
- **Scroll / Pinch**: Zoom
- **Sound**: Toggle procedural waterfall ambience
- **Drift**: Toggle gentle camera drift
- **Reset**: Return to the hero camera angle
- **Fullscreen**: Toggle fullscreen mode
- **`H` / Eye icon**: Hide or restore the HUD

## Getting Started

```bash
npm install
npm run dev
```

### Scripts

| Command                | Description                                     |
| ---------------------- | ----------------------------------------------- |
| `npm run dev`          | Start the Vite development server               |
| `npm run build`        | Type-check and build the production bundle      |
| `npm run preview`      | Preview the production build locally            |
| `npm run typecheck`    | Run TypeScript compiler checks (`tsc --noEmit`) |
| `npm test`             | Run Vitest unit tests                           |
| `npm run format`       | Format files with Prettier                      |
| `npm run format:check` | Verify Prettier formatting                      |

## Assets & Attribution

Photogrammetry PBR textures and 3D boulder models (`boulder_01`, `moon_rock_01`, `moon_rock_02`) are CC0 assets from [Poly Haven](https://polyhaven.com/).

## License

This project is licensed under the [MIT License](LICENSE).
