// Geodesics, the straightest possible curves, on a sphere, a torus and a
// saddle. This is Worlds/Geodesics/GeodesicWorld.swift, without its
// explorer; the tour's words are copied from it.
import { newState, copyState, keyframe, slider, picker, toggle, readout, group } from './engine.js';
import { FRAGMENT } from './shaders/geodesics.js';

// Indices into the state's values.
const SURFACE = 0;
const START_A = 1;
const START_B = 2;
const HEADING = 3;
const LENGTH = 4;
const TWIN = 5;
const TWIN_GAP = 6;
const GRID = 7;
const TRIANGLE = 8;

const RADIUS = 1.0;
const TUBE = 0.42;
const HALF = 1.3;

const defaults = newState();
defaults.values[START_A] = 0.5;
defaults.values[START_B] = 0.1;
defaults.values[HEADING] = 0.6;
defaults.values[LENGTH] = 6.3;
defaults.values[TWIN_GAP] = 0.25;
defaults.values[GRID] = 1;
defaults.yaw = 0.94;
defaults.pitch = -0.3;
defaults.cameraDistance = 3.6;
defaults.focus = [0, 0, 0];

// MARK: Vectors

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => { const l = Math.hypot(...a); return l > 1e-12 ? mul(a, 1 / l) : a; };

const kind = state => Math.min(Math.max(Math.round(state.values[SURFACE]), 0), 2);

// MARK: The surfaces, as F(x) = 0

function value(x, s) {
  if (s === 0) { return dot(x, x) - RADIUS * RADIUS; }
  if (s === 1) {
    const q = Math.hypot(x[0], x[2]);
    return (q - RADIUS) ** 2 + x[1] ** 2 - TUBE * TUBE;
  }
  return x[1] - 0.5 * (x[0] * x[0] - x[2] * x[2]);
}

function gradient(x, s) {
  if (s === 0) { return mul(x, 2); }
  if (s === 1) {
    const q = Math.max(Math.hypot(x[0], x[2]), 1e-9);
    const f = 2 * (q - RADIUS) / q;
    return [f * x[0], 2 * x[1], f * x[2]];
  }
  return [-x[0], 1, x[2]];
}

function curving(x, v, s) {
  if (s === 0) { return 2 * dot(v, v); }
  if (s === 2) { return -v[0] * v[0] + v[2] * v[2]; }
  const e = 1e-5;
  return dot(v, mul(sub(gradient(add(x, mul(v, e)), s), gradient(sub(x, mul(v, e)), s)), 1 / (2 * e)));
}

function curvature(x, s) {
  if (s === 0) { return 1 / (RADIUS * RADIUS); }
  if (s === 1) {
    const cosV = (Math.hypot(x[0], x[2]) - RADIUS) / TUBE;
    return cosV / (TUBE * (RADIUS + TUBE * cosV));
  }
  const w = 1 + x[0] * x[0] + x[2] * x[2];
  return -1 / (w * w);
}

function project(x, s) {
  let p = x;
  for (let i = 0; i < 4; i += 1) {
    const g = gradient(p, s);
    p = sub(p, mul(g, value(p, s) / Math.max(dot(g, g), 1e-12)));
  }
  return p;
}

function tangent(v, x, s) {
  const n = norm(gradient(x, s));
  return norm(sub(v, mul(n, dot(v, n))));
}

function acceleration(x, v, s) {
  const g = gradient(x, s);
  return mul(g, -curving(x, v, s) / Math.max(dot(g, g), 1e-12));
}

const inside = (x, s) => s !== 2 || (Math.abs(x[0]) <= HALF && Math.abs(x[2]) <= HALF);

