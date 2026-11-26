import { createWaterfallAudio } from './audio/waterfallAudio';
import { createWaterfallScene } from './scene/waterfallScene';
import { createHud, createLoadingOverlay, renderWebGlFallback } from './ui/hud';

function bootstrap(): void {
  const canvasContainer = document.getElementById('canvas-container');
  const hudRoot = document.getElementById('hud-root');
  const loadingRoot = document.getElementById('loading-overlay');

  if (!canvasContainer || !hudRoot) {
    return;
  }

  const loadingOverlay = loadingRoot ? createLoadingOverlay(loadingRoot) : null;

  let sceneController: ReturnType<typeof createWaterfallScene>;
  try {
    sceneController = createWaterfallScene({
      container: canvasContainer,
      onLoadProgress: (state) => {
        loadingOverlay?.update(state);
      },
    });
  } catch {
    if (loadingOverlay) {
      loadingOverlay.update({
        visible: false,
        eyebrow: '',
        title: '',
        progress: 100,
        status: '',
      });
    }
    renderWebGlFallback({
      container: canvasContainer,
      message:
        'Your browser or GPU could not initialize a WebGL context. Please enable hardware acceleration and reload the page.',
    });
    return;
  }

  const audioController = createWaterfallAudio();
  const hudController = createHud({
    container: hudRoot,
    initialPreset: sceneController.getPreset(),
    callbacks: {
      onSwitchWaterfall: () => sceneController.switchWaterfall(),
      onToggleSound: () => audioController.toggle(),
      onToggleDrift: () => sceneController.toggleDrift(),
      onResetView: () => sceneController.resetCameraView(),
    },
  });

  window.addEventListener('beforeunload', () => {
    hudController.dispose();
    audioController.dispose();
    sceneController.dispose();
  });
}

bootstrap();
