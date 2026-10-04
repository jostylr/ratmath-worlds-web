// Newton's method let loose: on any polynomial, by placing its roots; on
// a ratio of two, by adding poles; on sines and exponentials; and on a
// formula typed in. The plain Newton world keeps to zⁿ = 1.
// This is Worlds/Flat/NewtonLabWorld.swift, without its explorer; the tour's
// words are copied from it.
import { newState, copyState, keyframe, slider, picker, toggle, readout, group } from './engine.js';
import { SHELF, WHITE, YELLOW, PINK, dot, segment, blend, complex, lookDown, scale, plane, view, pan, dive } from './flat-support.js';
import { parse, evaluate, table, pack, unpack, CHARACTERS_PER_VALUE } from './formula-program.js';
import { FRAGMENT } from './shaders/newton-lab.js';

// Indices into the state's values.
const KIND = 0;
const PRESET = 1;
const STEP_SIZE = 2;
const LIMIT = 3;
const START_X = 4;
const START_Y = 5;
const PATH = 6;
const ROOT_COUNT = 7;
const POLE_COUNT = 8;
/** Which root or pole is picked up: −1 none, roots first, then poles. */
const PICKED = 9;
const FIRST_ROOT = 10;
const FIRST_POLE = 20;
/** The typed formula, eight characters to a value. */
const FIRST_TEXT = 24;

const MOST_ROOTS = 5;
const MOST_POLES = 2;
const TEXT_VALUES = 8;
const FARTHEST = 40.0;
const CLOSEST = 5.0 / 20000;

/** The nearest and farthest the picture can be seen from. */
const DISTANCE_RANGE = [CLOSEST, FARTHEST];

const FORMULAS = ['z^3-1', 'z^3-2z+2', 'sin(z)', 'e^z-1', 'cosh(z)-1', 'tan(z)', 'z^z-1'];
const FORMULA_NAMES = ['z³ − 1', 'z³ − 2z + 2', 'sin z', 'eᶻ − 1', 'cosh z − 1', 'tan z', 'zᶻ − 1', 'Your own'];
const OWN_FORMULA = FORMULAS.length;

const defaults = lookDown(newState(), 5.0);
defaults.values[STEP_SIZE] = 1;
defaults.values[LIMIT] = 60;
defaults.values[START_X] = 0.15;
defaults.values[START_Y] = 0.1;
defaults.values[ROOT_COUNT] = 3;
defaults.values[PICKED] = -1;
[[1.2, 0], [-0.6, 1.0], [-0.9, -0.7], [0.9, -1.1], [-1.6, 0.3]].forEach((place, index) => {
  defaults.values[FIRST_ROOT + 2 * index] = place[0];
  defaults.values[FIRST_ROOT + 2 * index + 1] = place[1];
});
defaults.values[FIRST_POLE] = 0.3;
defaults.values[FIRST_POLE + 1] = 0.5;
defaults.values[FIRST_POLE + 2] = -0.2;
defaults.values[FIRST_POLE + 3] = -1.3;
(pack('z^2+1', TEXT_VALUES) ?? []).forEach((value, index) => {
  defaults.values[FIRST_TEXT + index] = value;
});

const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);

// MARK: Reading the state

const usesFormula = state => state.values[KIND] > 0.5;
const presetIndex = state => Math.round(clamp(state.values[PRESET], 0, OWN_FORMULA));
const isOwn = state => usesFormula(state) && presetIndex(state) === OWN_FORMULA;
const stepLimit = state => Math.round(clamp(state.values[LIMIT], 5, 200));
const start = state => [state.values[START_X], state.values[START_Y]];

function roots(state) {
  const count = Math.round(clamp(state.values[ROOT_COUNT], 1, MOST_ROOTS));
  return Array.from({ length: count }, (_, i) => [state.values[FIRST_ROOT + 2 * i], state.values[FIRST_ROOT + 2 * i + 1]]);
}

function poles(state) {
  const count = Math.round(clamp(state.values[POLE_COUNT], 0, MOST_POLES));
  return Array.from({ length: count }, (_, i) => [state.values[FIRST_POLE + 2 * i], state.values[FIRST_POLE + 2 * i + 1]]);
}

const ownText = state => unpack(state.values.slice(FIRST_TEXT, FIRST_TEXT + TEXT_VALUES));
const formulaText = state =>
  (isOwn(state) ? ownText(state) : FORMULAS[Math.min(presetIndex(state), FORMULAS.length - 1)]);

const programCache = { text: '', program: null };

