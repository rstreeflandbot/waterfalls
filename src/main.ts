import { createWaterfallAudio } from './audio/waterfallAudio';
import { createWaterfallScene } from './scene/waterfallScene';
import { createHud, renderWebGlFallback } from './ui/hud';

function bootstrap(): void {
  const canvasContainer = document.getElementById('canvas-container');
  const hudRoot = document.getElementById('hud-root');

  if (!canvasContainer || !hudRoot) {
    return;
  }

  let sceneController: ReturnType<typeof createWaterfallScene>;
  try {
    sceneController = createWaterfallScene(canvasContainer);
  } catch {
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
