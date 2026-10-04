// The interface: the counterpart of ContentView, TourCardView and
// ExplorerPanelView in the native app.
import * as M from './math.js';
import * as Tour from './tour.js';
import { MandelbulbModel } from './model.js';
import { Renderer } from './renderer.js';
import { ImmersiveSession } from './xr.js';

const $ = id => document.getElementById(id);

/** Small DOM builder: h('div', { class: 'x', onclick }, child, 'text'). */
function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('on')) {
      element.addEventListener(key.slice(2), value);
    } else if (key === 'class') {
      element.className = value;
    } else if (value !== false && value !== null && value !== undefined) {
      element.setAttribute(key, value === true ? '' : value);
    }
  }
  element.append(...children.flat().filter(child => child !== null && child !== undefined && child !== false));
  return element;
}

const model = new MandelbulbModel();
const canvas = $('view');
let renderer;
try {
  renderer = new Renderer(canvas, model);
} catch (error) {
  $('error').hidden = false;
  $('error').textContent = error.message;
  throw error;
}
const immersive = new ImmersiveSession(renderer, model, () => { needsSync = true; });

/** Functions that copy model state into the page; all run on every sync. */
const updaters = [];
let needsSync = true;
model.onChange(() => { needsSync = true; });

const state = {
  showingControls: innerWidth >= 700,
  expandedNotes: new Set(),
  selectedStep: 0,
  viewIsTall: false,
  immersiveSupported: false,
};

// MARK: Formatting

/** Fixed decimals for ordinary values, scientific once an orbit grows large. */
function number(value, digits = 4) {
  if (!Number.isFinite(value)) { return '∞'; }
  if (Math.abs(value) >= 1000) { return value.toExponential(2).replace('e+', 'E'); }
  return value.toFixed(digits);
}
const degrees = radians => (radians * 180 / Math.PI).toFixed(2) + '°';
const vector = v => `(${v.map(x => number(x, 3)).join(', ')})`;

// MARK: Shared controls

/** A labelled slider row with its current value shown on the right. */
function parameterSlider({ label, min, max, step = 'any', get, set, display }) {
  const input = h('input', { type: 'range', min, max, step, 'aria-label': label });
  const value = h('span', { class: 'value' });
  input.addEventListener('input', () => {
    model.setInteraction('parameters', true);
    set(Number(input.value));
  });
  const release = () => model.setInteraction('parameters', false);
  input.addEventListener('change', release);
  input.addEventListener('pointerup', release);
  updaters.push(() => {
    input.value = get();
    value.textContent = display(get());
  });
  return h('label', { class: 'slider' },
    h('span', { class: 'slider-head' }, h('span', {}, label), value),
    input);
}

const setParameter = key => value => model.update(p => { p[key] = value; });
const setJuliaC = axis => value => model.update(p => { p.juliaC[axis] = value; });

function section(title, note, ...content) {
  const noteElement = h('p', { class: 'note', hidden: true });
  noteElement.append(...note.map(paragraph => h('span', {}, paragraph)));
  const button = h('button', {
    class: 'icon quiet', 'aria-label': `About ${title}`, 'aria-expanded': 'false',
    onclick: () => {
      const open = !state.expandedNotes.has(title);
      state.expandedNotes[open ? 'add' : 'delete'](title);
      noteElement.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      button.classList.toggle('active', open);
    },
  }, 'ⓘ');
  return h('section', {},
    h('div', { class: 'section-head' }, h('h3', {}, title), button),
    noteElement,
    ...content);
}

// MARK: Control panel

