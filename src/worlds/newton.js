// Newton's method for zⁿ = 1, tried from every starting guess: each guess
// is coloured by the root it finds. The borders between the colours are
// the picture John Hubbard drew for his students, in Gleick's Chaos.
// This is Worlds/Flat/NewtonWorld.swift, without its explorer; the tour's
// words are copied from it.
import { newState, copyState, keyframe, slider, toggle, readout, group } from './engine.js';
import { SHELF, WHITE, YELLOW, dot, segment, blend, complex, lookDown, plane, view, pan, dive } from './flat-support.js';
import { FRAGMENT } from './shaders/newton.js';

// Indices into the state's values.
const DEGREE = 0;
const STEP_SIZE = 1;
const LIMIT = 2;
const START_X = 3;
const START_Y = 4;
const PATH = 5;

const FARTHEST = 9.0;
const CLOSEST = 9.0 / 20000;

/** The nearest and farthest the picture can be seen from. */
const DISTANCE_RANGE = [CLOSEST, FARTHEST];

const defaults = lookDown(newState(), 4.2);
defaults.values[DEGREE] = 3;
defaults.values[STEP_SIZE] = 1;
defaults.values[LIMIT] = 60;
defaults.values[START_X] = -1.1;
defaults.values[START_Y] = 0.9;
defaults.values[PATH] = 1;

const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);

// MARK: Reading the state

const roots = state => Math.round(clamp(state.values[DEGREE], 2, 8));
const stepLimit = state => Math.round(clamp(state.values[LIMIT], 5, 200));
const start = state => [state.values[START_X], state.values[START_Y]];

// MARK: The rule

const lengthSquared = z => z[0] * z[0] + z[1] * z[1];
const times = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];

function over(a, b) {
  const bottom = Math.max(lengthSquared(b), 1e-300);
  return [(a[0] * b[0] + a[1] * b[1]) / bottom, (a[1] * b[0] - a[0] * b[1]) / bottom];
}

function power(z, n) {
  let w = [1, 0];
  for (let i = 0; i < n; i += 1) { w = times(w, z); }
  return w;
}

/** One guess, improved: everything worked out on the way. */
function step(z, n, size) {
  const below = power(z, n - 1);
  const product = times(below, z);
  const value = [product[0] - 1, product[1]];
  const slope = [below[0] * n, below[1] * n];
  const change = over(value, slope);
  return { z, value, slope, change, next: [z[0] - change[0] * size, z[1] - change[1] * size] };
}

/**
 * The guesses from one start: `steps` is every step taken; `root` is which
 * root was reached, counted anticlockwise from 1, or null.
 */
function search(from, state) {
  const n = roots(state);
  const steps = [];
  let z = from;
  const limit = stepLimit(state);
  for (let i = 0; i < limit; i += 1) {
    const one = step(z, n, state.values[STEP_SIZE]);
    steps.push(one);
    if (lengthSquared(one.value) < 1e-6) {
      const turn = Math.round(Math.atan2(z[1], z[0]) * n / (2 * Math.PI));
      return { steps, root: ((turn % n) + n) % n };
    }
    z = one.next;
    if (!Number.isFinite(z[0]) || !Number.isFinite(z[1])) { break; }
  }
  return { steps, root: null };
}

function rootName(index, n) {
  const angle = 360.0 * index / n;
  return index === 0 ? 'the root 1' : `the root at ${Math.round(angle)}°`;
}

function fate(found, state) {
  if (found.root === null) { return `no root in ${stepLimit(state)} steps`; }
  return `${rootName(found.root, roots(state))}, in ${found.steps.length - 1} steps`;
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
    markers.push(dot(view(points[index], state), WHITE, index === 0 ? 0.018 : 0.008));
  }
  if (selected !== null && selected > 0 && selected < points.length) {
    markers.push(dot(view(points[selected], state), YELLOW, 0.016));
  }
  return markers.filter(Boolean);
}

// MARK: Guided tour

