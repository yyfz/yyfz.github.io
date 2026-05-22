const fallbackDemos = [
  {
    id: "beach-angel",
    title: "Fallen Angel on the Shore",
    scene: "beach angel",
    demo_video: "demo/%E6%B5%B7%E6%BB%A9%E5%A4%A9%E4%BD%BF__mg05/demo_video.mp4",
    first_frame: "demo/%E6%B5%B7%E6%BB%A9%E5%A4%A9%E4%BD%BF__mg05/first_frame.png",
    prompt:
      "Continue from the first frame. A quiet, desolate beach at dawn, with pale waves washing onto wet sand and soft sea mist drifting through the air.",
    frames: 429,
    seed: 42,
  },
  {
    id: "amusement-park-whale",
    title: "Whale at the Abandoned Park",
    scene: "amusement park whale",
    demo_video: "demo/%E9%B2%B8%E9%B1%BC%E6%B8%B8%E4%B9%90%E5%9C%BA__mg01/demo_video.mp4",
    first_frame: "demo/%E9%B2%B8%E9%B1%BC%E6%B8%B8%E4%B9%90%E5%9C%BA__mg01/first_frame.png",
    prompt:
      "Continue from the first frame. The abandoned amusement park is quiet and misty, with weeds growing through cracked pavement and old rides creaking softly in the wind.",
    frames: 429,
    seed: 42,
  },
  {
    id: "office-surrealism",
    title: "Office Surrealism",
    scene: "office character",
    demo_video: "demo/%E6%B4%BE%E5%A4%A7%E6%98%9F__mg07/demo_video.mp4",
    first_frame: "demo/%E6%B4%BE%E5%A4%A7%E6%98%9F__mg07/first_frame.png",
    prompt:
      "Continue from the first frame. The modern open-plan office remains softly lit and quietly active, with desks, monitors, office chairs, paperwork, and office supplies.",
    frames: 429,
    seed: 42,
  },
  {
    id: "mechanical-dragon-frontier",
    title: "Mechanical Dragon Frontier",
    scene: "frontier machine dragon",
    demo_video: "demo/%E8%BE%B9%E5%A1%9E%E6%9C%BA%E6%A2%B0%E9%BE%99__mg09/demo_video.mp4",
    first_frame: "demo/%E8%BE%B9%E5%A1%9E%E6%9C%BA%E6%A2%B0%E9%BE%99__mg09/first_frame.png",
    prompt:
      "Continue from the first frame. The ancient Chinese frontier outpost stands in a dry, windswept landscape, with rammed-earth walls and a beacon tower.",
    frames: 429,
    seed: 42,
  },
  {
    id: "forbidden-city-dragon",
    title: "Dragon in the Forbidden City",
    scene: "Forbidden City dragon",
    demo_video: "demo/%E6%95%85%E5%AE%AB%E9%BE%99__mg10_feedbackfix_v5/demo_video.mp4",
    first_frame: "demo/%E6%95%85%E5%AE%AB%E9%BE%99__mg10_feedbackfix_v5/first_frame.png",
    prompt:
      "Continue from the first frame. The vast square of the Forbidden City at dawn remains quiet and solemn, with ancient red walls, golden roofs, white stone terraces, and soft morning haze. A majestic Chinese dragon rests across the palace courtyard, its long serpentine body coiled over the stone ground, with shimmering scales, flowing whiskers, and an ancient ceremonial presence. The dragon should feel noble, powerful, and mythical. Dust drifts across the square, scales glint in the soft light, banners and fabric edges move gently in the wind, and the dragon’s body shows faint breathing or small graceful movements, as if it is slowly awakening. The atmosphere should feel solemn, mythical, and emotionally striking, as if legend has appeared in the heart of the imperial palace. Keep the world immersive and explorable, with camera movement. Cinematic, highly detailed, soft morning light, mysterious but believable, no text, no watermark.",
    frames: 429,
    seed: 42,
  },
  {
    id: "desert-gas-station-ufo",
    title: "Desert Gas Station UFO",
    scene: "desert gas station",
    demo_video: "demo/%E5%85%AC%E8%B7%AF%E9%A3%9E%E7%A2%9F__mg05/demo_video.mp4",
    first_frame: "demo/%E5%85%AC%E8%B7%AF%E9%A3%9E%E7%A2%9F__mg05/first_frame.png",
    prompt:
      "Continue from the first frame. The lonely desert gas station sits under warm sunset light as dust drifts across the cracked road.",
    frames: 429,
    seed: 42,
  },
];