function buildControls() {
  const explorerButton = h('button', { onclick: () => (model.explorerIsOpen ? model.closeExplorer() : model.openExplorer()) });
  updaters.push(() => {
    explorerButton.textContent = model.explorerIsOpen ? 'ƒ  Close orbit explorer' : 'ƒ  Orbit explorer';
  });

  const juliaConstant = h('div', { class: 'stack' },
    ...['x', 'y', 'z'].map((name, axis) => parameterSlider({
      label: `c ${name}`, min: -1.2, max: 1.2,
      get: () => model.parameters.juliaC[axis], set: setJuliaC(axis), display: v => v.toFixed(2),
    })));
  updaters.push(() => { juliaConstant.hidden = !(model.parameters.juliaMix > 0.001); });

  const palette = h('select', {
    'aria-label': 'Colour',
    onchange: () => model.update(p => { p.palette = Number(palette.value); }),
  }, ...['Ember', 'Glacier', 'Spectrum', 'Chalk'].map((name, index) => h('option', { value: index }, name)));
  updaters.push(() => { palette.value = model.parameters.palette; });

  const immersiveButton = h('button', {
    class: 'prominent',
    onclick: () => immersive.toggle().catch(error => {
      immersiveNote.textContent = `Could not start the immersive session: ${error.message}`;
    }),
  });
  const immersiveNote = h('p', { class: 'caption' },
    'In the immersive space: pinch and move one hand to rotate; use two pinches to resize.');
  const immersiveSection = h('section', { hidden: true }, immersiveButton, immersiveNote);
  updaters.push(() => {
    immersiveSection.hidden = !state.immersiveSupported;
    immersiveButton.textContent = immersive.isOpen ? 'Leave immersive space' : 'Enter immersive space';
  });

  $('controls').append(
    h('a', { class: 'back', href: 'index.html' }, '‹ All worlds'),
    h('header', {},
      h('p', { class: 'eyebrow' }, 'Mandelbulb'),
      h('h2', {}, 'z → zⁿ + c')),
    h('div', { class: 'stack' },
      h('button', { onclick: () => model.startTour() }, '▶  Guided tour'),
      explorerButton,
      h('p', { class: 'caption' }, 'The explorer follows one point through the rule and shows every number.')),

    section('Shape', [
      'Power is the n in zⁿ: the distance from the origin is raised to the power n and both angles are multiplied by n. Around the polar axis the shape repeats n − 1 times.',
      'Iterations is how many times the rule is repeated before a point is declared to stay. More repetitions carve finer detail and cost more time per frame.',
    ],
      parameterSlider({
        label: 'Power', min: 2, max: 12,
        get: () => model.parameters.power, set: setParameter('power'), display: v => v.toFixed(1),
      }),
      parameterSlider({
        label: 'Iterations', min: 2, max: 24,
        get: () => model.parameters.iterations, set: setParameter('iterations'), display: v => String(Math.round(v)),
      })),

    section('Julia', [
      'At 0 the constant c is the point being tested, which gives the Mandelbulb. At 1 the same c is used for every point, which gives a Julia set. In between, the two rules are blended so you can watch one turn into the other.',
      'Each choice of c gives a different Julia set. Values of c near the Mandelbulb\'s surface give the most intricate ones; values far outside it give dust.',
    ],
      parameterSlider({
        label: 'Morph', min: 0, max: 1,
        get: () => model.parameters.juliaMix, set: setParameter('juliaMix'), display: v => v.toFixed(2),
      }),
      juliaConstant),

    section('Twist', [
      'A constant angle is added after each multiplication: Longitude turns the fold around the polar axis, Latitude tilts it toward or away from the pole. Because the offset is added again at every iteration, the effect compounds and the buds shear into spirals rather than simply rotating.',
    ],
      parameterSlider({
        label: 'Longitude', min: -Math.PI, max: Math.PI,
        get: () => model.parameters.phasePhi, set: setParameter('phasePhi'),
        display: v => `${(v * 180 / Math.PI).toFixed(0)}°`,
      }),
      parameterSlider({
        label: 'Latitude', min: -Math.PI, max: Math.PI,
        get: () => model.parameters.phaseTheta, set: setParameter('phaseTheta'),
        display: v => `${(v * 180 / Math.PI).toFixed(0)}°`,
      })),

    section('Slice', [
      'Removes everything above a horizontal plane. The inside is solid, because interior points never escape. The bands on the cut show how far from the origin each point\'s path has settled. Tilt the view down to look onto the cut.',
    ],
      parameterSlider({
        label: 'Height', min: -1.2, max: M.SLICE_DISABLED,
        get: () => model.parameters.sliceHeight, set: setParameter('sliceHeight'),
        display: v => (v >= 1.3 ? 'Off' : v.toFixed(2)),
      })),

    section('View', [
      'Zoom moves the camera toward the point it orbits. Double-tap any spot on the surface to orbit that spot instead and fly toward it. Raise Iterations as you go deeper to reveal detail at the new scale.',
      'Colour comes from each point\'s orbit: how close it passed to the origin, to a ring around the axis, and to the equatorial plane.',
    ],
      parameterSlider({
        label: 'Zoom',
        min: Math.log(M.DEFAULT_CAMERA_DISTANCE / M.CAMERA_DISTANCE_RANGE[1]),
        max: Math.log(M.DEFAULT_CAMERA_DISTANCE / M.CAMERA_DISTANCE_RANGE[0]),
        get: () => Math.log(M.magnification(model.parameters)),
        set: value => model.update(p => { p.cameraDistance = M.DEFAULT_CAMERA_DISTANCE / Math.exp(value); }),
        display: () => `${M.magnification(model.parameters).toFixed(1)}×`,
      }),
      h('label', { class: 'row' }, h('span', {}, 'Colour'), palette),
      h('div', { class: 'row' },
        h('button', { class: 'small', onclick: () => model.resetView() }, 'Reset view'),
        h('button', { class: 'small', onclick: () => model.resetShape() }, 'Reset shape'))),

    immersiveSection,
  );
}

