// The art gallery page: drawing, walking, the address bar, the formula box,
// picture labels, the controls and the tour. The page's address after # is
// always the place on screen, in the same code the app's address bar takes.
import * as G from './logic.js';
import { VERTEX, FRAGMENT } from './shader.js';
import { TOUR } from './tour.js';

const $ = id => document.getElementById(id);
const canvas = $('view');
const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);
const ZOOM_RANGE = [0.3, 1.6];

let scene = G.sceneAt(G.newPlace());
let dirty = true;
let tourIndex = null;
let animation = null;

const copyPlace = place => ({ ...place, design: { ...place.design, program: [...place.design.program] }, room: [...place.room] });

// MARK: Drawing

function fail(message) {
  $('error').textContent = message;
  $('error').hidden = false;
}

const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
let program = null;
const uniforms = {};
if (!gl) {
  fail('This browser does not support WebGL 2.');
} else {
  program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      fail('The shader failed to compile: ' + gl.getShaderInfoLog(shader));
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && $('error').hidden) {
    fail('The shader failed to link: ' + gl.getProgramInfoLog(program));
  }
  for (const name of ['uResolution', 'uCamera', 'uV']) {
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  gl.bindVertexArray(gl.createVertexArray());
}

function draw() {
  if (!gl) { return; }
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  gl.viewport(0, 0, width, height);
  gl.useProgram(program);
  gl.uniform2f(uniforms.uResolution, width, height);
  gl.uniform2f(uniforms.uCamera, scene.yaw, clamp(scene.pitch, -1.45, 1.45));
  gl.uniform4fv(uniforms.uV, G.shaderValues(scene));
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// MARK: Moving between scenes

/** Everything that depends on the scene is brought up to date. */
function changed() {
  dirty = true;
  refreshBar();
  refreshLabel();
  refreshControls();
  scheduleURL();
}

function arrive(next) {
  animation = null;
  stroll = null;
  scene = next;
  setFailure(null);
  changed();
}

/** Plays keyframes: the place jumps, the viewer glides. */
function animate(frames) {
  animation = { frames, index: 0, from: null, began: null };
}

function stepAnimation(now) {
  if (!animation) { return; }
  const frame = animation.frames[animation.index];
  if (animation.from === null) {
    animation.from = { x: scene.x, z: scene.z, yaw: scene.yaw, pitch: scene.pitch, zoom: scene.zoom };
    animation.began = now;
    scene.place = copyPlace(frame.scene.place);
  }
  const elapsed = (now - animation.began) / 1000;
  const linear = frame.duration > 0 ? Math.min(elapsed / frame.duration, 1) : 1;
  const eased = linear * linear * (3 - 2 * linear);
  for (const key of ['x', 'z', 'yaw', 'pitch', 'zoom']) {
    scene[key] = animation.from[key] + (frame.scene[key] - animation.from[key]) * eased;
  }
  if (elapsed >= frame.duration + frame.hold) {
    animation.index += 1;
    animation.from = null;
    if (animation.index >= animation.frames.length) { animation = null; }
  }
  changed();
}

// MARK: The address, in the bar and in the URL

const addressInput = $('address');
const formulaInput = $('formula');
let urlTimer = null;

function setFailure(message) {
  $('failure').textContent = message ?? '';
  $('failure').hidden = !message;
}

function refreshBar() {
  $('bar').hidden = tourIndex !== null;
  if (document.activeElement !== addressInput) { addressInput.value = G.addressText(scene); }
  $('formulaRow').hidden = G.kindOfFloor(scene.place.room[2]) !== G.FORMULA;
  if (document.activeElement !== formulaInput) { formulaInput.value = G.formulaText(scene.place.design); }
}

function scheduleURL() {
  if (urlTimer !== null) { return; }
  urlTimer = setTimeout(() => {
    urlTimer = null;
    const hash = '#' + G.addressText(scene, true);
    if (decodeHash(location.hash) !== hash) { history.replaceState(null, '', hash); }
  }, 250);
}

// Browsers may escape some characters of what follows #.
const decodeHash = hash => hash.replaceAll('%7E', '~').replaceAll('%7e', '~').replaceAll('%2A', '*').replaceAll('%2a', '*');

function go(text) {
  try {
    arrive(G.parseAddress(text, scene));
    addressInput.blur();
    return true;
  } catch (error) {
    if (!(error instanceof G.AddressError)) { throw error; }
    setFailure(error.message);
    return false;
  }
}

$('bar').addEventListener('submit', event => {
  event.preventDefault();
  go(addressInput.value);
});
addressInput.addEventListener('blur', refreshBar);
$('random').addEventListener('click', () => {
  const pick = () => Math.floor(Math.random() * 200001) - 100000;
  const place = copyPlace(scene.place);
  place.room = [pick(), pick(), place.room[2]];
  G.clearPicture(place);
  const next = G.sceneAt(place);
  arrive(next);
});
$('copy').addEventListener('click', async () => {
  const link = location.origin + location.pathname + '#' + G.addressText(scene, true);
  try {
    await navigator.clipboard.writeText(link);
    $('copy').textContent = '✓';
    setTimeout(() => { $('copy').textContent = '⧉'; }, 1500);
  } catch {
    setFailure('The link could not be copied; it is in the address bar of the browser.');
  }
});
window.addEventListener('hashchange', () => {
  const hash = decodeHash(location.hash);
  if (hash.length > 1 && hash !== '#' + G.addressText(scene, true)) { go(hash); }
});

// The pictures change as the formula is typed, whenever it can be read.
formulaInput.addEventListener('input', () => {
  const steps = G.programOf(formulaInput.value);
  if (!steps || steps.length === 0) {
    setFailure(`A formula uses x y r a t u, the digits, + - * /, and the letters s c q b f o z i e h l g p m n d w, up to ${G.LONGEST_PROGRAM} steps.`);
    return;
  }
  setFailure(null);
  scene.place.design = G.normalized({ ...scene.place.design, program: steps });
  changed();
});
formulaInput.addEventListener('blur', refreshBar);

// MARK: The label of a picture

function refreshLabel() {
  const caption = G.caption(scene.place);
  $('label').hidden = !caption;
  if (!caption) { return; }
  $('labelTitle').textContent = caption.title;
  $('labelLines').replaceChildren(...caption.lines.map(line => {
    const p = document.createElement('p');
    p.textContent = line;
    return p;
  }));
  $('stepBack').hidden = tourIndex !== null;
}

$('stepBack').addEventListener('click', () => {
  animation = null;
  G.clearPicture(scene.place);
  scene.pitch = 0;
  scene.zoom = 1;
  changed();
});

// MARK: Looking and walking

/** The walk a click has set going: { goal, climb }. */
let stroll = null;
let drag = null;

canvas.addEventListener('pointerdown', event => {
  drag = { x: event.clientX, y: event.clientY, moved: 0 };
  try { canvas.setPointerCapture(event.pointerId); } catch { /* a pointer that cannot be captured still drags */ }
  canvas.focus();
});
canvas.addEventListener('pointermove', event => {
  if (!drag) { return; }
  const unit = Math.max(Math.min(canvas.clientWidth, canvas.clientHeight) / 2, 1);
  const dx = (event.clientX - drag.x) / unit;
  const dy = (event.clientY - drag.y) / unit;
  drag.moved += Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y);
  drag.x = event.clientX;
  drag.y = event.clientY;
  if (drag.moved < 4) { return; }
  animation = null;
  scene.yaw += dx * 1.7;
  scene.pitch = clamp(scene.pitch + dy * 1.7, -1.45, 1.45);
  changed();
});
canvas.addEventListener('pointerup', event => {
  const wasClick = drag && drag.moved < 4;
  drag = null;
  if (!wasClick || tourIndex !== null) { return; }
  const box = canvas.getBoundingClientRect();
  const aspect = box.width / box.height;
  const fit = Math.min(aspect, 1);
  const u = ((((event.clientX - box.left) / box.width) * 2 - 1) * aspect) / fit;
  const v = (1 - ((event.clientY - box.top) / box.height) * 2) / fit;
  stroll = null;
  const hit = G.under(scene, u, v);
  if (!hit) { return; }
  animation = null;
  if (hit.picture) {
    // A click on a picture stands the viewer in front of it.
    Object.assign(scene.place, hit.picture);
    G.standSensibly(scene);
    changed();
  } else {
    stroll = { goal: hit.floor ?? null, climb: hit.climb ?? 0 };
  }
});
canvas.addEventListener('pointercancel', () => { drag = null; });
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  scene.zoom = clamp(scene.zoom * Math.exp(event.deltaY * 0.0015), ...ZOOM_RANGE);
  changed();
}, { passive: false });

