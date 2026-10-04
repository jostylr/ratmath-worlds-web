// The logistic map: a one-line population rule whose long-run behaviour
// doubles its period again and again and then turns chaotic. The centre of
// the chapters on May and Feigenbaum in James Gleick's Chaos.
// This is Worlds/Flat/LogisticWorld.swift, without its explorer; the tour's
// words are copied from it.
import { newState, copyState, keyframe, slider, picker, toggle, readout, group } from './engine.js';
import { SHELF, sup } from './flat-support.js';
import { FRAGMENT } from './shaders/logistic.js';

// Indices into the state's values.
const R = 0;
const X0 = 1;
const PICTURE = 2;
const RULE = 3;
const STEPS = 4;
const SKIP = 5;
const TWIN = 6;
const GAP_POWER = 7;
const CENTRE_R = 8;
const CENTRE_X = 9;
const TALL = 10;

/** Steps left out when the run-in is skipped. */
const RUN_IN = 300;
/** How many values of each path the shader is sent. */
const PATH_CAPACITY = 208;

const CAMERA_DISTANCE_RANGE = [1.0 / 2000, 2.0];

const defaults = newState();
defaults.values[R] = 3.2;
defaults.values[X0] = 0.2;
defaults.values[STEPS] = 60;
defaults.values[GAP_POWER] = 6;
defaults.values[CENTRE_R] = 3.3;
defaults.values[CENTRE_X] = 0.5;
defaults.values[TALL] = 1;
defaults.cameraDistance = 1;

const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);

// MARK: Reading the state

const pictureIndex = state => Math.round(state.values[PICTURE]);
const isSine = state => state.values[RULE] > 0.5;
const stepCount = state => Math.round(clamp(state.values[STEPS], 5, 200));
const gap = state => Math.pow(10, -Math.round(state.values[GAP_POWER]));
const rPerUnit = state => 0.72 * state.cameraDistance;
const xPerUnit = state => 0.56 * state.cameraDistance / clamp(state.values[TALL], 0.1, 20);
/** Plot units per view unit in the cobweb picture. */
const cobwebUnit = state => 0.72 * state.cameraDistance;

/** A round spacing for grid lines that puts about six across `width`. */
function gridSpacing(width) {
  const rough = Math.max(width, 1e-9) / 6;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const lead = rough / power;
  return power * (lead < 1.5 ? 1 : (lead < 3.5 ? 2 : (lead < 7.5 ? 5 : 10)));
}

const grid = state => ({ r: gridSpacing(2.6 * rPerUnit(state)), x: gridSpacing(2.0 * xPerUnit(state)) });

// MARK: The rule

const next = (x, r, sine) => (sine ? 0.25 * r * Math.sin(Math.PI * x) : r * x * (1 - x));

const slope = (x, r, sine) => (sine ? 0.25 * r * Math.PI * Math.cos(Math.PI * x) : r * (1 - 2 * x));

/** The values shown: from the start, or from after the run-in. */
function path(state, start) {
  const r = state.values[R];
  const sine = isSine(state);
  let x = start;
  if (state.values[SKIP] > 0.5) {
    for (let i = 0; i < RUN_IN; i += 1) { x = next(x, r, sine); }
  }
  const values = [x];
  for (let i = 0, count = stepCount(state); i < count; i += 1) {
    x = next(x, r, sine);
    values.push(x);
  }
  return values;
}

/** The number of the first value shown. */
const firstIndex = state => (state.values[SKIP] > 0.5 ? RUN_IN : 0);

/**
 * Where the rule ends up. `cycle` is the values of the cycle it settles
 * into, or null if it does not; `exponent` is the average of log |slope|
 * along the path: how fast neighbours close up (negative) or separate
 * (positive), per step.
 */