// MARK: Tour card

function buildTourCard() {
  const count = h('p', { class: 'eyebrow' });
  const title = h('h2', {});
  const body = h('div', { class: 'tour-body' });
  const tryIt = h('p', { class: 'caption try-it' });
  const exploreText = h('p', {});
  const explore = h('div', { class: 'invitation' },
    exploreText,
    h('button', { class: 'small', onclick: () => model.openExplorer() }, 'ƒ  Explore the numbers here'));
  const back = h('button', { onclick: () => model.advanceTour(-1) }, '‹ Back');
  const spinner = h('span', { class: 'spinner', role: 'status', 'aria-label': 'Animating' });
  const next = h('button', { class: 'prominent', onclick: () => model.advanceTour(1) });

  $('tourCard').append(
    h('div', { class: 'section-head' },
      count,
      h('button', { class: 'icon quiet', 'aria-label': 'End tour', onclick: () => model.endTour() }, '✕')),
    title, body, tryIt, explore,
    h('div', { class: 'row tour-actions' },
      back,
      h('button', { onclick: () => model.replayTourStep() }, '↺ Replay'),
      h('span', { class: 'spacer' }),
      spinner, next));

  let shown = null;
  updaters.push(() => {
    const step = model.tourStep;
    $('tourCard').hidden = !step;
    if (!step) {
      shown = null;
      return;
    }
    spinner.hidden = !model.isAnimating;
    if (shown === model.tourIndex) { return; }
    shown = model.tourIndex;
    const isLast = shown === Tour.steps.length - 1;
    count.textContent = `Guided tour · ${shown + 1} of ${Tour.steps.length}`;
    title.textContent = step.title;
    body.replaceChildren(...step.body.map(paragraph => h('p', {}, paragraph)));
    body.scrollTop = 0;
    tryIt.hidden = !step.tryIt;
    tryIt.textContent = step.tryIt ? `Try it: ${step.tryIt}` : '';
    explore.hidden = !step.explore;
    exploreText.textContent = step.explore ?? '';
    back.disabled = shown === 0;
    next.textContent = isLast ? '✓ Finish' : 'Next ›';
  });
}

// MARK: Orbit explorer

