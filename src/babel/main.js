// The Library of Babel page: drawing, walking, the address bar, the book in
// hand, the controls and the tour. The page's address after # is always the
// place on screen, in the same code the app's address bar takes.
import * as L from './library.js';
import * as W from './world.js';
import { VERTEX, FRAGMENT } from './shader.js';
import { TOUR } from './tour.js';

const $ = id => document.getElementById(id);
const canvas = $('view');
const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);
const ZOOM_RANGE = [0.45, 1.6];

let scene = W.sceneAt(L.newPlace());
let dirty = true;
let tourIndex = null;
let animation = null;

const copyPlace = place => ({ ...place, design: { ...place.design }, offset: [...place.offset] });
const copyScene = s => ({ ...s, place: copyPlace(s.place) });

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
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
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
  const values = new Float32Array(32);
  values.set(W.shaderValues(scene));
  gl.uniform4fv(uniforms.uV, values);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// MARK: Moving between scenes

/** Everything that depends on the scene is brought up to date. */
function changed() {
  dirty = true;
  refreshAddress();
  refreshControls();
  refreshReader();
  scheduleURL();
}

function arrive(place, view = null) {
  cancelAnimation();
  scene = W.sceneAt(copyPlace(place), view, scene.zoom);
  setFailure(null);
  changed();
}

