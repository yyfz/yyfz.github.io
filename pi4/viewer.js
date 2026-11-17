import * as THREE from 'three';
import { TrackballControls } from './assets/vendor/TrackballControls.js';

const element = (identifier) => document.getElementById(identifier);
const arrayTypes = { '<f4': Float32Array, '<f8': Float64Array, '|u1': Uint8Array, '<u4': Uint32Array };
const frustumEdges = [0, 1, 0, 2, 0, 3, 0, 4, 1, 2, 2, 3, 3, 4, 4, 1];

function pointSizeFromSlider(value) {
  if (value <= 50) return 0.05 + 0.55 * (value / 50) ** 2;
  if (value <= 80) return 0.6 + (value - 50) * 0.03;
  return 1.5 + (value - 80) * 0.125;
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function safeAsset(path, base) {
  requireValue(typeof path === 'string' && path.length > 0 && !/[\\?#:%]/.test(path), 'Invalid scene asset path.');
  requireValue(!path.startsWith('/') && path.split('/').every((part) => part && part !== '.' && part !== '..'), 'Scene assets must use relative paths.');
  return new URL(path, base);
}

async function fetchJSON(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Scene unavailable (HTTP ${response.status}).`);
  return response.json();
}

function decodeBundle(buffer, description, manifest) {
  requireValue(buffer.byteLength === description.bytes, 'Incomplete scene download. Please try again.');
  const arrays = {};
  const ranges = [];
  for (const [name, field] of Object.entries(description.arrays)) {
    const ArrayType = arrayTypes[field.dtype];
    requireValue(ArrayType && Array.isArray(field.shape) && field.shape.length > 0, `Unsupported scene array: ${name}.`);
    requireValue(field.shape.every((size) => Number.isSafeInteger(size) && size >= 0), 'Invalid scene dimensions.');
    const count = field.shape.reduce((total, size) => total * size, 1);
    requireValue(Number.isSafeInteger(count) && Number.isSafeInteger(field.offset) && field.offset >= 0 && field.offset % ArrayType.BYTES_PER_ELEMENT === 0, 'Invalid binary alignment.');
    requireValue(field.bytes === count * ArrayType.BYTES_PER_ELEMENT && field.offset + field.bytes <= buffer.byteLength, 'Invalid scene array length.');
    if (field.bytes) ranges.push([field.offset, field.offset + field.bytes]);
    arrays[name] = new ArrayType(buffer, field.offset, count);
  }
  ranges.sort((left, right) => left[0] - right[0]);
  requireValue(ranges.every((range, index) => index === 0 || range[0] >= ranges[index - 1][1]), 'Overlapping scene arrays.');
  const expect = (name, dtype, shape) => {
    const field = description.arrays[name];
    requireValue(field?.dtype === dtype && JSON.stringify(field.shape) === JSON.stringify(shape), `Invalid scene array: ${name}.`);
  };
  expect('xyz', '<f4', [manifest.points, 3]);
  expect('rgb', '|u1', [manifest.points, 3]);
  expect('frame_offsets', '<u4', [manifest.frames + 1]);
  expect('camera_centers', '<f4', [manifest.frames, 3]);
  expect('camera_frustums', '<f4', [manifest.frames, 5, 3]);
  expect('timestamps', '<f8', [manifest.frames]);
  expect('segments', '<u4', [manifest.frames]);
  if (manifest.cloudOffsets) {
    expect('cloud_offsets', '<u4', [manifest.cloudOffsets.length]);
    requireValue(arrays.cloud_offsets[0] === 0 && arrays.cloud_offsets.at(-1) === manifest.points, 'Invalid global cloud offsets.');
    requireValue(arrays.cloud_offsets.every((value, index, offsets) => index === 0 || value >= offsets[index - 1]), 'Overlapping global cloud segments.');
  }
  const overlayCount = arrays.frame_offsets[manifest.frames];
  expect('frame_xyz', '<f4', [overlayCount, 3]);
  expect('frame_rgb', '|u1', [overlayCount, 3]);
  requireValue(arrays.frame_offsets[0] === 0 && arrays.timestamps[0] === 0, 'Invalid scene timeline origin.');
  for (let frame = 0; frame < manifest.frames; frame++) {
    requireValue(Number.isFinite(arrays.timestamps[frame]) && (frame === 0 || arrays.timestamps[frame] > arrays.timestamps[frame - 1]), 'Invalid frame timestamps.');
    requireValue(arrays.frame_offsets[frame + 1] >= arrays.frame_offsets[frame], 'Invalid frame geometry offsets.');
  }
  requireValue(manifest.duration > arrays.timestamps[manifest.frames - 1], 'Invalid scene duration.');
  for (const name of ['xyz', 'frame_xyz', 'camera_centers', 'camera_frustums']) {
    requireValue(arrays[name].every(Number.isFinite), 'Scene geometry contains invalid coordinates.');
  }
  if (manifest.queries > 0) {
    expect('track_xyz', '<f4', [manifest.frames, manifest.queries, 3]);
    expect('track_valid', '|u1', [manifest.frames, manifest.queries]);
    expect('query_uv', '<f4', [manifest.queries, 2]);
    requireValue(arrays.track_xyz.every(Number.isFinite) && arrays.track_valid.every((value) => value <= 1), 'Invalid point trajectories.');
  }
  return arrays;
}

async function fetchBundle(url, description, signal, onProgress) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Scene data unavailable (HTTP ${response.status}).`);
  const downloadBytes = description.encodedBytes ?? description.bytes;
  let buffer;
  if (response.body) {
    const reader = response.body.getReader();
    const bytes = new Uint8Array(downloadBytes);
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (received + value.byteLength > bytes.byteLength) {
        await reader.cancel();
        throw new Error('Scene download is larger than expected.');
      }
      bytes.set(value, received);
      received += value.byteLength;
      onProgress(received / downloadBytes);
    }
    requireValue(received === downloadBytes, 'Scene download was interrupted.');
    buffer = bytes.buffer;
  } else {
    buffer = await response.arrayBuffer();
    requireValue(buffer.byteLength === downloadBytes, 'Scene download was interrupted.');
  }
  if (description.compression === 'gzip') {
    requireValue(typeof DecompressionStream === 'function', 'This browser cannot open compressed scene data.');
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    buffer = await new Response(stream).arrayBuffer();
  }
  requireValue(buffer.byteLength === description.bytes, 'Scene decompression failed.');
  if (description.sha256 && globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const actual = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
    requireValue(actual === description.sha256, 'Scene integrity check failed. Please reload.');
  }
  if (signal.aborted) throw new DOMException('Scene loading cancelled.', 'AbortError');
  return buffer;
}

function pointLayer(positions, colors, size, tint = 0) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3, colors instanceof Uint8Array));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    uniforms: { size: { value: size }, ratio: { value: Math.min(devicePixelRatio, 2) }, opacity: { value: 1 }, tint: { value: tint } },
    vertexShader: `
      attribute vec3 color;
      uniform float size, ratio, tint;
      varying vec3 pointColor;
      void main() {
        pointColor = min(pow(mix(color, vec3(0.57, 0.94, 0.91), tint), vec3(1.7)) * 1.08, vec3(1.0));
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = clamp(size * ratio * 2.3 / max(-viewPosition.z, 0.05), ratio, 12.0 * ratio);
      }`,
    fragmentShader: `
      uniform float opacity;
      varying vec3 pointColor;
      void main() {
        float radius = length(gl_PointCoord - 0.5);
        if (radius > 0.5) discard;
        gl_FragColor = vec4(pointColor, opacity * (1.0 - smoothstep(0.46, 0.5, radius)));
        #include <colorspace_fragment>
      }`,
  });
  const layer = new THREE.Points(geometry, material);
  layer.frustumCulled = false;
  return layer;
}