const titleByVideo = new Map(fallbackDemos.map((demo) => [demo.demo_video, demo.title]));
const sceneByVideo = new Map(fallbackDemos.map((demo) => [demo.demo_video, demo.scene]));

function cleanPrompt(prompt = "") {
  return prompt.replace(/^camctl23x\.\s*/i, "").trim();
}

function encodedPath(path = "") {
  return encodeURI(path);
}

function thumbnailPath(path = "") {
  return path.replace(/first_frame\.png$/i, "first_frame_thumb.jpg");
}

function titleFromItem(item, index = 0) {
  const videoKey = encodedPath(item.demo_video);
  if (titleByVideo.has(videoKey)) {
    return titleByVideo.get(videoKey);
  }

  return `Demo ${String(index + 1).padStart(2, "0")}`;
}

function sceneFromItem(item) {
  const videoKey = encodedPath(item.demo_video);
  return sceneByVideo.get(videoKey) || "Generated sequence";
}

function shortPrompt(prompt = "", maxLength = 520) {
  if (prompt.length <= maxLength) {
    return prompt;
  }

  const clipped = prompt.slice(0, maxLength);
  const sentenceEnd = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf(", "));
  const end = sentenceEnd > 280 ? sentenceEnd + 1 : clipped.lastIndexOf(" ");
  return `${clipped.slice(0, end).trim()}...`;
}

function isClipped(prompt = "", maxLength = 520) {
  return prompt.length > maxLength;
}

async function safeText(path) {
  if (!path) {
    return "";
  }

  const response = await fetch(path);
  if (!response.ok) {
    return "";
  }

  return response.text();
}

async function safeJson(path) {
  if (!path) {
    return {};
  }

  const response = await fetch(path);
  if (!response.ok) {
    return {};
  }

  return response.json();
}

async function loadDemos() {
  try {
    const catalogResponse = await fetch("demo/catalog.json", { cache: "no-store" });
    if (catalogResponse.ok) {
      const catalog = await catalogResponse.json();
      return {
        demos: (catalog.representatives || []).filter((demo) => demo.demo_video && demo.first_frame),
        diverseGroups: catalog.diverse_groups || [],
      };
    }
  } catch {
    // Fall through to the older manifest format.
  }

  try {
    const manifestResponse = await fetch("demo/manifest.json", { cache: "no-store" });
    if (!manifestResponse.ok) {
      throw new Error("manifest unavailable");
    }

    const manifest = await manifestResponse.json();
    const loaded = await Promise.all(
      manifest.map(async (item, index) => {
        const promptPath = encodedPath(item.prompt);
        const metadataPath = encodedPath(item.metadata);
        const [promptText, metadata] = await Promise.all([
          safeText(promptPath).catch(() => ""),
          safeJson(metadataPath).catch(() => ({})),
        ]);

        return {
          id: item.id,
          title: titleFromItem(item, index),
          scene: sceneFromItem(item),
          demo_video: encodedPath(item.demo_video),
          first_frame: encodedPath(item.first_frame),
          prompt: cleanPrompt(promptText || metadata.prompt || ""),
          frames: metadata.num_frames || 429,
          seed: metadata.seed ?? 42,
        };
      }),
    );

    return {
      demos: loaded.filter((demo) => demo.demo_video && demo.first_frame),
      diverseGroups: [],
    };
  } catch (error) {
    return {
      demos: fallbackDemos,
      diverseGroups: [],
    };
  }
}

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function isNearViewport(element, margin = 420) {
  if (!element) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.top < window.innerHeight + margin && rect.bottom > -margin;
}

function setDeferredVideoSource(video, source = video.dataset.src) {
  if (!video || !source) {
    return false;
  }

  if (video.dataset.loadedSrc === source) {
    return false;
  }

  video.src = source;
  video.dataset.loadedSrc = source;
  video.load();
  return true;
}