/** Slider plus an exact number field, as in the native explorer. */
function valueRow({ label, min, max, digits, get, set, editable = () => true }) {
  const range = h('input', { type: 'range', min, max, step: 'any', 'aria-label': label });
  const field = h('input', { type: 'number', step: 'any', 'aria-label': `${label} value` });
  range.addEventListener('input', () => {
    model.setInteraction('parameters', true);
    set(Number(range.value));
  });
  const release = () => model.setInteraction('parameters', false);
  range.addEventListener('change', release);
  range.addEventListener('pointerup', release);
  field.addEventListener('change', () => {
    const value = Number(field.value);
    if (field.value !== '' && Number.isFinite(value)) { set(M.clamp(value, min, max)); }
    needsSync = true;
  });
  updaters.push(() => {
    range.value = get();
    // Never rewrite a field while someone is typing in it.
    if (document.activeElement !== field) { field.value = get().toFixed(digits); }
    range.disabled = field.disabled = !editable();
  });
  return h('div', { class: 'value-row' }, h('span', {}, label), range, field);
}

/** A button that repeats while held, like the native move arrows. */
function repeatButton(symbol, label, action) {
  let timer = null;
  const stop = () => {
    clearTimeout(timer);
    clearInterval(timer);
    timer = null;
  };
  const button = h('button', { class: 'icon', 'aria-label': label, title: label }, symbol);
  button.addEventListener('pointerdown', () => {
    action();
    timer = setTimeout(() => { timer = setInterval(action, 70); }, 350);
  });
  for (const event of ['pointerup', 'pointerleave', 'pointercancel']) { button.addEventListener(event, stop); }
  // Keyboard activation arrives as a click with no pointer.
  button.addEventListener('click', event => { if (event.detail === 0) { action(); } });
  return button;
}

