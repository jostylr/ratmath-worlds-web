// The Mandelbrot set and its Julia sets: one rule, z → z² + c, and the two
// pictures it makes depending on which of z and c is held fixed.
// This is Worlds/Flat/MandelbrotWorld.swift, without its explorer; the tour's
// words are copied from it.
import { newState, copyState, keyframe, slider, picker, toggle, readout, group, Format, WIDE_LOW } from './engine.js';
import { Wide } from './wide.js';
import { SHELF, WHITE, YELLOW, CYAN, PINK, dot, segment, blend, complex } from './flat-support.js';
import { FRAGMENT } from './shaders/mandelbrot.js';

// Indices into the state's values.
const CENTRE_X = 0;
const CENTRE_Y = 1;
// The small remainders of the centre's two coordinates (see wide.js), stored
// multiplied by WIDE_LOW.
const CENTRE_LOW_X = 8;
const CENTRE_LOW_Y = 9;
const PICTURE = 2;
const C_X = 3;
const C_Y = 4;
const LIMIT = 5;
const INSET = 6;
const ORBIT = 7;

/** Plane units from the centre of the view to the edge of its shorter side,
    at 1× zoom. */
const SPAN = 1.35;

/** The nearest and farthest the picture can be seen from. */
/** How close the view can come: where thirty-two digits run out. */
const DISTANCE_RANGE = [1.0 / 1e26, 2.5];
/** Views narrower than this have their reference orbit followed with
    thirty-two digits; sixteen are enough until then, and quicker. */
const WIDE_BELOW = 1e-11;

const defaults = newState();
defaults.values[CENTRE_X] = -0.6;
defaults.values[C_X] = -0.12;
defaults.values[C_Y] = 0.75;
defaults.values[LIMIT] = 300;
defaults.values[INSET] = 1;
defaults.cameraDistance = 1;

const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);

// MARK: Reading the state

const isJulia = state => state.values[PICTURE] > 0.5;
const scale = state => SPAN * state.cameraDistance;
const centre = state => [state.values[CENTRE_X], state.values[CENTRE_Y]];
/** The centre to twice the digits: each coordinate a wide number. */
const wideCentre = state => [
  [state.values[CENTRE_X], state.values[CENTRE_LOW_X] / WIDE_LOW],
  [state.values[CENTRE_Y], state.values[CENTRE_LOW_Y] / WIDE_LOW],
];
function setCentre(x, y, state) {
  state.values[CENTRE_X] = x[0];
  state.values[CENTRE_LOW_X] = x[1] * WIDE_LOW;
  state.values[CENTRE_Y] = y[0];
  state.values[CENTRE_LOW_Y] = y[1] * WIDE_LOW;
}
/** How many decimal places of the centre are worth showing. */
const places = state => Math.min(Math.max(Math.ceil(-Math.log10(scale(state))) + 4, 6), 30);
const c = state => [state.values[C_X], state.values[C_Y]];
const stepLimit = state => Math.round(clamp(state.values[LIMIT], 2, 8000));

function plane(viewPoint, state) {
  const s = scale(state);
  return [state.values[CENTRE_X] + viewPoint[0] * s, state.values[CENTRE_Y] + viewPoint[1] * s];
}

function view(point, state) {
  const s = scale(state);
  return [(point[0] - state.values[CENTRE_X]) / s, (point[1] - state.values[CENTRE_Y]) / s];
}

// MARK: The rule

const square = z => [z[0] * z[0] - z[1] * z[1], 2 * z[0] * z[1]];
const lengthSquared = z => z[0] * z[0] + z[1] * z[1];

/** How far an orbit is followed before giving up on it. */
const PATIENCE = 4000;

/**
 * What becomes of one starting number: `points` is z₀, z₁, … up to the step
 * that escaped, or as far as was followed; `escapedAt` the first n with
 * |zₙ| > 2; `period` the length of the cycle the orbit settles into, if it
 * does.
 */
