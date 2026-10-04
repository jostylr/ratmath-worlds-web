// The quaternion Julia world: z → z² + c with four-part numbers, seen as a
// solid slice of a four-dimensional set. This is
// Worlds/FourD/QuaternionJuliaWorld.swift, without its explorer; the tour's
// words are copied from it.
import { newState, copyState, keyframe, slider, group } from './engine.js';
import { makeSlice, slicePoint, writeSlice } from './four-d-math.js';
import { FRAGMENT } from './shaders/quaternion-julia.js';

// Indices into the state's values.
const C_REAL = 0;
const C_I = 1;
const C_J = 2;
const C_K = 3;
const ITERATIONS = 4;
const W = 5;
const XW = 6;
const YW = 7;
const ZW = 8;
const CUT = 9;

/** Cut values at or above this leave the whole set visible. */
const CUT_DISABLED = 2.2;
const ESCAPE_RADIUS = 4.0;

const defaults = newState();
defaults.values[C_REAL] = -0.20;
defaults.values[C_I] = 0.60;
defaults.values[C_J] = 0.20;
defaults.values[C_K] = 0.20;
defaults.values[ITERATIONS] = 10;
defaults.values[CUT] = CUT_DISABLED;
defaults.yaw = 0.55;
defaults.pitch = -0.35;
defaults.cameraDistance = 4.4;

/** The constant c, a quaternion a + bi + cj + dk stored as [a, b, c, d]. */
const constant = state => [state.values[C_REAL], state.values[C_I], state.values[C_J], state.values[C_K]];

const slice = state => makeSlice(state.values[XW], state.values[YW], state.values[ZW], state.values[W]);

const iterationCount = state => Math.min(Math.max(Math.round(state.values[ITERATIONS]), 2), 16);

/** q² = (a² − b² − c² − d², 2ab, 2ac, 2ad) */
const square = q =>
  [q[0] * q[0] - (q[1] * q[1] + q[2] * q[2] + q[3] * q[3]), 2 * q[0] * q[1], 2 * q[0] * q[2], 2 * q[0] * q[3]];

const lengthSquared = q => q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];

/** CPU mirror of worldField in QuaternionJulia.metal, without the cut. */
function juliaDistance(start, c, iterations) {
  let q = start;
  // The size of the derivative: each squaring doubles it and multiplies it
  // by |q|.
  let derivative = 1;
  let size2 = lengthSquared(q);
  for (let i = 0; i < Math.max(iterations, 1); i += 1) {
    derivative *= 2 * Math.sqrt(size2);
    q = square(q).map((part, k) => part + c[k]);
    size2 = lengthSquared(q);
    if (size2 > ESCAPE_RADIUS * ESCAPE_RADIUS) { break; }
  }
  const size = Math.sqrt(size2);
  return 0.5 * size * Math.log(Math.max(size, 1e-9)) / Math.max(derivative, 1e-9);
}

/** The distance field of the slice, cut included. */
const fieldDistance = (u, state) => Math.max(
  juliaDistance(slicePoint(slice(state), u), constant(state), iterationCount(state)),
  u[2] - state.values[CUT]);

const degrees = value => (value * 180 / Math.PI).toFixed(0) + '°';
const two = value => value.toFixed(2);

/** A copy of a state with another constant c. */
function withConstant(base, c) {
  const s = copyState(base);
  s.values[C_REAL] = c[0];
  s.values[C_I] = c[1];
  s.values[C_J] = c[2];
  s.values[C_K] = c[3];
  return s;
}