/** The formula in use, read; null if what was typed cannot be. */
function program(state) {
  const text = formulaText(state);
  if (text !== programCache.text) {
    programCache.text = text;
    programCache.program = parse(text);
  }
  return programCache.program;
}

// MARK: The rule

const lengthSquared = z => z[0] * z[0] + z[1] * z[1];
const times = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];

function over(a, b) {
  const bottom = Math.max(lengthSquared(b), 1e-300);
  return [(a[0] * b[0] + a[1] * b[1]) / bottom, (a[1] * b[0] - a[0] * b[1]) / bottom];
}

/** The function's value at z and its slope there. */
function f(z, state) {
  if (usesFormula(state)) {
    const read = program(state);
    return read ? evaluate(read, z) : { value: z, slope: [1, 0] };
  }
  // (z − r₁)(z − r₂)… over (z − p₁)…; its slope is its value times
  // the sum of 1 ⁄ (z − root), less the same for the poles.
  let value = [1, 0];
  const sum = [0, 0];
  for (const root of roots(state)) {
    const away = [z[0] - root[0], z[1] - root[1]];
    value = times(value, away);
    const part = over([1, 0], away);
    sum[0] += part[0];
    sum[1] += part[1];
  }
  for (const pole of poles(state)) {
    const away = [z[0] - pole[0], z[1] - pole[1]];
    value = over(value, away);
    const part = over([1, 0], away);
    sum[0] -= part[0];
    sum[1] -= part[1];
  }
  return { value, slope: times(value, sum) };
}

/**
 * The guesses from one start: `steps` is every step taken; `found` is the
 * root reached, or null.
 */
function search(from, state) {
  const steps = [];
  let z = from;
  const limit = stepLimit(state);
  const size = state.values[STEP_SIZE];
  for (let i = 0; i < limit; i += 1) {
    const { value, slope } = f(z, state);
    const change = over(value, slope);
    steps.push({ z, value, slope, change, next: [z[0] - change[0] * size, z[1] - change[1] * size] });
    if (lengthSquared(value) < 1e-18 || lengthSquared(change) < 1e-20) {
      return { steps, found: z };
    }
    z = steps[steps.length - 1].next;
    if (!Number.isFinite(z[0]) || !Number.isFinite(z[1]) || !(lengthSquared(z) < 1e12)) { break; }
  }
  return { steps, found: null };
}

function fate(found, state) {
  if (found.found === null) { return `no root in ${stepLimit(state)} steps`; }
  return `${complex(found.found, 3)}, in ${found.steps.length - 1} steps`;
}

// MARK: Marks

function pathMarkers(found, selected, state) {
  const markers = [];
  const points = found.steps.map(one => one.z);
  const shown = Math.min(points.length - 1, 40);
  if (shown < 0) { return markers; }
  for (let index = 0; index < shown; index += 1) {
    const color = blend(WHITE, YELLOW, index / Math.max(shown - 1, 1));
    markers.push(segment(view(points[index], state), view(points[index + 1], state), color));
  }
  for (let index = 0; index <= shown; index += 1) {
    markers.push(dot(view(points[index], state), YELLOW, index === 0 ? 0.016 : 0.007));
  }
  if (selected !== null && selected > 0 && selected < points.length) {
    markers.push(dot(view(points[selected], state), PINK, 0.015));
  }
  return markers.filter(Boolean);
}

const two = value => value.toFixed(2);
const whole = value => String(Math.round(value));

// MARK: Guided tour

function placing(base, placedRoots, placedPoles = []) {
  const state = copyState(base);
  state.values[KIND] = 0;
  state.values[ROOT_COUNT] = placedRoots.length;
  state.values[POLE_COUNT] = placedPoles.length;
  placedRoots.forEach((root, index) => {
    state.values[FIRST_ROOT + 2 * index] = root[0];
    state.values[FIRST_ROOT + 2 * index + 1] = root[1];
  });
  placedPoles.forEach((pole, index) => {
    state.values[FIRST_POLE + 2 * index] = pole[0];
    state.values[FIRST_POLE + 2 * index + 1] = pole[1];
  });
  return state;
}

function using(base, index, distance) {
  const state = copyState(base);
  state.values[KIND] = 1;
  state.values[PRESET] = index;
  state.cameraDistance = distance;
  return state;
}

const THREE = [[1.2, 0], [-0.6, 1.0], [-0.9, -0.7]];

