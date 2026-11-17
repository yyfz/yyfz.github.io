const element = (identifier) => document.getElementById(identifier);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const formatTime = (seconds) => Number.isFinite(seconds) ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '00:00';

export function setupHero(config) {
  const demos = config.heroDemos?.length ? config.heroDemos : [{ id: 'hero', title: '', local: config.heroVideo, input: null, global: null, poster: config.heroPoster, version: 0 }];
  if (!demos[0]?.local) return;
  const root = element('hero-player');
  const local = element('hero-video');
  const input = element('hero-input');
  const global = element('hero-global');
  const videos = { local, input, global };
  const seek = element('hero-seek');
  const control = element('hero-video-control');
  let index = 0;
  let visible = true;
  let suspended = false;
  let resumeTime = 0;
  let manuallyPaused = false;
  let scrubbing = false;
  let unavailable = false;

  const versioned = (path, version) => {
    const url = new URL(path, document.baseURI);
    if (version) url.searchParams.set('v', version);
    return url.href;
  };
  const updateControl = () => {
    control.hidden = unavailable || reducedMotion.matches;
    control.setAttribute('aria-label', local.paused ? 'Play background video' : 'Pause background video');
    control.querySelector('use').setAttribute('href', local.paused ? '#icon-play' : '#icon-pause');
  };
  const updateTimeline = () => {
    const duration = local.duration;
    const current = local.currentTime;
    element('hero-current').textContent = formatTime(current);
    element('hero-duration').textContent = formatTime(duration);
    const progress = Number.isFinite(duration) && duration > 0 ? Math.min(1, current / duration) : 0;
    if (!scrubbing) seek.value = String(Math.round(progress * 1000));
    seek.style.setProperty('--progress', `${progress * 100}%`);
  };
  const syncPlayback = () => {
    const paused = suspended || scrubbing || reducedMotion.matches || document.hidden || !visible || manuallyPaused || unavailable;
    Object.values(videos).forEach((video) => {
      if (paused) video.pause();
      else if (video.src && video.readyState >= 2) video.play().catch(() => {});
    });
    updateControl();
  };
  Object.entries(videos).forEach(([kind, video]) => {
    video.muted = true;
    video.defaultMuted = true;
    video.loop = kind !== 'local';
    video.preload = 'auto';
    video.addEventListener('loadeddata', syncPlayback);
    video.addEventListener('loadedmetadata', updateTimeline);
    video.addEventListener('playing', () => {
      if (kind === 'local') local.classList.add('is-playing');
      syncPlayback();
    });
    video.addEventListener('pause', updateControl);
    video.addEventListener('error', () => {
      if (kind === 'local') {
        unavailable = true;
        local.classList.remove('is-playing');
      } else {
        element(`hero-${kind}-wrap`).hidden = true;
      }
      updateControl();
    });
  });
  local.addEventListener('ended', () => loadDemo(index + 1));
  local.addEventListener('timeupdate', () => {
    if (local.duration > 0 && local.currentTime / local.duration >= 0.7) prefetchNextDemo();
  });
  const insetWraps = { input: element('hero-input-wrap'), global: element('hero-global-wrap') };
  Object.entries(insetWraps).forEach(([kind, wrap]) => {
    const video = videos[kind];
    video.addEventListener('loadedmetadata', () => {
      const aspect = video.videoWidth / video.videoHeight;
      if (!Number.isFinite(aspect) || aspect <= 0) return;
      wrap.style.setProperty('--input-aspect', `${video.videoWidth} / ${video.videoHeight}`);
      wrap.style.setProperty('--input-scale', String(Math.sqrt(aspect / (874 / 480))));
    });
    video.addEventListener('emptied', () => {
      wrap.style.removeProperty('--input-aspect');
      wrap.style.removeProperty('--input-scale');
    });
  });

  let prefetchedIndex = -1;
  let prefetchVideos = [];
  const clearPrefetch = () => {
    prefetchVideos.forEach((video) => {
      video.removeAttribute('src');
      video.load();
    });
    prefetchVideos = [];
  };
  const prefetchNextDemo = () => {
    if (suspended) return;
    const next = (index + 1) % demos.length;
    if (prefetchedIndex === next) return;
    clearPrefetch();
    prefetchedIndex = next;
    const demo = demos[next];
    prefetchVideos = ['local', 'input', 'global'].filter((kind) => demo[kind]).map((kind) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.src = versioned(demo[kind], demo.version);
      video.load();
      return video;
    });
  };
  const loadDemo = (next, startTime = 0) => {
    clearPrefetch();
    prefetchedIndex = -1;
    index = (next + demos.length) % demos.length;
    resumeTime = startTime;
    const demo = demos[index];
    unavailable = false;
    demoButtons.forEach((button, buttonIndex) => {
      const active = buttonIndex === index;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const navigation = element('hero-demo-nav');
    if (navigation.scrollWidth > navigation.clientWidth) {
      const activeButton = demoButtons[index];
      navigation.scrollTo({ left: activeButton.offsetLeft - (navigation.clientWidth - activeButton.clientWidth) / 2, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }
    Object.values(videos).forEach((video) => video.pause());
    local.classList.remove('is-playing');
    element('hero-poster').src = demo.poster || config.heroPoster;
    element('hero-demo-name').textContent = demo.title;
    element('hero-demo-index').textContent = `${String(index + 1).padStart(2, '0')} / ${String(demos.length).padStart(2, '0')}`;
    const adjacent = {
      prev: demos[(index - 1 + demos.length) % demos.length],
      next: demos[(index + 1) % demos.length],
    };
    Object.entries(adjacent).forEach(([direction, adjacentDemo]) => {
      element(`hero-${direction}-poster`).src = versioned(adjacentDemo.poster || config.heroPoster, adjacentDemo.version);
      element(`hero-${direction}-name`).textContent = adjacentDemo.title;
      element(`hero-${direction}`).setAttribute('aria-label', `${direction === 'prev' ? 'Previous' : 'Next'} demo: ${adjacentDemo.title}`);
    });
    Object.entries(videos).forEach(([kind, video]) => {
      const path = kind === 'local' ? demo.local : demo[kind];
      if (!path) {
        if (kind !== 'local') element(`hero-${kind}-wrap`).hidden = true;
        video.removeAttribute('src');
        video.load();
        return;
      }
      if (kind !== 'local') element(`hero-${kind}-wrap`).hidden = false;
      if (startTime > 0) video.addEventListener('loadedmetadata', () => {
        video.currentTime = Math.min(startTime, Math.max(0, video.duration - 0.04));
        updateTimeline();
      }, { once: true });
      video.src = versioned(path, demo.version);
      video.load();
    });
    input.classList.toggle('is-contain', demo.inputFit === 'contain');
    global.classList.toggle('is-contain', demo.globalFit === 'contain');
    element('hero-global-wrap').querySelector('.hero-inset-label').textContent = demo.globalRole === 'input' ? 'INPUT RGB' : 'GLOBAL';
    seek.value = '0';
    updateTimeline();
    syncPlayback();
  };
  const setActive = (active) => {
    if (active) {
      if (!suspended) return;
      suspended = false;
      loadDemo(index, resumeTime);
      return;
    }
    if (suspended) return;
    suspended = true;
    resumeTime = Number.isFinite(local.currentTime) ? local.currentTime : 0;
    clearPrefetch();
    prefetchedIndex = -1;
    Object.values(videos).forEach((video) => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    });
    local.classList.remove('is-playing');
    updateControl();
  };
  const demoButtons = demos.map((demo, demoIndex) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hero-demo-chip';
    button.setAttribute('aria-label', `Show demo: ${demo.title}`);
    const media = document.createElement('span');
    media.className = 'hero-demo-chip-media';
    const thumbnail = document.createElement('img');
    thumbnail.src = versioned(demo.poster || config.heroPoster, demo.version);
    thumbnail.alt = '';
    thumbnail.loading = 'lazy';
    thumbnail.decoding = 'async';
    thumbnail.width = 874;
    thumbnail.height = 480;
    const number = document.createElement('span');
    number.className = 'hero-demo-chip-number';
    number.textContent = String(demoIndex + 1).padStart(2, '0');
    media.append(thumbnail, number);
    const name = document.createElement('span');
    name.className = 'hero-demo-chip-name';
    name.textContent = demo.title;
    button.append(media, name);
    button.addEventListener('click', () => loadDemo(demoIndex));
    element('hero-demo-nav').append(button);
    return button;
  });
  element('hero-prev').addEventListener('click', () => loadDemo(index - 1));
  element('hero-next').addEventListener('click', () => loadDemo(index + 1));
  control.addEventListener('click', () => { manuallyPaused = !local.paused; syncPlayback(); });
  seek.addEventListener('pointerdown', () => { scrubbing = true; syncPlayback(); });
  seek.addEventListener('input', () => {
    if (!Number.isFinite(local.duration)) return;
    scrubbing = true;
    syncPlayback();
    const target = Number(seek.value) / 1000 * local.duration;
    Object.values(videos).forEach((video) => {
      if (Number.isFinite(video.duration)) video.currentTime = Math.min(target, Math.max(0, video.duration - 0.04));
    });
    updateTimeline();
  });
  const finishScrubbing = () => {
    if (!scrubbing) return;
    scrubbing = false;
    syncPlayback();
    updateTimeline();
  };
  seek.addEventListener('pointerup', finishScrubbing);
  seek.addEventListener('pointercancel', finishScrubbing);
  seek.addEventListener('change', finishScrubbing);
  root.addEventListener('keydown', (event) => {
    if (event.target === seek) return;
    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      event.preventDefault();
      loadDemo(index + (event.code === 'ArrowRight' ? 1 : -1));
    }
  });
  reducedMotion.addEventListener('change', syncPlayback);
  document.addEventListener('visibilitychange', syncPlayback);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) setActive(true);
    syncPlayback();
  }).observe(root);
  const synchronize = () => {
    if (!scrubbing && Number.isFinite(local.duration)) {
      Object.values(videos).forEach((video) => {
        if (video === local || !video.src || video.readyState < 1) return;
        if (Math.abs(video.currentTime - local.currentTime) > 0.12) video.currentTime = Math.min(local.currentTime, Math.max(0, video.duration - 0.04));
      });
      updateTimeline();
    }
    requestAnimationFrame(synchronize);
  };
  loadDemo(0);
  synchronize();
  window.pi4Hero = () => ({ id: demos[index].id, index, count: demos.length, duration: local.duration || 0, currentTime: local.currentTime, playing: !local.paused, suspended, global: !element('hero-global-wrap').hidden });
  return { setActive };
}