function orbit(start, constant) {
  const points = [start];
  let z = start;
  for (let n = 0; n < PATIENCE; n += 1) {
    if (lengthSquared(z) > 4) { return { points, escapedAt: n, period: null }; }
    const squared = square(z);
    z = [squared[0] + constant[0], squared[1] + constant[1]];
    points.push(z);
  }
  if (lengthSquared(z) > 4) { return { points, escapedAt: PATIENCE, period: null }; }
  // A cycle shows as the same value coming round again.
  for (let period = 1; period <= 128; period += 1) {
    const earlier = points[points.length - 1 - period];
    if (Math.hypot(z[0] - earlier[0], z[1] - earlier[1]) < 1e-9) {
      return { points, escapedAt: null, period };
    }
  }
  return { points, escapedAt: null, period: null };
}

function fate(path, limit) {
  if (path.escapedAt !== null) {
    const n = path.escapedAt;
    return n > limit ? `escapes at step ${n}, past the limit` : `escapes at step ${n}`;
  }
  if (path.period !== null) {
    return path.period === 1 ? 'settles on one value' : `settles into a cycle of ${path.period}`;
  }
  return `still wandering after ${PATIENCE} steps`;
}

// MARK: Marks

/** The first steps of an orbit, joined up. */
function orbitMarkers(path, selected, state) {
  const markers = [];
  const shown = Math.min(path.points.length - 1, 40);
  if (shown < 0) { return markers; }
  for (let index = 0; index < shown; index += 1) {
    const color = blend(CYAN, PINK, index / Math.max(shown - 1, 1));
    markers.push(segment(view(path.points[index], state), view(path.points[index + 1], state), color));
  }
  for (let index = 0; index <= shown; index += 1) {
    const color = blend(CYAN, PINK, index / Math.max(shown, 1));
    markers.push(dot(view(path.points[index], state), color, 0.009));
  }
  if (selected !== null && selected >= 0 && selected < path.points.length) {
    markers.push(dot(view(path.points[selected], state), WHITE, 0.02));
  }
  return markers.filter(Boolean);
}

// MARK: Guided tour

function looking(base, x, y, zoom) {
  const state = copyState(base);
  if (typeof x === 'string') {
    // A place given to more digits than one number holds.
    setCentre(Wide.fromDecimal(x), Wide.fromDecimal(y), state);
  } else {
    setCentre([x, 0], [y, 0], state);
  }
  state.cameraDistance = 1 / zoom;
  return state;
}

function choosing(base, x, y) {
  const state = copyState(base);
  state.values[C_X] = x;
  state.values[C_Y] = y;
  return state;
}

