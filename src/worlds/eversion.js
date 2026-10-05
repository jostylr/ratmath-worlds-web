// Sphere eversion: a sphere turned inside out with no hole and no crease.
// This is Worlds/Eversion/EversionWorld.swift, without its explorer; the
// tour's words are copied from it.
import { newState, copyState, keyframe, slider, toggle, readout, group, Format } from './engine.js';
import { FRAGMENT } from './shaders/backdrop.js';

// MARK: The eversion
//
// The sphere eversion of Adam and Witold Bednorz ("Analytic sphere eversion
// using ruled surfaces", 2017), which gives the whole motion as explicit
// formulas.
//
// A point of the sphere at latitude θ and longitude φ is first placed on an
// infinite twisted cylinder made of straight lines, at height
// h = ω sin θ ⁄ cos²θ. The cylinder turns inside out as one number t runs
// from negative to positive. Two further maps damp it at large distances
// and close its two ends up, turning it back into a sphere.

const N = 2;
const KAPPA = 0.25; // (n − 1) ⁄ 2n
const OMEGA = 2;
const BIG_Q = 2 / 3;
const ETA = 1;
const BETA = 1;

const STAGE_NAMES = ['Twisting the poles', 'Opening the ends', 'Letting the sheets cross', 'Passing through'];

/**
 * The numbers that drive the formulas at one moment. Progress 0 is the
 * sphere, 0.5 the half-way surface, 1 the sphere inside out. The second half
 * retraces the first with t reversed.
 */
function parameters(progress) {
  const tau = Math.min(Math.max(progress, 0), 1);
  const s = tau <= 0.5 ? tau : 1 - tau;
  const sign = tau <= 0.5 ? -1 : 1;
  const limit = 1 / BIG_Q;
  const a = 0.15, b = 0.27, c = 0.38, d = 0.5;
  if (s < a) {
    return { t: sign * limit, q: BIG_Q, xi: 0, alpha: 0, lambda: s / a, stage: 0 };
  }
  if (s < b) {
    // Squared, so the surface starts to move gently: the closing-up
    // map depends on √α.
    const u = (s - a) / (b - a);
    return { t: sign * limit, q: BIG_Q, xi: u * u, alpha: u * u, lambda: 1, stage: 1 };
  }
  if (s < c) {
    const u = (s - b) / (c - b);
    return { t: sign * limit, q: BIG_Q * (1 - u), xi: 1, alpha: 1, lambda: 1, stage: 2 };
  }
  const u = (s - c) / (d - c);
  return { t: sign * limit * (1 - u), q: 0, xi: 1, alpha: 1, lambda: 1, stage: 3 };
}

/** Where a point of the sphere is, turned so that the poles are up and down;
    written into `out` at `at`. */
function point(theta, phi, m, out, at) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const cn = c * c;
  const t = m.t;

  if (m.lambda < 1) {
    // The last stage, written so that nothing is divided by cos θ.
    const g = m.lambda * cn + (1 - m.lambda);
    const ax = t * g * Math.cos(phi) - m.lambda * OMEGA * s * Math.sin(phi);
    const ay = t * g * Math.sin(phi) + m.lambda * OMEGA * s * Math.cos(phi);
    const size = t * t * g * g + m.lambda * m.lambda * OMEGA * OMEGA * s * s;
    const scale = ETA ** KAPPA * c / size ** (1 - KAPPA);
    const zc = m.lambda * (OMEGA * s * (Math.sin(N * phi) - m.q * t) * cn - (t / N) * Math.cos(N * phi) * cn * cn)
      - (1 - m.lambda) * ETA ** (1 + KAPPA) * t * Math.abs(t) ** (2 * KAPPA) * s;
    out[at] = scale * ax;
    out[at + 1] = -(zc / ETA) / size;
    out[at + 2] = -scale * ay;
    return;
  }

  // The twisted cylinder of straight lines.
  const p = 1 - Math.abs(m.q * t);
  const h = OMEGA * s / Math.max(cn, 1e-12);
  const x = t * Math.cos(phi) + p * Math.sin((N - 1) * phi) - h * Math.sin(phi);
  const y = t * Math.sin(phi) + p * Math.cos((N - 1) * phi) + h * Math.cos(phi);
  const z = h * Math.sin(N * phi) - (t / N) * Math.cos(N * phi) - m.q * t * h;

  // Damping at large distances.
  const denominator = m.xi + ETA * (x * x + y * y);
  const shrink = denominator ** -KAPPA;
  const x1 = x * shrink, y1 = y * shrink, z1 = z / denominator;

  // Closing the two ends: a relative of stereographic projection.
  const rho = x1 * x1 + y1 * y1;
  const gamma = 2 * Math.sqrt(m.alpha * BETA);
  const spread = Math.exp(gamma * z1) / (m.alpha + BETA * rho);
  const lift = gamma < 1e-9 ? z1 : Math.expm1(gamma * z1) / gamma;
  const z2 = (m.alpha - BETA * rho) / (m.alpha + BETA * rho) * lift
    + (gamma / 2) * (1 - rho) / ((m.alpha + BETA * rho) * (m.alpha + BETA));
  out[at] = x1 * spread;
  out[at + 1] = z2;
  out[at + 2] = -y1 * spread;
}

