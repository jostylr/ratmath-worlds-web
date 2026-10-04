// A pendulum over three magnets. Each place the bob can be let go is
// coloured by the magnet it finally rests over, and the borders between
// the colours are fractal: the basin pictures of Gleick's Chaos.
// This is Worlds/Flat/PendulumWorld.swift, without its explorer; the tour's
// words are copied from it.
import { newState, copyState, keyframe, slider, toggle, readout, group, Format } from './engine.js';
import { SHELF, lookDown, plane, pan, dive } from './flat-support.js';
import { FRAGMENT } from './shaders/pendulum.js';

// Indices into the state's values.
const FRICTION = 0;
const DEPTH = 1;
const PULL = 2;
const START_X = 3;
const START_Y = 4;
const PATH = 5;
const SHOWN = 6;

/** The nearest and farthest the picture can be seen from. */
const RANGE = [6.4 / 3000, 14.0];
/** The time between steps, and how long one swing is followed. */
const DT = 0.05;
const DURATION = 40.0;
const STEPS = Math.trunc(DURATION / DT);
const MAGNETS = [0, 1, 2].map(index => {
  const angle = Math.PI / 2 + 2 * Math.PI / 3 * index;
  return [Math.cos(angle), Math.sin(angle)];
});
const MAGNET_NAMES = ['the red magnet', 'the yellow magnet', 'the blue magnet'];

const defaults = lookDown(newState(), 6.4);
defaults.values[FRICTION] = 0.2;
defaults.values[DEPTH] = 0.5;
defaults.values[PULL] = 0.5;
defaults.values[START_X] = -1.9;
defaults.values[START_Y] = 1.4;
defaults.values[PATH] = 1;
defaults.values[SHOWN] = DURATION;

const start = state => [state.values[START_X], state.values[START_Y]];

// MARK: The rule

const lengthSquared = p => p[0] * p[0] + p[1] * p[1];

/** The forces on the bob at p: the pull to the middle, friction, each
    magnet's pull, and all of them together. */
function forces(p, velocity, state) {
  const spring = [p[0] * -state.values[PULL], p[1] * -state.values[PULL]];
  const drag = [velocity[0] * -state.values[FRICTION], velocity[1] * -state.values[FRICTION]];
  const depth2 = state.values[DEPTH] * state.values[DEPTH];
  const total = [spring[0] + drag[0], spring[1] + drag[1]];
  const magnets = MAGNETS.map(magnet => {
    const toward = [magnet[0] - p[0], magnet[1] - p[1]];
    const d2 = lengthSquared(toward) + depth2;
    const by = d2 * Math.sqrt(d2);
    const pull = [toward[0] / by, toward[1] / by];
    total[0] += pull[0];
    total[1] += pull[1];
    return pull;
  });
  return { spring, drag, magnets, total };
}

function nearestMagnet(p) {
  let best = 0;
  let least = Infinity;
  for (let index = 0; index < 3; index += 1) {
    const d2 = lengthSquared([p[0] - MAGNETS[index][0], p[1] - MAGNETS[index][1]]);
    if (d2 < least) { least = d2; best = index; }
  }
  return best;
}

/**
 * One swing from rest: `points` and `velocities` at each step, and `settled`
 * the step at which it was slow and close enough to a magnet to stay.
 */
function swing(from, state) {
  let p = [from[0], from[1]];
  let velocity = [0, 0];
  const points = [p];
  const velocities = [velocity];
  let settled = null;
  for (let step = 0; step < STEPS; step += 1) {
    const total = forces(p, velocity, state).total;
    velocity = [velocity[0] + total[0] * DT, velocity[1] + total[1] * DT];
    p = [p[0] + velocity[0] * DT, p[1] + velocity[1] * DT];
    points.push(p);
    velocities.push(velocity);
    const magnet = MAGNETS[nearestMagnet(p)];
    const close = lengthSquared([p[0] - magnet[0], p[1] - magnet[1]]);
    if (settled === null && close < 0.04 && lengthSquared(velocity) < 0.01) { settled = step + 1; }
  }
  return { points, velocities, settled };
}

function fate(path) {
  const end = nearestMagnet(path.points[path.points.length - 1]);
  if (path.settled === null) { return `still swinging at time ${Math.trunc(DURATION)}`; }
  return `${MAGNET_NAMES[end]}, by time ${Format.number(path.settled * DT, 1)}`;
}

/** The swing is worked out again only when what it depends on changes. */
const cache = { key: [], swing: { points: [], velocities: [], settled: null } };