function cameraColor(frame, frameCount) {
  const progress = frame / Math.max(1, frameCount - 1);
  return new THREE.Color().setHSL(0.74 - progress * 0.28, 0.62, 0.46);
}

function cameraMesh(instances, opacity) {
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false });
  const mesh = new THREE.InstancedMesh(geometry, material, instances);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}

function cameraCorner(arrays, frame, index) {
  return new THREE.Vector3(...arrays.camera_frustums.subarray(frame * 15 + index * 3, frame * 15 + index * 3 + 3));
}

function setCameraEdge(mesh, index, start, end, radius, color) {
  const direction = end.clone().sub(start);
  const length = Math.max(direction.length(), 0.000001);
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  const matrix = new THREE.Matrix4().compose(midpoint, quaternion, new THREE.Vector3(radius, length, radius));
  mesh.setMatrixAt(index, matrix);
  mesh.setColorAt(index, color);
}

function disposeGroup(group) {
  if (!group) return;
  group.traverse((object) => {
    object.geometry?.dispose();
    if (object.material) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    }
  });
  group.removeFromParent();
}

export class PointCloudViewer {
  constructor() {
    this.stage = element('viewer-stage');
    this.container = element('point-cloud');
    this.video = element('input-video');
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(43, 1, 0.001, 100);
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x0b1017, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.container.append(this.renderer.domElement);
    this.controls = new TrackballControls(this.camera, this.renderer.domElement);
    this.controls.rotateSpeed = 2.4;
    this.controls.zoomSpeed = 1.1;
    this.controls.panSpeed = 0.55;
    this.controls.dynamicDampingFactor = 0.12;
    this.controls.addEventListener('change', () => { this.dirty = true; });
    this.renderer.domElement.addEventListener('pointerdown', (event) => {
      this.setFollowCamera(false);
      this.controls.mouseButtons.LEFT = event.shiftKey ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    }, true);
    this.renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.setPlaying(false);
      this.showError('The graphics context was interrupted. Reload the page to restore the 3D view.');
      element('retry-scene').hidden = true;
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.visibilityObserver = new IntersectionObserver(([entry]) => this.setVisible(entry.isIntersecting), { threshold: 0 });
    this.visibilityObserver.observe(this.stage);
    this.frame = -1;
    this.playhead = 0;
    this.playing = false;
    this.speed = 1;
    this.mediaUsable = false;
    this.followCamera = false;
    this.followExact = false;
    this.followGoal = null;
    this.followInitialized = false;
    this.streamTrack = element('camera-stream-track');
    this.filmstrip = element('camera-filmstrip');
    this.streamThumb = element('camera-thumb-image');
    this.streamTiles = [];
    this.streamGeneration = 0;
    this.streamTileCount = 32;
    this.lastStreamThumbTime = -1;
    this.isScrubbing = false;
    this.bindControls();
    this.resize();
  }