function playDeferredVideo(video, source = video.dataset.src) {
  if (!video || !source) {
    return;
  }

  setDeferredVideoSource(video, source);
  if (!prefersReducedMotion) {
    video.play().catch(() => {});
  }
}

function resetDeferredVideo(video, source, poster) {
  if (!video) {
    return;
  }

  if (poster) {
    video.poster = poster;
  }
  video.dataset.src = source;

  if (video.dataset.loadedSrc !== source) {
    video.pause();
    video.removeAttribute("src");
    delete video.dataset.loadedSrc;
    video.load();
  }
}

const stageVideoObserver =
  "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const video = entry.target.querySelector("video");
            if (!video) {
              return;
            }

            if (entry.isIntersecting) {
              playDeferredVideo(video);
            } else {
              video.pause();
            }
          });
        },
        { rootMargin: "360px 0px", threshold: 0.01 },
      )
    : null;

function observeStagePlayback(stage) {
  if (!stage) {
    return;
  }

  if (stageVideoObserver) {
    stageVideoObserver.observe(stage);
  } else if (isNearViewport(stage)) {
    const video = stage.querySelector("video");
    playDeferredVideo(video);
  }
}

function createThumbnailImage(source, alt = "") {
  const image = document.createElement("img");
  image.alt = alt;
  image.loading = "lazy";
  image.decoding = "async";
  image.fetchPriority = "low";
  image.src = source;
  return image;
}

function getControlSpeed(control) {
  const active = control?.querySelector("button.is-active");
  return Number(active?.dataset.speed || 1);
}

function applyPlaybackSpeed(video, control) {
  video.playbackRate = getControlSpeed(control);
}

function setupSpeedControl(controlId, videoId) {
  const control = document.getElementById(controlId);
  const video = document.getElementById(videoId);
  if (!control || !video) {
    return;
  }

  control.querySelectorAll("button[data-speed]").forEach((button) => {
    button.addEventListener("click", () => {
      control.querySelectorAll("button[data-speed]").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      applyPlaybackSpeed(video, control);
    });
  });
}

function syncStageAspect(video, stage, property = "--stage-aspect") {
  const applyAspect = () => {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      stage.style.setProperty(property, `${video.videoWidth} / ${video.videoHeight}`);
    }
  };

  video.addEventListener("loadedmetadata", applyAspect, { once: true });
  applyAspect();
}

function openPromptModal(demo) {
  const modal = document.getElementById("promptModal");
  const title = document.getElementById("modalTitle");
  const scene = document.getElementById("modalScene");
  const prompt = document.getElementById("modalPrompt");

  if (!modal || !title || !scene || !prompt) {
    return;
  }

  title.textContent = demo.title;
  scene.textContent = demo.scene;
  prompt.textContent = demo.prompt;
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  modal.querySelector(".modal-close")?.focus();
}