function buildExplorer() {
  const isJulia = () => model.parameters.juliaMix > 0.5;
  const sectionTitle = text => h('h3', {}, text);

  const resume = h('button', { class: 'prominent small', onclick: () => model.returnToTour() });
  const modeButtons = [false, true].map(julia => h('button', {
    onclick: () => model.update(p => { p.juliaMix = julia ? 1 : 0; }),
  }, julia ? 'Julia' : 'Mandelbulb'));
  const modeNote = h('p', { class: 'caption' });
  const pointTitle = sectionTitle('');
  const surfaceNote = h('p', { class: 'caption' },
    'Held on the surface. Turn that off below to type or drag any coordinates.');

  const probeRow = (name, axis) => valueRow({
    label: name, min: -1.5, max: 1.5, digits: 4,
    get: () => model.probe[axis],
    set: value => {
      const point = [...model.probe];
      point[axis] = value;
      model.setProbe(point);
    },
    editable: () => !model.probeStaysOnSurface,
  });
  const constantSection = h('div', { class: 'stack' },
    sectionTitle('Constant c (green point)'),
    ...['x', 'y', 'z'].map((name, axis) => valueRow({
      label: name, min: -1.5, max: 1.5, digits: 4,
      get: () => model.parameters.juliaC[axis], set: setJuliaC(axis),
    })));

  const toggle = (label, get, set) => {
    const input = h('input', { type: 'checkbox', onchange: () => set(input.checked) });
    updaters.push(() => { input.checked = get(); });
    return h('label', { class: 'row toggle' }, h('span', {}, label), input);
  };
  const depthButtons = h('span', { class: 'row' },
    repeatButton('↗', 'Move away', () => model.moveProbe(0, 0, 1)),
    repeatButton('↙', 'Move nearer', () => model.moveProbe(0, 0, -1)));
  const moveNote = h('p', { class: 'caption' });

  const verdict = h('div', { class: 'stack verdict' });
  const table = h('div', { class: 'orbit-table', role: 'table' });
  const worked = h('div', { class: 'stack' });

  $('explorer').append(
    h('div', { class: 'section-head' },
      h('header', {},
        h('p', { class: 'eyebrow' }, 'Orbit explorer'),
        h('h2', { class: 'compact' }, 'z → zⁿ + c, one step at a time')),
      h('button', { class: 'icon quiet', 'aria-label': 'Close explorer', onclick: () => model.closeExplorer() }, '✕')),
    resume,
    h('div', { class: 'stack' }, h('div', { class: 'segmented' }, ...modeButtons), modeNote),
    h('div', { class: 'stack' }, pointTitle, probeRow('x', 0), probeRow('y', 1), probeRow('z', 2), surfaceNote),
    constantSection,
    h('div', { class: 'stack' },
      sectionTitle('Rule'),
      valueRow({ label: 'n', min: 2, max: 12, digits: 2, get: () => model.parameters.power, set: setParameter('power') }),
      valueRow({
        label: 'steps', min: 2, max: 24, digits: 0,
        get: () => model.parameters.iterations, set: setParameter('iterations'),
      })),
    h('div', { class: 'stack' },
      sectionTitle('Move the point'),
      toggle('Keep it on the surface', () => model.probeStaysOnSurface, v => model.setProbeStaysOnSurface(v)),
      toggle('Camera follows it', () => model.cameraFollowsProbe, v => model.setCameraFollowsProbe(v)),
      h('div', { class: 'row' },
        repeatButton('←', 'Move left', () => model.moveProbe(-1, 0)),
        repeatButton('↑', 'Move up', () => model.moveProbe(0, 1)),
        repeatButton('↓', 'Move down', () => model.moveProbe(0, -1)),
        repeatButton('→', 'Move right', () => model.moveProbe(1, 0)),
        depthButtons),
      h('button', { class: 'small', onclick: () => model.lookAtProbe() }, '⌖  Turn the camera to face the point'),
      moveNote),
    h('hr', {}),
    verdict, table, worked);

  const workedLine = (label, value, strong = false) =>
    h('div', { class: strong ? 'worked strong' : 'worked' }, h('span', {}, label), h('span', {}, value));

  updaters.push(() => {
    $('explorer').hidden = !model.explorerIsOpen;
    if (!model.explorerIsOpen) { return; }
    const p = model.parameters;
    const julia = isJulia();
    const orbit = model.orbit;
    const escape = M.ESCAPE_RADIUS;

    resume.hidden = model.tourStopToResume === null;
    if (model.tourStopToResume !== null) {
      resume.textContent = `‹ Back to the tour, stop ${model.tourStopToResume + 1}`;
    }
    modeButtons[0].classList.toggle('selected', !julia);
    modeButtons[1].classList.toggle('selected', julia);
    modeNote.textContent = julia
      ? 'Julia: c is fixed and the white point is the starting value z₀. The object shown is the Julia set for this c.'
      : 'Mandelbulb: the white point is both c and the starting value z₀.';
    pointTitle.textContent = julia ? 'Start z₀ (white point)' : 'Point c = z₀ (white point)';
    surfaceNote.hidden = !model.probeStaysOnSurface;
    constantSection.hidden = !julia;
    depthButtons.hidden = model.probeStaysOnSurface;
    moveNote.textContent = model.probeStaysOnSurface
      ? 'Arrow keys slide the point over the surface. Click or tap the object to jump there. Steps shrink as you zoom in.'
      : 'Arrow keys move the point across the view; with Shift, ↑ and ↓ move it away and nearer. Click or tap the object to jump to its surface.';

    const escaped = orbit.escapedAt;
    verdict.replaceChildren(
      h('p', { class: 'verdict-title' }, escaped !== null
        ? `↗ Outside: escapes at step ${escaped}`
        : `● Inside, as far as ${orbit.iterationLimit} steps can tell`),
      h('p', { class: 'caption' }, escaped !== null
        ? `|z| passed ${escape} after ${escaped} application${escaped === 1 ? '' : 's'} of the rule, and from there it only grows.`
        : `|z| stayed below ${escape} for every step. More steps might still show it escaping; points near the surface take longest to decide.`),
      model.probeStaysOnSurface && escaped !== null && h('p', { class: 'caption' },
        'The drawn surface lies a hair outside the set, so a point held on it does escape. How many steps that takes shows how intricate the surface is nearby.'),
      h('p', { class: 'caption numeric' }, orbit.distanceEstimate > 0
        ? `Distance estimate to the surface: ${orbit.distanceEstimate.toPrecision(3)}`
        : 'Distance estimate: none, the point is inside.'));

    const selected = M.clamp(state.selectedStep, 0, orbit.steps.length - 1);
    const cells = values => values.map(value => h('span', { role: 'cell' }, value));
    table.replaceChildren(
      sectionTitle('Orbit'),
      h('div', { class: 'orbit-row head', role: 'row' }, ...cells(['k', 'x', 'y', 'z', '|z|'])),
      ...orbit.steps.map(step => h('button', {
        class: step.id === selected ? 'orbit-row selected' : 'orbit-row', role: 'row',
        'aria-label': `Step ${step.id}, distance from origin ${number(step.radius)}`,
        onclick: () => {
          state.selectedStep = step.id;
          needsSync = true;
        },
      }, ...cells([String(step.id), ...step.z.map(v => number(v)), number(step.radius)]))),
      h('p', { class: 'caption' }, 'Select a row to see that step worked out below.'));

    const step = orbit.steps[selected];
    worked.replaceChildren(
      sectionTitle(`Step ${selected} → ${selected + 1}, worked`),
      ...(step.next
        ? [
          workedLine('r = |z|', number(step.radius)),
          workedLine('θ, angle from pole', degrees(step.theta)),
          workedLine('φ, longitude', degrees(step.phi)),
          workedLine('rⁿ', number(step.poweredRadius)),
          workedLine(p.phaseTheta === 0 ? 'n·θ' : 'n·θ + twist', degrees(step.newTheta)),
          workedLine(p.phasePhi === 0 ? 'n·φ' : 'n·φ + twist', degrees(step.newPhi)),
          workedLine('zⁿ', vector(step.powered)),
          workedLine('c', vector(orbit.c)),
          workedLine('zⁿ + c', vector(step.next), true),
          h('p', { class: 'caption' },
            `With n = ${p.power.toFixed(2)}: the distance is raised to the power n, both angles are multiplied by n, the result is turned back into x, y, z, and c is added.`),
        ]
        : [h('p', { class: 'caption' }, escaped === selected
          ? 'The orbit has escaped here, so the rule is not applied again.'
          : 'This is the last step computed. Raise “steps” to continue the orbit.')]));
  });
}

