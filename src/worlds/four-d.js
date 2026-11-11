// The 4D slice laboratory: shapes with four coordinates, seen one solid slice
// at a time. This is Worlds/FourD/FourDWorld.swift, without its explorer; the
// tour's words are copied from it.
import { newState, copyState, keyframe, slider, picker, readout, group, Camera, Format } from './engine.js';
import { dot4, makeSlice, slicePoint, writeSlice } from './four-d-math.js';
import { FRAGMENT } from './shaders/four-d.js';

// Indices into the state's values.
const SHAPE = 0;
const W = 1;
const XW = 2;
const YW = 3;
const ZW = 4;

const SPHERE_RADIUS = 1.35;
const SIMPLEX_RADIUS = 1.9;
const CROSS_RADIUS = 1.9;

const SHAPE_NAMES = ['Hypersphere', 'Tesseract', 'Simplex', '16-cell'];

/** The five corners of a regular simplex, as unit vectors. */
const SIMPLEX_CORNERS = (() => {
  const a = 1 / Math.sqrt(3.2);
  const b = -0.25;
  return [[a, a, a, b], [a, -a, -a, b], [-a, a, -a, b], [-a, -a, a, b], [0, 0, 0, 1]];
})();

const defaults = newState();
defaults.values[SHAPE] = 1;
defaults.yaw = 0.62;
defaults.pitch = -0.45;
defaults.cameraDistance = 6.2;

const slice = state => makeSlice(state.values[XW], state.values[YW], state.values[ZW], state.values[W]);

const shapeIndex = state => Math.min(Math.max(Math.round(state.values[SHAPE]), 0), 3);

/** CPU mirror of worldField in FourD.metal: how far a 4D point is from the shape. */
function shapeDistance(x, shape) {
  switch (shape) {
    case 0:
      return Math.hypot(...x) - SPHERE_RADIUS;
    case 1: {
      const q = x.map(c => Math.abs(c) - 1);
      return Math.hypot(...q.map(c => Math.max(c, 0))) + Math.min(Math.max(...q), 0);
    }
    case 2:
      return Math.max(...SIMPLEX_CORNERS.map(corner => -dot4(corner, x) - SIMPLEX_RADIUS * 0.25));
    default:
      return (x.reduce((sum, c) => sum + Math.abs(c), 0) - CROSS_RADIUS) * 0.5;
  }
}

const degrees = value => (value * 180 / Math.PI).toFixed(0) + '°';

/** Angles that point the hidden direction at a corner of the tesseract. */
const CORNER_FIRST = { xw: Math.PI / 4, yw: Math.asin(1 / Math.sqrt(3)), zw: Math.PI / 6 };