function cachedSwing(from, state) {
  const key = [from[0], from[1], state.values[FRICTION], state.values[DEPTH], state.values[PULL]];
  if (key.length !== cache.key.length || key.some((value, index) => value !== cache.key[index])) {
    cache.key = key;
    cache.swing = swing(from, state);
  }
  return cache.swing;
}

// MARK: The path

/** The path's segments and its two dots. */
const lineData = new Float32Array(12 * (STEPS + 2));
let lineCount = 0;

/** Adds one line in the plane: its two ends, colour and half-width in
    points. A dot is a segment with no length. */
function addLine(a, b, r, g, blue, alpha, width) {
  const at = 12 * lineCount;
  lineData[at] = a[0];
  lineData[at + 1] = a[1];
  lineData[at + 2] = 0;
  lineData[at + 3] = width;
  lineData[at + 4] = b[0];
  lineData[at + 5] = b[1];
  lineData[at + 6] = 0;
  lineData[at + 7] = 0;
  lineData[at + 8] = r;
  lineData[at + 9] = g;
  lineData[at + 10] = blue;
  lineData[at + 11] = alpha;
  lineCount += 1;
}

function lines(state, probe) {
  lineCount = 0;
  if (!(state.values[PATH] > 0.5 || probe)) { return { data: lineData, count: 0 }; }
  const origin = probe ? [probe[0], probe[1]] : start(state);
  const path = cachedSwing(origin, state);
  const head = Math.min(Math.trunc(Math.max(state.values[SHOWN], 0) / DT), path.points.length - 1);
  for (let index = 1; index <= head; index += 1) {
    const age = index / path.points.length;
    addLine(path.points[index - 1], path.points[index], 1, 1, 1, 0.75 - 0.4 * age, 1.1);
  }
  addLine(origin, origin, 1, 1, 1, 1, 4.5);
  addLine(path.points[head], path.points[head], 1, 0.85, 0.3, 1, 5.5);
  return { data: lineData, count: lineCount };
}

// MARK: Guided tour

function letGo(base, x, y, time = DURATION) {
  const state = copyState(base);
  state.values[START_X] = x;
  state.values[START_Y] = y;
  state.values[SHOWN] = time;
  return state;
}

function looking(base, x, y, zoom) {
  const state = copyState(base);
  state.focus = [x, y, 0];
  state.cameraDistance = base.cameraDistance / zoom;
  return state;
}

const tour = [
  {
    title: 'A toy on a desk',
    body: `
      A steel bob hangs on a string over three magnets: the white
      dots. Pull it aside and let go. It swoops toward one magnet,
      is flung past, is caught by another, and after a while,
      slowed by friction, it stops over one of the three.

      This is the swing seen from above, drawn as it goes. Forget
      the colours for a moment and watch the line.`,
    tryIt: 'One swing → Time shown',
    build: base => [
      keyframe(letGo(base, -1.9, 1.4, 0), 1.5, 1.0),
      keyframe(letGo(base, -1.9, 1.4), 16.0),
    ],
  },
  {
    title: 'Which magnet wins?',
    body: `
      Now the place it is let go from slides a short way across
      the picture. For a while the path changes only a little, and
      ends over the same magnet. Then, with no warning, the whole
      later part of the path is different, and it ends over
      another. Then another.

      The laws are simple and nothing is random. But to predict
      the winner you would have to know the starting place far
      more exactly than you could ever set it by hand.`,
    tryIt: 'Tap to let go from somewhere else',
    build: base => [
      keyframe(letGo(base, -1.9, 1.4), 1.5, 1.0),
      keyframe(letGo(base, -1.3, 1.9), 18.0),
    ],
  },
  {
    title: 'Every starting place at once',
    body: `
      That is what the colours are. Each point is a place to let
      go, painted with the colour of the magnet the bob ends over:
      red, yellow or blue. Brighter means it settled quickly.

      Round each magnet is a broad patch of its own colour. Start
      there and the ending is safe. Between the patches the three
      colours are wound round one another in bands.`,
    tryIt: 'View → Colour → Time',
    build(base) {
      const state = copyState(base);
      state.values[PATH] = 0;
      return [keyframe(state, 2.5)];
    },
  },
  {
    title: 'Borders with no edge',
    body: `
      Closer in on a place where the bands crowd together. A
      border between two colours on a map is a line. Here, between
      any band of one colour and the next lies a thinner band of
      the third, and beside that thinner ones still.

      However finely you could set the starting place, there are
      regions where it would not be finely enough. These are
      fractal basin boundaries, and they turn up wherever a system
      has more than one place to come to rest.`,
    tryIt: 'Double-tap where the bands are thin',
    build(base) {
      const state = copyState(base);
      state.values[PATH] = 0;
      return [
        keyframe(looking(state, -0.284, 1.152, 5), 6.0, 2.5),
        keyframe(looking(state, -0.284, 1.152, 20), 9.0),
      ];
    },
  },
  {
    title: 'Friction decides how tangled',
    body: `
      With more friction the bob loses heart quickly and falls to
      a magnet near where it started: the patches grow and the
      bands thin out.

      With less, it keeps swinging, passes all three magnets many
      times before it tires, and each pass is another chance for
      a small difference to grow. The tangle spreads over the
      whole picture.`,
    tryIt: 'Pendulum → Friction',
    build(base) {
      const heavy = copyState(base);
      heavy.values[PATH] = 0;
      heavy.values[FRICTION] = 0.45;
      const light = copyState(heavy);
      light.values[FRICTION] = 0.12;
      return [keyframe(heavy, 4.0, 3.0), keyframe(light, 12.0)];
    },
  },
  {
    title: 'Your turn',
    body: `
      Tap to let the bob go and wind its swing back and forward.
      Find two starting places a hair apart with different
      endings. Change the friction and the depth of the magnets.
      Every group of controls has an ⓘ button with a short note.

      The address of this page always holds the view on screen, so a
      copied link brings anyone to the very same spot.`,
    build: base => [keyframe(base, 2.5)],
  },
];