// MARK: Chrome

function buildChrome() {
  const toggle = $('controlsToggle');
  toggle.addEventListener('click', () => {
    state.showingControls = !state.showingControls;
    needsSync = true;
  });
  $('modeButtons').append(
    h('button', { class: 'prominent pill', onclick: () => model.startTour() }, '▶  Guided tour'),
    h('button', { class: 'prominent pill', onclick: () => model.openExplorer() }, 'ƒ  Explorer'));

  updaters.push(() => {
    const touring = model.tourIndex !== null;
    // A tall window has no room for both panels.
    const panelAllowed = !touring && !(model.explorerIsOpen && state.viewIsTall);
    $('controls').hidden = !(panelAllowed && state.showingControls);
    toggle.hidden = !panelAllowed;
    toggle.textContent = state.showingControls ? '✕' : '☰';
    toggle.setAttribute('aria-label', state.showingControls ? 'Hide controls' : 'Show controls');
    $('modeButtons').hidden = touring || model.explorerIsOpen;
  });
}

// MARK: Gestures on the picture

function installGestures() {
  const pointers = new Map();
  let drag = null;   // { x, y, yaw, pitch, moved }
  let pinch = null;  // { separation, distance }
  let lastTap = null;
  let wheelTimer = null;

  const separation = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const local = event => {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top, width: bounds.width, height: bounds.height };
  };

  canvas.addEventListener('pointerdown', event => {
    canvas.setPointerCapture(event.pointerId);
    canvas.focus({ preventScroll: true });
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      drag = { x: event.clientX, y: event.clientY, yaw: 0, pitch: 0, moved: false };
    } else if (pointers.size === 2) {
      if (drag?.moved) { model.setInteraction('rotation', false); }
      drag = null;
      pinch = { separation: separation(), distance: model.parameters.cameraDistance };
      model.setInteraction('zoom', true);
    }
  });

  canvas.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) { return; }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && pointers.size >= 2) {
      if (pinch.separation > 1) { model.setZoom(pinch.distance, separation() / pinch.separation); }
      return;
    }
    if (!drag) { return; }
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 3) { return; }
      drag.moved = true;
      drag.yaw = model.parameters.yaw;
      drag.pitch = model.parameters.pitch;
      model.setInteraction('rotation', true);
    }
    model.update(p => {
      p.yaw = drag.yaw + dx * 0.008;
      p.pitch = M.clamp(drag.pitch + dy * 0.008, -1.45, 1.45);
    });
  });

  const end = event => {
    if (!pointers.delete(event.pointerId)) { return; }
    if (pinch) {
      if (pointers.size < 2) {
        pinch = null;
        model.setInteraction('zoom', false);
      }
      return;
    }
    if (!drag) { return; }
    const wasTap = !drag.moved && event.type === 'pointerup';
    if (drag.moved) { model.setInteraction('rotation', false); }
    drag = null;
    if (!wasTap) { return; }

    const at = local(event);
    const now = performance.now();
    const isDouble = lastTap && now - lastTap.time < 350 && Math.hypot(at.x - lastTap.x, at.y - lastTap.y) < 30;
    lastTap = isDouble ? null : { time: now, x: at.x, y: at.y };
    if (isDouble) {
      model.focusAt(at.x, at.y, at.width, at.height);
    } else {
      model.pickProbe(at.x, at.y, at.width, at.height);
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    model.setInteraction('zoom', true);
    model.zoom(Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015)));
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => model.setInteraction('zoom', false), 180);
  }, { passive: false });

  // Arrow keys drive the explorer's point whenever it is open and no text is
  // being edited, wherever keyboard focus happens to be.
  addEventListener('keydown', event => {
    if (!model.explorerIsOpen) { return; }
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type !== 'range' && target.type !== 'checkbox') { return; }
    if (target instanceof HTMLSelectElement) { return; }
    const direction = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1],
    }[event.key];
    if (!direction) { return; }
    event.preventDefault();
    if (event.shiftKey && direction[1] !== 0) {
      model.moveProbe(0, 0, direction[1]);
    } else {
      model.moveProbe(...direction);
    }
  }, { capture: true });
}

