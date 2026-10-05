import { sceneURL, mountTools, RenderQuality, reducedMotion } from '../site.js';
import { compileProgram, manageGraphics } from '../graphics.js';
import { worldSceneText, readWorldScene } from '../scene-state.js';
import { advancePlayback } from '../playback.js';
// The screen for one world: its picture, control panel and guided tour. This is
// Worlds/Core in the app (WorldDefinition, WorldModel, WorldView and
// WorldMetalView) for the web. Each world is a plain object with the same
// fields as the app's `World`; `start(world)` runs it in the page.
//
// What follows # in the page's address is always the scene on screen.

import { Wide } from './wide.js';

// MARK: State

export const VALUE_COUNT = 32;
/** The scale at which a flat world stores the small half of a wide centre. */
export const WIDE_LOW = 2 ** 53;

export function newState() {
  return {
    values: new Array(VALUE_COUNT).fill(0),
    palette: 0,
    yaw: -0.55,
    pitch: 0.45,
    cameraDistance: 3.35,
    focus: [0, 0, 0],
  };
}

export const copyState = state => ({ ...state, values: [...state.values], focus: [...state.focus] });

/** One stop of an animation: WorldKeyframe in the app. */
export const keyframe = (target, duration, hold = 0, direct = false) =>
  ({ target: copyState(target), duration, hold, direct });

/**
 * Blend used by animations. Distance moves logarithmically so zooming feels
 * even, and the camera backs away while the focus point travels so it does
 * not cut through the object.
 */
export function interpolate(a, b, t, world, direct = false) {
  const mix = (x, y) => x + (y - x) * t;
  const out = copyState(b);
  for (let index = 0; index < VALUE_COUNT; index += 1) {
    if (!world.discreteValues?.has(index)) { out.values[index] = mix(a.values[index], b.values[index]); }
  }
  out.yaw = mix(a.yaw, b.yaw);
  out.pitch = mix(a.pitch, b.pitch);
  out.focus = [0, 1, 2].map(i => mix(a.focus[i], b.focus[i]));

  let distance = Math.exp(mix(Math.log(a.cameraDistance), Math.log(b.cameraDistance)));
  if (world.cameraBacksAwayWhenMoving !== false && !direct) {
    const focusTravel = Math.hypot(b.focus[0] - a.focus[0], b.focus[1] - a.focus[1], b.focus[2] - a.focus[2]);
    const turn = Math.abs(b.yaw - a.yaw) + Math.abs(b.pitch - a.pitch);
    const closest = Math.min(a.cameraDistance, b.cameraDistance);
    distance += (1.8 * focusTravel + Math.max(0, 1.2 - closest) * Math.min(turn, 1.0)) * Math.sin(Math.PI * t);
  }
  out.cameraDistance = Math.min(distance, world.cameraDistanceRange[1]);
  if (world.flatCentre && Math.abs(a.cameraDistance - b.cameraDistance) > 1e-12) {
    // A flat picture's centre moves in step with its scale, so the spot being
    // zoomed toward stays put on screen.
    const w = (out.cameraDistance - b.cameraDistance) / (a.cameraDistance - b.cameraDistance);
    for (const index of world.flatCentre) {
      out.values[index] = b.values[index] + (a.values[index] - b.values[index]) * w;
    }
  }
  if (world.flatCentre && world.flatCentreLow && a.cameraDistance !== b.cameraDistance) {
    // A centre kept to twice the digits moves the same way, with the
    // arithmetic carried through both halves. The small half is stored
    // multiplied by 2⁵³, so that an address can hold it.
    const w = (out.cameraDistance - b.cameraDistance) / (a.cameraDistance - b.cameraDistance);
    world.flatCentre.forEach((high, i) => {
      const low = world.flatCentreLow[i];
      const from = [a.values[high], a.values[low] / WIDE_LOW];
      const to = [b.values[high], b.values[low] / WIDE_LOW];
      const moved = Wide.add(to, Wide.times(Wide.sub(from, to), w));
      out.values[high] = moved[0];
      out.values[low] = moved[1] * WIDE_LOW;
    });
  }
  if (world.flatFocus && Math.abs(a.cameraDistance - b.cameraDistance) > 1e-12) {
    // The same, for flat pictures that pan by moving the focus.
    const w = (out.cameraDistance - b.cameraDistance) / (a.cameraDistance - b.cameraDistance);
    out.focus = [0, 1, 2].map(i => b.focus[i] + (a.focus[i] - b.focus[i]) * w);
  }
  return out;
}

// MARK: Controls

export const slider = (title, index, range, display, visible = () => true) =>
  ({ kind: 'slider', title, index, range, display, visible });
export const picker = (title, index, options) => ({ kind: 'picker', title, index, options, visible: () => true });
export const toggle = (title, index) => ({ kind: 'toggle', title, index, visible: () => true });
export const movePad = title => ({ kind: 'movePad', title, visible: () => true });
export const readout = (title, value) => ({ kind: 'readout', title, value, visible: () => true });
export const group = (title, note, controls) => ({ title, note, controls });

// MARK: Camera

