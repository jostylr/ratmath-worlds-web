// Hénon's map: two numbers and one bend-and-squeeze rule, whose points
// gather on a curve made of infinitely many curves. The simplest strange
// attractor, from the chapter on strange attractors in Gleick's Chaos.
// This is Worlds/Flat/HenonWorld.swift, without its explorer; the tour's
// words are copied from it.
import { newState, copyState, keyframe, slider, picker, toggle, readout, group, Format } from './engine.js';
import { SHELF, lookDown, scale, plane, pan, dive, dice } from './flat-support.js';
import { FRAGMENT } from './shaders/backdrop.js';

// Indices into the state's values.
const A = 0;
const B = 1;
const COUNT_POWER = 2;
const PICTURE = 3;
const FOLDS = 4;
const START_X = 5;
const START_Y = 6;
const TRAIL = 7;

/** y is drawn this much larger than x, as in Hénon's own figures. */
const STRETCH = 2.6;
/** The nearest and farthest the picture can be seen from. */
const RANGE = [4.0 / 400, 9.0];
/** Points drawn at most, and steps taken at most looking for them. */
const BUDGET = 80000;
const PATIENCE = 3000000;
/** The disc of the stretch-and-fold picture, and the first steps joined up. */
const DISC = 7000;
const HOPS = 30;

const defaults = lookDown(newState(), 4.0);
defaults.values[A] = 1.4;
defaults.values[B] = 0.3;
defaults.values[COUNT_POWER] = 4.3;
defaults.values[START_X] = 0.1;
defaults.values[START_Y] = 0.1;

const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);

// MARK: The rule

const next = (p, state) => [1 - state.values[A] * p[0] * p[0] + p[1], state.values[B] * p[0]];

const fromScene = p => [p[0], p[1] / STRETCH];
const start = state => [state.values[START_X], state.values[START_Y]];
const shownCount = state => Math.min(Math.round(10 ** clamp(state.values[COUNT_POWER], 0, 5)), BUDGET);

/** The point the rule leaves where it is. */
function fixedPoint(state) {
  const a = state.values[A], b = state.values[B];
  if (!(a > 1e-9)) { return null; }
  const inside = (1 - b) * (1 - b) + 4 * a;
  if (!(inside >= 0)) { return null; }
  const x = (-(1 - b) + Math.sqrt(inside)) / (2 * a);
  return [x, b * x];
}

/** What becomes of a start: { away: step }, { cycle: period } or { chaos }. */
function longRun(from, state) {
  let p = from;
  for (let n = 0; n < 6000; n += 1) {
    p = next(p, state);
    if (!(Math.abs(p[0]) < 1e3)) { return { away: n + 1 }; }
  }
  const recent = [];
  for (let n = 0; n < 600; n += 1) {
    p = next(p, state);
    recent.push(p);
  }
  const last = recent.length - 1;
  for (let period = 1; period <= 256; period += 1) {
    const earlier = recent[last - period];
    if (Math.hypot(recent[last][0] - earlier[0], recent[last][1] - earlier[1]) < 1e-9) {
      return { cycle: period };
    }
  }
  return { chaos: true };
}

function verdict(run) {
  if (run.cycle === 1) { return 'settles on one point'; }
  if (run.cycle) { return `a cycle of ${run.cycle} points`; }
  if (run.chaos) { return 'a strange attractor'; }
  return `runs away by step ${run.away}`;
}

// MARK: The picture

/** The picture is recomputed only when what it depends on changes. */
const lineData = new Float32Array(12 * (BUDGET + 1 + 2 * HOPS));
let lineCount = 0;
let cacheKey = [];

/** Adds one line: its two ends, colour and half-width in points. */
function addLine(ax, ay, bx, by, r, g, b, alpha, width) {
  const at = 12 * lineCount;
  lineData[at] = ax;
  lineData[at + 1] = ay;
  lineData[at + 2] = 0;
  lineData[at + 3] = width;
  lineData[at + 4] = bx;
  lineData[at + 5] = by;
  lineData[at + 6] = 0;
  lineData[at + 7] = 0;
  lineData[at + 8] = r;
  lineData[at + 9] = g;
  lineData[at + 10] = b;
  lineData[at + 11] = alpha;
  lineCount += 1;
}

/** A dot is a segment with no length. */
function addDot(x, y, r, g, b, alpha, width) {
  addLine(x, y, x, y, r, g, b, alpha, width);
}