function closePromptModal() {
  const modal = document.getElementById("promptModal");
  if (!modal) {
    return;
  }

  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function setStageDemo(demo, index, shouldScroll = false) {
  const stage = document.querySelector(".demo-stage");
  const video = document.getElementById("stageVideo");
  const title = document.getElementById("stageTitle");
  const prompt = document.getElementById("stagePrompt");
  const frames = document.getElementById("stageFrames");
  const seed = document.getElementById("stageSeed");
  const scene = document.getElementById("stageScene");
  const promptAction = document.getElementById("stagePromptAction");
  const speedControl = document.getElementById("stageSpeedControl");

  if (!stage || !video || !title || !prompt || !frames || !seed || !scene || !promptAction) {
    return;
  }

  resetDeferredVideo(video, demo.demo_video, thumbnailPath(demo.first_frame));
  syncStageAspect(video, stage);
  applyPlaybackSpeed(video, speedControl);
  if (shouldScroll || isNearViewport(stage)) {
    playDeferredVideo(video);
  }
  title.textContent = demo.title;
  prompt.textContent = shortPrompt(demo.prompt, 560);
  prompt.title = demo.prompt;
  promptAction.hidden = !isClipped(demo.prompt, 560);
  promptAction.onclick = () => openPromptModal(demo);
  frames.textContent = `${demo.frames} frames`;
  seed.textContent = `seed ${demo.seed}`;
  scene.textContent = demo.scene;

  document.querySelectorAll(".demo-card").forEach((card) => {
    card.classList.toggle("is-active", card.dataset.demoIndex === String(index));
  });

  if (shouldScroll) {
    stage.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function setDiverseDemo(demo, group, shouldScroll = false) {
  const stage = document.querySelector(".diverse-stage");
  const video = document.getElementById("diverseStageVideo");
  const title = document.getElementById("diverseStageTitle");
  const prompt = document.getElementById("diverseStagePrompt");
  const frames = document.getElementById("diverseStageFrames");
  const seed = document.getElementById("diverseStageSeed");
  const scene = document.getElementById("diverseStageScene");
  const promptAction = document.getElementById("diverseStagePromptAction");
  const speedControl = document.getElementById("diverseSpeedControl");

  if (!stage || !video || !title || !prompt || !frames || !seed || !scene || !promptAction) {
    return;
  }

  resetDeferredVideo(video, demo.demo_video, thumbnailPath(demo.first_frame));
  syncStageAspect(video, stage, "--diverse-stage-aspect");
  applyPlaybackSpeed(video, speedControl);
  if (shouldScroll || isNearViewport(stage)) {
    playDeferredVideo(video);
  }
  title.textContent = `${group.title} - ${demo.variant_label}`;
  prompt.textContent = shortPrompt(demo.prompt, 560);
  prompt.title = demo.prompt;
  promptAction.hidden = !isClipped(demo.prompt, 560);
  promptAction.onclick = () => openPromptModal(demo);
  frames.textContent = `${demo.frames} frames`;
  seed.textContent = `seed ${demo.seed}`;
  scene.textContent = group.scene;

  document.querySelectorAll(".variant-card").forEach((card) => {
    card.classList.toggle("is-active", card.dataset.variantId === demo.id);
  });

  if (shouldScroll) {
    stage.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

const heroMosaicCounts = [1, 4, 16];
const heroPlaybackRate = 1.5;
const fallbackHeroMediaAspect = 16 / 9;

function heroGridForCount(count) {
  const side = Math.sqrt(count);
  return { columns: side, rows: side };
}

function clearHeroMosaic(mosaic) {
  mosaic.querySelectorAll("video").forEach((video) => {
    video.pause();
    video.removeAttribute("src");
    video.load();
  });
  mosaic.replaceChildren();
}

function demoGroupFromCursor(demos, start, count) {
  return Array.from({ length: count }, (_, offset) => demos[(start + offset) % demos.length]);
}

function edgeDemosFromPool(pool, excludedGroup, count, start = 0) {
  const excluded = new Set(excludedGroup.map((demo) => demo.demo_video));
  const candidates = [];

  for (let offset = 0; offset < pool.length; offset += 1) {
    const candidate = pool[(start + offset) % pool.length];
    if (!excluded.has(candidate.demo_video)) {
      candidates.push(candidate);
    }
  }

  const source = candidates.length ? candidates : pool;
  if (!source.length) {
    return [];
  }

  return Array.from({ length: count }, (_, index) => source[index % source.length]);
}

function setHeroBoardAspect(board, columns, rows, mediaAspect = fallbackHeroMediaAspect) {
  const boardAspect = (columns * mediaAspect) / rows;
  board.style.setProperty("--hero-board-aspect-value", boardAspect.toFixed(5));
  board.style.setProperty("--hero-board-aspect", `${boardAspect.toFixed(5)} / 1`);
}

function heroTilePosition(index, columns, rows) {
  const column = index % columns;
  const row = Math.floor(index / columns);
  const horizontalCenter = (columns - 1) / 2;
  const verticalCenter = (rows - 1) / 2;
  const x = column < horizontalCenter ? "100%" : column > horizontalCenter ? "0%" : "50%";
  const y = row < verticalCenter ? "100%" : row > verticalCenter ? "0%" : "50%";
  return `${x} ${y}`;
}

function heroFillDemoForTile(group, pool, index, columns, rows) {
  const current = group[index];
  const groupOffset = Math.max(1, Math.floor(columns / 2) + 1);
  for (let offset = groupOffset; offset < groupOffset + group.length; offset += 1) {
    const candidate = group[(index + offset) % group.length];
    if (candidate.demo_video !== current.demo_video) {
      return candidate;
    }
  }

  const poolIndex = pool.findIndex((demo) => demo.demo_video === current.demo_video);
  const start = poolIndex >= 0 ? poolIndex : index;
  const firstOffset = Math.max(1, Math.ceil(pool.length / 2));
  for (let offset = firstOffset; offset < firstOffset + pool.length; offset += 1) {
    const candidate = pool[(start + offset) % pool.length];
    if (candidate.demo_video !== current.demo_video) {
      return candidate;
    }
  }

  return current;
}

function createHeroVideo(demo, className, { loop = false, preload = "auto", label = demo.title } = {}) {
  const video = document.createElement("video");
  video.className = className;
  video.muted = true;
  video.loop = loop;
  video.playsInline = true;
  video.autoplay = true;
  video.defaultPlaybackRate = heroPlaybackRate;
  video.playbackRate = heroPlaybackRate;
  video.preload = preload;
  video.poster = demo.first_frame;
  video.src = demo.demo_video;
  video.setAttribute("aria-label", label);
  return video;
}

function appendHeroEdgeCell(strip, demo, position) {
  const cell = document.createElement("div");
  cell.className = "hero-edge-cell";
  cell.style.setProperty("--edge-poster", `url(${JSON.stringify(demo.first_frame)})`);
  cell.style.setProperty("--edge-position", position);
  strip.append(cell);
}

function appendHeroEdgeStrip(edgeFill, side, demos, position, columns, rows) {
  const strip = document.createElement("div");
  strip.className = `hero-edge-strip is-${side}`;
  strip.style.setProperty("--hero-cols", String(columns));
  strip.style.setProperty("--hero-rows", String(rows));
  demos.forEach((demo) => appendHeroEdgeCell(strip, demo, position));
  edgeFill.append(strip);
}

function buildHeroEdgeFill(mosaic, demos, columns, rows) {
  const edgeFill = document.createElement("div");
  edgeFill.className = "hero-edge-fill";
  setHeroBoardAspect(edgeFill, columns, rows);

  appendHeroEdgeStrip(edgeFill, "left", demos.slice(0, rows), "100% 50%", columns, rows);
  appendHeroEdgeStrip(edgeFill, "right", demos.slice(rows, rows * 2), "0% 50%", columns, rows);
  appendHeroEdgeStrip(edgeFill, "top", demos.slice(rows * 2, rows * 2 + columns), "50% 100%", columns, rows);
  appendHeroEdgeStrip(edgeFill, "bottom", demos.slice(rows * 2 + columns, rows * 2 + columns * 2), "50% 0%", columns, rows);

  mosaic.append(edgeFill);
  return edgeFill;
}

function buildHeroMosaic(mosaic, demos, allDemos, count, onPrimaryEnded) {
  const { columns, rows } = heroGridForCount(count);
  clearHeroMosaic(mosaic);
  mosaic.dataset.count = String(count);
  const edgeDemos = edgeDemosFromPool(allDemos, demos, rows * 2 + columns * 2, count + Math.ceil(allDemos.length / 3));
  const edgeFill = buildHeroEdgeFill(
    mosaic,
    edgeDemos,
    columns,
    rows,
  );

  const board = document.createElement("div");
  board.className = "hero-mosaic-board";
  board.style.setProperty("--hero-cols", String(columns));
  board.style.setProperty("--hero-rows", String(rows));
  setHeroBoardAspect(board, columns, rows);
  mosaic.append(board);

  demos.forEach((demo, index) => {
    const fillDemo = heroFillDemoForTile(demos, allDemos, index, columns, rows);
    const tile = document.createElement("div");
    tile.className = "hero-tile";
    tile.style.setProperty("--tile-fill-poster", `url(${JSON.stringify(fillDemo.first_frame)})`);
    tile.style.setProperty("--tile-position", heroTilePosition(index, columns, rows));

    const video = createHeroVideo(demo, "hero-main-video", {
      preload: count > 4 ? "metadata" : "auto",
    });

    if (index === 0) {
      video.addEventListener("ended", onPrimaryEnded, { once: true });
      video.addEventListener("loadedmetadata", () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          const mediaAspect = video.videoWidth / video.videoHeight;
          setHeroBoardAspect(board, columns, rows, mediaAspect);
          setHeroBoardAspect(edgeFill, columns, rows, mediaAspect);
        }
      });
    }

    tile.append(video);
    board.append(tile);
    video.play().catch(() => {});
  });
}

function setupHeroPlaylist(demos) {
  const prerendered = document.getElementById("heroPrerendered");
  if (prerendered) {
    prerendered.playbackRate = 1;
    const loadPrerendered = () => playDeferredVideo(prerendered);
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(loadPrerendered, { timeout: 1200 });
    } else {
      window.setTimeout(loadPrerendered, 650);
    }
    return;
  }

  const mosaics = [document.getElementById("heroMosaicA"), document.getElementById("heroMosaicB")].filter(Boolean);
  const backdrops = [document.getElementById("heroBackdropA"), document.getElementById("heroBackdropB")].filter(Boolean);
  if (!mosaics.length || !backdrops.length || !demos.length) {
    return;
  }

  let activeLayer = 0;
  let layoutIndex = 0;
  let demoCursor = 0;
  let cycleToken = 0;
  let heroShouldPlay = true;

  const setHeroPlayback = (shouldPlay) => {
    mosaics.forEach((mosaic) => {
      mosaic.querySelectorAll("video").forEach((video) => {
        if (shouldPlay && mosaic.classList.contains("is-active")) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      });
    });
  };

  const showGroup = (isInitial = false) => {
    const count = heroMosaicCounts[layoutIndex];
    const group = demoGroupFromCursor(demos, demoCursor, count);
    const token = ++cycleToken;
    const nextLayer = isInitial ? activeLayer : 1 - activeLayer;
    const nextMosaic = mosaics[nextLayer] || mosaics[activeLayer];
    const prevMosaic = mosaics[activeLayer];
    const nextBackdrop = backdrops[nextLayer] || backdrops[activeLayer];
    const prevBackdrop = backdrops[activeLayer];
    const backdropDemo = group[0];

    demoCursor = (demoCursor + count) % demos.length;
    layoutIndex = (layoutIndex + 1) % heroMosaicCounts.length;

    buildHeroMosaic(nextMosaic, group, demos, count, () => {
      if (token === cycleToken) {
        showGroup();
      }
    });

    nextBackdrop.style.backgroundImage = `url(${JSON.stringify(backdropDemo.first_frame)})`;

    requestAnimationFrame(() => {
      nextMosaic.classList.add("is-active");
      nextBackdrop.classList.add("is-active");
      if (prevMosaic !== nextMosaic) {
        prevMosaic.classList.remove("is-active");
      }
      if (prevBackdrop !== nextBackdrop) {
        prevBackdrop.classList.remove("is-active");
      }
    });

    if (prevMosaic !== nextMosaic) {
      window.setTimeout(() => {
        if (!prevMosaic.classList.contains("is-active")) {
          clearHeroMosaic(prevMosaic);
        }
      }, 480);
    }

    if (prevBackdrop !== nextBackdrop) {
      window.setTimeout(() => {
        if (!prevBackdrop.classList.contains("is-active")) {
          prevBackdrop.style.backgroundImage = "";
        }
      }, 480);
    }

    activeLayer = nextLayer;
    if (!heroShouldPlay || document.hidden) {
      setHeroPlayback(false);
    }
  };

  showGroup(true);

  const hero = document.querySelector(".hero");
  if ("IntersectionObserver" in window && hero) {
    const observer = new IntersectionObserver(
      ([entry]) => {
        heroShouldPlay = entry.isIntersecting && entry.intersectionRatio > 0.18;
        setHeroPlayback(heroShouldPlay && !document.hidden);
      },
      { threshold: [0, 0.18] },
    );
    observer.observe(hero);
  }

  document.addEventListener("visibilitychange", () => {
    setHeroPlayback(heroShouldPlay && !document.hidden);
  });
}

function renderGrid(demos) {
  const grid = document.getElementById("demoGrid");
  if (!grid) {
    return;
  }

  grid.replaceChildren();
  demos.forEach((demo, index) => {
    const card = document.createElement("article");
    card.className = "demo-card";
    card.dataset.demoIndex = String(index);
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", demo.title);

    const media = document.createElement("div");
    media.className = "card-media";
    const image = createThumbnailImage(thumbnailPath(demo.first_frame), demo.title);
    media.append(image);

    const copy = document.createElement("div");
    copy.className = "card-copy";

    const heading = document.createElement("h3");
    heading.textContent = demo.title;

    const scene = document.createElement("p");
    scene.className = "scene-label";
    scene.textContent = demo.scene;

    const prompt = document.createElement("p");
    prompt.className = "prompt";
    prompt.textContent = shortPrompt(demo.prompt, 260);
    prompt.title = demo.prompt;

    const promptAction = document.createElement("button");
    promptAction.className = "prompt-action";
    promptAction.type = "button";
    promptAction.textContent = "Full prompt";
    promptAction.hidden = !isClipped(demo.prompt, 260);
    promptAction.addEventListener("click", (event) => {
      event.stopPropagation();
      openPromptModal(demo);
    });
    promptAction.addEventListener("keydown", (event) => {
      event.stopPropagation();
    });

    const facts = document.createElement("p");
    facts.className = "card-facts";
    facts.textContent = `${demo.frames} frames · seed ${demo.seed}`;

    copy.append(scene, heading, prompt, promptAction, facts);
    card.append(media, copy);
    card.addEventListener("click", () => setStageDemo(demo, index, true));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setStageDemo(demo, index, true);
      }
    });
    grid.append(card);
  });
}