/** The camera model shared by every ray-marched world. */
export const Camera = {
  rotate(v, yaw, pitch) {
    const sp = Math.sin(pitch), cp = Math.cos(pitch);
    const x = [v[0], cp * v[1] - sp * v[2], sp * v[1] + cp * v[2]];
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    return [cy * x[0] + sy * x[2], x[1], -sy * x[0] + cy * x[2]];
  },

  position(state) {
    const back = Camera.rotate([0, 0, state.cameraDistance], state.yaw, state.pitch);
    return [state.focus[0] + back[0], state.focus[1] + back[1], state.focus[2] + back[2]];
  },

  /** View coordinates of a place in the picture: x and y in units of half the
      shorter side, with y up and the vertical shift removed. */
  viewPoint(x, y, width, height, verticalShift = 0) {
    if (!(width > 0 && height > 0)) { return null; }
    const aspect = width / height;
    const fit = Math.min(aspect, 1);
    return [((x / width) * 2 - 1) * aspect / fit, -((y / height) * 2 - 1) / fit - verticalShift];
  },

  rayDirection(x, y, width, height, verticalShift, state) {
    const uv = Camera.viewPoint(x, y, width, height, verticalShift);
    if (!uv) { return null; }
    const local = [uv[0] * 0.72, uv[1] * 0.72, -1.65];
    const length = Math.hypot(...local);
    return Camera.rotate(local.map(c => c / length), state.yaw, state.pitch);
  },

  /** Marches one ray through a world's distance field. */
  raycast(origin, direction, state, distance) {
    let travel = 0;
    for (let i = 0; i < 700; i += 1) {
      const point = [0, 1, 2].map(k => origin[k] + direction[k] * travel);
      const d = distance(point, state);
      if (!Number.isFinite(d)) { return null; }
      const threshold = Math.max(2e-4 * travel, 1e-7);
      if (d < threshold) { return { point, travel }; }
      travel += Math.max(d * 0.8, threshold * 0.35);
      if (travel > 40) { return null; }
    }
    return null;
  },

  /** Camera angles that look at the focus from the side `direction` is on. */
  viewAngles(direction) {
    const length = Math.hypot(...direction);
    if (!(length > 1e-9)) { return { yaw: 0, pitch: 0 }; }
    const d = direction.map(c => c / length);
    const pitch = Math.min(Math.max(-Math.asin(Math.min(Math.max(d[1], -1), 1)), -1.45), 1.45);
    return { yaw: Math.atan2(d[0], d[2]), pitch };
  },
};

/** Number formatting shared by the readouts. */
export const Format = {
  fixed: (value, digits) =>
    value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }),
  number(value, digits = 4) {
    if (!Number.isFinite(value)) { return '∞'; }
    if (Math.abs(value) >= 100000) { return value.toExponential(2).replace('e+', 'E').replace('e', 'E'); }
    return Format.fixed(value, digits);
  },
  significant(value, digits = 3) {
    if (!Number.isFinite(value)) { return '∞'; }
    return value.toLocaleString('en-US', { minimumSignificantDigits: digits, maximumSignificantDigits: digits });
  },
  degrees: (radians, digits = 2) => Format.fixed(radians * 180 / Math.PI, digits) + '°',
  vector: (v, digits = 3) => `(${v.map(c => Format.number(c, digits)).join(', ')})`,
};

// MARK: Shaders of the engine's own