function lines(state, probe) {
  const origin = probe ? [probe[0], probe[1]] : start(state);
  const key = [...state.values, state.focus[0], state.focus[1], state.cameraDistance, origin[0], origin[1]];
  if (key.length === cacheKey.length && key.every((value, i) => value === cacheKey[i])) {
    return { data: lineData, count: lineCount };
  }
  lineCount = 0;
  const a = state.values[A], b = state.values[B];

  if (state.values[PICTURE] > 0.5) {
    // A disc of points, carried through the rule: each keeps the
    // colour of where it began.
    const roll = dice(0x9E3779B9);
    const folds = Math.max(state.values[FOLDS], 0);
    const whole = Math.trunc(folds);
    const part = folds - whole;
    for (let n = 0; n < DISC; n += 1) {
      const angle = roll() * 2 * Math.PI;
      const radius = Math.sqrt(roll());
      let p = [0.75 * radius * Math.cos(angle), 0.26 * radius * Math.sin(angle)];
      for (let fold = 0; fold < whole; fold += 1) { p = next(p, state); }
      const after = next(p, state);
      const x = p[0] + (after[0] - p[0]) * part;
      const y = p[1] + (after[1] - p[1]) * part;
      if (!(Math.abs(x) < 4 && Math.abs(y) < 4)) { continue; }
      addDot(x, y * STRETCH,
        0.5 + 0.5 * Math.cos(angle),
        0.5 + 0.5 * Math.cos(angle - 2.094),
        0.5 + 0.5 * Math.cos(angle + 2.094),
        0.75, 1.5);
    }
  } else {
    // Points of the long run that fall in view.
    const half = scale(state) * 2.4;
    const wanted = shownCount(state);
    const focusX = state.focus[0], focusY = state.focus[1];
    const allInView = state.cameraDistance >= 3.9;
    let x = origin[0], y = origin[1];
    let kept = 0;
    for (let step = 0; step < PATIENCE; step += 1) {
      const nextX = 1 - a * x * x + y;
      y = b * x;
      x = nextX;
      if (!(Math.abs(x) < 1e3)) { break; }
      if (step < 100) { continue; }
      if (Math.abs(x - focusX) < half && Math.abs(y * STRETCH - focusY) < half) {
        addDot(x, y * STRETCH, 0.55, 0.80, 1.0, 0.6, 1.15);
        kept += 1;
        if (kept >= wanted) { break; }
      }
      // All of it is in view at first: stop once enough steps are shown.
      if (step - 100 >= wanted && allInView) { break; }
    }
  }

  if (state.values[TRAIL] > 0.5 || probe) {
    let p = origin;
    let previous = [p[0], p[1] * STRETCH];
    addDot(previous[0], previous[1], 1, 0.8, 0.2, 1, 4.0);
    for (let index = 0; index < HOPS; index += 1) {
      p = next(p, state);
      if (!(Math.abs(p[0]) < 50)) { break; }
      const now = [p[0], p[1] * STRETCH];
      const fade = 1 - index / 40;
      addLine(previous[0], previous[1], now[0], now[1], 1.0, 0.35, 0.55, 0.5 * fade, 0.9);
      addDot(now[0], now[1], 1.0, 0.45, 0.6, fade, 2.4);
      previous = now;
    }
  }

  cacheKey = key;
  return { data: lineData, count: lineCount };
}

// MARK: Guided tour

function looking(base, x, y, zoom) {
  const state = copyState(base);
  state.focus = [x, y * STRETCH, 0];
  state.cameraDistance = base.cameraDistance / zoom;
  return state;
}

const tour = [
  {
    title: 'Two numbers and a rule',
    body: `
      A point has two numbers, x and y. The rule makes a new point
      from it: the new x is 1 − 1.4·x² + y, and the new y is 0.3
      times the old x. Then the rule is applied to the new point.

      The pink line joins the first thirty points, starting from the
      yellow dot. They hop about with no pattern you could name.
      Michel Hénon, an astronomer, built this rule in 1976 to be the
      simplest thing that behaves like Lorenz's weather.`,
    tryIt: 'Tap to start somewhere else',
    build(base) {
      const state = copyState(base);
      state.values[TRAIL] = 1;
      state.values[COUNT_POWER] = 0;
      return [keyframe(state, 2.5)];
    },
  },
  {
    title: 'The hops fill in a shape',
    body: `
      Keep going. A hundred points, a thousand, thirty thousand.
      Each one lands somewhere unpredictable, and yet together they
      draw a curve, bent like a boomerang.

      Start anywhere nearby and the same curve appears. It attracts
      every path, which is why it is called an attractor. The order
      in which the points arrive never repeats.`,
    tryIt: 'Picture → Points',
    build(base) {
      const few = copyState(base);
      few.values[COUNT_POWER] = 1;
      const many = copyState(base);
      many.values[COUNT_POWER] = 4.5;
      return [keyframe(few, 1.0, 1.0), keyframe(many, 12.0)];
    },
  },
  {
    title: 'A curve made of curves',
    body: `
      Closer, one strand of the curve turns out to be several.
      Closer again, and one of those is several more. Hénon checked
      this by plotting millions of points: at every magnification
      the same bundle of lines reappears.

      A true curve has dimension 1 and a filled region 2. This
      object is in between, about 1.26. That in-between dimension
      is what makes an attractor strange.`,
    tryIt: 'Double-tap a strand',
    build(base) {
      const state = copyState(base);
      state.values[COUNT_POWER] = 4.7;
      return [
        keyframe(looking(state, 0.6314, 0.1894, 12), 6.0, 3.0),
        keyframe(looking(state, 0.6314, 0.1894, 130), 8.0),
      ];
    },
  },
  {
    title: 'Stretch and fold',
    body: `
      Here is why. A disc of points, coloured by where each began,
      goes through the rule once: it is bent into an arch and
      flattened. Again: the arch is bent into a horseshoe. Again,
      and again.

      Each step stretches the disc along the curve, pulling
      neighbours apart, then folds it back so it still fits. Points
      that began side by side end up far along the curve from each
      other, and the layers pile up like pastry. Stretching makes
      the chaos; folding keeps it in a box.`,
    tryIt: 'Picture → Show → Stretch and fold → Folds',
    build(base) {
      const state = copyState(base);
      state.values[PICTURE] = 1;
      const frames = [keyframe(state, 1.5, 2.0)];
      for (let count = 1; count <= 5; count += 1) {
        const folded = copyState(state);
        folded.values[FOLDS] = count;
        frames.push(keyframe(folded, 3.0, 1.5));
      }
      return frames;
    },
  },
  {
    title: 'The road in',
    body: `
      Chaos here is reached the same way as in the logistic map.
      With the bend small, every path ends on one point. Raise it,
      and the one point becomes two, then four, then eight, each
      doubling coming sooner than the last, at Feigenbaum's rate.

      Past about 1.06 the points smear out along a curve, and by 1.4
      the curve is the whole attractor.`,
    tryIt: 'Rule → Bend, a',
    build(base) {
      const low = copyState(base);
      low.values[A] = 0.25;
      low.values[COUNT_POWER] = 3.3;
      const high = copyState(low);
      high.values[A] = 1.4;
      return [keyframe(low, 2.0, 2.0), keyframe(high, 22.0)];
    },
  },
  {
    title: 'Your turn',
    body: `
      Dive into a strand and count its layers. Change the bend and
      the squeeze and find where the points stop settling. Put a
      disc through the folds one at a time. Every group of controls
      has an ⓘ button with a short note.

      The address of this page always holds the view on screen, so a
      copied link brings anyone to the very same spot.`,
    build: base => [keyframe(base, 2.5)],
  },
];