function looking(base, x, y, zoom) {
  const state = copyState(base);
  state.focus = [x, y, 0];
  state.cameraDistance = base.cameraDistance / zoom;
  return state;
}

function guessing(base, x, y) {
  const state = copyState(base);
  state.values[START_X] = x;
  state.values[START_Y] = y;
  return state;
}

const tour = [
  {
    title: 'Improving a guess',
    body: `
      Suppose you want a number whose cube is 1, and you start with a
      guess: the large white dot. Newton's method measures how wrong
      the guess is and how quickly the wrongness changes nearby, and
      from those two works out a better guess. Then it does the same
      again.

      The line shows the guesses hopping in toward one of the small
      white dots. Those are the three answers: 1, and two complex
      numbers a third of a turn round from it.`,
    tryIt: 'Tap anywhere to guess from there',
    build(base) {
      return [
        keyframe(guessing(base, 1.9, 1.2), 2.0, 3.0),
        keyframe(guessing(base, -1.1, 0.9), 4.0, 2.0),
        keyframe(guessing(base, -1.3, -1.4), 4.0),
      ];
    },
  },
  {
    title: 'Every guess, coloured by its answer',
    body: `
      Each point of the picture is a starting guess, coloured by the
      root it ends at. Brighter points got there sooner.

      You might expect three tidy wedges, each guess going to the
      nearest root. Arthur Cayley expected that in 1879 and could not
      prove it. He was right for two roots, where the border is a
      straight line. For three it is this.`,
    tryIt: 'Equation → Roots, n: try 2',
    build(base) {
      const state = copyState(base);
      state.values[PATH] = 0;
      return [keyframe(state, 2.5)];
    },
  },
  {
    title: "A hair's width decides",
    body: `
      The guess now creeps across a border. On one side its path
      wanders and settles on one root. A hair farther on, the path
      is thrown somewhere else entirely and ends at another.

      Near the middle the slope is almost zero, and dividing by
      almost zero makes an enormous hop. Where that hop lands is
      anyone's guess, and so the beads along each border are filled
      with all three colours.`,
    tryIt: 'Tap close to a border, then a little to one side',
    build(base) {
      const state = looking(base, -0.3, 0, 1.3);
      return [
        keyframe(guessing(state, -0.62, 0.14), 2.0, 2.0),
        keyframe(guessing(state, -0.62, -0.14), 14.0),
      ];
    },
  },
  {
    title: 'Three colours meet everywhere',
    body: `
      Closer in on one bead of the border. It is not a line between
      two colours. Wherever two colours come near each other, the
      third pushes in between them, and between it and each
      neighbour the others push in again, without end.

      Every point of the border touches all three colours at once.
      No map of three countries on paper could be drawn that way,
      and yet here it is, made by a method for finding cube roots.`,
    tryIt: 'Double-tap a bead',
    build(base) {
      const state = copyState(base);
      state.values[PATH] = 0;
      return [
        keyframe(looking(state, -0.7937, 0, 6), 5.0, 2.0),
        keyframe(looking(state, -0.7937, 0, 240), 9.0),
      ];
    },
  },
  {
    title: 'More roots',
    body: `
      The same method on z⁵ = 1, then z⁷ = 1. Each root keeps a
      broad region around itself, where guesses behave. Between the
      regions run chains of beads, and inside every bead is every
      colour.`,
    tryIt: 'Equation → Roots, n',
    build(base) {
      const five = copyState(base);
      five.values[PATH] = 0;
      five.values[DEGREE] = 5;
      const seven = copyState(five);
      seven.values[DEGREE] = 7;
      return [keyframe(five, 1.5, 4.0), keyframe(seven, 0.0)];
    },
  },
  {
    title: 'Careful steps and bold ones',
    body: `
      Here the method moves only part of the way it is told to. With
      a small step the beads shrink and the borders calm down, at
      the cost of many more steps: the picture darkens.

      Then the step grows past Newton's. Each guess overshoots its
      target, and the tangle spreads out from the borders until
      little is left that can be relied on.`,
    tryIt: 'Step size → Step size, a',
    build(base) {
      const careful = copyState(base);
      careful.values[PATH] = 0;
      careful.values[STEP_SIZE] = 0.45;
      careful.values[LIMIT] = 120;
      const bold = copyState(careful);
      bold.values[STEP_SIZE] = 1.75;
      return [keyframe(careful, 4.0, 3.0), keyframe(bold, 12.0)];
    },
  },
  {
    title: 'Your turn',
    body: `
      Tap to choose a guess and watch where it goes. Dive into a
      bead by double-tapping it. Change the number of roots and the
      size of the step. Every group of controls has an ⓘ button with
      a short note.

      The address of this page always holds the view on screen, so a
      copied link brings anyone to the very same spot.`,
    build: base => [keyframe(base, 2.5)],
  },
];