// MARK: The world

// Indices into the state's values.
const PROGRESS = 0;
const PLAY = 1;
const SPEED = 29;
const SLATS = 2;
const CUT = 3;
const GRID = 4;

const ROWS = 96;
const COLUMNS = 192;

const defaults = newState();
defaults.values[GRID] = 1;
defaults.values[PLAY] = 1;
defaults.values[SPEED] = 1;
defaults.yaw = 0.5;
defaults.pitch = -0.4;
defaults.cameraDistance = 4.4;

/** The progress shown: the slider's, or a slow back-and-forth when playing. */
function shownProgress(state) { return state.values[PROGRESS]; }

const VERTEX_COUNT = (ROWS + 1) * (COLUMNS + 1);
const points = new Float64Array(3 * VERTEX_COUNT);
const vertices = new Float32Array(8 * VERTEX_COUNT);
const indices = new Uint32Array(6 * ROWS * COLUMNS);
for (let i = 0, n = 0; i < ROWS; i += 1) {
  for (let j = 0; j < COLUMNS; j += 1) {
    const a = i * (COLUMNS + 1) + j;
    const b = a + 1;
    const c = a + COLUMNS + 1;
    const d = c + 1;
    indices.set([a, c, b, b, c, d], n);
    n += 6;
  }
}
const surface = { vertices, indices };
/** The progress the vertices were last worked out for. */
let meshProgress = null;

