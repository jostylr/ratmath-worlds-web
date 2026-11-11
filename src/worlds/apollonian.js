// The Apollonian gasket as the limit set of a group of circle inversions.
// This is Worlds/Flat/ApollonianWorld.swift, without its explorer; the
// tour's words are copied from it.
import { newState, copyState, keyframe, slider, toggle, group, Format } from './engine.js';
import { SHELF, YELLOW, dot, view, complex, scale, plane, lookDown, pan, dive } from './flat-support.js';
import { FRAGMENT } from './shaders/apollonian.js';

// Indices into the state's values.
const MIRROR_SCALE = 0;
const LIMIT = 1;
const SHOW_MIRRORS = 2;
const OUTLINES = 3;

const FARTHEST = 6.0;
const CLOSEST = 6.0 / 20000;

const defaults = lookDown(newState(), 2.7);
defaults.values[MIRROR_SCALE] = 1;
defaults.values[LIMIT] = 160;
defaults.values[OUTLINES] = 1;

/** The circle through three points, as [x, y, r]. */
function through(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  const a2 = a[0] ** 2 + a[1] ** 2;
  const b2 = b[0] ** 2 + b[1] ** 2;
  const c2 = c[0] ** 2 + c[1] ** 2;
  const x = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const y = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return [x, y, Math.hypot(a[0] - x, a[1] - y)];
}

/** The mirrors, through the points where three of the first circles touch;
    the fourth is the line y = 0, built into the shader. */
const MIRRORS = [
  through([0, 0], [-0.2, 0.4], [0.2, 0.4]),
  through([1, 0], [0, 1], [0.2, 0.4]),
  through([-1, 0], [0, 1], [-0.2, 0.4]),
];

function looking(base, x, y, distance) {
  const state = copyState(base);
  state.focus = [x, y, 0];
  state.cameraDistance = distance;
  return state;
}

// MARK: Guided tour

