export interface HudCallbacks {
  readonly onToggleSound: () => Promise<boolean>;
  readonly onToggleDrift: () => boolean;
  readonly onResetView: () => void;
}

export interface HudController {
  readonly dispose: () => void;
}

const ICONS = {
  soundOff:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>',
  soundOn:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
  driftOn:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10 9l5 3-5 3V9z"/></svg>',
  driftOff:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="10" y1="9" x2="10" y2="15"/><line x1="14" y1="9" x2="14" y2="15"/></svg>',
  reset:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  fullscreen:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  eyeOff:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
  eyeOn:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
};

function createButton(options: {
  readonly className: string;
  readonly ariaLabel: string;
  readonly title: string;
  readonly iconSvg: string;
  readonly labelText?: string;
}): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = options.className;
  button.setAttribute('aria-label', options.ariaLabel);
  button.title = options.title;
  button.innerHTML = options.labelText
    ? `${options.iconSvg}<span class="hud-button-label">${options.labelText}</span>`
    : options.iconSvg;
  return button;
}

export function createHud(options: {
  readonly container: HTMLElement;
  readonly callbacks: HudCallbacks;
}): HudController {
  const { container, callbacks } = options;
  container.replaceChildren();

  const topRow = document.createElement('div');
  topRow.className = 'hud-top hud-chrome';

  const titleBlock = document.createElement('div');
  titleBlock.className = 'hud-title-block';

  const eyebrow = document.createElement('div');
  eyebrow.className = 'hud-eyebrow';
  eyebrow.textContent = 'ICELAND · GOLDEN HOUR';

  const title = document.createElement('div');
  title.className = 'hud-title';
  title.textContent = 'Svartifoss';

  titleBlock.append(eyebrow, title);
  topRow.append(titleBlock);

  const bottomRow = document.createElement('div');
  bottomRow.className = 'hud-bottom';

  const hint = document.createElement('div');
  hint.className = 'hud-hint hud-chrome';
  hint.textContent = 'Drag to orbit · Scroll to zoom · H to hide HUD';

  const controlsWrap = document.createElement('div');
  controlsWrap.className = 'hud-controls-wrap';

  const toolbar = document.createElement('div');
  toolbar.className = 'hud-toolbar hud-chrome';

  const soundButton = createButton({
    className: 'hud-button',
    ariaLabel: 'Toggle waterfall ambience sound',
    title: 'Toggle waterfall sound',
    iconSvg: ICONS.soundOff,
    labelText: 'Sound',
  });

  const driftButton = createButton({
    className: 'hud-button is-active',
    ariaLabel: 'Toggle gentle camera drift',
    title: 'Toggle gentle camera drift',
    iconSvg: ICONS.driftOn,
    labelText: 'Drift',
  });

  const resetButton = createButton({
    className: 'hud-button hud-button-icon-only',
    ariaLabel: 'Reset camera view',
    title: 'Reset camera view',
    iconSvg: ICONS.reset,
  });

  const fullscreenButton = createButton({
    className: 'hud-button hud-button-icon-only',
    ariaLabel: 'Toggle fullscreen',
    title: 'Toggle fullscreen',
    iconSvg: ICONS.fullscreen,
  });

  const hideHudButton = createButton({
    className: 'hud-button hud-button-icon-only',
    ariaLabel: 'Hide controls',
    title: 'Hide controls (H)',
    iconSvg: ICONS.eyeOff,
  });

  const restoreHudButton = createButton({
    className: 'hud-restore-button',
    ariaLabel: 'Show controls',
    title: 'Show controls (H)',
    iconSvg: ICONS.eyeOn,
  });
  restoreHudButton.hidden = true;

  toolbar.append(soundButton, driftButton, resetButton, fullscreenButton, hideHudButton);
  controlsWrap.append(toolbar, restoreHudButton);
  bottomRow.append(hint, controlsWrap);
  container.append(topRow, bottomRow);

  let hudHidden = false;

  const setHudHidden = (hidden: boolean) => {
    hudHidden = hidden;
    container.classList.toggle('hud-hidden', hidden);
    restoreHudButton.hidden = !hidden;
  };

  const handleSoundClick = async () => {
    const isPlaying = await callbacks.onToggleSound();
    soundButton.classList.toggle('is-active', isPlaying);
    soundButton.innerHTML = `${isPlaying ? ICONS.soundOn : ICONS.soundOff}<span class="hud-button-label">${isPlaying ? 'Sound On' : 'Sound'}</span>`;
  };

  const handleDriftClick = () => {
    const enabled = callbacks.onToggleDrift();
    driftButton.classList.toggle('is-active', enabled);
    driftButton.innerHTML = `${enabled ? ICONS.driftOn : ICONS.driftOff}<span class="hud-button-label">Drift</span>`;
  };

  const handleResetClick = () => {
    callbacks.onResetView();
  };

  const handleFullscreenClick = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen();
    }
  };

  const handleHideClick = () => {
    setHudHidden(true);
  };

  const handleRestoreClick = () => {
    setHudHidden(false);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() === 'h' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      setHudHidden(!hudHidden);
    }
  };

  soundButton.addEventListener('click', handleSoundClick);
  driftButton.addEventListener('click', handleDriftClick);
  resetButton.addEventListener('click', handleResetClick);
  fullscreenButton.addEventListener('click', handleFullscreenClick);
  hideHudButton.addEventListener('click', handleHideClick);
  restoreHudButton.addEventListener('click', handleRestoreClick);
  window.addEventListener('keydown', handleKeyDown);

  return {
    dispose: () => {
      soundButton.removeEventListener('click', handleSoundClick);
      driftButton.removeEventListener('click', handleDriftClick);
      resetButton.removeEventListener('click', handleResetClick);
      fullscreenButton.removeEventListener('click', handleFullscreenClick);
      hideHudButton.removeEventListener('click', handleHideClick);
      restoreHudButton.removeEventListener('click', handleRestoreClick);
      window.removeEventListener('keydown', handleKeyDown);
      container.replaceChildren();
    },
  };
}

export function renderWebGlFallback(options: {
  readonly container: HTMLElement;
  readonly message: string;
}): void {
  const wrapper = document.createElement('div');
  wrapper.className = 'webgl-fallback';

  const card = document.createElement('div');
  card.className = 'webgl-fallback-card';

  const heading = document.createElement('h1');
  heading.textContent = 'WebGL Renderer Unavailable';

  const paragraph = document.createElement('p');
  paragraph.textContent = options.message;

  card.append(heading, paragraph);
  wrapper.append(card);
  options.container.replaceChildren(wrapper);
}