const tour = [
  {
    title: 'A sphere visits Flatland',
    body: `
      Imagine creatures living in a flat sheet. A ball passing through
      their sheet would look to them like a dot that appears from
      nowhere, swells into a circle, shrinks, and vanishes.

      This is the same thing one dimension up. A hypersphere, a ball
      with four coordinates, is passing through our space. We see a
      ball that grows and shrinks. The hypersphere is not changing; we
      are seeing one slice of it after another.`,
    tryIt: 'Slice → Position',
    build(base) {
      const start = copyState(base);
      start.values[SHAPE] = 0;
      start.values[W] = -1.5;
      start.palette = 1;
      const end = copyState(start);
      end.values[W] = 1.5;
      // It ends back in the middle, so the stop is not left on an empty view.
      const rest = copyState(start);
      rest.values[W] = 0;
      return [keyframe(start, 2.0, 0.5), keyframe(end, 14.0, 1.0), keyframe(rest, 4.0)];
    },
  },
  {
    title: 'The tesseract, face first',
    body: `
      A square is every point with x and y between −1 and 1. A cube
      adds z. A tesseract adds one more coordinate, w, with the same
      condition.

      Slice it straight on and the result is dull: a cube appears all
      at once, stays exactly the same, and vanishes all at once. A
      cube dropped flat through Flatland would do the same: a square
      that pops in, sits there, and pops out.`,
    tryIt: 'Shape → Tesseract; Slice → Position',
    build(base) {
      const start = copyState(base);
      start.values[SHAPE] = 1;
      start.values[W] = -1.3;
      const end = copyState(start);
      end.values[W] = 1.3;
      const rest = copyState(start);
      rest.values[W] = 0;
      return [keyframe(start, 2.0, 1.0), keyframe(end, 10.0, 1.0), keyframe(rest, 3.0)];
    },
  },
  {
    title: 'Turn it through the hidden direction',
    body: `
      Now the slice stays where it is and the tesseract turns, in the
      plane of x and w. From inside our space the cube appears to
      stretch into a box, more than 40% longer, and then shrink back.

      Nothing rigid in three dimensions can do that. It is what a
      turning shape looks like when the turn carries part of it out of
      our space and brings another part in.`,
    tryIt: 'Turn through 4D → x into w',
    build(base) {
      const start = copyState(base);
      start.values[SHAPE] = 1;
      const turned = copyState(start);
      turned.values[XW] = Math.PI / 4;
      const full = copyState(start);
      full.values[XW] = Math.PI / 2;
      return [keyframe(start, 2.0, 1.0), keyframe(turned, 6.0, 1.5), keyframe(full, 6.0)];
    },
  },
  {
    title: 'Eight cubes for walls',
    body: `
      A cube has six square faces. A tesseract has eight cubic walls,
      one for each coordinate held at +1 or −1. Each colour here marks
      one of them.

      With the tesseract tilted, the slice cuts through several walls
      at once, and each face of what we see is a flat cut through a
      different cube. Count the colours as the slice moves.`,
    tryIt: 'View → Colour → Cells',
    build(base) {
      const start = copyState(base);
      start.values[SHAPE] = 1;
      start.values[XW] = 0.55;
      start.values[YW] = 0.4;
      start.values[W] = -1.2;
      const end = copyState(start);
      end.values[W] = 1.2;
      end.yaw = 1.4;
      return [keyframe(start, 3.0, 0.5), keyframe(end, 12.0)];
    },
  },
  {
    title: 'Corner first',
    body: `
      Push a cube through Flatland corner first and its slices are a
      triangle, then a hexagon, then a triangle again. Here is the
      tesseract doing the same through our space.

      A point becomes a tetrahedron. Its corners are cut off as four
      more walls arrive, and half-way through the slice is a perfect
      octahedron. Then everything happens in reverse.`,
    tryIt: 'Turn through 4D: 45°, 35°, 30°; then Slice → Position',
    build(base) {
      const start = copyState(base);
      start.values[SHAPE] = 1;
      start.values[XW] = CORNER_FIRST.xw;
      start.values[YW] = CORNER_FIRST.yw;
      start.values[ZW] = CORNER_FIRST.zw;
      start.values[W] = -1.9;
      start.cameraDistance = 6.8;
      const middle = copyState(start);
      middle.values[W] = 0;
      const end = copyState(start);
      end.values[W] = 1.9;
      // It ends back on the octahedron, half-way through.
      return [keyframe(start, 3.0, 0.5), keyframe(middle, 9.0, 2.5), keyframe(end, 9.0, 1.0), keyframe(middle, 5.0)];
    },
  },
  {
    title: 'Where the surface comes from',
    body: `
      The colour now shows the tesseract's own fourth coordinate at
      each spot on the slice: blue where w is negative, orange where
      it is positive, pale near zero.

      With the slice tilted, one side of what we see comes from the
      near half of the tesseract and the other side from the far half.
      Our space cuts diagonally across the hidden direction.`,
    tryIt: 'View → Colour → Hidden coordinate',
    build(base) {
      const start = copyState(base);
      start.values[SHAPE] = 1;
      start.palette = 1;
      start.values[XW] = 0.3;
      const turned = copyState(start);
      turned.values[XW] = 1.2;
      turned.values[YW] = 0.5;
      return [keyframe(start, 3.0, 1.0), keyframe(turned, 10.0)];
    },
  },
  {
    title: 'Five corners, all neighbours',
    body: `
      Three points can be equally far from each other: a triangle.
      Four: a tetrahedron. A fifth, equally far from all four, will
      not fit in our space. In four dimensions it does, and the result
      is the simplex, with five tetrahedra for walls.

      Sliced from one corner toward the opposite wall, it is a
      tetrahedron that grows steadily and stops.`,
    tryIt: 'Shape → Simplex',
    build(base) {
      const start = copyState(base);
      start.values[SHAPE] = 2;
      start.values[W] = 1.8;
      const end = copyState(start);
      end.values[W] = -0.45;
      const turned = copyState(end);
      turned.values[W] = 0.1;
      turned.values[XW] = 0.9;
      turned.values[ZW] = 0.6;
      return [keyframe(start, 2.5, 0.5), keyframe(end, 9.0, 1.0), keyframe(turned, 7.0)];
    },
  },
  {
    title: 'The 16-cell',
    body: `
      An octahedron is every point with |x| + |y| + |z| ≤ r. Add |w|
      to the sum and you have the 16-cell, with sixteen tetrahedral
      walls, one for each choice of signs.

      Straight on, its slices are octahedra of changing size. Turned,
      they pass through shapes with more faces, as the slice catches
      more of the sixteen walls at once.`,
    tryIt: 'Shape → 16-cell',
    build(base) {
      const start = copyState(base);
      start.values[SHAPE] = 3;
      start.values[W] = -1.6;
      const middle = copyState(start);
      middle.values[W] = 0;
      const turned = copyState(middle);
      turned.values[XW] = 0.7;
      turned.values[YW] = 0.5;
      turned.values[W] = 0.3;
      return [keyframe(start, 2.5, 0.5), keyframe(middle, 7.0, 1.0), keyframe(turned, 8.0)];
    },
  },
  {
    title: 'How the picture is drawn',
    body: `
      Each shape is a formula that says how far any four-coordinate
      point is from its surface. A point of the picture has three
      coordinates; three directions e₁, e₂, e₃ and a position w turn
      it into four, and the formula does the rest.

      The same ray marcher that draws the Mandelbulb draws this. It
      never needs to know how many coordinates the formula uses.`,
    build(base) {
      const p = copyState(base);
      p.values[SHAPE] = 1;
      p.values[XW] = 0.5;
      p.values[ZW] = 0.35;
      return [keyframe(p, 4.0)];
    },
  },
  {
    title: 'Your turn',
    body: `
      Pick a shape, slide the slice through it, and turn it through
      the hidden direction. Drag to look at the slice from another
      side. Every group of controls has an ⓘ note.

      The address of this page always holds the view on screen, so a
      copied link brings anyone to the very same spot.`,
    build: base => [keyframe(base, 3.0)],
  },
];