/** A geodesic, by Runge–Kutta steps, each put back on the surface. */
function walk(x0, v0, length, s, h = 0.01) {
  let x = project(x0, s);
  let v = tangent(v0, x, s);
  const points = [x];
  for (let travelled = 0; travelled < length; travelled += h) {
    const k1x = v; const k1v = acceleration(x, v, s);
    const k2x = add(v, mul(k1v, h / 2)); const k2v = acceleration(add(x, mul(k1x, h / 2)), k2x, s);
    const k3x = add(v, mul(k2v, h / 2)); const k3v = acceleration(add(x, mul(k2x, h / 2)), k3x, s);
    const k4x = add(v, mul(k3v, h)); const k4v = acceleration(add(x, mul(k3x, h)), k4x, s);
    x = add(x, mul(add(add(k1x, mul(k2x, 2)), add(mul(k3x, 2), k4x)), h / 6));
    v = add(v, mul(add(add(k1v, mul(k2v, 2)), add(mul(k3v, 2), k4v)), h / 6));
    x = project(x, s);
    v = tangent(v, x, s);
    if (!inside(x, s)) { break; }
    points.push(x);
  }
  return points;
}

function place(a, b, s) {
  if (s === 0) {
    const lat = (a - 0.5) * Math.PI * 0.98;
    const lon = b * 2 * Math.PI;
    return {
      point: mul([Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)], RADIUS),
      east: [-Math.sin(lon), 0, Math.cos(lon)],
      north: [-Math.sin(lat) * Math.cos(lon), Math.cos(lat), -Math.sin(lat) * Math.sin(lon)],
    };
  }
  if (s === 1) {
    const u = b * 2 * Math.PI;
    const v = a * 2 * Math.PI;
    return {
      point: [(RADIUS + TUBE * Math.cos(v)) * Math.cos(u), TUBE * Math.sin(v), (RADIUS + TUBE * Math.cos(v)) * Math.sin(u)],
      east: [-Math.sin(u), 0, Math.cos(u)],
      north: [-Math.sin(v) * Math.cos(u), Math.cos(v), -Math.sin(v) * Math.sin(u)],
    };
  }
  const x = (b - 0.5) * 2 * HALF * 0.95;
  const z = (a - 0.5) * 2 * HALF * 0.95;
  const east = norm([1, x, 0]);
  let north = [0, -z, 1];
  north = norm(sub(north, mul(east, dot(north, east))));
  return { point: [x, 0.5 * (x * x - z * z), z], east, north };
}

function paths(state) {
  const s = kind(state);
  const start = place(state.values[START_A], state.values[START_B], s);
  const h = state.values[HEADING];
  const direction = add(mul(start.east, Math.cos(h)), mul(start.north, Math.sin(h)));
  const length = Math.min(Math.max(state.values[LENGTH], 0), 40);
  const main = walk(start.point, direction, length, s);
  let twin = [];
  if (state.values[TWIN] > 0.5) {
    const side = add(mul(start.east, -Math.sin(h)), mul(start.north, Math.cos(h)));
    const beside = walk(start.point, side, state.values[TWIN_GAP], s);
    const other = beside[beside.length - 1];
    twin = walk(other, tangent(direction, other, s), length, s);
  }
  let triangle = [];
  if (state.values[TRIANGLE] > 0.5 && s === 0) {
    triangle = [
      walk([0, 1, 0], [1, 0, 0], Math.PI / 2, s),
      walk([1, 0, 0], [0, 0, 1], Math.PI / 2, s),
      walk([0, 0, 1], [0, 1, 0], Math.PI / 2, s),
    ];
  }
  return { main, twin, triangle };
}

let cache = { key: '', table: new Float32Array(4) };

/** The table for the shader: every few points, at most 1200 in all. */
function table(state) {
  const key = state.values.slice(0, 9).join(',');
  if (key === cache.key) { return cache.table; }
  const p = paths(state);
  const rows = [];
  const addPath = (points, id, budget) => {
    if (!points.length) { return; }
    const stride = Math.max(1, Math.floor(points.length / budget));
    for (let i = 0; i < points.length; i += stride) { rows.push(...points[i], id); }
    if ((points.length - 1) % stride !== 0) { rows.push(...points[points.length - 1], id); }
  };
  addPath(p.main, 0, 500);
  addPath(p.twin, 1, 400);
  for (const side of p.triangle) { addPath(side, 2, 100); }
  if (!rows.length) { rows.push(0, 0, 0, -1); }
  cache = { key, table: new Float32Array(rows) };
  return cache.table;
}