const tour = [
  {
    title: 'A circle in every gap',
    body: `
      Inside a circle sit three circles, each touching the other
      two and the outside. Between them are curved triangular gaps.
      Into each gap fits exactly one circle that touches all three of
      its sides.

      Fill them. That makes three new gaps for each one filled, and
      so on for ever. Apollonius of Perga studied circles touching
      three others about 200 BC; the picture of all of them at once
      is named after him.`,
    tryIt: 'Circles → Generations drawn',
    build(base) {
      const empty = copyState(base);
      empty.values[LIMIT] = 0;
      const full = copyState(base);
      full.values[LIMIT] = 40;
      return [keyframe(empty, 1.5, 1.5), keyframe(full, 16.0)];
    },
  },
  {
    title: 'Every curvature is a whole number',
    body: `
      Curvature is one over the radius. The outer circle has
      curvature −1 (negative, because it holds the rest inside), the
      two large circles 2 each, and the two next 3 each.

      In 1643 Descartes wrote to Princess Elisabeth of Bohemia that
      four circles touching in pairs obey (k₁ + k₂ + k₃ + k₄)² =
      2(k₁² + k₂² + k₃² + k₄²). So a new circle's curvature is
      2(k₁ + k₂ + k₃) − k₄, a whole number whenever the others are.
      Every circle here, down to the smallest, has a whole-number
      curvature: 6, 11, 14, 15, 18, 23, …`,
    build(base) {
      const state = looking(base, 0.25, 0.45, 1.4);
      state.palette = 1;
      return [keyframe(state, 4.0)];
    },
  },
  {
    title: 'One move, repeated',
    body: `
      The green circles are mirrors. Each passes through the three
      points where three of the first circles touch, and crosses
      those three at right angles. One mirror is a straight line.

      Inversion in a circle sends each point to the point on the same
      ray from the centre, at distance R² ⁄ d instead of d. Circles
      stay circles. Inverting in a mirror leaves the three circles it
      crosses in place and throws the fourth into the gap. The whole
      gasket is the first four circles seen in a hall of four mirrors.`,
    tryIt: 'Mirrors → Show the mirrors',
    build(base) {
      const state = copyState(base);
      state.values[SHOW_MIRRORS] = 1;
      return [keyframe(state, 3.0)];
    },
  },
  {
    title: 'No end to the circles',
    body: `
      Here we dive toward a point where two circles touch. On both
      sides the narrowing gaps are lined with circles touching
      circles, smaller and smaller toward the point of contact, and
      between any three of them the whole pattern starts again.

      The gasket has no area: the circles fill all of it. Yet the
      edge left over is more than a curve. Its dimension is about
      1.3057, between a line and a surface.`,
    tryIt: 'Double-tap a point where two circles touch',
    build(base) {
      const deep = copyState(base);
      deep.values[LIMIT] = 400;
      return [keyframe(looking(deep, -0.21, 0.42, 0.6), 5.0, 1.0), keyframe(looking(deep, -0.2, 0.4, 0.12), 10.0)];
    },
  },
  {
    title: 'Pull the mirrors apart',
    body: `
      The four mirrors no longer touch. The hall of mirrors still
      makes copies of the first circles, but now the copies do not
      touch: dark gaps open between them, and the places where they
      pile up, which were a lace of curves, break into a scatter of
      separate points, a dust.

      Groups made by inversions and other moves of circles are
      Kleinian groups, after Felix Klein. Their limit sets range
      from dust like this to the gasket and far stranger shapes, as
      in the book Indra's Pearls by Mumford, Series and Wright.`,
    tryIt: 'Mirrors → Mirror size, below 1',
    build(base) {
      const state = copyState(base);
      state.values[SHOW_MIRRORS] = 1;
      state.values[MIRROR_SCALE] = 0.86;
      return [keyframe(state, 8.0)];
    },
  },
  {
    title: 'Push them together',
    body: `
      Now the mirrors overlap. Each inversion undoes part of what the
      others did, the copies pile on top of one another, and the
      picture loses its tidiness.

      Only at exactly the size where the mirrors touch do the copies
      fit together edge to edge with nothing left over. The gasket is
      a knife-edge between dust and confusion.`,
    tryIt: 'Mirrors → Mirror size, above 1',
    build(base) {
      const state = copyState(base);
      state.values[SHOW_MIRRORS] = 1;
      state.values[MIRROR_SCALE] = 1.08;
      const back = copyState(base);
      back.values[SHOW_MIRRORS] = 1;
      return [keyframe(state, 6.0, 2.0), keyframe(back, 6.0)];
    },
  },
  {
    title: 'Your turn',
    body: `
      Dive toward any point of contact, change the number of
      generations drawn, and switch the colours between generations
      and families. Resize the mirrors slowly through 1 and watch the
      gasket come together and fall apart. Every group of controls
      has an ⓘ note.

      The address of this page always holds the view on screen, so a
      copied link brings anyone to the very same spot.`,
    build: base => [keyframe(base, 2.5)],
  },
];

// MARK: World

// MARK: Explorer

/** The four starting circles: curvatures −1, 2, 2 and 3. */
const STARTS = [[0, 0, 1], [-0.5, 0, 0.5], [0.5, 0, 0.5], [0, 2 / 3, 1 / 3]];
const START_NAMES = ['the unit circle', 'the left circle of radius ½', 'the right circle of radius ½', 'the circle of radius ⅓'];
const MIRROR_NAMES = ['the mirror of radius ¼', 'the right mirror', 'the left mirror', 'the line y = 0'];

/** Which starting circle a folded point lies in (0 means outside the unit
    circle), or −1 for none. */
function landing(q) {
  let best = 1 - Math.hypot(q[0], q[1]);
  let which = 0;
  for (let k = 1; k <= 3; k += 1) {
    const d = Math.hypot(q[0] - STARTS[k][0], q[1] - STARTS[k][1]) - STARTS[k][2];
    if (d < best) { best = d; which = k; }
  }
  return best <= 0 ? which : -1;
}

/** A point folded back until it lies outside every mirror: each step's
    point, mirror and the magnification so far. */
function fold(start, size, limit) {
  let p = [start[0], start[1]];
  let last = -1;
  let magnification = 1;
  const steps = [];
  for (let i = 0; i < limit; i += 1) {
    if (landing(p) >= 0) { return { steps, settled: true }; }
    let moved = false;
    if (p[1] < 0) {
      p = [p[0], -p[1]];
      last = 3;
      moved = true;
    } else {
      for (let m = 0; m < MIRRORS.length; m += 1) {
        if (m === last) { continue; }
        const [cx, cy, radius] = [MIRRORS[m][0], MIRRORS[m][1], MIRRORS[m][2] * size];
        const d = [p[0] - cx, p[1] - cy];
        const d2 = d[0] * d[0] + d[1] * d[1];
        if (d2 < radius * radius) {
          const k = radius * radius / Math.max(d2, 1e-300);
          p = [cx + d[0] * k, cy + d[1] * k];
          magnification *= k;
          last = m;
          moved = true;
          break;
        }
      }
    }
    if (!moved) { return { steps, settled: true }; }
    steps.push({ point: p, mirror: last, magnification });
  }
  return { steps, settled: false };
}