const tour = [
  {
    title: 'One rule, tried on every number',
    body: `
      Take a number c. Start from zero, square it and add c. Square
      the answer and add c again, and keep going. Either the answers
      stay small for ever, or they run away, each larger than the last.

      Every point of this picture is a different c. The black points
      are the ones whose answers stay small: the Mandelbrot set. The
      numbers here are complex, with two parts, which is why they
      fill a plane and not just a line.`,
    tryIt: 'Drag, pinch, and double-tap to dive in',
    build(base) {
      const state = copyState(base);
      state.values[INSET] = 0;
      return [keyframe(state, 2.5)];
    },
  },
  {
    title: 'Follow one number',
    body: `
      The yellow dot is c, and the line follows its answers from zero.
      Inside the big heart they spiral in to one value and stay there.

      Now c moves into the disc on the left. The answers no longer
      settle on one value: they hop between two. Then c moves out
      into the colours, and after a few steps the answers fly off the
      picture. Which side of the border c is on decides everything.`,
    tryIt: 'The number c → Orbit of 0, then tap the picture',
    build(base) {
      const state = copyState(base);
      state.values[INSET] = 0;
      state.values[ORBIT] = 1;
      state.cameraDistance = 0.85;
      const heart = choosing(state, -0.4, 0.2);
      const disc = choosing(state, -1.0, 0.12);
      const outside = choosing(state, 0.45, 0.25);
      return [
        keyframe(heart, 2.0, 4.0),
        keyframe(disc, 5.0, 4.0),
        keyframe(heart, 3.0),
        keyframe(outside, 5.0),
      ];
    },
  },
  {
    title: 'The colours are a count',
    body: `
      Outside the set, every c escapes sooner or later, and the colour
      says how soon. Each band here is one count: the outermost points
      are past 2 from zero at once, the next band takes one more step,
      and so on inward.

      The bands crowd together toward the black, because the nearer c
      is to the border the longer it takes to make up its mind. Then
      the picture changes to a colouring that smooths between the
      counts.`,
    tryIt: 'View → Colour → Bands',
    build(base) {
      const bands = copyState(base);
      bands.values[INSET] = 0;
      bands.palette = 1;
      const smooth = copyState(bands);
      smooth.palette = 0;
      return [keyframe(bands, 2.0, 7.0), keyframe(smooth, 0.0)];
    },
  },
  {
    title: 'Every bulb has a number',
    body: `
      In the bulb at the top, the answers go round a cycle of three.
      The bulb to its right has a cycle of four, and the one to its
      left a cycle of five.

      Every bulb on the heart has its own number, and there is a bulb
      for every fraction: the three at the top sits a third of the
      way round the heart, and between any two bulbs the largest one
      has their numbers added together. Between the two and the three
      sits the five.`,
    tryIt: 'Tap a bulb with Orbit of 0 switched on',
    build(base) {
      const state = looking(base, -0.25, 0.45, 1.9);
      state.values[INSET] = 0;
      state.values[ORBIT] = 1;
      return [
        keyframe(choosing(state, -0.1226, 0.7449), 2.5, 4.0),
        keyframe(choosing(state, 0.2819, 0.5300), 3.0, 4.0),
        keyframe(choosing(state, -0.5044, 0.5627), 4.0),
      ];
    },
  },
  {
    title: 'The border never smooths out',
    body: `
      This is the valley between the heart and the disc. A smooth
      curve looks straighter the closer you look. This border does
      the opposite: at sixty times closer there are spirals, and at
      two thousand times closer the arms of the spirals have spirals
      of their own.

      Nothing here is stored. Each pixel is a number c, and the rule
      is run for it afresh at every zoom.`,
    tryIt: 'Double-tap any spot on the border',
    build(base) {
      const state = copyState(base);
      state.values[INSET] = 0;
      state.values[LIMIT] = 700;
      return [
        keyframe(looking(state, -0.7453, 0.1127, 60), 7.0, 3.0),
        keyframe(looking(state, -0.7453, 0.1127, 2000), 9.0),
      ];
    },
  },
  {
    title: 'A copy of the whole',
    body: `
      Far out along the needle on the left is a speck. Closer, it is
      a small Mandelbrot set, with its own heart, its own disc and its
      own bulbs. Inside its heart the answers go round a cycle of three.

      There are infinitely many of these copies, none exactly the
      same, and every one is joined to the main set by threads too
      thin to see. The Mandelbrot set is one connected piece.`,
    tryIt: 'Reset view, then look along the needle',
    build(base) {
      const state = copyState(base);
      state.values[INSET] = 0;
      state.values[LIMIT] = 500;
      return [
        keyframe(looking(state, -1.2, 0, 1.2), 2.5, 1.0),
        keyframe(looking(state, -1.7549, 0, 45), 9.0),
      ];
    },
  },
  {
    title: 'Past the end of the numbers',
    body: `
      This dive goes to three million times. A graphics chip keeps
      about seven digits, and long before this depth every pixel on
      the screen would be the same number to it: the picture would
      break up into blocks.

      So the app follows one orbit in the view itself, with sixteen
      digits, and hands it to the chip. Each pixel then works out
      only how its own orbit differs from that one, and a small
      difference needs few digits. The same trick, with more digits
      for the one orbit, is how the deepest zooms ever made were
      computed.`,
    tryIt: 'Keep double-tapping; raise Rule → Step limit as you go',
    build(base) {
      const state = copyState(base);
      state.values[INSET] = 0;
      state.values[LIMIT] = 2500;
      return [
        keyframe(looking(state, -0.743643977, 0.131826294, 300), 6.0, 1.0),
        keyframe(looking(state, -0.743643977, 0.131826294, 3000000), 16.0),
      ];
    },
  },
  {
    title: 'Twenty zeros',
    body: `
      This is the centre of one of the spirals in the valley, a
      point that can be worked out to as many digits as you like.
      The dive goes to a hundred million million million times. If
      the whole set were as wide as the Milky Way, the screen would
      now be showing a stretch ten paces long.

      Sixteen digits ran out along the way. From there the one
      orbit is followed with thirty-two, and the spiral goes on
      turning exactly as before. It always will: around this point
      the set looks the same at every scale.`,
    tryIt: 'Where you are → Centre shows the digits in use',
    build(base) {
      const state = copyState(base);
      state.values[INSET] = 0;
      state.values[LIMIT] = 6000;
      const x = '-0.776610592599701856564039502552994749';
      const y = '0.134608961675028166056737270233057809';
      return [
        keyframe(looking(state, x, y, 50), 5.0, 1.0),
        keyframe(looking(state, x, y, 1e20), 30.0),
      ];
    },
  },
  {
    title: 'The other picture: Julia sets',
    body: `
      Now hold c fixed and ask a different question: which starting
      numbers stay small? The answer is the small picture: the Julia
      set of the c under the yellow dot.

      While c is in the black, its Julia set is one connected piece.
      As c crosses the border, the Julia set breaks up, and out in the
      colours it is a dust of disconnected points. That is the
      original meaning of the Mandelbrot set: the c whose Julia sets
      hold together.`,
    tryIt: 'The number c → Small picture, then tap around',
    build(base) {
      const state = copyState(base);
      state.cameraDistance = 0.9;
      return [
        keyframe(choosing(state, -0.1226, 0.7449), 2.0, 3.5),
        keyframe(choosing(state, -0.75, 0.05), 5.0, 2.5),
        keyframe(choosing(state, -0.8, 0.3), 5.0, 2.5),
        keyframe(choosing(state, 0.36, 0.36), 6.0, 2.5),
        keyframe(choosing(state, 0.45, 0.25), 4.0),
      ];
    },
  },
  {
    title: 'A Julia set, full size',
    body: `
      Here the Julia set fills the screen and the small picture is the
      map, with the yellow dot showing which c is in use. As the dot
      travels, the Julia set changes shape continuously: a rabbit with
      three ears from the bulb of three, then spirals near the valley,
      then a lightning bolt at the tip of an antenna.

      Each Julia set looks the same all the way round and at every
      scale. The Mandelbrot set is richer: near any c, it looks like
      the Julia set of that c.`,
    tryIt: 'Rule → Picture → Julia set, then the c sliders',
    build(base) {
      const state = looking(base, 0, 0, 0.85);
      state.values[PICTURE] = 1;
      return [
        keyframe(choosing(state, -0.1226, 0.7449), 2.0, 3.5),
        keyframe(choosing(state, -0.76, 0.12), 7.0, 3.0),
        keyframe(choosing(state, 0.0, 1.0), 8.0),
      ];
    },
  },
  {
    title: 'Your turn',
    body: `
      Drag and pinch to travel, and double-tap to dive. Tap the
      Mandelbrot set to choose c and watch its Julia set in the small
      picture. Switch the main picture between the two. Every group
      of controls has an ⓘ button with a short note.

      The address of this page always holds the view on screen, so a
      copied link brings anyone to the very same spot.`,
    build: base => [keyframe(base, 2.5)],
  },
];