const FULLSCREEN = `#version 300 es
void main() {
  vec2 corner = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

// The picture is drawn in linear light into an sRGB target, as in the app,
// so that glowing lines add up the same way. This copies it to the screen.
const PRESENT = `#version 300 es
precision highp float;
uniform sampler2D uScene;
out vec4 fragColor;
void main() {
  vec3 c = texelFetch(uScene, ivec2(gl_FragCoord.xy), 0).rgb;
  fragColor = vec4(mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)), 1.0);
}`;

const ROTATIONS = `
vec3 wRotateX(vec3 p, float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}
vec3 wRotateY(vec3 p, float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}`;

// WorldLines.metal: each instance is one glowing segment, widened into a
// quad on screen.
const LINE_VERTEX = `#version 300 es
precision highp float;
uniform vec4 uResolutionAndCone;
uniform vec4 uCamera;
uniform vec4 uFocus;
layout(location = 0) in vec4 aA;     // xyz: start, w: width in points
layout(location = 1) in vec4 aB;     // xyz: end
layout(location = 2) in vec4 aColor; // alpha scales the glow
out vec4 vColor;
out float vAcross;
${ROTATIONS}
// Where a point lands on screen, and how far in front of the camera it is.
vec3 project(vec3 p) {
  vec3 local = wRotateX(wRotateY(p - uFocus.xyz, -uCamera.x), -uCamera.y);
  float depth = uCamera.z - local.z;
  vec2 uv = local.xy / max(depth, 1e-4) * (1.65 / 0.72);
  vec2 resolution = uResolutionAndCone.xy;
  float aspect = resolution.x / resolution.y;
  uv.y += uResolutionAndCone.w;
  uv *= min(aspect, 1.0);
  uv.x /= aspect;
  return vec3(uv, depth);
}
void main() {
  vec3 a = project(aA.xyz);
  vec3 b = project(aB.xyz);
  vec2 halfResolution = 0.5 * uResolutionAndCone.xy;
  float along = (gl_VertexID & 1) == 0 ? 0.0 : 1.0;
  float side = (gl_VertexID & 2) == 0 ? -1.0 : 1.0;
  vec2 pixelsA = a.xy * halfResolution;
  vec2 pixelsB = b.xy * halfResolution;
  vec2 direction = pixelsB - pixelsA;
  float length2 = dot(direction, direction);
  direction = length2 > 1e-6 ? direction / sqrt(length2) : vec2(1.0, 0.0);
  vec2 normal = vec2(-direction.y, direction.x);
  // Widths are given for a view 900 pixels across its shorter side.
  float width = aA.w * min(halfResolution.x, halfResolution.y) / 450.0;
  vec2 pixel = mix(pixelsA, pixelsB, along) + normal * side * width + direction * (along * 2.0 - 1.0) * width;
  // Segments that reach behind the camera are dropped.
  bool visible = a.z > 0.02 && b.z > 0.02;
  gl_Position = visible ? vec4(pixel / halfResolution, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  vColor = aColor;
  vAcross = side;
}`;

const LINE_FRAGMENT = `#version 300 es
precision highp float;
in vec4 vColor;
in float vAcross;
out vec4 fragColor;
void main() {
  float edge = 1.0 - smoothstep(0.35, 1.0, abs(vAcross));
  fragColor = vec4(vColor.rgb * vColor.a * edge, 1.0);
}`;

// WorldMesh.metal: triangles with a depth buffer, shaded on both faces.
const MESH_VERTEX = `#version 300 es
precision highp float;
uniform vec4 uResolutionAndCone;
uniform vec4 uCamera;
uniform vec4 uFocus;
layout(location = 0) in vec4 aPositionU; // xyz: position, w: u (< 0 marks a marker)
layout(location = 1) in vec4 aNormalV;   // xyz: normal, w: v
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUV;
${ROTATIONS}
void main() {
  vec3 local = wRotateX(wRotateY(aPositionU.xyz - uFocus.xyz, -uCamera.x), -uCamera.y);
  float depth = uCamera.z - local.z;
  vec2 uv = local.xy * (1.65 / 0.72);
  vec2 resolution = uResolutionAndCone.xy;
  float aspect = resolution.x / resolution.y;
  float fit = min(aspect, 1.0);
  // Homogeneous coordinates, so that the divide by depth happens after
  // clipping and colours are interpolated in true perspective.
  float near = 0.05;
  float far = 60.0;
  float z = far * (depth - near) / (far - near);
  // Metal's depth runs 0 to 1; here it runs -1 to 1.
  gl_Position = vec4(uv.x * fit / aspect, (uv.y + uResolutionAndCone.w * depth) * fit, 2.0 * z - depth, depth);
  vWorld = aPositionU.xyz;
  vNormal = aNormalV.xyz;
  vUV = vec2(aPositionU.w, aNormalV.w);
}`;

const MESH_FRAGMENT = `#version 300 es
precision highp float;
uniform vec4 uCamera;
uniform vec4 uFocus;
uniform vec4 uBudget;
uniform vec4 uV0; // slats (0 = whole surface), cut-away fraction, grid lines flag
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUV;
out vec4 fragColor;
${ROTATIONS}
vec3 wToneMap(vec3 x) {
  x *= 0.9;
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main() {
  float yaw = uCamera.x;
  float pitch = uCamera.y;
  vec3 eye = wRotateY(wRotateX(vec3(0.0, 0.0, uCamera.z), pitch), yaw) + uFocus.xyz;
  vec3 toEye = normalize(eye - vWorld);
  vec3 normal = normalize(vNormal);
  bool marker = vUV.x < -0.5;

  if (!marker) {
    // Slats: keep alternate strips, so the layers behind can be seen.
    float slats = uV0.x;
    if (slats > 0.5 && fract(vUV.y * slats) > 0.5) { discard; }
    // Cut-away: remove a wedge.
    if (vUV.y < uV0.y) { discard; }
  }

  // The face toward the viewer: the side the normal points from is the one
  // that was outside when the surface was a plain sphere.
  bool outside = dot(normal, toEye) > 0.0;
  vec3 facing = outside ? normal : -normal;
  int palette = int(uBudget.z);
  vec3 gold = palette == 1 ? vec3(0.85, 0.20, 0.12) : vec3(0.95, 0.62, 0.10);
  vec3 violet = palette == 1 ? vec3(0.10, 0.45, 0.85) : vec3(0.36, 0.14, 0.62);
  if (palette == 2) { gold = vec3(0.82, 0.80, 0.76); violet = vec3(0.30, 0.31, 0.36); }
  vec3 albedo = marker ? vec3(1.0) : (outside ? gold : violet);

  if (!marker && uV0.z > 0.5) {
    // Lines of latitude and longitude, to show how the surface is stretched.
    vec2 grid = abs(fract(vUV * vec2(12.0, 24.0)) - 0.5);
    vec2 width = fwidth(vUV * vec2(12.0, 24.0));
    float line = min(smoothstep(0.5 - width.x * 1.2, 0.5, grid.x) + smoothstep(0.5 - width.y * 1.2, 0.5, grid.y), 1.0);
    albedo *= 1.0 - 0.45 * line;
  }

  vec3 lightDirection = wRotateY(wRotateX(normalize(vec3(-0.45, 0.65, 0.60)), pitch), yaw);
  float diffuse = clamp(dot(facing, lightDirection), 0.0, 1.0);
  float fill = clamp(dot(facing, toEye), 0.0, 1.0);
  vec3 halfVector = normalize(lightDirection + toEye);
  float specular = pow(clamp(dot(facing, halfVector), 0.0, 1.0), 36.0);
  vec3 color = albedo * (0.16 + 0.80 * diffuse + 0.22 * fill) + 0.20 * specular;
  fragColor = vec4(wToneMap(color), 1.0);
}`;

// MARK: The page

const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);
const escapeHTML = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Paragraphs of a note or caption written as one indented block of text. */
const paragraphs = text => text.split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
const MAX_MARKERS = 96;

const PAGE = `
  <canvas id="view" tabindex="0" role="img"></canvas>
  <div id="labels" aria-hidden="true"></div>
  <aside id="controls" class="panel" aria-label="Controls"></aside>
  <button id="controlsToggle" class="prominent icon round" aria-label="Hide controls">✕</button>
  <nav id="modeButtons"><button id="tourPill" class="prominent pill">▶ Guided tour</button></nav>
  <article id="tourCard" class="panel" aria-live="polite" hidden></article>
  <p id="error" role="alert" hidden></p>`;

export function start(world) {
  document.body.insertAdjacentHTML('afterbegin', PAGE);
  const $ = id => document.getElementById(id);
  const canvas = $('view');
  canvas.setAttribute('aria-label', `Interactive ${world.title}`);
  const pitchRange = world.pitchRange ?? [-1.45, 1.45];
  const distanceRange = world.cameraDistanceRange;

  let state = copyState(world.defaults);
  /** The explorer's point in the app; there is no explorer here, but worlds
      that walk carry it along. */
  const probe = [0, 0, 0, 0];
  let dirty = true;
  let tourIndex = null;
  let animation = null;
  let verticalShift = 0;
  const interactions = new Set();
  const began = performance.now();

  function fail(message) {
    $('error').textContent = message;
    $('error').hidden = false;
  }

  // MARK: Drawing

  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  const programs = {};
  let target = null;
  let lineBuffer = null;
  let meshBuffers = null;

  function compile(name, vertex, fragment, uniformNames) {
    const program = compileProgram(gl, vertex, fragment);
    const uniforms = {};
    for (const uniform of uniformNames) { uniforms[uniform] = gl.getUniformLocation(program, uniform); }
    programs[name] = { program, uniforms };
  }

  const qualitySettings = new RenderQuality();
  const graphics = manageGraphics(canvas, () => {
    if (!gl) { throw new Error('WebGL 2 is unavailable.'); }
    target = null;
    lineBuffer = null;
    meshBuffers = null;
    compile('scene', FULLSCREEN, world.fragment,
      ['U.resolutionAndCone', 'U.camera', 'U.focus', 'U.budget', 'U.v[0]', 'markers[0]', 'uData']);
    compile('present', FULLSCREEN, PRESENT, ['uScene']);
    if (world.lines) {
      compile('lines', LINE_VERTEX, LINE_FRAGMENT, ['uResolutionAndCone', 'uCamera', 'uFocus']);
      lineBuffer = { array: gl.createVertexArray(), buffer: gl.createBuffer() };
      gl.bindVertexArray(lineBuffer.array);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer.buffer);
      for (let i = 0; i < 3; i += 1) {
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, 4, gl.FLOAT, false, 48, 16 * i);
        gl.vertexAttribDivisor(i, 1);
      }
    }
    if (world.mesh) {
      compile('mesh', MESH_VERTEX, MESH_FRAGMENT, ['uResolutionAndCone', 'uCamera', 'uFocus', 'uBudget', 'uV0']);
      meshBuffers = { array: gl.createVertexArray(), vertices: gl.createBuffer(), indices: gl.createBuffer() };
      gl.bindVertexArray(meshBuffers.array);
      gl.bindBuffer(gl.ARRAY_BUFFER, meshBuffers.vertices);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshBuffers.indices);
      for (let i = 0; i < 2; i += 1) {
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, 4, gl.FLOAT, false, 32, 16 * i);
      }
    }
    programs.plain = gl.createVertexArray();
    gl.bindVertexArray(programs.plain);
  }, () => { dirty = true; });

  /** The sRGB picture the scene is drawn into, remade when the view changes size. */
  function prepareTarget(width, height) {
    if (target && target.width === width && target.height === height) { return; }
    if (target) {
      gl.deleteTexture(target.color);
      gl.deleteRenderbuffer(target.depth);
      gl.deleteFramebuffer(target.frame);
      target = null;
    }
    const color = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, color);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.SRGB8_ALPHA8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    const frame = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteTexture(color); gl.deleteRenderbuffer(depth); gl.deleteFramebuffer(frame);
      throw new Error('The browser could not allocate the scene framebuffer. Try Economy picture quality.');
    }
    target = { width, height, color, depth, frame };
  }

  const finite = value => (Number.isFinite(value) ? value : 0);

  /** Markers as pairs of (position, radius) and (colour, connect-to-next),
      sized from the camera distance so they look the same at every zoom. */
  function packedMarkers(markers, cameraDistance) {
    const radius = 0.013 * cameraDistance;
    const out = new Float32Array(8 * MAX_MARKERS);
    let count = 0;
    for (const marker of markers.slice(0, MAX_MARKERS)) {
      const at = 8 * count;
      if (marker.raw) {
        out.set(marker.raw[0], at);
        out.set(marker.raw[1], at + 4);
      } else {
        const color = marker.color ?? [1, 1, 1];
        out.set([finite(marker.position[0]), finite(marker.position[1]), finite(marker.position[2]),
          radius * (marker.size ?? 1), color[0], color[1], color[2], marker.connectsToNext ? 1 : 0], at);
      }
      count += 1;
    }
    return { data: out, count };
  }

  const shaderValues = () => {
    const values = world.shaderValues ? world.shaderValues(state, null, 0) : state.values;
    const out = new Float32Array(VALUE_COUNT);
    for (let i = 0; i < VALUE_COUNT; i += 1) { out[i] = finite(values[i] ?? 0); }
    return out;
  };

  let dataTexture = null;

  function draw(now) {
    if (!graphics.ready || document.hidden || !$('error').hidden) { return; }
    const ratio = qualitySettings.ratio(canvas, moving() || isPlaying(), now);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    try { prepareTarget(width, height); } catch (error) { fail(error.message); return; }

    const yaw = Number.isFinite(state.yaw) ? clamp(state.yaw, -10000, 10000) : world.defaults.yaw;
    const pitch = Number.isFinite(state.pitch) ? clamp(state.pitch, ...pitchRange) : world.defaults.pitch;
    const distance = Number.isFinite(state.cameraDistance)
      ? clamp(state.cameraDistance, ...distanceRange) : world.defaults.cameraDistance;
    const time = (now - began) / 1000;
    // Quality 1 leaves out occlusion and shadows while the picture is being moved.
    const quality = moving() || isPlaying() || qualitySettings.mode === 'economy' ? 1 : 2;
    const markers = packedMarkers(world.overlayMarkers?.(state) ?? [], distance);

    const resolutionAndCone = [width, height, 0.0003, verticalShift];
    const camera = [yaw, pitch, distance, quality];
    const focus = [finite(state.focus[0]), finite(state.focus[1]), finite(state.focus[2]), time];
    const budget = [quality === 1 ? 160 : 240, quality === 1 ? 0 : 40, state.palette, markers.count];
    const values = shaderValues();

    gl.bindFramebuffer(gl.FRAMEBUFFER, target.frame);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    const scene = programs.scene;
    gl.useProgram(scene.program);
    gl.bindVertexArray(programs.plain);
    gl.uniform4fv(scene.uniforms['U.resolutionAndCone'], resolutionAndCone);
    gl.uniform4fv(scene.uniforms['U.camera'], camera);
    gl.uniform4fv(scene.uniforms['U.focus'], focus);
    gl.uniform4fv(scene.uniforms['U.budget'], budget);
    gl.uniform4fv(scene.uniforms['U.v[0]'], values);
    if (scene.uniforms['markers[0]']) { gl.uniform4fv(scene.uniforms['markers[0]'], markers.data); }
    if (scene.uniforms.uData && world.shaderData) {
      // A world's longer table of numbers, as a texture 1024 wide.
      const table = world.shaderData(state);
      const rows = Math.max(1, Math.ceil(table.length / 4096));
      const padded = new Float32Array(4096 * rows);
      padded.set(table);
      if (!dataTexture || !gl.isTexture(dataTexture)) {
        dataTexture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, dataTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      }
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, dataTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1024, rows, 0, gl.RGBA, gl.FLOAT, padded);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(scene.uniforms.uData, 1);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const shared = program => {
      gl.useProgram(program.program);
      gl.uniform4fv(program.uniforms.uResolutionAndCone, resolutionAndCone);
      gl.uniform4fv(program.uniforms.uCamera, camera);
      gl.uniform4fv(program.uniforms.uFocus, focus);
    };

    // Curves and particles add their light to whatever is behind them.
    const lines = world.lines?.(state, null, time);
    if (lines && lines.count > 0) {
      shared(programs.lines);
      gl.bindVertexArray(lineBuffer.array);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, lines.data.subarray(0, 12 * lines.count), gl.DYNAMIC_DRAW);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, lines.count);
      gl.disable(gl.BLEND);
    }

    const mesh = world.mesh?.(state, null, time);
    if (mesh && mesh.indices.length > 0) {
      shared(programs.mesh);
      gl.uniform4fv(programs.mesh.uniforms.uBudget, budget);
      gl.uniform4fv(programs.mesh.uniforms.uV0, values.subarray(0, 4));
      gl.bindVertexArray(meshBuffers.array);
      gl.bindBuffer(gl.ARRAY_BUFFER, meshBuffers.vertices);
      if (mesh.revision === undefined || meshBuffers.uploadedRevision !== mesh.revision) {
        gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.DYNAMIC_DRAW);
        meshBuffers.uploadedRevision = mesh.revision;
      }
      if (meshBuffers.uploadedIndices !== mesh.indices) {
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
        meshBuffers.uploadedIndices = mesh.indices;
      }
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.disable(gl.CULL_FACE);
      gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_INT, 0);
      gl.disable(gl.DEPTH_TEST);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(programs.present.program);
    gl.bindVertexArray(programs.plain);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.color);
    gl.uniform1i(programs.present.uniforms.uScene, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** A flat world's own lettering over the picture, such as the numbers
      along an axis: `labels` gives text and places in CSS pixels. */
  let labelText = '';
  function drawLabels() {
    if (!world.labels) { return; }
    const labels = world.labels(state, {
      width: canvas.clientWidth, height: canvas.clientHeight, verticalShift,
    });
    const html = labels.map(label =>
      `<span style="left:${label.x.toFixed(1)}px;top:${label.y.toFixed(1)}px">${escapeHTML(label.text)}</span>`).join('');
    if (html !== labelText) {
      labelText = html;
      $('labels').innerHTML = html;
    }
  }

  // MARK: The scene, in the page's address

  // Flat worlds that zoom far need more digits to name a place.
  let urlTimer = null;

  /** The scene as text: only what differs from the world's defaults. */
  const sceneText = () => worldSceneText(state, world);
  const readScene = text => readWorldScene(text, world);

  function scheduleURL() {
    if (urlTimer !== null) { return; }
    urlTimer = setTimeout(() => {
      urlTimer = null;
      const text = sceneText();
      if (location.hash.replace(/^#/, '') !== text || new URLSearchParams(location.search).has('tourStep')) {
        history.replaceState(null, '', sceneURL(text ? '#' + text : ''));
      }
    }, 250);
  }

  window.addEventListener('hashchange', () => {
    if (location.hash.replace(/^#/, '') === sceneText()) { return; }
    endTour();
    animation = null;
    state = readScene(location.hash);
    changed();
  });

  /** Everything that depends on the state is brought up to date. */
  function changed() {
    dirty = true;
    refreshControls();
    scheduleURL();
  }

  // MARK: Direct manipulation

  const moving = () => interactions.size > 0 || animation !== null;

  function setInteraction(kind, active) {
    if (active) {
      // The person's hands win over any animation in progress.
      animation = null;
      interactions.add(kind);
    } else {
      interactions.delete(kind);
    }
    dirty = true;
    refreshSpinner();
  }

  function dragBy(dx, dy) {
    if (world.drag) {
      world.drag(state, probe, dx, dy);
    } else {
      state.yaw += dx * 3.4;
      state.pitch = clamp(state.pitch + dy * 3.4, ...pitchRange);
    }
    changed();
  }

  function step(forward, right, up) {
    if (!world.step || tourIndex !== null) { return; }
    animation = null;
    world.step(state, probe, forward, right, up);
    changed();
  }

  function setZoom(origin, magnification) {
    if (!Number.isFinite(origin) || !Number.isFinite(magnification) || magnification <= 0.001) { return; }
    const proposed = origin / clamp(magnification, 0.05, 20);
    if (!Number.isFinite(proposed)) { return; }
    state.cameraDistance = clamp(proposed, ...distanceRange);
    changed();
  }

  /** Makes the surface point under a place in the picture the centre of the
      view and moves the camera most of the way toward it. */
  function focusAt(x, y) {
    if (world.zoomTarget) {
      const viewPoint = Camera.viewPoint(x, y, canvas.clientWidth, canvas.clientHeight, verticalShift);
      const goal = viewPoint && world.zoomTarget(viewPoint, state, 3);
      if (goal) { animate([keyframe(goal, 0.9)]); }
      return;
    }
    if (!world.distance) { return; }
    const direction = Camera.rayDirection(x, y, canvas.clientWidth, canvas.clientHeight, verticalShift, state);
    const hit = direction && Camera.raycast(Camera.position(state), direction, state, world.distance);
    if (!hit) { return; }
    const goal = copyState(state);
    goal.focus = hit.point;
    goal.cameraDistance = Math.max(hit.travel * 0.4, distanceRange[0]);
    world.prepareForZoom?.(goal);
    animate([keyframe(goal, 1.4)]);
  }

  function resetView() {
    animation = null;
    interactions.clear();
    const d = world.defaults;
    Object.assign(state, { yaw: d.yaw, pitch: d.pitch, cameraDistance: d.cameraDistance, focus: [...d.focus] });
    world.resetView?.(state);
    changed();
  }

  function resetShape() {
    animation = null;
    const next = copyState(world.defaults);
    Object.assign(next, { yaw: state.yaw, pitch: state.pitch, cameraDistance: state.cameraDistance,
      focus: [...state.focus], palette: state.palette });
    state = next;
    changed();
  }

  const pointers = new Map();
  let pinch = null;
  let wheelTimer = null;

  canvas.addEventListener('pointerdown', event => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { canvas.setPointerCapture(event.pointerId); } catch { /* a pointer that cannot be captured still drags */ }
    canvas.focus();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { span: Math.hypot(a.x - b.x, a.y - b.y), origin: state.cameraDistance };
      setInteraction('zoom', true);
    }
  });
  canvas.addEventListener('pointermove', event => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) { return; }
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      setZoom(pinch.origin, Math.hypot(a.x - b.x, a.y - b.y) / Math.max(pinch.span, 1));
      return;
    }
    if (pointers.size !== 1) { return; }
    if (!interactions.has('rotation')) {
      if (Math.abs(dx) + Math.abs(dy) < 2) {
        // Not yet a drag: wait for more movement.
        pointer.x -= dx;
        pointer.y -= dy;
        return;
      }
      setInteraction('rotation', true);
    }
    const unit = Math.max(Math.min(canvas.clientWidth, canvas.clientHeight) / 2, 1);
    dragBy(dx / unit, dy / unit);
  });
  const release = event => {
    if (event.type === 'pointerup' && world.tap && pointers.size === 1 && !pinch
        && !interactions.has('rotation')) {
      // A press that never became a drag is a tap on the picture.
      const box = canvas.getBoundingClientRect();
      const viewPoint = Camera.viewPoint(event.clientX - box.left, event.clientY - box.top,
        canvas.clientWidth, canvas.clientHeight, verticalShift);
      if (viewPoint) {
        world.tap(state, viewPoint);
        changed();
      }
    }
    pointers.delete(event.pointerId);
    if (pointers.size < 2 && pinch) {
      pinch = null;
      setInteraction('zoom', false);
    }
    if (pointers.size === 0) { setInteraction('rotation', false); }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    setInteraction('zoom', true);
    const factor = Math.exp(-event.deltaY * 0.0015);
    if (world.zoomTarget) {
      // A flat picture zooms about the pointer.
      const box = canvas.getBoundingClientRect();
      const viewPoint = Camera.viewPoint(event.clientX - box.left, event.clientY - box.top,
        canvas.clientWidth, canvas.clientHeight, verticalShift);
      const goal = viewPoint && world.zoomTarget(viewPoint, state, clamp(factor, 0.05, 20));
      if (goal) {
        animation = null;
        state = goal;
        changed();
      }
    } else {
      setZoom(state.cameraDistance, factor);
    }
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => setInteraction('zoom', false), 200);
  }, { passive: false });
  canvas.addEventListener('dblclick', event => {
    const box = canvas.getBoundingClientRect();
    focusAt(event.clientX - box.left, event.clientY - box.top);
  });

  const KEYS = {
    w: [1, 0, 0], s: [-1, 0, 0], a: [0, -1, 0], d: [0, 1, 0], e: [0, 0, 1], q: [0, 0, -1],
    arrowup: [1, 0, 0], arrowdown: [-1, 0, 0], arrowleft: [0, -1, 0], arrowright: [0, 1, 0],
  };
  window.addEventListener('keydown', event => {
    if (event.target.closest?.('input, textarea, select, dialog') || event.metaKey || event.ctrlKey || event.altKey) { return; }
    const move = KEYS[event.key.toLowerCase()];
    if (!move || !world.step || tourIndex !== null) { return; }
    event.preventDefault();
    step(...move);
  });

  // MARK: Animation

  function animate(frames) {
    interactions.clear();
    if (reducedMotion() && frames.length) {
      animation = null;
      state = copyState(frames.at(-1).target);
      if (world.playback) { state.values[world.playback.play] = 0; }
      changed(); refreshSpinner(); return;
    }
    animation = frames.length > 0 ? { frames, index: 0, from: null, began: 0 } : null;
    refreshSpinner();
  }

  function stepAnimation(now) {
    if (!animation) { return; }
    const frame = animation.frames[animation.index];
    if (animation.from === null) {
      animation.from = copyState(state);
      animation.began = now;
    }
    const elapsed = (now - animation.began) / 1000;
    const linear = frame.duration > 0 ? Math.min(elapsed / frame.duration, 1) : 1;
    const eased = linear * linear * (3 - 2 * linear);
    state = interpolate(animation.from, frame.target, eased, world, frame.direct);
    if (elapsed >= frame.duration + frame.hold) {
      animation.index += 1;
      animation.from = null;
      if (animation.index >= animation.frames.length) {
        animation = null;
        refreshSpinner();
      }
    }
    changed();
  }

  // MARK: Controls

  const controls = world.controlGroups.flatMap(g => g.controls);
  const magnification = () => world.defaults.cameraDistance / state.cameraDistance;
  const PAD = [['↑', 'Forward', [1, 0, 0]], ['↓', 'Back', [-1, 0, 0]], ['←', 'Left', [0, -1, 0]],
    ['→', 'Right', [0, 1, 0]], ['⤒', 'Up', [0, 0, 1]], ['⤓', 'Down', [0, 0, -1]]];

  function controlHTML(control, id) {
    const title = escapeHTML(control.title);
    switch (control.kind) {
      case 'slider':
        return `<label class="row" data-control="${id}"><span class="title">${title}</span>
          <span class="value"></span>
          <input type="range" min="${control.range[0]}" max="${control.range[1]}" step="any"></label>`;
      case 'picker':
        return `<label class="row" data-control="${id}"><span class="title">${title}</span>
          <select>${control.options.map((o, i) => `<option value="${i}">${escapeHTML(o)}</option>`).join('')}</select></label>`;
      case 'toggle':
        return `<label class="row check" data-control="${id}"><span class="title">${title}</span>
          <input type="checkbox"></label>`;
      case 'movePad':
        return `<div data-control="${id}"><div class="pad">${PAD.map(([symbol, label], i) =>
          `<button data-move="${i}" aria-label="${label}">${symbol}</button>`).join('')}</div>
          <p class="caption">${escapeHTML(world.stepHint ?? 'Arrow keys or W A S D walk; E and Q go up and down.')}</p></div>`;
      default:
        return `<div class="readout" data-control="${id}"><span>${title}</span><span class="value"></span></div>`;
    }
  }

  function section(title, note, inner) {
    const name = escapeHTML(title);
    return `<section><header><h3>${name}</h3>
      <button class="info" data-note="${name}" aria-label="About ${name}" aria-expanded="false">ⓘ</button></header>
      <p class="note" data-note-for="${name}" hidden>${paragraphs(note).map(p => `<span>${escapeHTML(p)}</span>`).join('')}</p>
      ${inner}</section>`;
  }

  function buildControls() {
    const panel = $('controls');
    let id = 0;
    const zoomRange = [Math.log(world.defaults.cameraDistance / distanceRange[1]),
      Math.log(world.defaults.cameraDistance / distanceRange[0])];
    panel.innerHTML = `
      <a class="back" href="${world.shelf?.href ?? 'index.html'}">‹ ${escapeHTML(world.shelf?.title ?? 'All worlds')}</a>
      <div><p class="eyebrow">${escapeHTML(world.title)}</p><h2 class="compact">${escapeHTML(world.formula)}</h2></div>
      <button id="tourStart">▶ Guided tour</button>
      ${world.controlGroups.map(g => section(g.title, g.note, g.controls.map(c => controlHTML(c, id++)).join(''))).join('')}
      ${section('View', world.viewNote, `
        <label class="row"><span class="title">Zoom</span><span class="value" id="zoomValue"></span>
          <input type="range" id="zoom" min="${zoomRange[0]}" max="${zoomRange[1]}" step="any"></label>
        ${world.paletteNames.length > 1 ? `<label class="row"><span class="title">Colour</span>
          <select id="palette">${world.paletteNames.map((n, i) => `<option value="${i}">${escapeHTML(n)}</option>`).join('')}</select></label>` : ''}
        <div class="row"><button id="resetView" class="small">Reset view</button>
          <button id="resetShape" class="small">Reset shape</button></div>`)}`;

    panel.addEventListener('click', event => {
      const info = event.target.closest('.info');
      if (info) {
        const note = panel.querySelector(`[data-note-for="${info.dataset.note}"]`);
        note.hidden = !note.hidden;
        info.setAttribute('aria-expanded', String(!note.hidden));
      }
    });
    panel.addEventListener('input', event => {
      const input = event.target;
      if (input.id === 'zoom') {
        setInteraction('parameters', true);
        state.cameraDistance = clamp(world.defaults.cameraDistance / Math.exp(Number(input.value)), ...distanceRange);
      } else if (input.id === 'palette') {
        state.palette = Number(input.value);
      } else {
        const row = input.closest('[data-control]');
        if (!row) { return; }
        const control = controls[Number(row.dataset.control)];
        animation = null;
        if (control.kind === 'slider') {
          setInteraction('parameters', true);
          state.values[control.index] = Number(input.value);
        } else if (control.kind === 'picker') {
          state.values[control.index] = Number(input.value);
        } else if (control.kind === 'toggle') {
          state.values[control.index] = input.checked ? 1 : 0;
        }
      }
      changed();
    });
    // A slider that has been let go is no longer being moved.
    for (const end of ['change', 'pointerup', 'pointercancel']) {
      panel.addEventListener(end, () => setInteraction('parameters', false));
    }
    // A pad button walks one step, and goes on walking while it is held.
    for (const button of panel.querySelectorAll('[data-move]')) {
      let timer = null;
      const move = PAD[Number(button.dataset.move)][2];
      const stop = () => { clearTimeout(timer); clearInterval(timer); timer = null; };
      button.addEventListener('pointerdown', () => {
        step(...move);
        timer = setTimeout(() => { timer = setInterval(() => step(...move), 70); }, 350);
      });
      for (const end of ['pointerup', 'pointerleave', 'pointercancel']) { button.addEventListener(end, stop); }
      addEventListener('blur', stop);
      // The keyboard presses a button with a click and no pointer.
      button.addEventListener('click', event => { if (event.detail === 0) { step(...move); } });
    }
    $('tourStart').addEventListener('click', () => showTourStep(0));
    $('resetView').addEventListener('click', resetView);
    $('resetShape').addEventListener('click', resetShape);
  }

  let refreshExtra = null;

  function refreshControls() {
    refreshExtra?.(state);
    const panel = $('controls');
    if (panel.hidden || panel.classList.contains('touring')) { return; }
    for (const row of panel.querySelectorAll('[data-control]')) {
      const control = controls[Number(row.dataset.control)];
      row.hidden = !control.visible(state);
      if (row.hidden) { continue; }
      const value = state.values[control.index];
      const input = row.querySelector('input, select');
      if (control.kind === 'slider') {
        if (document.activeElement !== input) { input.value = value; }
        row.querySelector('.value').textContent = control.display(value);
      } else if (control.kind === 'picker') {
        input.value = String(Math.round(value));
      } else if (control.kind === 'toggle') {
        input.checked = value > 0.5;
      } else if (control.kind === 'readout') {
        row.querySelector('.value').textContent = control.value(state);
      }
    }
    if (document.activeElement !== $('zoom')) { $('zoom').value = Math.log(magnification()); }
    $('zoomValue').textContent = magnification().toFixed(1) + '×';
    if ($('palette')) { $('palette').value = String(state.palette); }
  }

  $('controlsToggle').addEventListener('click', () => {
    const hidden = !$('controls').hidden;
    $('controls').hidden = hidden;
    $('controlsToggle').textContent = hidden ? '☰' : '✕';
    $('controlsToggle').setAttribute('aria-label', hidden ? 'Show controls' : 'Hide controls');
    refreshControls();
  });

  // MARK: Guided tour

  function refreshSpinner() {
    const spinner = $('tourSpinner');
    if (spinner) { spinner.hidden = animation === null; }
  }

  function showTourStep(index) {
    tourIndex = index;
    const stop = world.tour[index];
    const last = index === world.tour.length - 1;
    $('tourCard').innerHTML = `
      <header><p class="eyebrow">Guided tour · ${index + 1} of ${world.tour.length}</p>
        <button id="tourEnd" class="plain" aria-label="End tour">✕</button></header>
      <h2>${escapeHTML(stop.title)}</h2>
      <div class="body">${paragraphs(stop.body).map(p => `<p>${escapeHTML(p)}</p>`).join('')}</div>
      ${stop.tryIt ? `<p class="caption">☰ ${escapeHTML(stop.tryIt)}</p>` : ''}
      <footer><button id="tourBack" ${index === 0 ? 'disabled' : ''}>‹ Back</button>
        <button id="tourReplay">↺ Replay</button><span class="spacer"></span>
        <span id="tourSpinner" class="spinner" aria-label="Animating"></span>
        <button id="tourNext" class="prominent">${last ? '✓ Finish' : 'Next ›'}</button></footer>`;
    $('tourCard').hidden = false;
    $('controls').classList.add('touring');
    $('controlsToggle').hidden = true;
    $('modeButtons').hidden = true;
    $('tourEnd').addEventListener('click', endTour);
    $('tourBack').addEventListener('click', () => showTourStep(index - 1));
    $('tourReplay').addEventListener('click', () => showTourStep(index));
    $('tourNext').addEventListener('click', () => (last ? endTour() : showTourStep(index + 1)));
    // Steps animate to a fully specified state, so the tour looks the same
    // whatever was changed beforehand. Only the palette is kept.
    const base = copyState(world.defaults);
    if (world.tourKeepsPalette !== false) { base.palette = state.palette; }
    animate(stop.build(base));
    layout();
  }

  function endTour() {
    if (tourIndex === null) { return; }
    tourIndex = null;
    animation = null;
    $('tourCard').hidden = true;
    $('controls').classList.remove('touring');
    $('controlsToggle').hidden = false;
    $('modeButtons').hidden = false;
    layout();
    changed();
  }

  $('tourPill').addEventListener('click', () => showTourStep(0));

  /** In a tall, narrow window the caption sits over the middle of the
      picture, so the picture is drawn higher up. */
  function layout() {
    const tall = canvas.clientHeight > canvas.clientWidth * 1.2;
    document.body.classList.toggle('tall', tall);
    verticalShift = tall && tourIndex !== null ? 0.62 : 0;
    dirty = true;
  }

  // MARK: Start

  buildControls();
  // A world may add furniture of its own to the panel, such as a box to
  // type in; what it returns is called whenever the state changes.
  refreshExtra = world.extend?.({
    panel: $('controls'),
    state: () => state,
    change(edit) { edit(state); changed(); },
  }) ?? null;
  // On a phone the panel would cover most of the picture.
  if (matchMedia('(max-width: 700px)').matches) { $('controlsToggle').click(); }

  if (location.hash.length > 1) { state = readScene(location.hash); }
  if (reducedMotion() && world.playback) { state.values[world.playback.play] = 0; }
  mountTools($('controls'), { link: () => sceneURL(sceneText() ? '#' + sceneText() : ''), quality: qualitySettings, invalidate: () => { $('error').hidden = true; dirty = true; } });
  const query = new URLSearchParams(location.search);
  if (location.hash.length <= 1 && query.has('tourStep')) {
    const index = Number(query.get('tourStep'));
    if (Number.isInteger(index) && index >= 0 && index < world.tour.length) { showTourStep(index); }
  }
  layout();
  changed();
  new ResizeObserver(layout).observe(canvas);

  const isPlaying = () => !!world.playback && state.values[world.playback.play] > 0.5;
  let previousFrame = null;
  canvas.addEventListener('webglcontextlost', () => { animation = null; interactions.clear(); pointers.clear(); pinch = null; previousFrame = null; refreshSpinner(); });
  addEventListener('visibilitychange', () => {
    previousFrame = null;
    if (document.hidden) { animation = null; interactions.clear(); pointers.clear(); pinch = null; refreshSpinner(); }
    qualitySettings.lastFrame = null; dirty = true;
  });
  function loop(now) {
    if (document.hidden || !graphics.ready) { previousFrame = null; requestAnimationFrame(loop); return; }
    const dt = previousFrame === null ? 0 : Math.min((now - previousFrame) / 1000, 0.1);
    previousFrame = now;
    stepAnimation(now);
    if (advancePlayback(state, world.playback, dt)) { dirty = true; scheduleURL(); }
    // Worlds that move on their own are drawn continuously; the rest only
    // when something changes.
    if (dirty || (world.animates && !world.playback)) {
      dirty = false;
      draw(now);
      drawLabels();
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return { get state() { return state; }, moving };
}