function setup(base, s, a, b, h, l, twin, yaw, pitch, distance = 3.6) {
  const state = copyState(base);
  state.values[SURFACE] = s;
  state.values[START_A] = a;
  state.values[START_B] = b;
  state.values[HEADING] = h;
  state.values[LENGTH] = l;
  state.values[TWIN] = twin ? 1 : 0;
  state.yaw = yaw;
  state.pitch = pitch;
  state.cameraDistance = distance;
  return state;
}

// MARK: Guided tour

const tour = [
  {
    title: 'Straight ahead on a ball',
    body: `
      A walker sets off from the yellow dot and never turns. On a
      ball the path is a great circle, like the equator tipped over,
      and after 2π units it is back where it started, heading the
      same way.

      Nothing about the walk is curved from the walker's point of
      view. These are the straight lines of the sphere: geodesics,
      the paths aircraft fly between cities.`,
    tryIt: 'The walk → Heading and Length',
    build: base => [keyframe(setup(base, 0, 0.5, 0.1, 0.6, 0, false, 0.94, -0.3), 1.5, 1.0), keyframe(setup(base, 0, 0.5, 0.1, 0.6, 6.3, false, 1.7, 0.15), 10.0)],
  },
  {
    title: 'Parallel lines meet',
    body: `
      Two walkers stand on the equator a short way apart and both
      set off due north, side by side. In a flat field they would
      stay the same distance apart for ever.

      Here they drift together without either turning, and meet at
      the north pole. This is what positive curvature means: straight
      lines that start parallel close in on each other.`,
    tryIt: 'Parallel walkers → Second walker',
    build: base => [keyframe(setup(base, 0, 0.5, 0.12, Math.PI / 2, 0, true, 0.82, -0.35), 2.0, 1.0), keyframe(setup(base, 0, 0.5, 0.12, Math.PI / 2, 1.6, true, 0.82, -0.75), 9.0)],
  },
  {
    title: 'On a saddle they part',
    body: `
      The same two walkers on a saddle, which curves up in one
      direction and down in the other. Now they drift apart, faster
      and faster, though neither turns.

      Negative curvature makes room: it is the curvature of the
      hyperbolic plane, where through a point beside a line run many
      lines that never meet it.`,
    tryIt: 'Surface → Saddle',
    build: base => [keyframe(setup(base, 2, 0.5, 0.12, 0.08, 0, true, 0.4, -0.75), 2.0, 1.0), keyframe(setup(base, 2, 0.5, 0.12, 0.08, 2.5, true, 0.6, -0.9), 9.0)],
  },
  {
    title: 'A torus has both',
    body: `
      Round the outside a torus curves like a ball; round the inside
      of its hole, like a saddle. A walker crosses both, drawn
      together on the warm side and spread apart on the cool.

      This walk winds round and round and never quite closes,
      filling more and more of a band of the surface the longer it
      goes.`,
    tryIt: 'The walk → Length',
    build: base => [keyframe(setup(base, 1, 0.1, 0.0, 0.45, 0, false, 0.3, 0.7, 4.2), 2.0, 1.0), keyframe(setup(base, 1, 0.1, 0.0, 0.45, 30, false, 1.4, 0.8, 4.2), 16.0)],
  },
  {
    title: 'A triangle with three right angles',
    body: `
      From the north pole walk straight down to the equator, turn
      left a right angle, walk a quarter of the way round, turn left
      again and walk back up. Three right angles: 270°.

      Gauss and Bonnet proved that a geodesic triangle's angles add
      up to 180° plus the curvature inside it, counted over its area.
      This one covers an eighth of the sphere: π ⁄ 2 of curvature, the
      extra 90°. On a saddle, triangles fall short of 180°.`,
    tryIt: 'A triangle → Show the triangle (sphere)',
    build(base) {
      const state = setup(base, 0, 0.5, 0.1, 0.6, 0, false, 0.785, -0.62);
      state.values[TRIANGLE] = 1;
      return [keyframe(state, 4.0)];
    },
  },
  {
    title: 'Curvature you can measure from inside',
    body: `
      Every measurement in this tour could be made by someone who
      never leaves the surface: whether parallel walkers meet, what a
      triangle's angles add up to. In 1827 Gauss proved that his
      curvature K is decided by such measurements alone. He called
      it his remarkable theorem, the Theorema Egregium.

      It is why a flat map of the Earth must stretch something, and
      why a slice of pizza held curved across stays stiff along its
      length.`,
    build: base => [keyframe(setup(base, 1, 0.25, 0.1, 1.0, 8, false, 0.9, 0.5, 4.2), 5.0)],
  },
  {
    title: 'Your turn',
    body: `
      Choose a surface, a start and a heading, and lengthen the walk.
      Add a second walker and watch the gap. On the torus, find a walk
      that closes up, and one that never does. Every group of controls
      has an ⓘ note.

      The address of this page always holds the view on screen, so a
      copied link brings anyone to the very same spot.`,
    build: base => [keyframe(base, 3.0)],
  },
];