function longRun(state) {
  const r = state.values[R];
  const sine = isSine(state);
  let x = clamp(state.values[X0], 0, 1);
  for (let i = 0; i < 4000; i += 1) { x = next(x, r, sine); }
  const values = [];
  let total = 0;
  for (let i = 0; i < 2048; i += 1) {
    x = next(x, r, sine);
    values.push(x);
    total += Math.log(Math.max(Math.abs(slope(x, r, sine)), 1e-12));
  }
  const exponent = total / values.length;
  const last = values.length - 1;
  for (let period = 1; period <= 512; period += 1) {
    if (Math.abs(values[last] - values[last - period]) < 1e-9) {
      return { cycle: values.slice(last - period + 1, last + 1).sort((a, b) => a - b), exponent };
    }
  }
  return { cycle: null, exponent };
}

function verdict(run) {
  if (run.cycle) {
    return run.cycle.length === 1 ? 'settles on one value' : `a cycle of ${run.cycle.length}`;
  }
  return run.exponent > 0.005 ? 'chaos: never repeats' : 'still settling';
}

// MARK: What the shader is sent

/** Both paths, packed where other worlds put their markers. */
function pathData(state) {
  const start = clamp(state.values[X0], 0, 1);
  const main = path(state, start);
  const other = path(state, Math.min(start + gap(state), 1));
  const numbers = new Array(2 * PATH_CAPACITY).fill(0);
  main.slice(0, PATH_CAPACITY).forEach((value, index) => { numbers[index] = value; });
  other.slice(0, PATH_CAPACITY).forEach((value, index) => { numbers[PATH_CAPACITY + index] = value; });
  const markers = [];
  for (let at = 0; at < numbers.length; at += 8) {
    markers.push({ raw: [numbers.slice(at, at + 4), numbers.slice(at + 4, at + 8)] });
  }
  return markers;
}

// MARK: The numbers along the edges of the pictures

/** Where a view point (see Camera.viewPoint) lies on screen. */
function screen(u, v, size) {
  const aspect = size.width / size.height;
  const fit = Math.min(aspect, 1);
  return {
    x: (u * fit / aspect + 1) / 2 * size.width,
    y: (1 - (v + size.verticalShift) * fit) / 2 * size.height,
  };
}

const tick = (value, spacing) => value.toFixed(Math.max(0, Math.ceil(-Math.log10(spacing))));

function labels(state, size) {
  if (!(size.width > 0 && size.height > 0)) { return []; }
  const v = state.values;
  const aspect = size.width / size.height;
  const extent = { x: aspect / Math.min(aspect, 1), y: 1 / Math.min(aspect, 1) };
  const out = [];

  switch (pictureIndex(state)) {
    case 0: {
      const spacing = grid(state);
      const perR = rPerUnit(state);
      const perX = xPerUnit(state);
      // r along the foot of the diagram, or the foot of the view.
      const foot = Math.min(Math.max(screen(0, (0 - v[CENTRE_X]) / perX, size).y + 12, 90), size.height - 110);
      const lowR = v[CENTRE_R] - extent.x * perR;
      const highR = v[CENTRE_R] + extent.x * perR;
      let value = Math.ceil(lowR / spacing.r) * spacing.r;
      while (value <= highR && out.length < 40) {
        if (value > -1e-9 && value < 4 + 1e-9) {
          const x = screen((value - v[CENTRE_R]) / perR, 0, size).x;
          out.push({ text: (out.length === 0 ? 'r = ' : '') + tick(value, spacing.r), x: Math.max(x, 30), y: foot });
        }
        value += spacing.r;
      }
      const lowX = v[CENTRE_X] - (extent.y + size.verticalShift) * perX;
      const highX = v[CENTRE_X] + extent.y * perX;
      value = Math.ceil(lowX / spacing.x) * spacing.x;
      let first = true;
      while (value <= highX && out.length < 80) {
        if (value > -1e-9 && value < 1 + 1e-9) {
          const y = screen(0, (value - v[CENTRE_X]) / perX, size).y;
          if (y > 80 && y < size.height - 60 && Math.abs(y - foot) > 14) {
            out.push({ text: (first ? 'x = ' : '') + tick(value, spacing.x), x: first ? 34 : 24, y });
            first = false;
          }
        }
        value += spacing.x;
      }
      break;
    }
    case 1: {
      const unit = cobwebUnit(state);
      const plot = (x, y) => screen((x - 0.5) / unit, (y - 0.5) / unit, size);
      const origin = plot(0, 0);
      const corner = plot(1, 1);
      out.push(
        { text: '0', x: origin.x + 6, y: origin.y + 12 },
        { text: '1', x: corner.x - 6, y: origin.y + 12 },
        { text: '1', x: origin.x + 10, y: corner.y + 12 },
        { text: 'this year, xₙ', x: (origin.x + corner.x) / 2, y: origin.y + 12 },
        { text: 'next year, xₙ₊₁', x: (origin.x + corner.x) / 2, y: corner.y + 12 },
      );
      break;
    }
    default: {
      const halfWidth = 0.88 * extent.x;
      const halfHeight = 0.50;
      const left = screen(-halfWidth, 0, size).x;
      const right = screen(halfWidth, 0, size).x;
      const top = screen(0, halfHeight, size).y;
      const bottom = screen(0, -halfHeight, size).y;
      const first = firstIndex(state);
      out.push(
        { text: 'x = 1', x: left + 24, y: top + 12 },
        { text: 'x = 0', x: left + 24, y: bottom - 12 },
        { text: `year ${first}`, x: left + 26, y: bottom + 14 },
        { text: `year ${first + stepCount(state)}`, x: right - 30, y: bottom + 14 },
      );
      break;
    }
  }
  return out;
}