// MARK: Explorer

/** The explorer's point is a small 4D ball of this radius. */
const BALL_RADIUS = 0.16;

/** What the explorer says about one point with four coordinates: FourDWorld.report in the app. */
function explorerReport(x, state) {
  const s = slice(state);
  const shape = shapeIndex(state);
  const u = [dot4(x, s.e1), dot4(x, s.e2), dot4(x, s.e3)];
  const off = dot4(x, s.n) - s.w;
  const four = v => `(${v.map(c => c.toFixed(2)).join(', ')})`;
  const n = value => Format.number(value, 3);

  const placeRow = {
    id: 1, cells: ['1', 'place in your slice', `(${n(u[0])}, ${n(u[1])}, ${n(u[2])})`],
    workedTitle: 'Place in the slice, worked',
    worked: [
      ['point, p', four(x)],
      ['e₁', four(s.e1)], ['u₁ = p · e₁', n(u[0])],
      ['e₂', four(s.e2)], ['u₂ = p · e₂', n(u[1])],
      ['e₃', four(s.e3)], ['u₃ = p · e₃', n(u[2])],
    ],
    note: 'e₁, e₂ and e₃ are the three directions of your slice, written with four coordinates each. A dot product multiplies matching coordinates and adds them up; it measures how far the point goes in that direction.',
  };

  const visible = Math.abs(off) < BALL_RADIUS;
  const offRow = {
    id: 2, cells: ['2', 'off your slice by', n(off)],
    workedTitle: 'Distance off the slice, worked',
    worked: [
      ['hidden direction, n', four(s.n)],
      ['p · n', n(dot4(s.n, x))],
      ['slice position, w', n(s.w)],
      ['p · n − w', n(off)],
      ['ball radius', n(BALL_RADIUS)],
      ['its slice: √(r² − off²)', visible ? n(Math.sqrt(BALL_RADIUS * BALL_RADIUS - off * off)) : 'none'],
    ],
    note: 'n is the one direction at right angles to all of your slice. The point is in your space only when p · n equals w exactly. The small ball around it reaches your slice while it is within its radius, and shows as a ball of radius √(r² − off²), the same rule that makes a sphere\'s cross-sections grow and shrink.',
  };

  const distance = shapeDistance(x, shape);
  let worked;
  let insideNote;
  if (shape === 0) {
    const sum = dot4(x, x);
    worked = [['x² + y² + z² + w²', n(sum)], ['r²', n(SPHERE_RADIUS * SPHERE_RADIUS)], ['√ of the sum', n(Math.sqrt(sum))], ['r', n(SPHERE_RADIUS)]];
    insideNote = 'Inside when the four squares add up to less than r². Fix w and what is left is x² + y² + z² < r² − w²: an ordinary ball, smaller the farther w is from zero.';
  } else if (shape === 1) {
    worked = ['|x|', '|y|', '|z|', '|w|'].map((label, i) => [label, `${n(Math.abs(x[i]))}${Math.abs(x[i]) <= 1 ? '  ≤ 1' : '  > 1'}`]);
    worked.push(['largest', n(Math.max(...x.map(Math.abs)))]);
    insideNote = 'Inside when all four coordinates lie between −1 and 1. The coordinate that reaches ±1 first decides which of the eight cubic walls is nearest.';
  } else if (shape === 2) {
    worked = SIMPLEX_CORNERS.map((corner, index) => [`−p · corner ${index + 1}`, n(-dot4(corner, x))]);
    worked.push(['wall distance, R⁄4', n(SIMPLEX_RADIUS * 0.25)]);
    insideNote = 'The simplex has five walls, each facing away from one corner. The point is inside when it is behind all five: every number above must be below R⁄4.';
  } else {
    worked = [['|x| + |y| + |z| + |w|', n(x.reduce((sum, c) => sum + Math.abs(c), 0))], ['r', n(CROSS_RADIUS)]];
    insideNote = 'Inside when the four sizes add up to less than r. Each choice of signs for x, y, z, w gives one flat wall, sixteen in all.';
  }
  worked.push(['distance to the surface', n(Math.abs(distance))]);
  const insideRow = {
    id: 3, cells: ['3', 'inside the shape?', distance <= 0 ? 'yes' : 'no'],
    workedTitle: `Inside the ${SHAPE_NAMES[shape].toLowerCase()}?`, worked, note: insideNote,
  };

  // The engine sizes markers from the camera distance; undo that so the
  // ball has its true size.
  const marker = visible
    ? { position: u, size: Math.sqrt(BALL_RADIUS * BALL_RADIUS - off * off) / (0.013 * state.cameraDistance), color: [1, 1, 1] }
    : { position: u, size: 0.35, color: [0.5, 0.5, 0.55] };
  const where = distance <= 0 ? 'inside' : 'outside';
  return {
    headline: visible ? `In your slice, ${where} the shape` : `Not in your slice: ${n(Math.abs(off))} off it`,
    details: [
      visible
        ? `The point is within ${n(BALL_RADIUS)} of your slice, so its ball shows.`
        : `Move the slice to w = ${n(dot4(s.n, x))} to bring it into view. The grey speck marks the spot directly beside it in your slice.`,
      `As a 4D point it is ${where} the ${SHAPE_NAMES[shape].toLowerCase()}, whether or not you can see it.`,
    ],
    tableTitle: 'Measurements', columns: ['', 'quantity', 'value'], rows: [placeRow, offRow, insideRow], markers: [marker],
  };
}