const tour = [
  {
    title: 'Roots wherever you like',
    body: `
      In the plain Newton world the roots sat evenly round a
      circle. Here they are yours to place. The function is the
      simplest one that is zero at the three white dots, and each
      guess is coloured by the dot it ends at.

      Now one root slides across the picture. Its territory goes
      with it, and the tangled borders rearrange themselves as it
      moves. A root's own colour always surrounds it. What lies
      between the roots is never simple.`,
    tryIt: 'Tap a root to pick it up, drag, tap elsewhere to put it down',
    build(base) {
      const moved = [[1.2, 0], [0.9, 1.3], [-0.9, -0.7]];
      return [
        keyframe(placing(base, THREE), 2.0, 2.0),
        keyframe(placing(base, moved), 10.0),
      ];
    },
  },
  {
    title: 'Where the method fails',
    body: `
      These are the roots of z³ − 2z + 2. The black regions are
      guesses that never find any of them.

      The yellow path shows why. Start near zero and the method
      hops to 1; from 1 it hops back to zero; and so on for ever.
      Worse, the trap attracts: guesses anywhere in the black are
      drawn into the same two-step dance. Newton's method is
      usually superb, but it comes with no guarantee.`,
    tryIt: 'One guess → Show its path, then tap in the black',
    build(base) {
      const state = placing(base, [[-1.76929, 0], [0.88465, 0.58974], [0.88465, -0.58974]]);
      state.values[PATH] = 1;
      state.values[START_X] = 0.12;
      state.values[START_Y] = 0.08;
      state.cameraDistance = 4.2;
      return [keyframe(state, 3.0)];
    },
  },
  {
    title: 'Five roots',
    body: `
      Two more roots arrive. Five territories now, and every border
      between any two of them is beaded with all five colours.

      Any polynomial at all can be made this way, because a
      polynomial is fixed, up to a constant, by where its roots
      are. The constant does not matter here: Newton's method
      divides the function by its own slope, and the constant
      cancels.`,
    tryIt: 'Function → Roots',
    build(base) {
      const five = [...THREE, [0.9, -1.1], [-1.6, 0.3]];
      return [
        keyframe(placing(base, THREE), 1.5, 1.5),
        keyframe(placing(base, five), 0.0),
      ];
    },
  },
  {
    title: 'Poles push',
    body: `
      The white ring is a pole: the function is divided by its
      distance from there, so near the ring it is enormous. Roots
      pull guesses in. A pole pushes them away: each step doubles
      a nearby guess's distance from it, until some root takes
      over.

      The function is now a ratio of two polynomials. As the pole
      moves in among the roots, their territories are pushed
      aside and rearranged around it.`,
    tryIt: 'Function → Poles; a pole can be picked up like a root',
    build(base) {
      const far = placing(base, THREE, [[2.6, 1.8]]);
      const near = placing(base, THREE, [[-0.1, 0.1]]);
      return [keyframe(far, 2.0, 2.0), keyframe(near, 11.0)];
    },
  },
  {
    title: 'Infinitely many roots',
    body: `
      This is sin z. Along the middle of the picture it is the
      ordinary sine, zero at every multiple of π, and so it has
      infinitely many roots, each with a territory of its own
      colour.

      A guess close to a root goes to it. But between each pair of
      roots the sine is flat, its slope is zero, and a guess there
      can be hurled to a root a long way off: the thin stripes of
      far-away colours.`,
    tryIt: 'Function → Kind → A formula → Formula',
    build(base) {
      return [
        keyframe(using(base, 2, 9), 2.0, 3.0),
        keyframe(using(base, 2, 30), 8.0),
      ];
    },
  },
  {
    title: 'Roots up a ladder',
    body: `
      eᶻ − 1 is zero at 0, and also at 2πi, 4πi and every step up
      and down the imaginary direction: the exponential goes round
      in a circle as z climbs.

      On the right the method works well and each root collects
      the guesses level with it. On the left eᶻ is nearly zero,
      the function is nearly flat at −1, and one hop from there is
      vast: the fine bands are guesses landing who knows where.`,
    tryIt: 'Function → Formula → eᶻ − 1',
    build: base => [keyframe(using(base, 3, 26), 2.5)],
  },
  {
    title: 'A double root, and the fix',
    body: `
      cosh z − 1 touches zero without crossing it: every root is
      a double root. There the slope vanishes along with the
      value, and Newton's step only halves the error each time.
      The picture is dim because every guess needs dozens of
      steps.

      Now the step size rises to 2. For a double root that is
      exactly the right correction, the squaring of the error
      returns, and the picture lights up.`,
    tryIt: 'Step → Step size, a',
    build(base) {
      const slow = using(base, 4, 22);
      const fast = copyState(slow);
      fast.values[STEP_SIZE] = 2;
      return [keyframe(slow, 2.0, 3.5), keyframe(fast, 6.0)];
    },
  },
  {
    title: 'A formula of your own',
    body: `
      This is zᶻ − 1, a function with no simple list of roots and
      a seam along the negative axis where its two halves do not
      match. The method does not mind. It needs only a value and
      a slope at each guess.

      Choose Your own and type anything made of z, numbers, i, e
      and pi, with + − * / ^ and brackets, and sin, cos, tan,
      exp, log, sqrt, sinh, cosh and tanh. The slope is worked
      out for you.`,
    tryIt: 'Function → Formula → Your own, then type',
    build: base => [keyframe(using(base, 6, 12), 2.5)],
  },
  {
    title: 'Your turn',
    body: `
      Place roots and poles and drag them about. Try to make a
      black region, or to get rid of one. Run through the
      formulas, and then write your own. Every group of controls
      has an ⓘ button with a short note.

      The address of this page always holds the view on screen, so a
      copied link brings anyone to the very same spot.`,
    build: base => [keyframe(base, 2.5)],
  },
];