const MOVES = {
  w: [1, 0], s: [-1, 0], a: [0, -1], d: [0, 1],
  arrowup: [1, 0], arrowdown: [-1, 0], arrowleft: [0, -1], arrowright: [0, 1],
};
const held = new Set();

function climb(up) {
  animation = null;
  G.walk(scene, 0, 0, up);
  changed();
}

window.addEventListener('keydown', event => {
  if (event.target.closest('input, textarea, select') || event.metaKey || event.ctrlKey || event.altKey) { return; }
  if (tourIndex !== null) { return; }
  const key = event.key.toLowerCase();
  if (key in MOVES) {
    held.add(key);
    event.preventDefault();
  } else if ((key === 'e' || key === 'q') && !event.repeat) {
    climb(key === 'e' ? 1 : -1);
  }
});
window.addEventListener('keyup', event => held.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => held.clear());

function stepStroll(dt) {
  if (!stroll) { return; }
  if (tourIndex !== null || held.size > 0) {
    stroll = null;
    return;
  }
  if (stroll.goal) {
    // Short paces, however long the frame took, so no wall is stepped over.
    for (let left = dt; left > 0 && stroll.goal; left -= 0.03) {
      stroll.goal = G.pace(scene, stroll.goal, 3.3 * Math.min(left, 0.03));
    }
  } else {
    if (stroll.climb !== 0) { G.walk(scene, 0, 0, stroll.climb); }
    stroll = null;
  }
  changed();
}