function mesh(state, probe, clock) {
  const progress = shownProgress(state, clock);
  // A surface that is holding still is not worked out again.
  if (progress === meshProgress) { return surface; }
  meshProgress = progress;
  surface.revision = progress;
  const m = parameters(progress);
  // The very poles are left out by a hair; the formulas divide by cos θ.
  const edge = 0.002;
  for (let i = 0; i <= ROWS; i += 1) {
    // Rows crowd toward the poles, where the surface is stretched most.
    const along = 2 * i / ROWS - 1;
    const theta = (Math.PI / 2 - edge) * (1.5 * along - 0.5 * along * along * along);
    for (let j = 0; j <= COLUMNS; j += 1) {
      point(theta, 2 * Math.PI * j / COLUMNS, m, points, 3 * (i * (COLUMNS + 1) + j));
    }
  }
  for (let i = 0; i <= ROWS; i += 1) {
    for (let j = 0; j <= COLUMNS; j += 1) {
      // Normals from neighbouring points; longitude wraps round.
      const up = 3 * (Math.min(i + 1, ROWS) * (COLUMNS + 1) + j);
      const down = 3 * (Math.max(i - 1, 0) * (COLUMNS + 1) + j);
      const east = 3 * (i * (COLUMNS + 1) + (j === COLUMNS ? 1 : j + 1));
      const west = 3 * (i * (COLUMNS + 1) + (j === 0 ? COLUMNS - 1 : j - 1));
      const ax = points[up] - points[down], ay = points[up + 1] - points[down + 1], az = points[up + 2] - points[down + 2];
      const bx = points[east] - points[west], by = points[east + 1] - points[west + 1], bz = points[east + 2] - points[west + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const length = Math.hypot(nx, ny, nz);
      if (length > 1e-14) {
        nx /= length;
        ny /= length;
        nz /= length;
      } else {
        nx = 0;
        ny = 1;
        nz = 0;
      }
      const index = i * (COLUMNS + 1) + j;
      const at = 8 * index;
      vertices[at] = points[3 * index];
      vertices[at + 1] = points[3 * index + 1];
      vertices[at + 2] = points[3 * index + 2];
      vertices[at + 3] = i / ROWS;
      vertices[at + 4] = nx;
      vertices[at + 5] = ny;
      vertices[at + 6] = nz;
      vertices[at + 7] = j / COLUMNS;
    }
  }
  return surface;
}

const three = value => Format.number(value, 3);

// MARK: Guided tour

function at(base, value) {
  const s = copyState(base);
  s.values[PROGRESS] = value;
  s.values[PLAY] = 0;
  return s;
}

const tour = [
  {
    title: 'The challenge',
    body: `
      Here is a sphere, gold outside and violet inside. The challenge
      is to turn it inside out, so that the violet is outside.

      The sphere is made of something that can stretch and bend as much
      as you like, and can even pass through itself like a ghost. Two
      things are forbidden: you may not tear it, and you may never make
      a sharp crease.`,
    tryIt: 'See inside → Cut away, to check the inside is violet',
    build(base) {
      const whole = at(base, 0);
      whole.yaw = 0.3;
      const open = copyState(whole);
      open.values[CUT] = 0.3;
      open.yaw = 1.2;
      return [keyframe(whole, 2.5, 1.0), keyframe(open, 7.0)];
    },
  },
  {
    title: 'Why it seems impossible',
    body: `
      The obvious way is to push the top down through the bottom. But
      that leaves a loop round the middle which tightens into a sharp
      crease. Forbidden.

      Try the same game with a circle in a plane: turn it inside out
      without a kink. It cannot be done. A circle's tangent turns once
      anticlockwise as you go round, and no smooth motion can change
      that to clockwise. So in 1958, when Stephen Smale proved that a
      sphere can be everted, his own adviser did not believe it.`,
    build(base) {
      const s = at(base, 0);
      s.values[CUT] = 0.3;
      s.yaw = 1.2;
      const turned = copyState(s);
      turned.yaw = 2.0;
      return [keyframe(s, 2.0, 0.5), keyframe(turned, 8.0)];
    },
  },
  {
    title: 'Twist the caps',
    body: `
      Smale's proof showed that a way exists without showing one. It
      took years for anyone to find an eversion that could be watched.
      This one was published in 2017 and is given entirely by formulas.

      It starts by turning the two polar caps against each other and
      pushing them through each other. Violet appears on the outside
      where the surface has passed through itself, but nothing has been
      creased.`,
    tryIt: 'Eversion → Progress, from 0 to 0.15',
    build(base) {
      const start = at(base, 0);
      start.pitch = -0.7;
      const end = at(base, 0.15);
      end.pitch = -0.7;
      end.yaw = 1.2;
      return [keyframe(start, 2.5, 0.5), keyframe(end, 12.0)];
    },
  },
  {
    title: 'Open it out',
    body: `
      Next the surface is opened into something like a tunnel with a
      twist in it, and its sheets are let cross one another.

      Slats have been cut in it here so you can see the layers. The
      lines on the surface are the sphere's own latitude and longitude,
      carried along: they show where it is being stretched, and that
      it is never pinched to a point or folded flat.`,
    tryIt: 'See inside → Slats',
    build(base) {
      const start = at(base, 0.15);
      start.values[SLATS] = 8;
      start.yaw = 0.4;
      const end = at(base, 0.38);
      end.values[SLATS] = 8;
      end.yaw = 1.4;
      end.pitch = -0.6;
      return [keyframe(start, 2.5, 0.5), keyframe(end, 14.0)];
    },
  },
  {
    title: 'Half-way',
    body: `
      This is the middle of the eversion. Look at it from above and
      from below: the two views are the same shape, with gold and
      violet exchanged. Neither side is the outside any more.

      At the very centre four sheets of the surface pass through one
      point. It has been proved that every eversion of the sphere must
      have a moment like that.`,
    tryIt: 'Eversion → Progress at 0.5',
    build(base) {
      const above = at(base, 0.5);
      above.pitch = -1.2;
      above.yaw = 0.2;
      const below = copyState(above);
      below.pitch = 1.2;
      below.yaw = 0.2 + Math.PI / 2;
      return [keyframe(above, 4.0, 2.5), keyframe(below, 9.0)];
    },
  },
  {
    title: 'Through, and back out',
    body: `
      From the half-way surface the rest is easy: do everything again
      in reverse, with gold and violet exchanged.

      The sheets uncross, the tunnel closes, the caps untwist. What
      is left is a round sphere with the violet side out. Not one
      point was torn from its neighbours, and there was never a crease.`,
    tryIt: 'Eversion → Progress, from 0.5 to 1',
    build(base) {
      const start = at(base, 0.5);
      start.yaw = 0.5;
      const end = at(base, 1.0);
      end.yaw = 2.2;
      return [keyframe(start, 2.5, 0.5), keyframe(end, 22.0)];
    },
  },
  {
    title: 'The whole thing',
    body: `
      Here it is from start to finish, without stopping.

      The secret is in the twist. A plain push-through creases because
      the loop round the middle has nowhere to go. Here the surface is
      first given a twist, which is free in three dimensions, and the
      twist is what lets the loop slide through itself instead of
      tightening.`,
    tryIt: 'Eversion → Play',
    build(base) {
      const start = at(base, 0);
      start.yaw = 0.3;
      const end = at(base, 1);
      end.yaw = 2.6;
      return [keyframe(start, 2.0, 0.5), keyframe(end, 30.0)];
    },
  },
  {
    title: 'How the picture is drawn',
    body: `
      The other worlds in this app are drawn from a formula evaluated
      at every pixel. This surface moves and passes through itself, so
      it is drawn the older way: about nineteen thousand points of the
      sphere are run through the eversion formulas, joined into
      triangles, and painted gold or violet according to which face is
      toward you.

      Each point keeps its latitude and longitude from start to finish.`,
    build(base) {
      const s = at(base, 0.3);
      s.values[SLATS] = 0;
      s.yaw = 0.8;
      return [keyframe(s, 4.0)];
    },
  },
  {
    title: 'Your turn',
    body: `
      Move Progress slowly and stop wherever something puzzling
      happens. Turn the surface round, cut slats in it, cut it open.
      Or turn on Play and watch it go back and forth.

      The address of this page always holds the view on screen, so a
      copied link brings anyone to the very same spot.`,
    build: base => [keyframe(base, 3.0)],
  },
];

export const world = {
  id: 'eversion',
  title: 'Sphere eversion',
  formula: 'Inside out, with no hole and no crease',
  summary: 'A sphere can be turned inside out if it may pass through itself but must never be torn or creased. It sounds impossible, and it took a proof to find out that it is not. Watch one way of doing it, and stop it anywhere.',
  fragment: FRAGMENT,
  defaults,
  cameraDistanceRange: [2.0, 14.0],
  paletteNames: ['Gold and violet', 'Red and blue', 'Chalk'],
  controlGroups: [
    group('Eversion', `
      Progress runs from 0, an ordinary sphere with its gold side
      out, to 1, the same sphere with its violet side out. At every
      moment in between the surface is smooth: it has no tear and
      no sharp fold, though it passes through itself.

      The second half is the first half run backwards and seen in a
      mirror, which is what makes the half-way surface special: at
      progress 0.5 neither side is favoured.`, [
      slider('Progress', PROGRESS, [0, 1], value => value.toFixed(3), state => state.values[PLAY] < 0.5),
      toggle('Play', PLAY),
      slider('Playback speed', SPEED, [0.25, 2], value => value.toFixed(2) + '×'),
      readout('Stage', state => {
        if (!(state.values[PLAY] < 0.5)) { return 'playing'; }
        const m = parameters(state.values[PROGRESS]);
        return STAGE_NAMES[m.stage] + (state.values[PROGRESS] > 0.5 ? ', reversed' : '');
      }),
      readout('t', state => (state.values[PLAY] > 0.5 ? '' : three(parameters(state.values[PROGRESS]).t))),
    ]),
    group('See inside', `
      The surface hides most of itself. Slats removes alternate
      strips running from pole to pole, the way the makers of the
      film Outside In did, so the layers behind show through the
      gaps. Cut away removes a wedge instead.

      Grid draws the sphere's own lines of latitude and longitude,
      which are carried along with the surface and show how it is
      being stretched and twisted.`, [
      slider('Slats', SLATS, [0, 16], value => (Math.round(value) === 0 ? 'Off' : String(Math.round(value)))),
      slider('Cut away', CUT, [0, 0.6], value => (value < 0.01 ? 'Off' : (value * 100).toFixed(0) + '%')),
      toggle('Grid', GRID),
    ]),
  ],
  viewNote: `
    Drag to turn the surface and zoom to move closer. Gold marks the side
    that began outside and violet the side that began inside, whichever
    way they now face.`,
  tour,
  shaderValues(state) {
    // What the mesh's shader reads: slats, the cut-away fraction, the grid.
    const values = new Array(32).fill(0);
    values[0] = Math.round(state.values[SLATS]);
    values[1] = state.values[CUT];
    values[2] = state.values[GRID] > 0.5 ? 1 : 0;
    return values;
  },
  discreteValues: new Set([PLAY, GRID]),
  mesh,
  playback: { play: PLAY, speed: SPEED, value: PROGRESS, rate: 1 / 18, period: 2, bounce: true },
};