function cancelAnimation() {
  animation = null;
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
let urlTimer = null;

function setFailure(message) {
  $('failure').textContent = message ?? '';
  $('failure').hidden = !message;
}

function refreshAddress() {
  if (document.activeElement !== addressInput) { addressInput.value = L.addressText(scene.place); }
}

const currentView = () => ({ x: scene.x, z: scene.z, yaw: scene.yaw, pitch: scene.pitch });
const fullAddress = () => L.addressText(scene.place, currentView());

function scheduleURL() {
  if (urlTimer !== null) { return; }
  urlTimer = setTimeout(() => {
    urlTimer = null;
    const hash = '#' + fullAddress();
    if (decodeHash(location.hash) !== hash) { history.replaceState(null, '', hash); }
  }, 250);
}

// Browsers escape some characters of what follows #; undo only what they do
// on their own, since the address has its own %XX escapes inside quotations.
function decodeHash(hash) {
  return hash.replaceAll('%27', "'").replaceAll('%7E', '~').replaceAll('%7e', '~');
}

function go(text) {
  try {
    const { place, view } = L.parseAddress(text, scene.place.design);
    arrive(place, view);
    addressInput.blur();
    return true;
  } catch (error) {
    if (!(error instanceof L.AddressError)) { throw error; }
    setFailure(error.message);
    return false;
  }
}

$('bar').addEventListener('submit', event => {
  event.preventDefault();
  endTour();
  go(addressInput.value);
});
addressInput.addEventListener('blur', refreshAddress);
$('random').addEventListener('click', () => {
  endTour();
  arrive(L.randomPlace(scene.place.design));
});
$('copy').addEventListener('click', async () => {
  const link = location.origin + location.pathname + '#' + fullAddress();
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
  if (hash.length > 1 && hash !== '#' + fullAddress()) { go(hash); }
});

// Finding a text.
const findDialog = $('find');
$('search').addEventListener('click', () => {
  $('alphabet').textContent = 'This library writes in: ' + L.symbols(scene.place.design).replaceAll(' ', '␣');
  findDialog.showModal();
});
$('findCancel').addEventListener('click', () => findDialog.close());
$('findForm').addEventListener('submit', event => {
  event.preventDefault();
  // Trailing blank lines would only push the page down.
  const text = $('findText').value.replaceAll('\r', '').replace(/\s+$/, '');
  findDialog.close();
  if (text === '') { return; }
  try {
    endTour();
    arrive(L.placeQuoting(text, scene.place.design));
  } catch (error) {
    if (!(error instanceof L.AddressError)) { throw error; }
    setFailure(error.message);
  }
});

// MARK: The book in hand

const reader = $('reader');
let shownBook = null;   // key of the book whose text is in the reader
let shownPage = 0;
let turnTimer = null;

function fitPage() {
  const d = scene.place.design;
  const touring = tourIndex !== null;
  const wide = innerWidth > innerHeight * 1.2;
  const width = Math.max(Math.min(innerWidth - (touring && wide ? 500 : 0) - 110, 760), 120);
  const height = Math.max(innerHeight * (touring && !wide ? 0.55 : 1) - 210, 120);
  // A monospaced letter is six tenths of its size wide.
  const size = Math.max(Math.min(width / (d.columns * 0.61), height / (d.lines * 1.24), 28), 3);
  reader.style.setProperty('--size', size + 'px');
  reader.classList.toggle('touring', touring);
  reader.classList.toggle('wide', wide);
}

function refreshReader() {
  const place = scene.place;
  const open = place.page > 0;
  reader.hidden = !open;
  $('bar').hidden = open || tourIndex !== null;
  if (!open) {
    shownBook = null;
    return;
  }
  const key = L.addressText({ ...place, page: 0 });
  const book = L.bookOf(place);
  const text = number => (book ? L.pageOf(book, place.design, number).join('\n')
    : 'No book stands here: the library ends before this shelf.');

  if (key !== shownBook) {
    shownBook = key;
    shownPage = place.page;
    const look = W.bookLook(place);
    for (const [name, value] of Object.entries(look)) { reader.style.setProperty('--' + name, value); }
    $('bookTitle').textContent = book ? (L.titleOf(book, place.design) || 'untitled') : ' ';
    $('bookWhere').textContent = `Wall ${place.wall} · shelf ${place.shelf} · volume ${place.volume}`;
    $('pageSlider').max = place.design.pages;
    $('pageSlider').hidden = place.design.pages <= 1;
    $('page').textContent = text(place.page);
    $('leaf').hidden = true;
  } else if (place.page !== shownPage) {
    turnLeaf(text(shownPage), text(place.page), place.page > shownPage);
    shownPage = place.page;
  }
  fitPage();
  $('pageSlider').value = place.page;
  $('pageLabel').textContent = `page ${place.page} of ${place.design.pages}`;
  $('previous').disabled = place.page <= 1;
  $('next').disabled = place.page >= place.design.pages;
}

/**
 * Turns the leaf: forward, the old page lifts away from the new one; back,
 * the earlier page comes down over the later.
 */
function turnLeaf(oldText, newText, forward) {
  const page = $('page');
  const leaf = $('leaf');
  clearTimeout(turnTimer);
  leaf.style.transition = 'none';
  leaf.textContent = forward ? oldText : newText;
  leaf.style.transform = `rotateY(${forward ? 0 : -100}deg)`;
  leaf.hidden = false;
  if (forward) { page.textContent = newText; }
  void leaf.offsetWidth; // start the transition from here
  leaf.style.transition = '';
  leaf.style.transform = `rotateY(${forward ? -100 : 0}deg)`;
  turnTimer = setTimeout(() => {
    page.textContent = newText;
    leaf.hidden = true;
  }, 400);
}

function setPage(number, animated = true) {
  const target = clamp(number, 1, scene.place.design.pages);
  if (scene.place.page === 0 || target === scene.place.page) { return; }
  cancelAnimation();
  if (!animated) {
    shownPage = target;
    $('page').textContent = L.pageOf(L.bookOf(scene.place), scene.place.design, target).join('\n');
  }
  scene.place.page = target;
  changed();
}

function putBack() {
  cancelAnimation();
  scene.place.page = 0;
  changed();
}

$('previous').addEventListener('click', () => setPage(scene.place.page - 1));
$('next').addEventListener('click', () => setPage(scene.place.page + 1));
$('putBack').addEventListener('click', putBack);
$('pageSlider').addEventListener('input', event => setPage(Number(event.target.value), false));

let swipeStart = null;
$('cover').addEventListener('pointerdown', event => { swipeStart = [event.clientX, event.clientY]; });
$('cover').addEventListener('pointerup', event => {
  if (!swipeStart) { return; }
  const dx = event.clientX - swipeStart[0];
  const dy = event.clientY - swipeStart[1];
  swipeStart = null;
  // A swipe, and not the selecting of a line of text.
  if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy) && event.pointerType !== 'mouse') {
    setPage(scene.place.page + (dx < 0 ? 1 : -1));
  }
});