// MARK: World

const two = value => value.toFixed(2);

export const world = {
  id: 'pendulum',
  title: 'Magnetic pendulum',
  formula: 'Three magnets, one bob: where does it stop?',
  summary: 'A pendulum swings over three magnets and at last comes to rest above one of them. Colour each place it can be let go by the magnet that wins, and the borders between the colours never simplify, however closely you look.',
  fragment: FRAGMENT,
  defaults,
  cameraDistanceRange: RANGE,
  paletteNames: ['Magnets', 'Time'],
  controlGroups: [
    group('Pendulum', `
      Seen from above. The bob hangs over the middle, and
      gravity pulls it back there in proportion to how far out
      it is. Friction slows it in proportion to its speed. Each
      magnet, a little way below the plane the bob swings in,
      pulls it with a force that falls off as the square of the
      distance. The white dots are the magnets.

      Every point of the picture is a place to let the bob go,
      from rest. The colour is the magnet it ends over; the
      brightness is how soon it stopped wandering between them.

      More friction and the bob gives up sooner: the borders
      grow simpler. Less, and it wanders longer, and the tangle
      spreads.`, [
      slider('Friction', FRICTION, [0.1, 0.5], two),
      slider('Magnets\' depth', DEPTH, [0.25, 1.0], two),
      slider('Pull to the middle', PULL, [0.2, 1.0], two),
    ]),
    group('One swing', `
      Tap the picture to let the bob go from there. The white
      line is its path, from the white dot to the yellow one.
      Time shown winds the swing back and forward.

      In the broad patches of colour around each magnet the bob
      goes more or less straight home. Let it go from the
      tangled regions and it visits all three before choosing,
      and the choice turns on differences too small to see.`, [
      toggle('Show its path', PATH),
      slider('Time shown', SHOWN, [0, DURATION], value => value.toFixed(1), state => state.values[PATH] > 0.5),
      readout('Rests over', state => fate(cachedSwing(start(state), state))),
    ]),
  ],
  viewNote: `
    Drag to move the picture and pinch to zoom. Double-tap a spot to dive
    toward it. A single tap chooses where the bob is let go.`,
  tour,
  shaderValues(state) {
    const values = new Array(32).fill(0);
    values[0] = state.values[FRICTION];
    values[1] = state.values[DEPTH];
    values[2] = state.values[PULL];
    values[3] = DT;
    return values;
  },
  discreteValues: new Set([PATH]),
  cameraBacksAwayWhenMoving: false,
  drag: (state, probe, dx, dy) => pan(state, dx, dy),
  tourKeepsPalette: false,
  lines,
  pitchRange: [0, 0],
  flatFocus: true,
  zoomTarget: (viewPoint, state, factor) => dive(viewPoint, state, factor, RANGE),
  tap(state, viewPoint) {
    const point = plane(viewPoint, state);
    state.values[START_X] = point[0];
    state.values[START_Y] = point[1];
  },
  urlDigits: 10,
  shelf: SHELF,
};