// MARK: The typed formula

const FAILURE = `A formula uses z, numbers, i, e and pi, with + - * / ^ and brackets, and sin cos tan exp log sqrt sinh cosh tanh, in at most ${TEXT_VALUES * CHARACTERS_PER_VALUE} characters.`;

/** Where a formula of one's own is typed, shown at the foot of the panel
    while that choice is in use. Returns what keeps it up to date. */
function formulaField({ panel, state, change }) {
  if (typeof document === 'undefined' || !panel) { return null; }
  const wrapper = document.createElement('div');
  const label = document.createElement('label');
  label.className = 'row';
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = 'f(z) =';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'z^2+1';
  input.spellcheck = false;
  input.autocapitalize = 'off';
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('autocomplete', 'off');
  input.style.width = '100%';
  input.style.flexBasis = '100%';
  input.style.fontFamily = 'ui-monospace, monospace';
  const message = document.createElement('p');
  message.className = 'caption';
  message.hidden = true;
  label.append(title, input);
  wrapper.append(label, message);
  panel.append(wrapper);

  // The picture changes as the formula is typed, whenever it can be read.
  input.addEventListener('input', () => {
    const text = input.value;
    if (text === ownText(state())) { return; }
    const values = parse(text) ? pack(text, TEXT_VALUES) : null;
    if (!values) {
      message.textContent = FAILURE;
      message.hidden = false;
      return;
    }
    message.textContent = '';
    message.hidden = true;
    change(live => {
      values.forEach((value, index) => { live.values[FIRST_TEXT + index] = value; });
    });
  });
  // Keys typed here are the formula's, not the picture's.
  input.addEventListener('keydown', event => event.stopPropagation());

  const refresh = now => {
    wrapper.hidden = !isOwn(now);
    if (document.activeElement !== input) {
      const stored = ownText(now);
      if (input.value !== stored) { input.value = stored; }
    }
  };
  refresh(state());
  return refresh;
}

// MARK: World