// MARK: World

// MARK: Explorer

/** What the explorer says about the walk as it is set: GeodesicWorld.report in the app. */
function explorerReport(state) {
  const s = kind(state);
  const p = paths(state);
  const separation = index => (index < p.main.length && index < p.twin.length
    ? Math.hypot(...sub(p.main[index], p.twin[index])) : null);
  const rows = [];
  // Points are a hundredth apart: every fiftieth is half a unit.
  for (let index = 0; index < p.main.length && rows.length < 81; index += 50) {
    const x = p.main[index];
    const gap = separation(index);
    const k = curvature(x, s);
    const travelled = index * 0.01;
    rows.push({
      id: rows.length,
      cells: [travelled.toFixed(1), `(${x.map(c => c.toFixed(2)).join(', ')})`, k.toFixed(3), gap === null ? '—' : gap.toFixed(3)],
      workedTitle: `After ${travelled.toFixed(1)} units`,
      worked: [
        ['place', `(${x.map(c => c.toFixed(5)).join(', ')})`],
        ['on the surface, F(x)', value(x, s).toExponential(2)],
        ['curvature K', k.toFixed(5)],
        ['gap to the second walker', gap === null ? 'no second walker' : gap.toFixed(5)],
      ],
      note: k > 0
        ? 'K > 0 here: nearby straight paths bend toward each other.'
        : (k < 0 ? 'K < 0 here: nearby straight paths bend away from each other.' : 'K = 0 here: nearby paths neither close in nor spread, for the moment.'),
    });
  }
  const details = [`The walk is ${((p.main.length - 1) * 0.01).toFixed(2)} units long, in ${Math.max(p.main.length - 1, 0)} steps of a hundredth.`];
  if (p.main.length) {
    details.push(`It ends ${Math.hypot(...sub(p.main[p.main.length - 1], p.main[0])).toFixed(4)} from where it began.`);
  }
  if (p.twin.length && separation(0) !== null) {
    const end = separation(Math.min(p.main.length, p.twin.length) - 1) ?? separation(0);
    details.push(`The walkers began ${separation(0).toFixed(3)} apart and end ${end.toFixed(3)} apart.`);
  }
  return {
    headline: `A straight walk on the ${['sphere', 'torus', 'saddle'][s]}`,
    details, tableTitle: 'Every half unit', columns: ['walked', 'place', 'K', 'gap'], rows, markers: [],
  };
}

const explorer = {
  title: 'Walk explorer',
  subtitle: 'One straight walk, step by step',
  buttonTitle: 'Walk explorer',
  blurb: 'The explorer follows the walk: where it is after each half unit, the curvature underfoot, and how far the second walker is from it.',
  pointTitle: '',
  coordinates: [],
  moveHint: '',
  initialProbe: () => [0, 0, 0, 0],
  report: (probe, state) => explorerReport(state),
};