/** The image of a circle [x, y, radius] under inversion in a mirror, or
    reflection in the line y = 0 (mirror 3). */
function invertCircle(circle, mirror, size) {
  if (mirror === 3) { return [circle[0], -circle[1], circle[2]]; }
  const [cx, cy, radius] = [MIRRORS[mirror][0], MIRRORS[mirror][1], MIRRORS[mirror][2] * size];
  const d = [circle[0] - cx, circle[1] - cy];
  const power = d[0] * d[0] + d[1] * d[1] - circle[2] * circle[2];
  const r2 = radius * radius;
  return [cx + d[0] * (r2 / power), cy + d[1] * (r2 / power), r2 * circle[2] / Math.abs(power)];
}

/** What the explorer says about one point: ApollonianWorld.report in the app. */
function explorerReport(point, state) {
  const size = state.values[MIRROR_SCALE];
  const folded = fold(point, size, 400);
  const end = folded.steps.length ? folded.steps[folded.steps.length - 1].point : point;
  const rows = folded.steps.slice(0, 60).map((step, index) => ({
    id: index,
    cells: [String(index + 1), step.mirror === 3 ? 'line' : String(step.mirror), complex(step.point, 4)],
    workedTitle: `Fold ${index + 1}, worked`,
    worked: [
      ['in', MIRROR_NAMES[step.mirror]],
      ['the point becomes', complex(step.point, 6)],
      ['magnified so far', Format.significant(step.magnification, 4)],
    ],
    note: step.mirror === 3
      ? 'Reflection in the line y = 0: inversion in a circle so large it has become straight.'
      : 'Inversion in a circle of centre m and radius R sends a point at distance d from m to the point on the same ray at distance R² ⁄ d. Inside goes to outside, and the closer to m, the farther it is thrown.',
  }));
  const details = [];
  let headline;
  const which = landing(end);
  const exact = Math.abs(size - 1) < 1e-9;
  if (!folded.settled) {
    headline = 'On the gasket itself, or too close to it to tell';
    details.push('After 400 inversions the point is still inside a mirror. Points of the gasket\'s own dust never come out.');
  } else if (which < 0) {
    headline = 'In a gap the mirrors no longer close';
    details.push('With the mirrors shrunk, the circles no longer touch and gaps open between them. Points here are folded out of every mirror without landing in a circle.');
  } else {
    // Carry the starting circle back through the inversions, in reverse.
    let circle = STARTS[which];
    for (let i = folded.steps.length - 1; i >= 0; i -= 1) { circle = invertCircle(circle, folded.steps[i].mirror, size); }
    const curvature = which === 0 && folded.steps.length === 0 ? -1 : 1 / circle[2];
    headline = folded.steps.length === 0
      ? 'In one of the four first circles'
      : `In a circle of curvature ${exact ? Math.round(curvature) : curvature.toFixed(4)}, reached by ${folded.steps.length} inversions`;
    details.push(`It is a copy of ${START_NAMES[which]}.`);
    details.push(`Centre ${complex([circle[0], circle[1]], 6)}, radius ${Format.significant(circle[2], 6)}, so curvature 1 ⁄ r = ${curvature.toFixed(6)}.`);
    details.push(exact
      ? 'A whole number, as Descartes\'s rule promises: each new circle\'s curvature is 2(k₁ + k₂ + k₃) − k₄ from four circles already there.'
      : 'With the mirrors resized the group is no longer the gasket\'s, and curvatures stop being whole numbers.');
  }
  if (folded.steps.length > 60) { details.push(`The table shows the first 60 inversions of ${folded.steps.length}.`); }
  return {
    headline, details,
    tableTitle: folded.steps.length ? 'Inversions' : '',
    columns: folded.steps.length ? ['', 'mirror', 'point'] : [],
    rows,
    markers: [dot(view(point, state), YELLOW, 0.016)].filter(Boolean),
  };
}