// MARK: Guided tour

function showing(base, picture, growth, start = 0.2) {
  const state = copyState(base);
  state.values[PICTURE] = picture;
  state.values[R] = growth;
  state.values[X0] = start;
  return state;
}

function diagram(base, growth, centre, zoom, stretch = 1) {
  const state = showing(base, 0, growth);
  state.values[CENTRE_R] = centre[0];
  state.values[CENTRE_X] = centre[1];
  state.values[TALL] = stretch;
  state.cameraDistance = 1 / zoom;
  return state;
}

const tour = [
  {
    title: 'Next year\'s fish',
    body: `
      A pond holds some fraction x of the fish it could. Next year's
      fraction is r·x·(1 − x): more fish breed more, but crowding
      holds them back. The number r says how strongly they breed.

      These are the values year by year, with r = 2.6. Whatever the
      start, the population wobbles and then settles on one steady
      value. Nothing surprising yet.`,
    tryIt: 'Rule → Growth and Start; drag sideways to change r',
    build: base => [
      keyframe(showing(base, 2, 2.6, 0.1), 2.0, 3.0),
      keyframe(showing(base, 2, 2.6, 0.85), 4.0),
    ],
  },
  {
    title: 'The same thing as a cobweb',
    body: `
      The curve is the rule: above each x is next year's x. The
      straight line is where next year equals this year. From the
      yellow dot, go up to the curve to find next year, across to the
      line to make it this year, and again.

      The steps spiral in to the point where the curve crosses the
      line: the steady population. It pulls everything in because the
      curve crosses the line there at a gentle slope.`,
    tryIt: 'Picture → Show → Cobweb; tap to move the start',
    build: base => [
      keyframe(showing(base, 1, 2.6, 0.1), 2.0, 3.0),
      keyframe(showing(base, 1, 2.6, 0.85), 4.0),
    ],
  },
  {
    title: 'Past 3, it cannot settle',
    body: `
      As r grows the hump grows taller and crosses the line more
      steeply. At r = 3 the crossing becomes steeper than the line
      itself, and from then on the steady value pushes neighbours
      away where it used to pull them in.

      The population has nowhere to settle, and ends up alternating:
      a good year, a bad year, for ever. The cobweb closes up into a
      square. The steady value is still there, in the middle of the
      square, but nothing ever reaches it.`,
    tryIt: 'Drag sideways across the cobweb',
    build(base) {
      const state = showing(base, 1, 2.7);
      state.values[STEPS] = 90;
      const after = copyState(state);
      after.values[R] = 3.3;
      return [keyframe(state, 2.0, 1.5), keyframe(after, 10.0)];
    },
  },
  {
    title: 'Two, four, eight',
    body: `
      Here the run-in is hidden, so only the lasting pattern shows.
      At r = 3.2 it is one square: two values. Raise r and each of
      the two splits in turn. By 3.5 the population repeats every
      four years, and by 3.56 every eight.

      Each doubling arrives sooner than the last. The first took all
      the way from 1 to 3; the next comes at 3.449, the next at
      3.544, the next at 3.564.`,
    tryIt: 'Picture → Skip the first 300',
    build(base) {
      const state = showing(base, 1, 3.2);
      state.values[SKIP] = 1;
      state.values[STEPS] = 64;
      const four = copyState(state);
      four.values[R] = 3.5;
      const eight = copyState(state);
      eight.values[R] = 3.56;
      return [keyframe(state, 2.0, 2.5), keyframe(four, 6.0, 2.5), keyframe(eight, 4.0)];
    },
  },
  {
    title: 'Every r at once',
    body: `
      This is the same information for every r together. Across is r.
      Above each r are marked the values the population keeps
      visiting once it has settled down.

      On the left one line: a steady population. At 3 it forks into
      two, then four, then eight, and then the forks come too fast
      to see and the picture turns to smear: for those r the
      population never repeats at all. The yellow line is the r of
      the last stop.`,
    tryIt: 'Picture → Show → Diagram; tap to choose r',
    build: base => [keyframe(diagram(base, 3.56, [3.3, 0.5], 1), 2.5)],
  },
  {
    title: 'Feigenbaum\'s number',
    body: `
      Closer in on the forks. Measure from each fork to the next:
      0.4495, then 0.0946, then 0.0203, then 0.0044. Each gap is the
      one before divided by about 4.669.

      Mitchell Feigenbaum found that ratio in 1975 on a pocket
      calculator, and then found the same ratio for a quite
      different rule. The picture changes now to the sine rule: the
      same forks, shrinking at the same rate. The number belongs to
      period doubling itself, and it has since been measured in
      real fluids and circuits.`,
    tryIt: 'Rule → Rule; and see Period doubling',
    build(base) {
      const wide = diagram(base, 3.56, [3.3, 0.5], 1);
      const close = diagram(base, 3.5699, [3.5, 0.6], 4, 0.3);
      const sine = diagram(base, 3.46, [3.3, 0.6], 2.2, 0.55);
      sine.values[RULE] = 1;
      return [keyframe(wide, 1.0), keyframe(close, 6.0, 6.0), keyframe(sine, 3.0)];
    },
  },
  {
    title: 'Chaos: the same rule, no pattern',
    body: `
      At r = 3.9 the values never repeat. Nothing random has been
      added: it is the same line of arithmetic every year.

      The pink path starts one millionth away from the blue. For
      twenty years they cannot be told apart. By thirty-five they
      have nothing to do with each other. Each step multiplies the
      gap by about 1.6 on average, and twenty-eight of those turn a
      millionth into one. A rule can be exact and its future still
      be unknowable, because no start is ever measured exactly.`,
    tryIt: 'Picture → Values in order → Twin and Gap',
    build(base) {
      const state = showing(base, 2, 3.9, 0.2);
      state.values[TWIN] = 1;
      state.values[GAP_POWER] = 6;
      state.values[STEPS] = 70;
      return [keyframe(state, 2.5)];
    },
  },
  {
    title: 'Order inside the chaos',
    body: `
      The smear is not solid. It has clear stripes, and the widest is
      near r = 3.83, where out of the chaos comes a tidy cycle of
      three. The colours now show which is which: blue where nearby
      starts close up, amber where they are driven apart.

      In 1975 Li and Yorke proved that a rule of this kind with a
      cycle of three has cycles of every other length too, and gave
      the subject its name in the title: Period Three Implies Chaos.`,
    tryIt: 'View → Colour → Order and chaos',
    build(base) {
      const wide = diagram(base, 3.835, [3.3, 0.5], 1);
      wide.palette = 1;
      const close = diagram(base, 3.835, [3.84, 0.5], 9, 0.11);
      close.palette = 1;
      return [keyframe(wide, 1.5, 1.5), keyframe(close, 7.0)];
    },
  },
  {
    title: 'The whole diagram, again',
    body: `
      Inside that stripe, follow the middle one of the three lines.
      It forks into two, then four, then eight, then smears, with
      stripes of its own: a small, squashed copy of the entire
      diagram, doublings and all, at Feigenbaum's rate.

      Its stripes contain copies too. Like the Mandelbrot set's
      border, the diagram has no smallest detail. They are in fact
      the same object: this diagram is what the Mandelbrot set looks
      like along its horizontal axis.`,
    tryIt: 'Double-tap to dive; Picture → Height stretch',
    build(base) {
      const close = diagram(base, 3.835, [3.84, 0.5], 9, 0.11);
      close.palette = 1;
      const copy = diagram(base, 3.835, [3.845, 0.5], 30, 0.3);
      copy.palette = 1;
      return [keyframe(close, 1.5, 1.0), keyframe(copy, 8.0)];
    },
  },
  {
    title: 'Your turn',
    body: `
      Tap the diagram to choose r, then switch to the cobweb or the
      values in order to see what that r does. Drag sideways on
      those to change r by hand, and find the place where two
      becomes four. Every group of controls has an ⓘ button with a
      short note.

      The address of this page always holds the view on screen, so a
      copied link brings anyone to the very same spot.`,
    build: base => [keyframe(base, 2.5)],
  },
];