// MARK: World

const three = value => value.toFixed(3);

export const world = {
  id: 'henon',
  title: 'Hénon\'s attractor',
  formula: 'x → 1 − a·x² + y,  y → b·x',
  summary: 'Two numbers, bent and squeezed by one rule, over and over. Whatever the start, the points gather on the same curve; look closer and the curve is two curves, then four, without end.',
  fragment: FRAGMENT,
  defaults,
  cameraDistanceRange: RANGE,
  paletteNames: ['Glow'],
  controlGroups: [
    group('Rule', `
      The state is a point (x, y). The new x is 1 − a·x² + y, and
      the new y is b times the old x. Michel Hénon chose it in
      1976 as the simplest rule he could find that does what
      Lorenz's weather equations do: stretch, fold, and squeeze.

      b is the squeeze: every step shrinks areas to b times what
      they were. a is the bend. With a small, the points settle
      on one place. As a grows that place splits into two, then
      four, and at Hénon's values, a = 1.4 and b = 0.3, they
      never settle.`, [
      slider('Bend, a', A, [0, 1.42], three),
      slider('Squeeze, b', B, [0, 0.35], three),
      readout('In the long run', state => verdict(longRun(start(state), state))),
      readout('Unmoved point', state => {
        const p = fixedPoint(state);
        if (!p) { return 'none'; }
        return `(${Format.number(p[0], 3)}, ${Format.number(p[1], 3)})`;
      }),
    ]),
    group('Picture', `
      Attractor: one point is followed for a very long time, and
      every place it visits is marked. Points says how many
      marks. When you zoom, more steps are taken until that many
      fall inside the view, up to three million.

      Stretch and fold: a disc of points, each keeping its own
      colour, is put through the rule a few times. One step
      bends the disc into a horseshoe and flattens it. The next
      bends the horseshoe. Neighbours are pulled apart along the
      curve while the whole stays in the same small region:
      that is how chaos fits in a box.

      First steps joins the first thirty hops from the chosen
      start, in pink.`, [
      picker('Show', PICTURE, ['Attractor', 'Stretch and fold']),
      slider('Points', COUNT_POWER, [0, 4.9], value => String(Math.round(10 ** value)),
        state => state.values[PICTURE] < 0.5),
      slider('Folds', FOLDS, [0, 8], value => value.toFixed(1), state => state.values[PICTURE] > 0.5),
      toggle('First steps', TRAIL),
    ]),
  ],
  viewNote: `
    Drag to move the picture and pinch to zoom. Double-tap a spot to dive
    toward it. A single tap chooses where the point starts. The picture
    is drawn two and a half times taller than it is, as Hénon drew it.`,
  tour,
  discreteValues: new Set([PICTURE, TRAIL]),
  cameraBacksAwayWhenMoving: false,
  drag: (state, probe, dx, dy) => pan(state, dx, dy),
  lines,
  pitchRange: [0, 0],
  flatFocus: true,
  zoomTarget: (viewPoint, state, factor) => dive(viewPoint, state, factor, RANGE),
  tap(state, viewPoint) {
    const point = fromScene(plane(viewPoint, state));
    state.values[START_X] = point[0];
    state.values[START_Y] = point[1];
  },
  urlDigits: 10,
  shelf: SHELF,
};