function renderDiverseGroups(groups) {
  const container = document.getElementById("diverseGroups");
  if (!container) {
    return;
  }

  container.replaceChildren();

  if (!groups.length) {
    container.closest(".diverse-section")?.setAttribute("hidden", "");
    return;
  }

  container.closest(".diverse-section")?.removeAttribute("hidden");

  groups.forEach((group) => {
    const board = document.createElement("article");
    board.className = "diverse-board";

    const source = document.createElement("div");
    source.className = "source-frame";
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.fetchPriority = "low";
    image.src = thumbnailPath(group.first_frame);
    source.append(image);

    const header = document.createElement("div");
    header.className = "diverse-copy";
    const label = document.createElement("p");
    label.className = "scene-label";
    label.textContent = `${group.variants.length} trajectories`;
    const title = document.createElement("h3");
    title.textContent = group.title;
    const prompt = document.createElement("p");
    prompt.className = "prompt";
    prompt.textContent = shortPrompt(group.prompt, 220);
    header.append(label, title, prompt);

    const variants = document.createElement("div");
    variants.className = "variant-grid";
    group.variants.forEach((variant) => {
      const card = document.createElement("button");
      card.className = "variant-card";
      card.type = "button";
      card.dataset.variantId = variant.id;

      const image = createThumbnailImage(thumbnailPath(variant.first_frame), `${group.title}, ${variant.variant_label}`);

      const caption = document.createElement("span");
      caption.textContent = variant.variant_label;

      card.append(image, caption);
      card.addEventListener("click", () => setDiverseDemo(variant, group, true));
      variants.append(card);
    });

    board.append(source, header, variants);
    container.append(board);
  });

  setDiverseDemo(groups[0].variants[0], groups[0]);
}

loadDemos().then(({ demos, diverseGroups }) => {
  const demoCount = document.getElementById("demoCount");
  if (demoCount) {
    demoCount.textContent = String(demos.length);
  }

  const ordered = [...demos].sort((a, b) => {
    if (a.title === "Dragon in the Forbidden City") {
      return -1;
    }
    if (b.title === "Dragon in the Forbidden City") {
      return 1;
    }
    return 0;
  });

  setupHeroPlaylist(ordered);
  renderGrid(ordered);
  renderDiverseGroups(diverseGroups);
  setStageDemo(ordered[0], 0);
  observeStagePlayback(document.querySelector(".demo-stage"));
  observeStagePlayback(document.querySelector(".diverse-stage"));
});

document.querySelector(".modal-backdrop")?.addEventListener("click", closePromptModal);
document.querySelector(".modal-close")?.addEventListener("click", closePromptModal);
setupSpeedControl("stageSpeedControl", "stageVideo");
setupSpeedControl("diverseSpeedControl", "diverseStageVideo");
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closePromptModal();
  }
});