// MARK: Looking and walking

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
  cancelAnimation();
  scene.yaw += dx * 3.4 * 0.5;
  scene.pitch = clamp(scene.pitch + dy * 3.4 * 0.5, -1.45, 1.45);
  changed();
});
canvas.addEventListener('pointerup', event => {
  const wasClick = drag && drag.moved < 4;
  drag = null;
  if (!wasClick || tourIndex !== null || scene.place.page > 0) { return; }
  // A click takes down the book under it.
  const box = canvas.getBoundingClientRect();
  const aspect = box.width / box.height;
  const fit = Math.min(aspect, 1);
  const u = ((((event.clientX - box.left) / box.width) * 2 - 1) * aspect) / fit;
  const v = (1 - ((event.clientY - box.top) / box.height) * 2) / fit;
  stroll = null;
  const hit = W.bookUnder(scene, u, v);
  if (hit) {
    cancelAnimation();
    Object.assign(scene.place, hit, { page: 1 });
    changed();
    return;
  }
  // Anything else that can be walked on or climbed is somewhere to go.
  const aim = W.aimUnder(scene, u, v);
  if (aim) {
    cancelAnimation();
    stroll = { goal: aim.floor ?? null, climb: aim.climb ?? 0 };
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
  cancelAnimation();
  W.walk(scene, 0, 0, up);
  changed();
}

window.addEventListener('keydown', event => {
  if (event.target.closest('input, textarea, select, dialog') || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  const key = event.key.toLowerCase();
  if (scene.place.page > 0) {
    if (key === 'arrowleft') { setPage(scene.place.page - 1); }
    else if (key === 'arrowright') { setPage(scene.place.page + 1); }
    else if (key === 'escape') { putBack(); }
    else { return; }
    event.preventDefault();
    return;
  }
  if (tourIndex !== null) { return; }
  if (key in MOVES) {
    held.add(key);
    event.preventDefault();
  } else if ((key === 'e' || key === 'q') && !event.repeat) {
    climb(key === 'e' ? 1 : -1);
  }
});
window.addEventListener('keyup', event => held.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => held.clear());

/** The walk a click has set going: { goal, climb }. */
let stroll = null;

function stepStroll(dt) {
  if (!stroll) { return; }
  if (scene.place.page > 0 || tourIndex !== null || held.size > 0) {
    stroll = null;
    return;
  }
  if (stroll.goal) {
    // Short paces, however long the frame took, so no wall is stepped over.
    for (let left = dt; left > 0 && stroll.goal; left -= 0.03) {
      stroll.goal = W.pace(scene, stroll.goal, 3.3 * Math.min(left, 0.03));
    }
  } else {
    if (stroll.climb !== 0) { W.walk(scene, 0, 0, stroll.climb); }
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
  if (held.size === 0 || scene.place.page > 0 || tourIndex !== null) { return; }
  let forward = 0;
  let right = 0;
  for (const key of held) {
    forward += MOVES[key][0];
    right += MOVES[key][1];
  }
  if (forward === 0 && right === 0) { return; }
  cancelAnimation();
  const speed = 2.3 * dt / Math.hypot(forward, right);
  W.walk(scene, forward * speed, right * speed, 0);
  changed();
}

// MARK: Controls

const NOTES = {
  Walk: [
    'The arrows, or W A S D, walk you about the gallery. Drag to look round. The walls without shelves open onto a vestibule, and beyond it the next gallery. Up and down, or E and Q, take the spiral stair to the floor above or below.',
    'Click the floor to walk to that spot, through a doorway if need be. Click the stair to climb or go down it, and click up or down the shaft to change floor at once.',
    'Click a book to take it down and read it. Its address appears at the top: design, room, then wall, shelf, volume and page. Type any address there to go to it. The address of this page always holds the same thing, with where you stand.',
  ],
  Books: [
    'A book is a fixed number of characters, each one of the alphabet’s symbols. Borges gives 410 pages of 40 lines of 80 characters in 25 symbols: 1,312,000 characters, and so 25^1,312,000 different books. The library holds each one exactly once.',
    'Shuffled puts them in an order that looks random but can be run backwards, so any text can be found. In order shelves them alphabetically: each book is the expansion of a number between 0 and 1, and neighbours differ only in their last letters. Seeded uses the address to start a random number generator: books may then repeat or be missing, and nothing can be looked up.',
    'Make the books small enough and you can read the whole library: 2 symbols and 4 characters gives 16 books.',
  ],
  Rooms: [
    'Borges’s galleries are hexagons. Four walls carry five shelves of thirty-two books, 640 to a room; the other two open onto vestibules. His first edition shelved five walls and left one way out, which would make every floor a set of dead ends joined only by the stairs. Here a room always keeps at least two doorways.',
    'Rooms need an even number of sides here, so that each doorway faces one in the next room. Every room is furnished from a number worked out from where it is, so no two look alike, and each looks the same whenever you return. Uniform gives the library of the story, where every room and every book is like every other.',
  ],
  View: ['Zoom narrows the view like a longer lens; it does not move you. Reset takes you back to the middle of Borges’s library.'],
};

const SLIDERS = {
  Books: [
    ['Symbols', 'alphabet', 2, 30, 1, v => (v >= 30 ? '95, all of ASCII' : v === 25 ? '25, as Borges' : String(v))],
    ['Pages', 'pages', 1, 410, 1, String],
    ['Lines on a page', 'lines', 1, 40, 1, String],
    ['Characters in a line', 'columns', 1, 80, 1, String],
    ['Key', 'key', 0, 99, 1, String],
  ],
  Rooms: [
    ['Sides', 'sides', 4, 12, 2, String],
    ['Shelved walls', 'walls', 1, 10, 1, String],
    ['Shelves on a wall', 'shelves', 1, 12, 1, String],
    ['Books on a shelf', 'volumes', 1, 80, 1, String],
    ['Ceiling', 'height', 20, 60, 1, v => (v / 10).toFixed(1) + ' m'],
  ],
};

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
    <a class="back" href="index.html">‹ Mandelbulb</a> <a class="back" href="gallery.html">Art gallery ›</a>
    <div><p class="eyebrow">Library of Babel</p><h2 class="compact">25 symbols, 1,312,000 to a book: every book, once</h2></div>
    <button id="tourStart">▶ Guided tour</button>
    ${section('Walk', `<div class="pad">${PAD.map(([symbol, label, key]) =>
      `<button data-key="${key}" aria-label="${label}">${symbol}</button>`).join('')}</div>
      <p class="caption">Keys: W A S D or the arrows walk; E and Q go up and down a floor.</p>
      ${readout('Room', 'roomText')}${readout('Books here', 'booksHere')}`)}
    ${section('Books', `<label class="row"><span class="title">Order</span>
      <select data-field="mode"><option value="0">Shuffled</option><option value="1">In order</option><option value="2">Seeded</option></select></label>
      ${SLIDERS.Books.map(slider).join('')}
      ${readout('Characters in a book', 'characters')}${readout('Books', 'bookCount')}`)}
    ${section('Rooms', `${SLIDERS.Rooms.map(slider).join('')}
      <label class="row check"><span class="title">Uniform</span><input type="checkbox" data-field="uniform"></label>
      ${readout('Books in a room', 'perRoom')}`)}
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
      const value = event.target.type === 'checkbox' ? (event.target.checked ? 1 : 0) : Number(event.target.value);
      cancelAnimation();
      scene.place.design = L.normalized({ ...scene.place.design, [field]: value });
      W.tidy(scene.place);
      if (!W.geometry(scene.place.design).allows([scene.x, scene.z])) { W.standSensibly(scene); }
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
    scene.zoom = 1;
    arrive(L.newPlace());
  });
}

function refreshControls() {
  const place = scene.place;
  const d = place.design;
  for (const input of $('controls').querySelectorAll('[data-field]')) {
    const field = input.dataset.field;
    if (input.type === 'checkbox') {
      input.checked = d[field] === 1;
    } else if (document.activeElement !== input || input.tagName === 'SELECT') {
      input.value = field === 'alphabet' && d.alphabet === 95 ? 30 : d[field];
    }
  }
  for (const [, field, , , , display] of [...SLIDERS.Books, ...SLIDERS.Rooms]) {
    $('controls').querySelector(`[data-value="${field}"]`).textContent =
      display(field === 'alphabet' && d.alphabet === 95 ? 30 : d[field]);
  }
  $('roomText').textContent = W.roomText(place);
  $('booksHere').textContent = `${L.roomOf(place)?.bookCount ?? 0} of ${L.booksPerRoom(d)}`;
  $('characters').textContent = L.charactersPerBook(d).toLocaleString('en-US');
  $('bookCount').textContent = L.bookCountText(d);
  $('perRoom').textContent = String(L.booksPerRoom(d));
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
  try {
    animate(step.build());
  } catch (error) {
    setFailure(String(error.message ?? error));
  }
  changed();
}

function endTour() {
  if (tourIndex === null) { return; }
  tourIndex = null;
  cancelAnimation();
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
if (startHash.length > 1 && !go(startHash)) { changed(); }
if (query.has('tourStep')) {
  const index = Number(query.get('tourStep'));
  if (Number.isInteger(index) && index >= 0 && index < TOUR.length) { showTourStep(index); }
}
changed();

new ResizeObserver(() => {
  dirty = true;
  if (scene.place.page > 0) { fitPage(); }
}).observe(canvas);

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