let lastFrame = null;
function stepWalk(now) {
  const elapsed = lastFrame === null ? 0 : (now - lastFrame) / 1000;
  const dt = Math.min(elapsed, 0.05);
  lastFrame = now;
  stepStroll(Math.min(elapsed, 0.5));
  if (held.size === 0 || tourIndex !== null) { return; }
  let forward = 0;
  let right = 0;
  for (const key of held) {
    forward += MOVES[key][0];
    right += MOVES[key][1];
  }
  if (forward === 0 && right === 0) { return; }
  animation = null;
  const speed = (2.3 * dt) / Math.hypot(forward, right);
  G.walk(scene, forward * speed, right * speed, 0);
  changed();
}

// MARK: Controls

const NOTES = {
  Walk: [
    'The arrows, or W A S D, walk you about. Drag to look round. Click the floor to walk to that spot, through a doorway if need be, and a picture to stand in front of it and read what it is.',
    'Each floor has its own scheme. Up and down, or E and Q, change floor; so does clicking the spiral stair in a vestibule, or clicking up or down the shaft. The floors run mixed, plasma, Truchet tiles, Mondrian, automaton, Julia set, rose, bit games, Voronoi, formula, and then round again.',
    'The address at the top is design, then column, row and floor, then wall and picture; type one to go there. The address of this page always holds the same thing, with where you stand.',
  ],
  Rooms: [
    'The rooms are those of the Library of Babel: a many-sided gallery round an air shaft, with pictures on some walls and doorways in the rest, at least two. Choose the number of sides, how many walls are hung, how many pictures hang side by side on a wall, and in how many rows.',
    'Every frame has its own number, worked out from the room and its place on the wall, so the same address always shows the same picture. Key reshuffles them all.',
  ],
  Formula: [
    'Floor 9, and every tenth floor from it, shows your own rule. Type it in the box at the top while you stand there, or put it in the address after an equals sign.',
    'A formula is read left to right, one character a step, and keeps a stack of numbers: x y are the point, from −1 to 1; r a its distance and angle; t u two numbers that change from picture to picture; 0 to 9 are themselves. + − * / join the top two numbers. s c are sine and cosine of π times the top; q square root, b size, f fraction, o whole part, z minus, i one over, e exp, h 1 if positive. l g take the lesser and greater, p a power, m a remainder, n smooth noise, d copies the top, w swaps. At most 52 steps.',
    'One number left at the end picks a colour from a wheel; three are red, green and blue. So xy*4*s is sin(4π·x·y).',
  ],
  View: ['Zoom narrows the view like a longer lens; it does not move you. Reset takes you back to the first room.'],
};