// MARK: World

export const world = {
  id: 'logistic',
  title: 'Logistic map',
  formula: 'xₙ₊₁ = r·xₙ·(1 − xₙ)',
  summary: 'A one-line rule for next year\'s population. Turn one knob and it settles, then alternates between two values, then four, then eight, faster and faster, into chaos. The road there is the same for every rule of its kind.',
  fragment: FRAGMENT,
  defaults,
  cameraDistanceRange: CAMERA_DISTANCE_RANGE,
  paletteNames: ['Chalk', 'Order and chaos'],
  shelf: SHELF,
  urlDigits: 10,
  controlGroups: [
    group('Rule', `
      x is a population, as a fraction of the most the land can
      hold, so it lies between 0 and 1. Next year's is r·x·(1 − x):
      r·x is growth, and (1 − x) is the crowding that holds it
      back. Robert May urged in 1976 that everyone should play
      with this rule on a calculator, because nothing so simple
      was expected to behave like this.

      The sine rule, x → (r ⁄ 4)·sin(πx), is a different hump of
      the same height. Mitchell Feigenbaum found that it goes
      through the same doublings at the same shrinking rate: the
      details of the rule do not matter, only that it has one
      smooth hump.`, [
      slider('Growth, r', R, [0, 4], value => value.toFixed(4)),
      slider('Start, x₀', X0, [0, 1], value => value.toFixed(4)),
      picker('Rule', RULE, ['r·x·(1 − x)', '(r ⁄ 4)·sin πx']),
      readout('In the long run', state => verdict(longRun(state))),
      readout('Stretch per step', state => {
        const exponent = longRun(state).exponent;
        return `e^${exponent.toFixed(3)} = ${Math.exp(exponent).toFixed(3)}`;
      }),
    ]),
    group('Picture', `
      Diagram: for every r across the picture, the rule is run
      for hundreds of steps to let it settle, and then every
      value it visits is marked. One line means it settled; two
      means it alternates; a smear means it never repeats. The
      yellow line is the r in use.

      Cobweb: the curve is the rule and the straight line is
      next = this. Go up to the curve to find the next value,
      across to the line to make it the current one, and repeat.

      Values in order: the same numbers, one after another. Twin
      adds a second start, a tiny Gap away, in pink.`, [
      picker('Show', PICTURE, ['Diagram', 'Cobweb', 'Values in order']),
      slider('Steps shown', STEPS, [5, 200], value => String(Math.round(value)),
        state => pictureIndex(state) !== 0),
      { ...toggle(`Skip the first ${RUN_IN}`, SKIP), visible: state => pictureIndex(state) !== 0 },
      { ...toggle('Twin', TWIN), visible: state => pictureIndex(state) === 2 },
      slider('Gap', GAP_POWER, [2, 12], value => `10⁻${sup(Math.round(value))}`,
        state => pictureIndex(state) === 2 && state.values[TWIN] > 0.5),
      slider('Height stretch', TALL, [0.1, 8], value => value.toFixed(2) + '×',
        state => pictureIndex(state) === 0),
    ]),
    group('Period doubling', `
      These are the values of r at which the logistic rule's
      cycle doubles. Each gap is shorter than the one before by a
      ratio that closes in on 4.669201…, Feigenbaum's constant.
      Because the gaps shrink like that, infinitely many
      doublings fit before r = 3.569946, where chaos begins.

      The same constant turns up for the sine rule, and in real
      experiments: dripping taps, convecting fluid, electronic
      circuits. It is a number like π, belonging to no one
      system.`, [
      readout('1 → 2', () => 'r = 3'),
      readout('2 → 4', () => '3.449490'),
      readout('4 → 8', () => '3.544090'),
      readout('8 → 16', () => '3.564407'),
      readout('16 → 32', () => '3.568759'),
      readout('Gap ratios', () => '4.751, 4.656, 4.668'),
    ]),
  ],
  viewNote: `
    On the diagram, drag to move, pinch to zoom, double-tap to dive in,
    and tap to choose r. Height stretch magnifies up and down only,
    because the diagram's small copies are squashed. On the other two
    pictures, drag left and right to change r, and tap the cobweb to
    choose where it starts.`,
  tour,
  shaderValues(state, probe, row) {
    const spacing = grid(state);
    const values = new Array(32).fill(0);
    values[0] = state.values[R];
    values[1] = pictureIndex(state);
    values[2] = isSine(state) ? 1 : 0;
    values[3] = 1 / state.cameraDistance;
    values[4] = state.values[CENTRE_R];
    values[5] = state.values[CENTRE_X];
    values[6] = rPerUnit(state);
    values[7] = xPerUnit(state);
    values[8] = stepCount(state);
    values[9] = state.values[SKIP] > 0.5 ? 1 : 0;
    values[10] = state.values[TWIN] > 0.5 ? 1 : 0;
    // The step selected in the app's explorer; there is none here.
    values[11] = probe == null ? -1 : row;
    values[12] = spacing.r;
    values[13] = spacing.x;
    return values;
  },
  discreteValues: new Set([PICTURE, RULE, SKIP, TWIN, GAP_POWER]),
  cameraBacksAwayWhenMoving: false,
  drag(state, probe, dx, dy) {
    if (pictureIndex(state) === 0) {
      state.values[CENTRE_R] -= dx * rPerUnit(state);
      state.values[CENTRE_X] += dy * xPerUnit(state);
    } else {
      state.values[R] = clamp(state.values[R] + dx * 0.25, 0, 4);
    }
  },
  resetView(state) {
    state.values[CENTRE_R] = defaults.values[CENTRE_R];
    state.values[CENTRE_X] = defaults.values[CENTRE_X];
    state.values[TALL] = 1;
  },
  overlayMarkers: pathData,
  tourKeepsPalette: false,
  flatCentre: [CENTRE_R, CENTRE_X],
  zoomTarget(viewPoint, state, factor) {
    if (pictureIndex(state) !== 0) { return null; }
    const target = copyState(state);
    target.cameraDistance = clamp(state.cameraDistance / factor, ...CAMERA_DISTANCE_RANGE);
    const ratio = target.cameraDistance / state.cameraDistance;
    target.values[CENTRE_R] += viewPoint[0] * rPerUnit(state) * (1 - ratio);
    target.values[CENTRE_X] += viewPoint[1] * xPerUnit(state) * (1 - ratio);
    return target;
  },
  tap(state, viewPoint) {
    switch (pictureIndex(state)) {
      case 0: {
        const chosen = state.values[CENTRE_R] + viewPoint[0] * rPerUnit(state);
        if (chosen >= 0 && chosen <= 4) { state.values[R] = chosen; }
        break;
      }
      case 1: {
        const chosen = 0.5 + viewPoint[0] * cobwebUnit(state);
        if (chosen >= 0 && chosen <= 1) { state.values[X0] = chosen; }
        break;
      }
      default:
        break;
    }
  },
  labels,
};