const explorer = {
  title: 'Circle explorer',
  subtitle: 'Which circle, and how it was reached',
  buttonTitle: 'Circle explorer',
  blurb: 'The explorer takes a point, folds it back through the mirrors one inversion at a time, and then works out the circle it lies in: its centre, radius and whole-number curvature.',
  pointTitle: 'Point',
  coordinates: [{ label: 'x', range: [-1.2, 1.2] }, { label: 'y', range: [-1.2, 1.2] }],
  moveHint: 'Arrow keys move the point. Click or tap the picture to put it there.',
  initialProbe: () => [0.12, 0.83, 0, 0],
  report: (probe, state) => explorerReport([probe[0], probe[1]], state),
  move(probe, right, up, away, state) {
    const step = 0.02 * scale(state);
    return [probe[0] + right * step, probe[1] + up * step, 0, 0];
  },
  pick(viewPoint, state) {
    const point = plane(viewPoint, state);
    return [point[0], point[1], 0, 0];
  },
};

export const world = {
  id: 'apollonian',
  title: 'Apollonian gasket',
  formula: '(k₁ + k₂ + k₃ + k₄)² = 2(k₁² + k₂² + k₃² + k₄²)',
  summary: 'Fill a circle with circles: into every gap put the largest circle that fits, for ever. Every circle here has a whole number for its curvature, and the whole picture is made by one move, inversion in a circle, repeated.',
  fragment: FRAGMENT,
  defaults,
  cameraDistanceRange: [CLOSEST, FARTHEST],
  paletteNames: ['Generations', 'Families'],
  controlGroups: [
    group('Circles', `
      Four circles that each touch the other three leave curved
      triangular gaps. Into each gap fits exactly one circle that
      touches all three of its sides; that makes new gaps, and so on
      for ever. What is left when every gap has been filled is the
      Apollonian gasket.

      Here the four first circles have curvatures −1, 2, 2 and 3
      (curvature is one over the radius; the outer circle counts as
      negative because it holds the others inside it). Descartes's
      rule, (k₁ + k₂ + k₃ + k₄)² = 2(k₁² + k₂² + k₃² + k₄²), then
      makes every circle's curvature a whole number.`, [
      slider('Generations drawn', LIMIT, [0, 400], value => String(Math.round(value))),
      toggle('Outlines', OUTLINES),
    ]),
    group('Mirrors', `
      Through the three points where any three of the first circles
      touch passes a fourth circle, which crosses all three at right
      angles. There are four of these mirrors; one of them is the
      line y = 0.

      Inversion in a mirror swaps its inside and outside, and turns
      circles into circles. It leaves the three circles it crosses
      where they are, and throws the fourth into the gap. Every
      circle of the gasket is a first circle seen in a hall of these
      mirrors. At a mirror size of exactly 1 they touch and make the
      gasket; smaller, it falls into dust; larger, the copies overlap.`, [
      toggle('Show the mirrors', SHOW_MIRRORS),
      slider('Mirror size', MIRROR_SCALE, [0.7, 1.15], value => value.toFixed(3)),
    ]),
  ],
  viewNote: `
    Drag to move and pinch to zoom. Double-tap to dive toward a spot.
    Generations colours each circle by how many inversions it took to
    reach it; Families by which of the first circles it is a copy of.`,
  tour,
  explorer,
  shaderValues(state) {
    const scale = state.values[MIRROR_SCALE];
    const values = new Array(32).fill(0);
    values[0] = scale;
    values[1] = Math.round(Math.min(Math.max(state.values[LIMIT], 0), 400));
    values[2] = state.values[SHOW_MIRRORS] > 0.5 ? 1 : 0;
    values[3] = state.values[OUTLINES] > 0.5 ? 1 : 0;
    MIRRORS.forEach((m, i) => {
      values[4 + 4 * i] = m[0];
      values[5 + 4 * i] = m[1];
      values[6 + 4 * i] = m[2] * scale;
    });
    return values;
  },
  discreteValues: new Set([SHOW_MIRRORS, OUTLINES]),
  cameraBacksAwayWhenMoving: false,
  drag: (state, probe, dx, dy) => pan(state, dx, dy),
  tourKeepsPalette: false,
  pitchRange: [0, 0],
  flatFocus: true,
  zoomTarget: (viewPoint, state, factor) => dive(viewPoint, state, factor, world.cameraDistanceRange),
  urlDigits: 8,
  shelf: SHELF,
};