const tour = [
  {
    title: 'The same rule, with bigger numbers',
    body: `
      An ordinary Julia set comes from complex numbers, which have two
      parts, a + bi. Pick a constant c, start anywhere, and repeat:
      square, add c. The starting points whose paths stay bounded form
      the set.

      Quaternions have four parts, a + bi + cj + dk. Run the same rule
      with them and the set has four dimensions. What you see is one
      solid slice of it.`,
    build(base) {
      const turned = copyState(base);
      turned.yaw = 1.7;
      return [keyframe(base, 2.5, 0.5), keyframe(turned, 12.0)];
    },
  },
  {
    title: 'Spin a Julia set',
    body: `
      Here c is the plain number −1, with no imaginary part. In two
      dimensions that gives a Julia set known as the basilica.

      Squaring a quaternion treats i, j and k exactly alike, so with a
      real c nothing distinguishes one imaginary direction from
      another. The slice is the basilica, spun round the real axis
      like clay on a wheel.`,
    tryIt: 'Constant c → Real, with i, j and k at zero',
    build(base) {
      const p = withConstant(base, [-1, 0, 0, 0]);
      p.yaw = 0.2;
      p.pitch = -0.25;
      const turned = copyState(p);
      turned.yaw = 1.2;
      turned.pitch = -0.6;
      return [keyframe(p, 5.0, 1.0), keyframe(turned, 8.0)];
    },
  },
  {
    title: 'Cut it open',
    body: `
      A plane is removing the front half. The set is solid, and the
      outline of the cut face is the basilica itself, exactly as it
      appears on a flat screen.

      Now c gains an imaginary part and becomes −0.12 + 0.75i. The
      solid loses its roundness, and the cut face changes into the
      Julia set for that complex number: the three-eared shape called
      Douady's rabbit.`,
    tryIt: 'Cut → Depth; Constant c → i',
    build(base) {
      const whole = withConstant(base, [-1, 0, 0, 0]);
      whole.yaw = 0.0;
      whole.pitch = -0.12;
      whole.values[ITERATIONS] = 12;
      whole.values[CUT] = 1.5;
      const cutOpen = copyState(whole);
      cutOpen.values[CUT] = 0;
      const rabbit = withConstant(cutOpen, [-0.123, 0.745, 0, 0]);
      rabbit.values[ITERATIONS] = 14;
      return [keyframe(whole, 4.0, 0.5), keyframe(cutOpen, 6.0, 2.5), keyframe(rabbit, 9.0)];
    },
  },
  {
    title: 'Multiplying four-part numbers',
    body: `
      The rules are i² = j² = k² = −1, and ij = k, jk = i, ki = j. But
      the order matters: ji = −k. Quaternions were the first numbers
      found for which a × b and b × a can differ.

      In a square, those opposite pairs cancel, which is why the
      formula is short: the real part is a² − b² − c² − d², and each
      imaginary part is just doubled and multiplied by a.`,
    build(base) {
      const p = copyState(base);
      p.yaw = -0.5;
      p.pitch = -0.2;
      return [keyframe(p, 4.0)];
    },
  },
  {
    title: 'Slide through the fourth dimension',
    body: `
      With j and k parts in c, the set has no symmetry left to make
      its slices alike. The slice is now moving along the k direction,
      which is at right angles to everything on screen.

      The solid swells, splits and vanishes. It is one unchanging
      four-dimensional object; we are passing through it.`,
    tryIt: 'Slice → Position',
    build(base) {
      const start = copyState(base);
      start.values[W] = -0.9;
      start.palette = 1;
      const end = copyState(start);
      end.values[W] = 0.9;
      return [keyframe(start, 3.0, 0.5), keyframe(end, 14.0)];
    },
  },
  {
    title: 'Turn it through the hidden direction',
    body: `
      Now the slice stays at the centre and tilts, trading the j
      direction for k. The shape appears to flow into another, which
      no rigid object in three dimensions could do.

      Colour shows each point's k part: blue for negative, orange for
      positive. The tilted slice cuts across the hidden direction, so
      one side of what you see comes from each side of it.`,
    tryIt: 'Slice → j into k',
    build(base) {
      const start = copyState(base);
      start.palette = 1;
      const turned = copyState(start);
      turned.values[ZW] = Math.PI / 2;
      return [keyframe(start, 3.0, 0.5), keyframe(turned, 12.0)];
    },
  },
  {
    title: 'Every c gives another set',
    body: `
      As c changes, the set changes continuously. For some values it
      is one connected solid; for others it breaks into pieces, and
      then into dust.

      Whether it holds together depends only on whether the path that
      starts at zero stays bounded. That is the same test that defines
      the Mandelbrot set, and it works in four dimensions too.`,
    tryIt: 'Constant c → all four parts',
    build: base => [
      keyframe(withConstant(base, [-0.2, 0.6, 0.2, 0.2]), 3.0, 1.0),
      keyframe(withConstant(base, [-0.45, 0.2, 0.5, 0.1]), 7.0, 1.0),
      keyframe(withConstant(base, [-0.9, 0.1, 0.25, 0.0]), 7.0, 1.0),
      keyframe(withConstant(base, [0.2, 0.6, 0.1, 0.3]), 7.0),
    ],
  },
  {
    title: 'How the picture is drawn',
    body: `
      As with the Mandelbulb, a ray walks forward for each pixel, and
      the rule supplies a safe step length: about ½ · |q| ln |q| ⁄ |q′|,
      where |q′| doubles and is multiplied by |q| at every squaring.

      A point of the picture has three coordinates. The slice turns it
      into a four-part number, the rule runs, and the answer says how
      far the ray may go.`,
    build(base) {
      const p = copyState(base);
      p.cameraDistance = 2.2;
      p.values[ITERATIONS] = 12;
      return [keyframe(p, 5.0)];
    },
  },
  {
    title: 'Your turn',
    body: `
      Change the four parts of c, move and tilt the slice, and cut the
      solid open. Drag to turn it and double-click to fly to a spot.
      Every group of controls has an ⓘ note.

      The address of this page always holds the view on screen, so a
      copied link brings anyone to the very same spot.`,
    build: base => [keyframe(base, 3.0)],
  },
];