const explorer = {
  title: 'Point explorer',
  subtitle: 'One point with four coordinates',
  buttonTitle: 'Point explorer',
  blurb: 'The explorer takes a point with four coordinates and works out where it sits in your slice, how far off the slice it is, and whether it is inside the shape.',
  pointTitle: 'Point, in the shape\'s coordinates',
  coordinates: ['x', 'y', 'z', 'w'].map(label => ({ label, range: [-2, 2] })),
  moveHint: 'Arrow keys move the point within your slice; with Shift, ↑ and ↓ move it away and nearer. Click or tap the shape to put the point on its surface. The point is drawn as a small 4D ball: it shrinks as it leaves your slice, and is a grey speck once it is out of it.',
  initialProbe: state => slicePoint(slice(state), [0.6, 0.4, 0.5]),
  report: (probe, state) => explorerReport(probe, state),
  move(probe, right, up, away, state) {
    const s = slice(state);
    const axis = v => Camera.rotate(v, state.yaw, state.pitch);
    const r = axis([1, 0, 0]), u = axis([0, 1, 0]), b = axis([0, 0, 1]);
    const step = [0, 1, 2].map(i => (r[i] * right + u[i] * up - b[i] * away) * 0.05);
    return probe.map((c, i) => c + s.e1[i] * step[0] + s.e2[i] * step[1] + s.e3[i] * step[2]);
  },
  pick(viewPoint, state) {
    const s = slice(state);
    const local = [viewPoint[0] * 0.72, viewPoint[1] * 0.72, -1.65];
    const length = Math.hypot(...local);
    const direction = Camera.rotate(local.map(c => c / length), state.yaw, state.pitch);
    const shape = shapeIndex(state);
    const hit = Camera.raycast(Camera.position(state), direction, state, u => shapeDistance(slicePoint(s, u), shape));
    return hit ? slicePoint(s, hit.point) : null;
  },
};