const SLIDERS = [
  ['Sides', 'sides', 4, 12, 2, String],
  ['Hung walls', 'walls', 1, 10, 1, String],
  ['Pictures in a row', 'perRow', 1, 6, 1, String],
  ['Rows', 'rows', 1, 3, 1, String],
  ['Ceiling', 'height', 26, 50, 1, v => (v / 10).toFixed(1) + ' m'],
  ['Key', 'key', 0, 99, 1, String],
];

const PAD = [['↑', 'Forward', 'w'], ['↓', 'Back', 's'], ['←', 'Left', 'a'], ['→', 'Right', 'd'], ['⤒', 'Up a floor', 'e'], ['⤓', 'Down a floor', 'q']];

function section(title, inner) {
  return `<section><header><h3>${title}</h3>
    <button class="info" data-note="${title}" aria-label="About ${title}" aria-expanded="false">ⓘ</button></header>
    <p class="note" data-note-for="${title}" hidden>${NOTES[title].map(p => `<span>${p}</span>`).join('')}</p>
    ${inner}</section>`;
}

const slider = ([title, field, min, max, step]) => `<label class="row"><span class="title">${title}</span>
  <span class="value" data-value="${field}"></span>
  <input type="range" data-field="${field}" min="${min}" max="${max}" step="${step}"></label>`;

const readout = (title, id) => `<div class="readout"><span>${title}</span><span id="${id}"></span></div>`;

function buildControls() {
  $('controls').innerHTML = `
    <a class="back" href="index.html">‹ Mandelbulb</a> <a class="back" href="babel.html">‹ Library of Babel</a>
    <div><p class="eyebrow">Art gallery</p><h2 class="compact">picture = scheme(place)</h2></div>
    <button id="tourStart">▶ Guided tour</button>
    ${section('Walk', `<div class="pad">${PAD.map(([symbol, label, key]) =>
      `<button data-key="${key}" aria-label="${label}">${symbol}</button>`).join('')}</div>
      <p class="caption">Keys: W A S D or the arrows walk; E and Q go up and down a floor.</p>
      ${readout('Room', 'roomText')}${readout('This floor', 'floorKind')}`)}
    ${section('Rooms', `${SLIDERS.map(slider).join('')}${readout('Pictures in a room', 'perRoom')}`)}
    ${section('Formula', readout('Now', 'formulaNow'))}
    ${section('View', `<label class="row"><span class="title">Zoom</span><span class="value" id="zoomValue"></span>
      <input type="range" id="zoom" min="${-Math.log(ZOOM_RANGE[1])}" max="${-Math.log(ZOOM_RANGE[0])}" step="0.01"></label>
      <button id="reset">Reset</button>`)}`;

  const panel = $('controls');
  panel.addEventListener('click', event => {
    const info = event.target.closest('.info');
    if (info) {
      const note = panel.querySelector(`[data-note-for="${info.dataset.note}"]`);
      note.hidden = !note.hidden;
      info.setAttribute('aria-expanded', String(!note.hidden));
    }
  });
  panel.addEventListener('input', event => {
    const field = event.target.dataset.field;
    if (event.target.id === 'zoom') {
      scene.zoom = clamp(Math.exp(-Number(event.target.value)), ...ZOOM_RANGE);
      changed();
    } else if (field) {
      animation = null;
      stroll = null;
      scene.place.design = G.normalized({ ...scene.place.design, [field]: Number(event.target.value) });
      G.tidy(scene.place);
      if (G.hasPicture(scene.place) || !G.geometry(scene.place.design).allows([scene.x, scene.z])) {
        G.standSensibly(scene);
      }
      changed();
    }
  });
  // The pad's buttons act as held keys, so a press walks until it is let go.
  for (const button of panel.querySelectorAll('.pad button')) {
    const key = button.dataset.key;
    if (key === 'e' || key === 'q') {
      button.addEventListener('click', () => climb(key === 'e' ? 1 : -1));
      continue;
    }
    button.addEventListener('pointerdown', () => held.add(key));
    for (const end of ['pointerup', 'pointerleave', 'pointercancel']) {
      button.addEventListener(end, () => held.delete(key));
    }
  }
  $('tourStart').addEventListener('click', () => showTourStep(0));
  $('reset').addEventListener('click', () => {
    const place = G.newPlace(scene.place.design);
    arrive(G.sceneAt(place));
  });
}