export const world = {
  id: 'quaternion-julia',
  title: 'Quaternion Julia set',
  formula: 'q → q² + c, with q = a + bi + cj + dk',
  summary: 'The Julia set rule, run with four-part numbers instead of two-part ones. The result is a four-dimensional shape; you see a solid slice of it, and inside every cut is a Julia set you may already know.',
  fragment: FRAGMENT,
  defaults,
  cameraDistanceRange: [0.05, 9.0],
  paletteNames: ['Orbit', 'Hidden coordinate', 'Chalk'],
  controlGroups: [
    group('Constant c', `
      A quaternion has a real part and three imaginary parts,
      i, j and k, each of which squares to −1. The rule is the same
      as for the ordinary Julia set: square, add c, repeat. A
      starting point belongs to the set if its path never escapes.

      Squaring treats i, j and k alike. With c purely real, the
      slice is an ordinary Julia set spun round the real axis.
      Each imaginary part of c breaks that symmetry in one more
      direction.`, [
      slider('Real', C_REAL, [-1.3, 0.6], two),
      slider('i', C_I, [-1, 1], two),
      slider('j', C_J, [-1, 1], two),
      slider('k', C_K, [-1, 1], two),
      slider('Iterations', ITERATIONS, [2, 16], value => String(Math.round(value))),
    ]),
    group('Slice', `
      The set lives in four dimensions: real, i, j, k. You see
      the three-dimensional slice where the k part equals
      Position. Moving it shows a different cross-section of the
      same four-dimensional object.

      The three turns tilt the slice so that it mixes k with one
      of the visible directions.`, [
      slider('Position, k', W, [-1.2, 1.2], two),
      slider('Real into k', XW, [-Math.PI / 2, Math.PI / 2], degrees),
      slider('i into k', YW, [-Math.PI / 2, Math.PI / 2], degrees),
      slider('j into k', ZW, [-Math.PI / 2, Math.PI / 2], degrees),
    ]),
    group('Cut', `
      Removes the front of the solid, the part with j greater than
      this value, so you can look at the inside. The set is solid:
      every interior point stays bounded.

      With the j and k parts of c at zero and the cut at zero, the
      outline of the cut face is exactly the two-dimensional Julia
      set of the complex number Real + i.`, [
      slider('Depth, j', CUT, [-1.2, CUT_DISABLED], value => (value >= 1.6 ? 'Off' : two(value))),
    ]),
  ],
  viewNote: `
    Zoom moves the camera toward the point it orbits; double-click the
    surface to orbit that spot and fly toward it. Orbit colours come
    from how close each point's path passed to the real axis.`,
  tour,
  distance: fieldDistance,
  shaderValues(state) {
    const c = constant(state);
    const values = new Array(32).fill(0);
    values[0] = iterationCount(state);
    values[1] = state.values[W];
    values[2] = state.values[CUT];
    writeSlice(values, slice(state));
    for (let i = 0; i < 4; i += 1) { values[20 + i] = c[i]; }
    return values;
  },
  prepareForZoom(state) {
    // Keep enough iterations switched on for detail at the new scale.
    const magnification = defaults.cameraDistance / state.cameraDistance;
    state.values[ITERATIONS] = Math.max(state.values[ITERATIONS],
      Math.min(10 + 2 * Math.log2(Math.max(magnification, 1)), 16));
  },
  tourKeepsPalette: false,
};