// MARK: World

export const world = {
  id: 'newton',
  title: "Newton's method",
  formula: 'z → z − (zⁿ − 1) ⁄ (n·zⁿ⁻¹)',
  summary: 'A way of improving a guess until it becomes an answer. The equation z³ = 1 has three answers; colour every guess by the answer it leads to, and the borders between the colours turn out to be endlessly tangled.',
  fragment: FRAGMENT,
  defaults,
  cameraDistanceRange: DISTANCE_RANGE,
  paletteNames: ['Roots', 'Steps'],
  controlGroups: [
    group('Equation', `
      The equation is zⁿ = 1. Among complex numbers it has n
      answers, called roots, spaced evenly round a circle: the
      white dots.

      Newton's method starts from a guess. It asks how far off
      the guess is, zⁿ − 1, and how fast that error changes as z
      moves, n·zⁿ⁻¹, and moves the guess by the one divided by the
      other. Near a root this roughly doubles the number of
      correct digits at every step.`, [
      slider('Roots, n', DEGREE, [2, 8], value => String(Math.round(value))),
      slider('Step limit', LIMIT, [5, 200], value => String(Math.round(value))),
    ]),
    group('Step size', `
      Newton's own step is 1: move by the full amount the
      arithmetic suggests. A smaller step is cautious. It takes
      longer, but the borders grow calmer. A larger step
      overshoots, and the borders spread out into the picture.
      At 2 the method never settles at all.`, [
      slider('Step size, a', STEP_SIZE, [0.3, 1.95], value => value.toFixed(2)),
    ]),
    group('One guess', `
      Tap the picture to choose a starting guess. Its path is
      drawn, each step a straight hop. A guess well inside a
      colour goes more or less straight to its root. A guess
      near a border can be thrown far away first, and land at
      any root at all.`, [
      toggle('Show its path', PATH),
      readout('Guess', state => complex(start(state), 4)),
      readout('Finds', state => fate(search(start(state), state), state)),
    ]),
  ],
  viewNote: `
    Drag to move the picture and pinch to zoom. Double-tap a spot to dive
    toward it. A single tap chooses the starting guess. Brighter means
    fewer steps were needed.`,
  tour,
  shaderValues(state) {
    const values = new Array(32).fill(0);
    values[0] = roots(state);
    values[1] = state.values[STEP_SIZE];
    values[2] = stepLimit(state);
    return values;
  },
  discreteValues: new Set([DEGREE, PATH]),
  cameraBacksAwayWhenMoving: false,
  drag: (state, probe, dx, dy) => pan(state, dx, dy),
  overlayMarkers(state) {
    if (!(state.values[PATH] > 0.5)) { return []; }
    return pathMarkers(search(start(state), state), null, state);
  },
  tourKeepsPalette: false,
  pitchRange: [0, 0],
  flatFocus: true,
  zoomTarget: (viewPoint, state, factor) => dive(viewPoint, state, factor, world.cameraDistanceRange),
  tap(state, viewPoint) {
    const point = plane(viewPoint, state);
    state.values[START_X] = point[0];
    state.values[START_Y] = point[1];
  },
  urlDigits: 10,
  shelf: SHELF,
};