  bindControls() {
    const timeline = element('timeline');
    element('play').addEventListener('click', () => this.setPlaying(!this.playing));
    timeline.addEventListener('pointerdown', () => this.beginScrub());
    timeline.addEventListener('input', (event) => {
      if (!this.isScrubbing) this.setFollowCamera(true, { exact: true });
      this.seek(Number(event.target.value));
    });
    timeline.addEventListener('change', () => this.endScrub());
    window.addEventListener('pointerup', () => this.endScrub());
    window.addEventListener('pointercancel', () => this.endScrub());
    element('video-inset').addEventListener('click', () => {
      if (!this.ready) return;
      this.setPlaying(false);
      this.setFollowCamera(true, { exact: true });
    });
    element('follow-view').addEventListener('click', () => this.setFollowCamera(!this.followCamera));
    element('reset-view').addEventListener('click', () => {
      this.setFollowCamera(false);
      this.fit();
    });
    element('speed').addEventListener('change', (event) => {
      this.speed = Number(event.target.value);
      this.video.playbackRate = this.speed;
    });
    element('point-size').addEventListener('input', () => this.applyLayers());
    ['show-cloud', 'show-frame', 'show-tracks', 'show-cameras'].forEach((identifier) => {
      element(identifier).addEventListener('change', () => this.applyLayers());
    });
    element('fullscreen').addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await element('viewer-shell').requestFullscreen();
      } catch {
        element('fullscreen').title = 'Fullscreen is not supported in this browser.';
      }
    });
    if (!document.fullscreenEnabled) element('fullscreen').hidden = true;
    document.addEventListener('fullscreenchange', () => {
      element('fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen');
      this.resize();
    });
    this.stage.addEventListener('keydown', (event) => {
      if (event.target.closest('button, input, select') || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Space') {
        event.preventDefault();
        this.setPlaying(!this.playing);
      }
      if (event.code === 'ArrowRight' || event.code === 'ArrowLeft') {
        event.preventDefault();
        this.seek(this.frame + (event.code === 'ArrowRight' ? 1 : -1));
      }
      if (event.code === 'KeyF') this.setFollowCamera(!this.followCamera);
      if (event.code === 'KeyR') {
        this.setFollowCamera(false);
        this.fit();
      }
    });
    this.video.addEventListener('loadeddata', () => {
      this.mediaUsable = true;
      this.video.currentTime = this.playhead;
      this.updateStreamThumb(true);
      if (this.playing) this.playVideo();
    });
    this.video.addEventListener('seeked', () => this.updateStreamThumb(true));
    this.video.addEventListener('error', () => {
      this.mediaUsable = false;
      element('video-unavailable').hidden = false;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.setPlaying(false);
    });
  }

  async load(entry) {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;
    this.setPlaying(false);
    this.ready = false;
    this.mediaUsable = false;
    this.followExact = false;
    this.followGoal = null;
    this.followInitialized = false;
    this.isScrubbing = false;
    this.resetCameraStream();
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.video.poster = entry.poster;
    element('viewer-poster').src = entry.poster;
    this.stage.classList.remove('is-ready');
    element('video-unavailable').hidden = true;
    element('video-inset').disabled = true;
    element('play').disabled = true;
    element('timeline').disabled = true;
    element('viewer-status').hidden = false;
    element('viewer-status').classList.remove('is-error');
    element('retry-scene').hidden = true;
    element('loading-text').textContent = 'Opening the scene…';
    element('scene-name').textContent = entry.title;
    element('scene-mode').textContent = entry.tag;
    this.stage.setAttribute('aria-busy', 'true');
    try {
      const url = new URL(entry.manifest, location.href);
      const manifest = await fetchJSON(url, signal);
      requireValue(manifest.format === 'pi4_web_scene_v1', 'Unsupported scene format.');
      requireValue(Number.isSafeInteger(manifest.frames) && manifest.frames > 0 && manifest.frames <= 10000, 'Invalid frame count.');
      requireValue(Number.isSafeInteger(manifest.points) && manifest.points > 0 && manifest.points <= 3000000, 'Invalid scene point count.');
      requireValue(Number.isSafeInteger(manifest.queries) && manifest.queries >= 0 && manifest.queries <= 10000, 'Invalid track count.');
      requireValue(Number.isFinite(manifest.duration) && manifest.duration > 0 && Number.isFinite(manifest.fps) && manifest.fps > 0, 'Invalid scene timing.');
      requireValue(Number.isSafeInteger(manifest.data?.bytes) && manifest.data.bytes > 0 && manifest.data.bytes <= 180000000, 'Invalid scene data size.');
      requireValue(Number.isSafeInteger(manifest.data.encodedBytes ?? manifest.data.bytes) && (manifest.data.encodedBytes ?? manifest.data.bytes) > 0, 'Invalid scene download size.');
      requireValue(!manifest.data.compression || manifest.data.compression === 'gzip', 'Unsupported scene compression.');
      for (const bounds of [manifest.bounds, ...(manifest.viewBounds ? [manifest.viewBounds] : [])]) {
        requireValue(['min', 'max'].every((key) => Array.isArray(bounds?.[key]) && bounds[key].length === 3 && bounds[key].every(Number.isFinite)), 'Invalid scene bounds.');
        requireValue(bounds.min.every((value, index) => value <= bounds.max[index]), 'Reversed scene bounds.');
      }
      const dataUrl = safeAsset(manifest.data.file, url);
      if (manifest.data.sha256) dataUrl.searchParams.set('v', manifest.data.sha256.slice(0, 16));
      const buffer = await fetchBundle(dataUrl, manifest.data, signal, (progress) => {
        element('loading-text').textContent = `Loading real predictions · ${Math.round(progress * 100)}%`;
      });
      const arrays = decodeBundle(buffer, manifest.data, manifest);
      if (signal.aborted) return;
      disposeGroup(this.group);
      this.manifest = manifest;
      this.arrays = arrays;
      this.buildScene();
      this.scene.add(this.group);
      this.fit();
      this.ready = true;
      this.frame = -1;
      this.playhead = 0;
      this.video.loop = true;
      const videoUrl = safeAsset(manifest.video, url);
      if (manifest.data.sha256) videoUrl.searchParams.set('v', manifest.data.sha256.slice(0, 16));
      this.video.src = videoUrl.href;
      this.video.playbackRate = this.speed;
      this.video.load();
      this.prepareCameraStream(videoUrl);
      element('timeline').max = manifest.frames - 1;
      element('timeline').disabled = false;
      element('video-inset').disabled = false;
      element('play').disabled = false;
      element('duration').textContent = this.formatTime(manifest.duration);
      element('show-tracks').disabled = manifest.queries === 0;
      element('tracks-toggle').title = manifest.queries ? 'Point trajectories over the preceding two seconds' : 'This preview contains geometry and cameras; no valid point tracks were exported.';
      element('viewer-stat').textContent = `${new Intl.NumberFormat('en', { notation: 'compact' }).format(manifest.points)} POINTS${manifest.queries ? ` / ${manifest.queries} TRACKS` : ''}`;
      this.setFollowCamera(true);
      this.setFrame(0);
      this.applyLayers();
      element('viewer-status').hidden = true;
      this.stage.setAttribute('aria-busy', 'false');
      this.setPlaying(true);
      this.dirty = true;
      this.stage.classList.add('is-ready');
    } catch (error) {
      if (signal.aborted || error.name === 'AbortError') return;
      this.showError(error.message);
    }
  }

  setFollowCamera(enabled, { exact = false } = {}) {
    this.followCamera = Boolean(enabled);
    this.followExact = this.followCamera && Boolean(exact);
    this.controls.enabled = !this.followCamera;
    const button = element('follow-view');
    button.classList.toggle('is-active', this.followCamera);
    button.setAttribute('aria-label', this.followCamera ? 'Disable camera follow' : 'Enable camera follow');
    button.title = this.followCamera ? 'Disable camera follow (F)' : 'Follow camera (F)';
    if (this.followCamera) this.applyFollowCamera();
    else this.controls.update();
    this.dirty = true;
  }

  applyFollowCamera() {
    if (!this.followCamera || !this.arrays || this.frame < 0) return;
    const { camera_centers: centers, camera_frustums: corners } = this.arrays;
    const origin = new THREE.Vector3(...centers.subarray(this.frame * 3, this.frame * 3 + 3));
    const corner = (index) => new THREE.Vector3(...corners.subarray(this.frame * 15 + index * 3, this.frame * 15 + index * 3 + 3));
    const topLeft = corner(1);
    const topRight = corner(2);
    const bottomRight = corner(3);
    const bottomLeft = corner(4);
    const target = topLeft.clone().add(topRight).add(bottomLeft).add(bottomRight).multiplyScalar(0.25);
    const up = topLeft.clone().add(topRight).sub(bottomLeft).sub(bottomRight).normalize();
    const followOffset = origin.clone().sub(target).normalize().multiplyScalar(this.followExact ? 0 : this.manifest.followDistance ?? 0.18);
    const position = origin.clone().add(followOffset).addScaledVector(up, this.followExact ? 0 : this.manifest.followHeight ?? 0);
    const verticalSpan = topLeft.clone().add(topRight).sub(bottomLeft).sub(bottomRight).length() * 0.5;
    const opticalDistance = Math.max(origin.distanceTo(target), 0.000001);
    const fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(verticalSpan / (2 * opticalDistance))), 25, 75);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(position, target, up));
    this.followGoal = { position, target, up, quaternion, fov };
    if (!this.followInitialized) {
      this.camera.position.copy(position);
      this.camera.up.copy(up);
      this.camera.quaternion.copy(quaternion);
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      this.controls.target.copy(target);
      this.followInitialized = true;
    }
    this.dirty = true;
  }

  updateFollowCamera(elapsed) {
    if (!this.followGoal || !this.followInitialized) return;
    const goal = this.followGoal;
    const positionAlpha = 1 - Math.exp(-8 * elapsed);
    const rotationAlpha = 1 - Math.exp(-11 * elapsed);
    const fovAlpha = 1 - Math.exp(-8 * elapsed);
    const positionDelta = this.camera.position.distanceToSquared(goal.position);
    const targetDelta = this.controls.target.distanceToSquared(goal.target);
    const upDelta = this.camera.up.distanceToSquared(goal.up);
    const rotationDelta = 1 - Math.abs(this.camera.quaternion.dot(goal.quaternion));
    const fovDelta = Math.abs(this.camera.fov - goal.fov);
    this.camera.position.lerp(goal.position, positionAlpha);
    this.controls.target.lerp(goal.target, positionAlpha);
    this.camera.up.lerp(goal.up, rotationAlpha).normalize();
    this.camera.quaternion.slerp(goal.quaternion, rotationAlpha);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, goal.fov, fovAlpha);
    if (fovDelta > 0.00001) this.camera.updateProjectionMatrix();
    if (positionDelta > 1e-10 || targetDelta > 1e-10 || upDelta > 1e-10 || rotationDelta > 1e-8 || fovDelta > 0.0001) this.dirty = true;
  }

  buildScene() {
    const { arrays, manifest } = this;
    this.group = new THREE.Group();
    this.cloud = pointLayer(arrays.xyz, arrays.rgb, 1.6);
    this.overlay = pointLayer(arrays.frame_xyz, arrays.frame_rgb, 2.1, 0.4);
    this.overlay.renderOrder = 1;
    this.group.add(this.cloud, this.overlay);
    const cameraCount = Math.min(72, manifest.frames);
    const cameraFrames = Array.from({ length: cameraCount }, (_, index) => Math.round(index / Math.max(1, cameraCount - 1) * (manifest.frames - 1)));
    this.cameraPath = cameraMesh(cameraCount * frustumEdges.length / 2, 0.78);
    this.cameraPath.userData.frames = cameraFrames;
    this.cameraPath.userData.pixelWidth = 0.65;
    this.cameraPath.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cameraFrustum = cameraMesh(frustumEdges.length / 2, 1.0);
    this.cameraFrustum.userData.frames = [0];
    this.cameraFrustum.userData.pixelWidth = 0.9;
    this.cameraFrustum.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.cameraPath, this.cameraFrustum);
    this.trackLines = null;
    this.trackHeads = null;
    if (!manifest.queries) return;
    const palette = [];
    const color = new THREE.Color();
    for (let query = 0; query < manifest.queries; query++) {
      color.setHSL((0.46 + query / manifest.queries * 0.55) % 1, 0.68, 0.7);
      palette.push(color.r, color.g, color.b);
    }
    this.trackLines = cameraMesh((manifest.frames - 1) * manifest.queries, 0.9);
    this.trackLines.count = 0;
    this.trackLines.renderOrder = 3;
    this.trackLines.userData.pixelWidth = 1.6;
    this.trackLines.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trackStartFrame = 0;
    this.trackPalette = new Float32Array(palette);
    this.trackHeads = pointLayer(new Float32Array(manifest.queries * 3), new Float32Array(manifest.queries * 3), 4.2);
    this.trackHeads.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
    this.trackHeads.geometry.attributes.color.setUsage(THREE.DynamicDrawUsage);
    this.trackHeads.material.depthWrite = false;
    this.trackHeads.renderOrder = 4;
    this.group.add(this.trackLines, this.trackHeads);
  }

  updateCameraGlyphs() {
    if (!this.arrays || !this.cameraPath || !this.cameraFrustum) return;
    const height = Math.max(1, this.container.clientHeight);
    const viewTangent = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    this.cameraFrustum.visible = element('show-cameras').checked && !this.followExact;
    for (const mesh of [this.cameraPath, this.cameraFrustum]) {
      let instance = 0;
      for (const frame of mesh.userData.frames) {
        const origin = cameraCorner(this.arrays, frame, 0);
        const target = cameraCorner(this.arrays, frame, 1).add(cameraCorner(this.arrays, frame, 2)).add(cameraCorner(this.arrays, frame, 3)).add(cameraCorner(this.arrays, frame, 4)).multiplyScalar(0.25);
        const baseDepth = Math.max(origin.distanceTo(target), 0.000001);
        const viewDistance = origin.distanceTo(this.camera.position);
        const scale = Math.min(1, viewDistance * 0.12 / baseDepth) * (this.manifest.cameraGlyphScale ?? 1);
        const radius = mesh.userData.pixelWidth * Math.max(viewDistance, 0.0001) * viewTangent / height;
        const color = cameraColor(frame, this.manifest.frames);
        for (let edge = 0; edge < frustumEdges.length; edge += 2) {
          const start = cameraCorner(this.arrays, frame, frustumEdges[edge]).sub(origin).multiplyScalar(scale).add(origin);
          const end = cameraCorner(this.arrays, frame, frustumEdges[edge + 1]).sub(origin).multiplyScalar(scale).add(origin);
          setCameraEdge(mesh, instance++, start, end, radius, color);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
  }

  updateTrackGlyphs() {
    if (!this.trackLines || !this.trackLines.visible) return;
    const { arrays, manifest, trackLines } = this;
    const height = Math.max(1, this.container.clientHeight);
    const viewTangent = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const color = new THREE.Color();
    let instance = 0;
    for (let frame = Math.max(1, this.trackStartFrame + 1); frame <= this.frame; frame++) {
      for (let query = 0; query < manifest.queries; query++) {
        const current = frame * manifest.queries + query;
        const previous = current - manifest.queries;
        if (arrays.segments[frame] !== arrays.segments[frame - 1] || !arrays.track_valid[current] || !arrays.track_valid[previous]) continue;
        const start = new THREE.Vector3(...arrays.track_xyz.subarray(previous * 3, previous * 3 + 3));
        const end = new THREE.Vector3(...arrays.track_xyz.subarray(current * 3, current * 3 + 3));
        if (start.distanceToSquared(end) < 1e-12) continue;
        const viewDistance = start.clone().add(end).multiplyScalar(0.5).distanceTo(this.camera.position);
        const radius = trackLines.userData.pixelWidth * Math.max(viewDistance, 0.0001) * viewTangent / height;
        color.setRGB(...this.trackPalette.subarray(query * 3, query * 3 + 3));
        setCameraEdge(trackLines, instance++, start, end, radius, color);
      }
    }
    trackLines.count = instance;
    trackLines.instanceMatrix.needsUpdate = true;
    if (trackLines.instanceColor) trackLines.instanceColor.needsUpdate = true;
  }

  setFrame(frame) {
    if (!this.ready) return;
    frame = Math.max(0, Math.min(this.manifest.frames - 1, frame));
    if (frame === this.frame) return;
    this.frame = frame;
    const { arrays, manifest } = this;
    if (manifest.cloudOffsets) {
      const segment = arrays.segments[frame];
      const start = arrays.cloud_offsets[segment];
      this.cloud.geometry.setDrawRange(start, arrays.cloud_offsets[segment + 1] - start);
    }
    this.overlay.geometry.setDrawRange(arrays.frame_offsets[frame], arrays.frame_offsets[frame + 1] - arrays.frame_offsets[frame]);
    this.cameraFrustum.userData.frames[0] = frame;
    if (this.trackLines) {
      let startFrame = frame;
      while (startFrame > 0 && arrays.timestamps[frame] - arrays.timestamps[startFrame - 1] <= 2 && arrays.segments[startFrame - 1] === arrays.segments[frame]) startFrame--;
      this.trackStartFrame = startFrame;
      let headCount = 0;
      const positions = this.trackHeads.geometry.attributes.position;
      const colors = this.trackHeads.geometry.attributes.color;
      for (let query = 0; query < manifest.queries; query++) {
        const sample = frame * manifest.queries + query;
        if (!arrays.track_valid[sample]) continue;
        positions.array.set(arrays.track_xyz.subarray(sample * 3, sample * 3 + 3), headCount * 3);
        colors.array.set(this.trackPalette.subarray(query * 3, query * 3 + 3), headCount * 3);
        headCount++;
      }
      positions.needsUpdate = true;
      colors.needsUpdate = true;
      this.trackHeads.geometry.setDrawRange(0, headCount);
    }
    element('timeline').value = frame;
    this.streamTrack.style.setProperty('--progress', `${manifest.frames > 1 ? frame / (manifest.frames - 1) * 100 : 0}%`);
    element('timeline').setAttribute('aria-valuetext', `Frame ${frame + 1} of ${manifest.frames}`);
    element('current-time').textContent = this.formatTime(arrays.timestamps[frame]);
    element('frame-label').textContent = `FRAME ${String(frame + 1).padStart(3, '0')} / ${manifest.frames}`;
    element('camera-thumb-frame').textContent = String(frame + 1).padStart(3, '0');
    this.updateStreamThumb();
    this.applyFollowCamera();
    this.dirty = true;
  }

  seek(frame) {
    if (!this.ready) return;
    const next = Math.max(0, Math.min(this.manifest.frames - 1, Math.round(frame)));
    this.playhead = this.arrays.timestamps[next];
    if (this.video.src && this.video.readyState >= 1) this.video.currentTime = this.playhead;
    this.setFrame(next);
  }

  beginScrub() {
    if (!this.ready) return;
    this.isScrubbing = true;
    this.resumeAfterScrub = this.playing;
    this.setPlaying(false);
    this.setFollowCamera(true, { exact: true });
  }

  endScrub() {
    if (!this.isScrubbing) return;
    this.isScrubbing = false;
    const resume = this.resumeAfterScrub;
    this.resumeAfterScrub = false;
    if (resume && this.ready && this.visible) this.setPlaying(true);
  }

  resetCameraStream() {
    this.streamGeneration++;
    if (this.streamVideo) {
      this.streamVideo.pause();
      this.streamVideo.removeAttribute('src');
      this.streamVideo.load();
    }
    this.streamVideo = null;
    this.streamTiles = [];
    this.lastStreamThumbTime = -1;
    this.streamTrack.style.setProperty('--progress', '0%');
    element('camera-thumb-frame').textContent = '—';
    const thumb = this.streamThumb.getContext('2d');
    thumb.fillStyle = '#15181d';
    thumb.fillRect(0, 0, this.streamThumb.width, this.streamThumb.height);
    this.resizeCameraStream();
  }

  prepareCameraStream(url) {
    const generation = this.streamGeneration;
    const sampler = document.createElement('video');
    sampler.muted = true;
    sampler.playsInline = true;
    sampler.preload = 'auto';
    this.streamVideo = sampler;
    this.streamTileCount = Math.max(16, Math.min(56, Math.round(this.streamTrack.clientWidth / 24) || 32));
    sampler.addEventListener('loadedmetadata', () => {
      if (generation !== this.streamGeneration) return;
      this.resizeCameraStream();
      this.populateCameraStream(generation).catch(() => {});
    }, { once: true });
    sampler.src = url.href;
    sampler.load();
  }

  async populateCameraStream(generation) {
    const sampler = this.streamVideo;
    for (let index = 0; index < this.streamTileCount; index++) {
      if (generation !== this.streamGeneration || sampler !== this.streamVideo) return;
      const frame = Math.round(index / Math.max(1, this.streamTileCount - 1) * (this.manifest.frames - 1));
      try {
        await this.seekStreamVideo(sampler, this.arrays.timestamps[frame]);
      } catch {
        continue;
      }
      if (generation !== this.streamGeneration || sampler !== this.streamVideo || sampler.readyState < 2) return;
      const tile = document.createElement('canvas');
      tile.width = 96;
      tile.height = Math.max(32, Math.min(160, Math.round(96 * sampler.videoHeight / sampler.videoWidth)));
      tile.getContext('2d').drawImage(sampler, 0, 0, tile.width, tile.height);
      this.streamTiles[index] = tile;
      this.drawFilmstrip();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  seekStreamVideo(video, time) {
    if (video.readyState >= 2 && Math.abs(video.currentTime - time) < 0.0001) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        video.removeEventListener('seeked', complete);
        video.removeEventListener('error', fail);
      };
      const complete = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('Video stream frame unavailable.')); };
      const timeout = setTimeout(fail, 2500);
      video.addEventListener('seeked', complete, { once: true });
      video.addEventListener('error', fail, { once: true });
      video.currentTime = Math.min(time, Math.max(0, video.duration - 0.001));
    });
  }

  resizeCameraStream() {
    const width = this.streamTrack.clientWidth;
    const height = this.streamTrack.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(devicePixelRatio, 2);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (this.filmstrip.width !== pixelWidth || this.filmstrip.height !== pixelHeight) {
      this.filmstrip.width = pixelWidth;
      this.filmstrip.height = pixelHeight;
    }
    this.drawFilmstrip();
  }

  drawFilmstrip() {
    const width = this.streamTrack.clientWidth;
    const height = this.streamTrack.clientHeight;
    if (!width || !height) return;
    const context = this.filmstrip.getContext('2d');
    const ratio = this.filmstrip.width / width;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = '#e4e7ec';
    context.fillRect(0, 0, width, height);
    const tileWidth = width / this.streamTileCount;
    for (let index = 0; index < this.streamTileCount; index++) {
      const tile = this.streamTiles[index];
      if (tile) this.drawCover(context, tile, index * tileWidth, 0, tileWidth + 0.5, height);
      context.fillStyle = 'rgba(255,255,255,0.22)';
      context.fillRect(index * tileWidth, 0, 0.5, height);
    }
  }

  drawCover(context, source, x, y, width, height) {
    const sourceWidth = source.videoWidth || source.width;
    const sourceHeight = source.videoHeight || source.height;
    const sourceRatio = sourceWidth / sourceHeight;
    const targetRatio = width / height;
    let sx = 0;
    let sy = 0;
    let sw = sourceWidth;
    let sh = sourceHeight;
    if (sourceRatio > targetRatio) {
      sw = sourceHeight * targetRatio;
      sx = (sourceWidth - sw) / 2;
    } else {
      sh = sourceWidth / targetRatio;
      sy = (sourceHeight - sh) / 2;
    }
    context.drawImage(source, sx, sy, sw, sh, x, y, width, height);
  }

  updateStreamThumb(force = false) {
    if (this.video.readyState < 2 || !this.video.videoWidth) return;
    if (!force && Math.abs(this.video.currentTime - this.lastStreamThumbTime) < 0.02) return;
    const canvas = this.streamThumb;
    const context = canvas.getContext('2d');
    context.fillStyle = '#15181d';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / this.video.videoWidth, canvas.height / this.video.videoHeight);
    const width = this.video.videoWidth * scale;
    const height = this.video.videoHeight * scale;
    context.drawImage(this.video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    this.lastStreamThumbTime = this.video.currentTime;
  }

  async playVideo() {
    try {
      await this.video.play();
    } catch (error) {
      if (error.name !== 'AbortError') this.mediaUsable = false;
    }
  }

  setPlaying(playing) {
    this.playing = Boolean(playing && this.ready);
    this.lastTick = performance.now();
    if (this.playing) this.playVideo();
    else this.video.pause();
    element('play').classList.toggle('is-playing', this.playing);
    element('play').setAttribute('aria-label', this.playing ? 'Pause point cloud' : 'Play point cloud');
    element('play').querySelector('use').setAttribute('href', this.playing ? '#icon-pause' : '#icon-play');
  }

  applyLayers() {
    const slider = element('point-size');
    const rawValue = Number(slider.value);
    const size = Number(slider.max) <= 3.5 ? rawValue : pointSizeFromSlider(rawValue);
    const label = `${size.toFixed(2)}×`;
    element('point-size-value').value = label;
    slider.setAttribute('aria-valuetext', label);
    if (!this.group) return;
    this.cloud.visible = element('show-cloud').checked;
    this.overlay.visible = element('show-frame').checked;
    const pointScale = this.manifest.pointScale ?? 1;
    this.cloud.material.uniforms.size.value = size * pointScale;
    this.cloud.material.uniforms.opacity.value = this.overlay.visible ? 0.9 : 1.0;
    this.overlay.material.uniforms.size.value = size * 1.3 * pointScale;
    this.cameraPath.visible = element('show-cameras').checked;
    this.cameraFrustum.visible = element('show-cameras').checked;
    if (this.trackLines) {
      this.trackLines.visible = element('show-tracks').checked;
      this.trackHeads.visible = element('show-tracks').checked;
    }
    this.dirty = true;
  }

  fit() {
    if (!this.manifest) return;
    const bounds = this.manifest.viewBounds || this.manifest.bounds;
    const minimum = new THREE.Vector3(...bounds.min);
    const maximum = new THREE.Vector3(...bounds.max);
    const center = minimum.clone().add(maximum).multiplyScalar(0.5);
    const radius = Math.max(maximum.distanceTo(minimum) * 0.5, 0.05);
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const verticalTangent = Math.tan(verticalFov / 2);
    const horizontalTangent = verticalTangent * this.camera.aspect;
    const corners = this.arrays.camera_frustums;
    const origin = new THREE.Vector3(...this.arrays.camera_centers.subarray(0, 3));
    const topLeft = new THREE.Vector3(...corners.subarray(3, 6));
    const topRight = new THREE.Vector3(...corners.subarray(6, 9));
    const bottomRight = new THREE.Vector3(...corners.subarray(9, 12));
    const bottomLeft = new THREE.Vector3(...corners.subarray(12, 15));
    const up = topLeft.clone().add(topRight).sub(bottomLeft).sub(bottomRight).normalize();
    const outward = topLeft.clone().add(topRight).add(bottomLeft).add(bottomRight).multiplyScalar(0.25).sub(origin).negate().normalize();
    outward.applyAxisAngle(up, THREE.MathUtils.degToRad(10));
    const right = up.clone().cross(outward).normalize();
    const screenUp = outward.clone().cross(right).normalize();
    let distance = 0;
    for (const horizontal of [minimum.x, maximum.x]) {
      for (const vertical of [minimum.y, maximum.y]) {
        for (const depth of [minimum.z, maximum.z]) {
          const offset = new THREE.Vector3(horizontal, vertical, depth).sub(center);
          distance = Math.max(distance, offset.dot(outward) + Math.abs(offset.dot(right)) / horizontalTangent, offset.dot(outward) + Math.abs(offset.dot(screenUp)) / verticalTangent);
        }
      }
    }
    distance = Math.max(distance * 1.12, radius * 0.4);
    this.camera.position.copy(center).add(outward.multiplyScalar(distance));
    this.camera.up.copy(up);
    this.camera.near = radius / 1000;
    this.camera.far = radius * 100;
    this.camera.lookAt(center);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.minDistance = radius * 0.04;
    this.controls.maxDistance = radius * 15;
    this.controls.update();
    this.dirty = true;
  }

  resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.controls.handleResize();
    this.resizeCameraStream();
    this.dirty = true;
  }

  setVisible(visible) {
    this.visible = visible;
    if (!visible) {
      this.resumeOnVisible = this.playing;
      this.setPlaying(false);
      cancelAnimationFrame(this.animation);
    } else {
      this.lastTick = performance.now();
      if (this.resumeOnVisible) {
        this.resumeOnVisible = false;
        this.setPlaying(true);
      }
      this.tick(this.lastTick);
    }
  }

  tick(now) {
    if (!this.visible) return;
    const elapsed = Math.max(0, Math.min((now - this.lastTick) / 1000, 0.2));
    this.lastTick = now;
    if (!this.followCamera) this.controls.update();
    if (this.playing && this.ready) {
      if (this.mediaUsable && !this.video.paused) this.playhead = this.video.currentTime;
      else this.playhead = (this.playhead + elapsed * this.speed) % this.manifest.duration;
      let low = 0;
      let high = this.manifest.frames;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (this.arrays.timestamps[middle] <= this.playhead) low = middle + 1;
        else high = middle;
      }
      this.setFrame(Math.max(0, low - 1));
    }
    if (this.followCamera) this.updateFollowCamera(elapsed);
    this.updateStreamThumb();
    if (this.dirty) {
      this.updateCameraGlyphs();
      this.updateTrackGlyphs();
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
    this.animation = requestAnimationFrame((timestamp) => this.tick(timestamp));
  }

  showError(message) {
    this.ready = false;
    this.stage.classList.remove('is-ready');
    element('viewer-status').hidden = false;
    element('viewer-status').classList.add('is-error');
    element('loading-text').textContent = message;
    element('retry-scene').hidden = false;
    element('play').disabled = true;
    element('timeline').disabled = true;
    this.stage.setAttribute('aria-busy', 'false');
  }

  formatTime(seconds) {
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  }
}
