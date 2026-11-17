import { setupHero } from './hero.js?v=20261116-loading';

const element = (identifier) => document.getElementById(identifier);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let hero;
let viewer;
let viewerPromise;
let selected;
let config;
let sceneRequest = 0;

function showFailure(message) {
  element('viewer-status').hidden = false;
  element('viewer-status').classList.add('is-error');
  element('loading-text').textContent = message;
  element('retry-scene').hidden = false;
  element('scene-name').textContent = '3D view unavailable';
  element('viewer-stage').classList.remove('is-ready');
  element('viewer-stage').setAttribute('aria-busy', 'false');
  element('play').disabled = true;
  element('timeline').disabled = true;
}

async function openScene(entry, { scroll = true } = {}) {
  const request = ++sceneRequest;
  selected = entry;
  hero?.setActive(false);
  element('viewer-poster').src = entry.poster;
  element('viewer-stage').classList.remove('is-ready');
  element('viewer-status').classList.remove('is-idle');
  document.querySelectorAll('.scene-card').forEach((card) => {
    card.setAttribute('aria-pressed', String(card.dataset.scene === entry.id));
  });
  const url = new URL(location.href);
  url.searchParams.set('scene', entry.id);
  history.replaceState(null, '', url);
  if (scroll) element('viewer-shell').scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'center' });
  try {
    viewerPromise ??= import('./viewer.js?v=20261116-loading').then(({ PointCloudViewer }) => new PointCloudViewer()).catch((error) => {
      viewerPromise = null;
      throw error;
    });
    const nextViewer = await viewerPromise;
    if (request !== sceneRequest) return;
    viewer = nextViewer;
    await viewer.load(entry);
  } catch (error) {
    if (request !== sceneRequest) return;
    showFailure(`The 3D view could not start. Check that WebGL is enabled, then try again. ${error.message}`);
  }
}

function createSceneCard(entry, index) {
  const card = document.createElement('button');
  card.className = 'scene-card';
  card.type = 'button';
  card.dataset.scene = entry.id;
  card.setAttribute('aria-pressed', String(entry.id === selected.id));
  card.setAttribute('aria-label', `${entry.title} — ${entry.subtitle}`);
  const preview = document.createElement('span');
  preview.className = 'card-preview';
  const image = document.createElement('img');
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.width = 768;
  image.height = 432;
  image.addEventListener('error', () => preview.classList.add('is-unavailable'));
  image.src = entry.poster;
  preview.append(image);
  const number = document.createElement('span');
  number.className = 'card-index';
  number.textContent = String(index + 1).padStart(2, '0');
  const indicator = document.createElement('span');
  indicator.className = 'card-selection';
  indicator.innerHTML = '<svg aria-hidden="true"><use href="#icon-arrow"/></svg>';
  const title = document.createElement('span');
  title.className = 'card-text';
  title.textContent = entry.title;
  const subtitle = document.createElement('span');
  subtitle.className = 'card-subtitle';
  subtitle.textContent = entry.subtitle;
  const copy = document.createElement('span');
  copy.className = 'card-copy';
  copy.append(title, subtitle);
  const tag = document.createElement('span');
  tag.className = 'card-tag';
  tag.textContent = entry.tag;
  const caption = document.createElement('span');
  caption.className = 'card-caption';
  caption.append(number, copy, indicator);
  card.append(preview, caption, tag);
  card.addEventListener('click', () => openScene(entry));
  return card;
}

async function initialize() {
  const response = await fetch('./site.config.json');
  if (!response.ok) throw new Error('The project configuration could not be loaded.');
  config = await response.json();
  if (!Array.isArray(config.scenes) || !config.scenes.length) throw new Error('No scenes are configured.');
  if (config.paperUrl) document.querySelectorAll('[data-paper-link]').forEach((link) => { link.href = config.paperUrl; });
  if (config.githubUrl) document.querySelectorAll('[data-github-link]').forEach((link) => { link.href = config.githubUrl; });
  if (config.huggingFaceUrl) document.querySelectorAll('[data-hugging-face-link]').forEach((link) => { link.href = config.huggingFaceUrl; });
  hero = setupHero(config);
  const requested = new URL(location.href).searchParams.get('scene');
  selected = config.scenes.find((scene) => scene.id === requested) || config.scenes[0];
  element('viewer-poster').src = selected.poster;
  config.scenes.forEach((entry, index) => element('scene-tabs').append(createSceneCard(entry, index)));
  element('retry-scene').addEventListener('click', () => openScene(selected));
  element('viewer-status').classList.add('is-idle');
  element('loading-text').textContent = 'Select a scene to load its interactive preview.';
  element('scene-name').textContent = 'Interactive preview';
  element('viewer-stage').setAttribute('aria-busy', 'false');
  window.pi4Viewer = () => viewer ? { id: selected.id, ready: Boolean(viewer.ready), frame: viewer.frame, playing: viewer.playing, following: viewer.followCamera, exactCamera: viewer.followExact, scrubbing: viewer.isScrubbing, streamSamples: viewer.streamTiles.filter(Boolean).length, streamState: viewer.streamVideo ? { readyState: viewer.streamVideo.readyState, currentTime: viewer.streamVideo.currentTime, duration: viewer.streamVideo.duration, error: viewer.streamVideo.error?.message } : null, camera: { position: viewer.camera.position.toArray(), quaternion: viewer.camera.quaternion.toArray(), fov: viewer.camera.fov, goalPosition: viewer.followGoal?.position.toArray(), goalQuaternion: viewer.followGoal?.quaternion.toArray(), goalFov: viewer.followGoal?.fov }, points: viewer.manifest?.points, tracks: viewer.manifest?.queries, geometries: viewer.renderer.info.memory.geometries, layers: { cloud: viewer.cloud?.visible, frame: viewer.overlay?.visible, tracks: viewer.trackLines?.visible ?? false, cameras: viewer.cameraPath?.visible } } : { ready: false };
  const openInitialScene = () => {
    if (!sceneRequest) openScene(selected, { scroll: false });
  };
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      openInitialScene();
    }, { rootMargin: '250px 0px' });
    observer.observe(element('viewer-shell'));
  } else {
    openInitialScene();
  }
}

initialize().catch((error) => {
  showFailure(error.message);
  element('retry-scene').addEventListener('click', () => location.reload(), { once: true });
});