// MARK: World

// MARK: The reference orbit

const NO_REFERENCE = new Float32Array(4);
const referenceCache = { key: '', value: { offset: [0, 0], last: 0, orbit: NO_REFERENCE } };

/** One orbit, followed with JavaScript's full precision, that the shader
    measures every pixel against (mandelDeep in the shader): where its c lies,
    measured from the centre of the view, and z₀, z₁, … four numbers apiece. */
function reference(state) {
  const limit = stepLimit(state);
  const middle = wideCentre(state);
  const key = [...middle[0], ...middle[1], scale(state), limit].join(',');
  if (key === referenceCache.key) { return referenceCache.value; }
  const wide = scale(state) < WIDE_BELOW;

  const follow = (dx, dy) => {
    const orbit = new Float32Array(4 * (limit + 1));
    let last = 0;
    if (wide) {
      // The same rule, with every number carried as two.
      const cx = Wide.plus(middle[0], dx), cy = Wide.plus(middle[1], dy);
      let x = [0, 0], y = [0, 0];
      for (let n = 1; n <= limit; n += 1) {
        const next = Wide.add(Wide.sub(Wide.mul(x, x), Wide.mul(y, y)), cx);
        y = Wide.add(Wide.times(Wide.mul(x, y), 2), cy);
        x = next;
        orbit[4 * n] = x[0];
        orbit[4 * n + 1] = y[0];
        last = n;
        if (x[0] * x[0] + y[0] * y[0] > 1e6) { break; }
      }
      return { last, orbit };
    }
    const cx = middle[0][0] + dx, cy = middle[1][0] + dy;
    let x = 0, y = 0;
    for (let n = 1; n <= limit; n += 1) {
      const next = x * x - y * y + cx;
      y = 2 * x * y + cy;
      x = next;
      orbit[4 * n] = x;
      orbit[4 * n + 1] = y;
      last = n;
      if (x * x + y * y > 1e6) { break; }
    }
    return { last, orbit };
  };

  // The longer the reference lasts, the better it serves: try the centre
  // and a grid of other places in the view, and keep the one that stays
  // longest.
  let best = { offset: [0, 0], ...follow(0, 0) };
  search: if (best.last < limit) {
    for (let row = -3; row <= 3; row += 1) {
      for (let column = -3; column <= 3; column += 1) {
        if (row === 0 && column === 0) { continue; }
        const offset = [column * 0.4 * scale(state), row * 0.4 * scale(state)];
        const candidate = follow(offset[0], offset[1]);
        if (candidate.last > best.last) {
          best = { offset, ...candidate };
          if (candidate.last >= limit) { break search; }
        }
      }
    }
  }
  referenceCache.key = key;
  referenceCache.value = best;
  return best;
}