export const world = {
  id: 'geodesics',
  title: 'Geodesics',
  formula: 'x″ = −(x′ᵀ H x′) ∇F ⁄ |∇F|²',
  summary: 'Walk straight ahead on a curved surface and see where you end up. Parallel walkers meet on a sphere and part on a saddle, a torus has both, and a triangle\'s angles add up to more or less than 180° by exactly the curvature inside it.',
  fragment: FRAGMENT,
  defaults,
  cameraDistanceRange: [1.6, 8],
  paletteNames: ['Curvature', 'Plain'],
  controlGroups: [
    group('Surface', `
      A geodesic is the path of someone who walks straight ahead and
      never turns, as far as anyone on the surface can tell. Its only
      acceleration is straight out of the surface, just enough to
      stay on it.

      The colours show the Gaussian curvature K: warm where the
      surface curves the same way in every direction, like a ball
      (K > 0); cool where it curves up one way and down the other,
      like a saddle (K < 0). The sphere has K = 1 everywhere, the
      saddle K < 0 everywhere, and the torus is warm outside and
      cool in its hole.`, [
      picker('Surface', SURFACE, ['Sphere', 'Torus', 'Saddle']),
      toggle('Grid', GRID),
      readout('Curvature at the start', state => {
        const s = kind(state);
        return curvature(place(state.values[START_A], state.values[START_B], s).point, s).toFixed(3);
      }),
    ]),
    group('The walk', `
      The start is a place on the surface: latitude and longitude on
      the sphere, the two angles round the torus, or x and z on the
      saddle. Heading is the direction you set off in: 0 is east,
      90° north.

      The walk is worked out step by step: each step goes straight in
      space, and the curve is pulled back onto the surface and its
      direction laid flat along it. Steps of a hundredth of a unit
      keep the error far below what can be seen.`, [
      slider('Start, across', START_A, [0, 1], value => value.toFixed(3)),
      slider('Start, around', START_B, [0, 1], value => value.toFixed(3)),
      slider('Heading', HEADING, [-Math.PI, Math.PI], value => (value * 180 / Math.PI).toFixed(0) + '°'),
      slider('Length', LENGTH, [0, 40], value => value.toFixed(1)),
    ]),
    group('Parallel walkers', `
      A second walker starts a short way to one side and sets off in
      the same direction. In a flat plane they would stay the same
      distance apart for ever.

      Where K > 0 they drift together, and on a sphere they meet;
      where K < 0 they drift apart, faster and faster. How their gap
      changes is governed by the curvature they pass over, and by
      nothing else.`, [
      toggle('Second walker', TWIN),
      slider('Starting gap', TWIN_GAP, [0.05, 0.6], value => value.toFixed(2)),
    ]),
    group('A triangle', `
      On the sphere, three geodesics make a triangle: from the north
      pole down to the equator, a quarter of the way round it, and
      back up. Every corner is a right angle, so its angles add up
      to 270°.

      Gauss and Bonnet's theorem says the angles of a geodesic
      triangle add up to 180° plus the total curvature inside it.
      Here that is K × area = 1 × (4π ⁄ 8) = π ⁄ 2: the missing 90°.
      On a saddle the angles add up to less than 180°.`, [
      toggle('Show the triangle (sphere)', TRIANGLE),
    ]),
  ],
  viewNote: `
    Drag to turn the surface and pinch to zoom.`,
  tour,
  explorer,
  shaderValues(state) {
    const values = new Array(32).fill(0);
    values[0] = kind(state);
    values[1] = table(state).length / 4;
    values[2] = state.values[GRID] > 0.5 ? 1 : 0;
    values[3] = state.palette === 0 ? 1 : 0;
    return values;
  },
  shaderData: table,
  discreteValues: new Set([SURFACE, TWIN, GRID, TRIANGLE]),
  cameraBacksAwayWhenMoving: false,
  tourKeepsPalette: false,
  pitchRange: [-1.45, 1.45],
};