export const world = {
  id: 'newton-lab',
  title: "Newton's laboratory",
  formula: 'z → z − a·f(z) ⁄ f′(z), for an f of your own',
  summary: "Newton's method on any function you like. Drag the roots of a polynomial about and watch their territories shift, add poles, try sines and exponentials with infinitely many roots, or type a formula.",
  fragment: FRAGMENT,
  defaults,
  cameraDistanceRange: DISTANCE_RANGE,
  paletteNames: ['Roots', 'Steps'],
  controlGroups: [
    group('Function', `
      Roots you place: the function is (z − r₁)(z − r₂)…,
      which is zero exactly at the white dots. Tap a dot to
      pick it up, drag to move it, and tap elsewhere to put it
      down. Any polynomial is one of these, since a polynomial
      is known by its roots.

      Poles are the white rings. Each divides the function by
      (z − p), so it blows up there instead of vanishing. With
      poles the function is a ratio of two polynomials.

      A formula: sines, exponentials and the like have
      infinitely many roots, so no list of them can be drawn.
      Each root found takes its colour from where it lies.`, [
      picker('Kind', KIND, ['Roots you place', 'A formula']),
      { ...slider('Roots', ROOT_COUNT, [1, MOST_ROOTS], whole), visible: state => !usesFormula(state) },
      { ...slider('Poles', POLE_COUNT, [0, MOST_POLES], whole), visible: state => !usesFormula(state) },
      { ...picker('Formula', PRESET, FORMULA_NAMES), visible: usesFormula },
      {
        ...readout('f(z)', state => (program(state) === null ? `cannot read ${formulaText(state)}` : formulaText(state))),
        visible: usesFormula,
      },
    ]),
    group('Step', `
      Newton's own step is 1. At a root where the function
      touches zero without crossing, a double root such as
      those of cosh z − 1, that step only halves the error each
      time, and the picture is dark with effort. A step of 2 is
      exactly right there, and wrong everywhere else.`, [
      slider('Step size, a', STEP_SIZE, [0.3, 2.2], two),
      slider('Step limit', LIMIT, [5, 200], whole),
    ]),
    group('One guess', `
      Tap the picture, away from any root, to choose a starting
      guess, and its path is drawn. Black regions are guesses
      that find no root: they are caught in a cycle, or thrown
      off to infinity.`, [
      toggle('Show its path', PATH),
      readout('Guess', state => complex(start(state), 3)),
      readout('Finds', state => fate(search(start(state), state), state)),
    ]),
  ],
  viewNote: `
    Drag to move the picture, or the root you have picked up. Pinch to
    zoom and double-tap to dive. A single tap picks up a root or pole,
    puts it down, or chooses the starting guess.`,
  tour,
  shaderValues(state) {
    const values = new Array(32).fill(0);
    values[0] = usesFormula(state) ? 1 : 0;
    values[1] = state.values[STEP_SIZE];
    values[2] = stepLimit(state);
    values[3] = program(state)?.steps.length ?? 1;
    values[4] = roots(state).length;
    values[5] = poles(state).length;
    values[6] = Math.round(state.values[PICKED]);
    for (let index = 0; index < 2 * MOST_ROOTS; index += 1) { values[8 + index] = state.values[FIRST_ROOT + index]; }
    for (let index = 0; index < 2 * MOST_POLES; index += 1) { values[18 + index] = state.values[FIRST_POLE + index]; }
    return values;
  },
  shaderData(state) {
    if (!usesFormula(state)) { return new Float32Array(4); }
    // What cannot be read is drawn as plain z, whose only root is 0.
    const read = program(state);
    return read ? table(read) : new Float32Array([1, 0, 0, 0]);
  },
  discreteValues: new Set([
    KIND, PRESET, PATH, ROOT_COUNT, POLE_COUNT, PICKED,
    ...Array.from({ length: TEXT_VALUES }, (_, index) => FIRST_TEXT + index),
  ]),
  cameraBacksAwayWhenMoving: false,
  drag(state, probe, dx, dy) {
    const held = Math.round(state.values[PICKED]);
    if (usesFormula(state) || held < 0) {
      pan(state, dx, dy);
      return;
    }
    const at = held < MOST_ROOTS ? FIRST_ROOT + 2 * held : FIRST_POLE + 2 * (held - MOST_ROOTS);
    state.values[at] += dx * scale(state);
    state.values[at + 1] -= dy * scale(state);
  },
  overlayMarkers(state) {
    if (!(state.values[PATH] > 0.5)) { return []; }
    return pathMarkers(search(start(state), state), null, state);
  },
  tourKeepsPalette: false,
  pitchRange: [0, 0],
  flatFocus: true,
  zoomTarget: (viewPoint, state, factor) => dive(viewPoint, state, factor, world.cameraDistanceRange),
  tap(state, viewPoint) {
    if (!usesFormula(state)) {
      // A tap on a root or pole picks it up, or puts it down.
      const places = [
        ...roots(state).map((place, index) => [index, place]),
        ...poles(state).map((place, index) => [index + MOST_ROOTS, place]),
      ];
      let near = null;
      for (const [index, place] of places) {
        const seen = view(place, state);
        const distance = Math.hypot(seen[0] - viewPoint[0], seen[1] - viewPoint[1]);
        if (distance < 0.07 && (near === null || distance < near[1])) { near = [index, distance]; }
      }
      if (near !== null) {
        state.values[PICKED] = Math.round(state.values[PICKED]) === near[0] ? -1 : near[0];
        return;
      }
      if (state.values[PICKED] >= 0) {
        state.values[PICKED] = -1;
        return;
      }
    }
    const point = plane(viewPoint, state);
    state.values[START_X] = point[0];
    state.values[START_Y] = point[1];
  },
  extend: formulaField,
  urlDigits: 10,
  shelf: SHELF,
};