export const world = {
  id: 'mandelbrot',
  title: 'Mandelbrot and Julia sets',
  formula: 'z → z² + c',
  summary: 'Square a number, add c, and do it again. Colour each c by whether the answers stay small or run away, and the border between the two has detail at every scale. Every point of it is also the recipe for another picture.',
  fragment: FRAGMENT,
  defaults,
  cameraDistanceRange: DISTANCE_RANGE,
  paletteNames: ['Dawn', 'Bands', 'Ember'],
  controlGroups: [
    group('Rule', `
      A point of the picture is a complex number: x across, y up,
      written x + yi. Squaring one squares its distance from zero
      and doubles its angle. The rule is z → z² + c, applied over
      and over.

      Mandelbrot set: every point is a different c, and the rule
      always starts from z = 0. Black means the answers never get
      farther than 2 from zero. Julia set: c is the same for the
      whole picture, and every point is a different starting z.

      A point is given up as black after Step limit steps. Near
      the border, points take longer and longer to decide, so a
      higher limit sharpens the edge and costs time.`, [
      picker('Picture', PICTURE, ['Mandelbrot set', 'Julia set']),
      slider('Step limit', LIMIT, [20, 8000], value => String(Math.round(value))),
    ]),
    group('The number c', `
      Tap the Mandelbrot set to choose c: the yellow dot. The
      small picture shows the Julia set that this c makes. Choose
      c in the black and its Julia set is one connected piece;
      choose it in the colours and the Julia set falls apart into
      dust. That is what the Mandelbrot set is: the map of which
      Julia sets hold together.

      Orbit of 0 draws the first forty answers the rule gives for
      this c, starting from 0. In the big heart they spiral in to
      one value. In the disc to its left they end up hopping
      between two, and each smaller bulb has its own number.`, [
      slider('c, real part', C_X, [-2, 1], value => Format.number(value, 4)),
      slider('c, imaginary part', C_Y, [-1.5, 1.5], value => Format.number(value, 4)),
      readout('Starting from 0', state => fate(orbit([0, 0], c(state)), stepLimit(state))),
      toggle('Small picture', INSET),
      { ...toggle('Orbit of 0', ORBIT), visible: state => !isJulia(state) },
    ]),
    group('Where you are', `
      The whole Mandelbrot set fits in a window three units wide.
      Width shown is how much of the plane the shorter side of
      the view now covers.

      The picture is worked out afresh for every pixel at every
      zoom, so nothing is stored and nothing runs out, until the
      numbers themselves do. A graphics chip keeps about seven
      digits, and past 20,000× neighbouring pixels would agree
      in all seven. So one orbit in the view is followed with
      sixteen digits, and each pixel works out only how its own
      orbit differs from that one. That reaches a million
      million times, where sixteen digits run out in turn.

      Past there the one orbit is followed with thirty-two
      digits, each number kept as a large part and a small
      remainder, and the centre is shown here to thirty places.
      The dive stops at 10²⁶×, where those run out too. Long
      before that the step limit is what matters: the deeper
      you go, the higher it needs to be, and the slower the
      picture.

      A Julia set is drawn the plain way, and blurs into blocks
      past 20,000×.`, [
      readout('Centre, real', state => Wide.decimal(wideCentre(state)[0], places(state))),
      readout('Centre, imaginary', state => Wide.decimal(wideCentre(state)[1], places(state))),
      readout('Width shown', state => Format.significant(2 * scale(state), 3)),
    ]),
  ],
  viewNote: `
    Drag to move the picture and pinch to zoom. Double-tap a spot to dive
    toward it. A single tap on the Mandelbrot set chooses c.`,
  tour,
  shaderValues(state) {
    const chosen = c(state);
    const values = new Array(32).fill(0);
    values[0] = state.values[CENTRE_X];
    values[1] = state.values[CENTRE_Y];
    values[2] = scale(state);
    values[3] = stepLimit(state);
    values[4] = isJulia(state) ? 1 : 0;
    values[5] = chosen[0];
    values[6] = chosen[1];
    values[7] = state.values[INSET] > 0.5 ? 1 : 0;
    if (!isJulia(state)) {
      const ref = reference(state);
      values[8] = ref.last;
      values[9] = ref.offset[0];
      values[10] = ref.offset[1];
    }
    return values;
  },
  shaderData: state => (isJulia(state) ? NO_REFERENCE : reference(state).orbit),
  discreteValues: new Set([PICTURE, INSET, ORBIT]),
  cameraBacksAwayWhenMoving: false,
  drag(state, probe, dx, dy) {
    const [x, y] = wideCentre(state);
    setCentre(Wide.plus(x, -dx * scale(state)), Wide.plus(y, dy * scale(state)), state);
  },
  resetView(state) {
    setCentre([isJulia(state) ? 0 : defaults.values[CENTRE_X], 0], [0, 0], state);
  },
  overlayMarkers(state) {
    if (isJulia(state)) { return []; }
    const markers = [];
    if (state.values[ORBIT] > 0.5) {
      markers.push(...orbitMarkers(orbit([0, 0], c(state)), null, state));
    }
    if (state.values[ORBIT] > 0.5 || state.values[INSET] > 0.5) {
      markers.push(dot(view(c(state), state), YELLOW));
    }
    return markers.filter(Boolean);
  },
  tourKeepsPalette: false,
  flatCentre: [CENTRE_X, CENTRE_Y],
  flatCentreLow: [CENTRE_LOW_X, CENTRE_LOW_Y],
  zoomTarget(viewPoint, state, factor) {
    // Closer by the factor, with the point under the finger staying where it is.
    const target = copyState(state);
    target.cameraDistance = clamp(state.cameraDistance / factor, ...DISTANCE_RANGE);
    const ratio = target.cameraDistance / state.cameraDistance;
    const shift = scale(state) * (1 - ratio);
    const [x, y] = wideCentre(state);
    setCentre(Wide.plus(x, viewPoint[0] * shift), Wide.plus(y, viewPoint[1] * shift), target);
    return target;
  },
  tap(state, viewPoint) {
    if (isJulia(state)) { return; }
    const point = plane(viewPoint, state);
    state.values[C_X] = clamp(point[0], -2, 1);
    state.values[C_Y] = clamp(point[1], -1.5, 1.5);
  },
  urlDigits: 20,
  shelf: SHELF,
};