// MARK: Start

buildControls();
buildTourCard();
buildExplorer();
buildChrome();
installGestures();

function layout() {
  const tall = innerHeight > innerWidth * 1.2;
  if (tall !== state.viewIsTall) {
    state.viewIsTall = tall;
    document.body.classList.toggle('tall', tall);
    needsSync = true;
  }
}
addEventListener('resize', layout);
layout();

ImmersiveSession.isSupported().then(supported => {
  state.immersiveSupported = supported;
  needsSync = true;
});

// `?tourStep=5` opens directly on that tour stop and `?explorer=1` in the
// explorer, which gives repeatable views for screenshots and comparisons.
const query = new URLSearchParams(location.search);
if (query.has('tourStep')) {
  model.showTourStep(Number(query.get('tourStep')));
} else if (query.has('explorer')) {
  model.openExplorer();
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!immersive.isOpen) { model.tick(now); }

  // In a tall, narrow window the caption sits over the middle of the object,
  // so the object is drawn higher up.
  const covered = state.viewIsTall && (model.tourIndex !== null || model.explorerIsOpen);
  const shift = covered ? (model.explorerIsOpen ? 0.8 : 0.62) : 0;
  if (Math.abs(model.verticalShift - shift) > 0.002) {
    model.verticalShift += (shift - model.verticalShift) * 0.14;
    renderer.invalidate();
  } else if (model.verticalShift !== shift) {
    model.verticalShift = shift;
    renderer.invalidate();
  }

  if (needsSync) {
    needsSync = false;
    for (const update of updaters) { update(); }
  }
  renderer.frame(now);
}
requestAnimationFrame(frame);

// For debugging from the console.
window.ratmath = { model, renderer };
