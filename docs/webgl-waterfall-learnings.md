# WebGL Photorealistic Waterfall Learnings

Engineering notes and hard-won rendering lessons from building an interactive, GPU-accelerated photorealistic WebGL2 waterfall scene in Three.js (`r170`) with custom GLSL shaders, photogrammetry assets, and post-processing.

## 1. Critical WebGL2 & Shader Bugs Caught

### WebGL2 Immutable `texStorage2D` Texture Resizing Bug

- **Symptom**: High-resolution PBR textures (`basalt`, `moss`) silently failed to appear, leaving every rock and cliff rendered as a flat `1x1` solid color with flat normals.
- **Cause**: Initializing a `1x1` `THREE.DataTexture` placeholder with `needsUpdate = true` causes Three.js (`r170`) on WebGL2 to allocate immutable `1x1` GPU storage via `gl.texStorage2D`. Later replacing `texture.image` with `1024x1024` pixel data and setting `needsUpdate = true` triggers `gl.texSubImage2D` into the `1x1` immutable target, failing with `GL_INVALID_VALUE`.
- **Fix**: Load scanned PBR textures directly with `THREE.TextureLoader`, or back dynamically derived maps with a `THREE.CanvasTexture` allocated at its final resolution from frame 1.

### Non-Uniform Instanced Normal Transform ("Bamboo Stripes" Bug)

- **Symptom**: Tall stretched hexagonal basalt columns showed horizontal green moss bands along their vertical walls.
- **Cause**: Scaling a unit cylinder non-uniformly by `(0.6, 28.0, 0.6)` and transforming normals with `mat3(instanceMatrix) * objectNormal` multiplied small `objectNormal.y` variations by `28.0`, snapping `worldNormal.y` close to `+1.0` on vertical walls and triggering upward-facing moss masks.
- **Fix**: Transform instanced normals using the cofactor (adjugate-transpose) matrix in the vertex shader:
  ```glsl
  mat3 im = mat3(instanceMatrix);
  mat3 adjugateT = mat3(
    cross(im[1], im[2]),
    cross(im[2], im[0]),
    cross(im[0], im[1])
  );
  vec3 worldNormal = normalize(mat3(modelMatrix) * adjugateT * objectNormal);
  ```

### Waterfall Upward-Flow Reversal (`uTime * fallProgress`)

- **Symptom**: After a few seconds, the waterfall appeared to reverse direction, flow upward, and compress into repeating horizontal bands.
- **Cause**: Multiplying `uTime` by a spatially varying factor (`uTime * (1.0 + fallProgress)`) makes the spatial derivative `d(flowY)/d(vUv.y)` flip sign once `uTime` grows large.
- **Fix**: Map vertical drop progress once into time-independent physical gravity fall time `tau = sqrt(progress * 0.92 + 0.08) - sqrt(0.08)` and scroll strictly downward via `tau * verticalRepeat - uTime * speed`. Velocity accelerates naturally under gravity (`v ~ sqrt(2gh)`) forever with zero reversal or compression.

### Unpacking Three.js `PCFSoftShadowMap` Depth

- **Symptom**: Reading `.r` from `sunLight.shadow.map.texture` in custom `ShaderMaterial` passes produced inaccurate or banded shadow comparisons.
- **Cause**: Three.js encodes directional `PCFSoftShadowMap` depth into all four RGBA8 channels.
- **Fix**: Unpack using Three.js's exact `unpackRGBAToDepth` weights (`dot(packed, vec4(255/256, 255/65536, 255/16777216, 1/16777216))`) and apply a 9-tap PCF kernel in waterfall, water pool, foliage, mist, and volumetric god ray shaders.

### Submerged Riverbed Occluding Planar Reflections

- **Symptom**: A mirrored reflection camera positioned below `y = 0` (`position.y = -camera.y`) had its view of the waterfall blocked by the opaque riverbed terrain (`y < 0`).
- **Fix**: Enable an above-water clipping plane (`new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.05)`) exclusively during the half-resolution planar reflection pass, then clear `renderer.clippingPlanes` immediately afterward.

## 2. Architecture Patterns for Current-Gen Quality at 60 FPS

### Single-Opaque-Pass `DepthTexture` + Transparent VFX Composite

- Render opaque geometry (sky, terrain, beveled columns, photogrammetry rocks, instanced foliage) once into a `HalfFloatType` target with an attached `THREE.DepthTexture`.
- Blit opaque color to the composite target, then render transparent water, waterfall, and mist reading `tSceneColor` and `tSceneDepth` (performing depth-test discard and smooth `linearSceneZ - linearFragZ` feathering).
- This avoids double-rendering opaque geometry while unlocking:
  - Screen-space underwater refraction and Beer-Lambert glacial absorption in the plunge pool.
  - Pixel-accurate shoreline and boulder contact foam rings without jagged vertex-depth artifacts.
  - Refractive dark water at the waterfall crest transitioning smoothly into aerated plunging plumes.
  - Depth-softened volumetric mist billboards that never slice harshly into rocks or water.
  - 14-step Interleaved Gradient Noise volumetric god rays raymarched against `tSceneDepth` and the cached directional shadow map.

### Static Shadow Map Caching

- Because terrain, basalt columns, and photogrammetry rocks are static, set `renderer.shadowMap.autoUpdate = false` and bake a tight `4096x4096` shadow map once on startup and once after async `.gltf` rock models finish loading. This drops per-frame shadow-map rendering cost to `0 ms` while every custom shader still samples crisp cliff shadows.

### Photogrammetry Assets & Geological Realism

- Real CC0 photogrammetry `.gltf` rock scans (from Poly Haven) instanced via `THREE.InstancedMesh` immediately break the synthetic procedural-primitive look.
- Warp the terrain grid non-linearly so vertex density concentrates around the hero cliff and plunge pool (`~0.24m` spacing) while still extending `280m` to distant ridges.
- Filter talus boulders by local terrain slope (`slope < 0.72`) and embed rocks proportionally deeper on steeper slopes so no boulder floats mid-air on cliff faces.
- Contour the waterfall lip directly along the escarpment curve `computeEscarpmentLineZ(x)` and tuck wet rock ledges directly behind the crest so no unnatural air gap appears when orbiting to steep side angles.
- Use flat-faceted, corner-beveled hexagonal prisms (6 planar faces + narrow corner chamfers) packed tightly with organic height/radius jitter rather than smooth 6-vertex cylinders.

### Color Science, Tone Mapping & Performance

- Keep all custom shader color constants in true linear space (`pow(srgb, 2.2)`) so fog, mist, water, and PBR terrain match seamlessly before AgX tone mapping.
- Use Filament/Blender Rec.2020 AgX tone mapping with a high bloom threshold (`~1.18`) and gentle bloom strength (`~0.15`) so bright aerated foam and sun glints stay crisp instead of washing out into flat white fog.
- Replace expensive per-pixel procedural noise loops (Worley + 5-octave FBM) with precomputed seamless mipmapped textures, and detect software WebGL renderers (SwiftShader/llvmpipe) to reduce pixel ratio, particle overdraw, and raymarch passes gracefully.