export const world = {
  id: 'four-d',
  title: '4D slices',
  formula: 'x = u₁e₁ + u₂e₂ + u₃e₃ + w·n',
  summary: 'Shapes with four coordinates, seen the only way a three-dimensional creature can: one solid slice at a time. Push a tesseract through your space corner first and watch a tetrahedron become an octahedron.',
  fragment: FRAGMENT,
  defaults,
  cameraDistanceRange: [2.6, 12.0],
  paletteNames: ['Cells', 'Hidden coordinate', 'Chalk'],
  controlGroups: [
    group('Shape', `
      Each shape is defined by a condition on four coordinates
      x, y, z, w. The hypersphere is every point at one distance
      from the centre. The tesseract is every point whose four
      coordinates all lie between −1 and 1: a cube with one more
      coordinate.

      The simplex has five corners, each at the same distance
      from the other four, which three dimensions cannot manage.
      The 16-cell is |x| + |y| + |z| + |w| ≤ r, the 4D octahedron.`, [
      picker('Shape', SHAPE, SHAPE_NAMES),
      readout('Solid walls', state => ['1, curved', '8 cubes', '5 tetrahedra', '16 tetrahedra'][shapeIndex(state)]),
      readout('Corners', state => ['none', '16', '5', '8'][shapeIndex(state)]),
    ]),
    group('Slice', `
      Your space is a flat three-dimensional slice of the
      four-dimensional one. Position moves the slice along the
      hidden direction, at right angles to everything you can
      see. The shape itself never changes; you are looking at a
      different cross-section of it.

      A sphere passing through a sheet of paper would appear to
      the paper's inhabitants as a dot, a growing circle, a
      shrinking circle, and nothing. This is that, one dimension up.`, [
      slider('Position, w', W, [-2.2, 2.2], value => value.toFixed(2)),
    ]),
    group('Turn through 4D', `
      In three dimensions a rotation turns around an axis. In
      four, it turns around a whole plane, and there are six
      kinds: xy, xz, yz, which are the ordinary ones you get by
      dragging, and xw, yw, zw, which mix a visible direction
      with the hidden one.

      Those three tilt your slice through the shape. A rigid
      shape turning through the hidden direction appears, from
      inside the slice, to change its shape.`, [
      slider('x into w', XW, [-Math.PI, Math.PI], degrees),
      slider('y into w', YW, [-Math.PI, Math.PI], degrees),
      slider('z into w', ZW, [-Math.PI, Math.PI], degrees),
      readout('Hidden direction n', state => `(${slice(state).n.map(c => c.toFixed(2)).join(', ')})`),
    ]),
  ],
  viewNote: `
    Drag to turn the slice you are looking at in the ordinary way, and
    zoom to move closer. Cells colours each face by which solid wall of
    the 4D shape it is cut from. Hidden coordinate colours the surface
    by the shape's own w: blue for negative, orange for positive.`,
  tour,
  explorer,
  distance: (u, state) => shapeDistance(slicePoint(slice(state), u), shapeIndex(state)),
  shaderValues(state) {
    const values = new Array(32).fill(0);
    values[0] = shapeIndex(state);
    values[1] = state.values[W];
    writeSlice(values, slice(state));
    return values;
  },
  discreteValues: new Set([SHAPE]),
  tourKeepsPalette: false,
};