function refreshControls() {
  const place = scene.place;
  const d = place.design;
  for (const input of $('controls').querySelectorAll('[data-field]')) {
    if (document.activeElement !== input) { input.value = d[input.dataset.field]; }
  }
  for (const [, field, , , , display] of SLIDERS) {
    $('controls').querySelector(`[data-value="${field}"]`).textContent = display(d[field]);
  }
  $('roomText').textContent = `column ${place.room[0]}, row ${place.room[1]}, floor ${place.room[2]}`;
  $('floorKind').textContent = G.TITLES[G.kindOfFloor(place.room[2])];
  $('perRoom').textContent = String(d.walls * G.picturesPerWall(d));
  $('formulaNow').textContent = G.formulaText(d);
  if (document.activeElement !== $('zoom')) { $('zoom').value = -Math.log(scene.zoom); }
  $('zoomValue').textContent = (1 / scene.zoom).toFixed(1) + '×';
}

$('controlsToggle').addEventListener('click', () => {
  const hidden = !$('controls').hidden;
  $('controls').hidden = hidden;
  $('controlsToggle').textContent = hidden ? '☰' : '✕';
  $('controlsToggle').setAttribute('aria-label', hidden ? 'Show controls' : 'Hide controls');
});

// MARK: Guided tour

function showTourStep(index) {
  tourIndex = index;
  held.clear();
  stroll = null;
  const step = TOUR[index];
  const last = index === TOUR.length - 1;
  $('tourCard').innerHTML = `
    <header><p class="eyebrow">Guided tour · ${index + 1} of ${TOUR.length}</p>
      <button id="tourEnd" class="plain" aria-label="End tour">✕</button></header>
    <h2>${step.title}</h2>
    <div class="body">${step.body.map(p => `<p>${p}</p>`).join('')}</div>
    ${step.tryIt ? `<p class="caption">☰ ${step.tryIt}</p>` : ''}
    <footer><button id="tourBack" ${index === 0 ? 'disabled' : ''}>‹ Back</button>
      <button id="tourReplay">↺ Replay</button><span class="spacer"></span>
      <button id="tourNext" class="prominent">${last ? '✓ Finish' : 'Next ›'}</button></footer>`;
  $('tourCard').hidden = false;
  $('controls').classList.add('touring');
  $('controlsToggle').hidden = true;
  $('tourEnd').addEventListener('click', endTour);
  $('tourBack').addEventListener('click', () => showTourStep(index - 1));
  $('tourReplay').addEventListener('click', () => showTourStep(index));
  $('tourNext').addEventListener('click', () => (last ? endTour() : showTourStep(index + 1)));
  // Stops are fully specified, so the tour looks the same whatever came before.
  animate(step.build());
  changed();
}

function endTour() {
  if (tourIndex === null) { return; }
  tourIndex = null;
  animation = null;
  $('tourCard').hidden = true;
  $('controls').classList.remove('touring');
  $('controlsToggle').hidden = false;
  changed();
}

// MARK: Start

buildControls();
if (matchMedia('(max-width: 700px)').matches) { $('controlsToggle').click(); }

const query = new URLSearchParams(location.search);
const startHash = decodeHash(location.hash);
if (startHash.length > 1) { go(startHash); }
if (query.has('tourStep')) {
  const index = Number(query.get('tourStep'));
  if (Number.isInteger(index) && index >= 0 && index < TOUR.length) { showTourStep(index); }
}
changed();

new ResizeObserver(() => { dirty = true; }).observe(canvas);

function loop(now) {
  stepAnimation(now);
  stepWalk(now);
  if (dirty) {
    dirty = false;
    draw();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
