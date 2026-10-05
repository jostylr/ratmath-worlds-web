// Strange attractors: the Lorenz and Rössler flows, drawn as glowing paths.
// This is Worlds/Dynamics/AttractorWorld.swift, without its explorer; the
// tour's words are copied from it.
import { newState, copyState, keyframe, slider, picker, toggle, readout, group } from './engine.js';
import { FRAGMENT } from './shaders/backdrop.js';

// MARK: The two flows and how their paths are computed

/** Time between stored points, and how long each path is followed. */
const STEP = 0.01;
const DURATION = 40;
const COUNT = Math.floor(DURATION / STEP) + 1;

/** The rule: the velocity at each point, written into `out`. A system is
    { isRossler, p1, p2, p3 }. */
function velocity(system, x, y, z, out) {
  if (system.isRossler) {
    // dx = −y − z, dy = x + a·y, dz = b + z(x − c)
    out[0] = -y - z;
    out[1] = x + system.p1 * y;
    out[2] = system.p2 + z * (x - system.p3);
  } else {
    // dx = σ(y − x), dy = x(ρ − z) − y, dz = xy − βz
    out[0] = system.p1 * (y - x);
    out[1] = x * (system.p2 - z) - y;
    out[2] = x * y - system.p3 * z;
  }
}

const K1 = [0, 0, 0];
const K2 = [0, 0, 0];
const K3 = [0, 0, 0];
const K4 = [0, 0, 0];

/** One step of the fourth-order Runge–Kutta method: four samples of the
    velocity, blended, so that the error per step is tiny. Moves `s` on. */
function advance(system, s, h) {
  const [x, y, z] = s;
  velocity(system, x, y, z, K1);
  velocity(system, x + K1[0] * (h / 2), y + K1[1] * (h / 2), z + K1[2] * (h / 2), K2);
  velocity(system, x + K2[0] * (h / 2), y + K2[1] * (h / 2), z + K2[2] * (h / 2), K3);
  velocity(system, x + K3[0] * h, y + K3[1] * h, z + K3[2] * h, K4);
  s[0] = x + (K1[0] + K2[0] * 2 + K3[0] * 2 + K4[0]) * (h / 6);
  s[1] = y + (K1[1] + K2[1] * 2 + K3[1] * 2 + K4[1]) * (h / 6);
  s[2] = z + (K1[2] + K2[2] * 2 + K3[2] * 2 + K4[2]) * (h / 6);
}

/** The path from a start, as x, y, z of each stored point in turn. */
function path(system, start, out) {
  const s = [start[0], start[1], start[2]];
  out[0] = s[0];
  out[1] = s[1];
  out[2] = s[2];
  for (let index = 1; index < COUNT; index += 1) {
    advance(system, s, STEP);
    // A path that runs away is held at the edge of the numbers.
    if (!(Math.hypot(s[0], s[1], s[2]) < 1e6)) {
      s[0] = out[3 * index - 3];
      s[1] = out[3 * index - 2];
      s[2] = out[3 * index - 1];
    }
    out[3 * index] = s[0];
    out[3 * index + 1] = s[1];
    out[3 * index + 2] = s[2];
  }
  return out;
}

/** Places a point of the flow in the picture: z up, and the whole attractor
    a couple of units across. */
function scene(system, x, y, z, out, at = 0) {
  if (system.isRossler) {
    out[at] = x / 9;
    out[at + 1] = (z - 6) / 9;
    out[at + 2] = y / 9;
  } else {
    out[at] = x / 20;
    out[at + 1] = (z - 25) / 20;
    out[at + 2] = y / 20;
  }
}

const fromScene = (system, p) => (system.isRossler
  ? [p[0] * 9, p[2] * 9, p[1] * 9 + 6]
  : [p[0] * 20, p[2] * 20, p[1] * 20 + 25]);

const CLOUD_PATHS = 160;
const CLOUD_POINTS = Math.ceil(COUNT / 4);

/** Paths are recomputed only when what they depend on changes. */
const cache = {
  key: null,
  main: new Float64Array(3 * COUNT),
  twin: new Float64Array(3 * COUNT),
  /** One list of scene points for each start of the cloud; empty when off. */
  cloud: [],
  scratch: new Float64Array(3 * COUNT),

  update(key) {
    const old = this.key;
    const sameSystem = old !== null && old.system.isRossler === key.system.isRossler
      && old.system.p1 === key.system.p1 && old.system.p2 === key.system.p2 && old.system.p3 === key.system.p3;
    const pathChanged = !sameSystem || old.start.some((c, i) => c !== key.start[i]);
    const twinChanged = pathChanged || old.delta !== key.delta;
    const cloudChanged = pathChanged || old.cloud !== key.cloud;
    this.key = key;
    if (pathChanged) { path(key.system, key.start, this.main); }
    if (twinChanged) {
      path(key.system, [key.start[0] + key.delta, key.start[1], key.start[2]], this.twin);
    }
    if (cloudChanged) {
      this.cloud = [];
      if (!key.cloud) { return; }
      // 160 starts in a small ball round the starting point, every
      // fourth stored point kept.
      let seed = 0x9E3779B97F4A7C15n;
      const random = () => {
        seed = BigInt.asUintN(64, seed * 6364136223846793005n + 1442695040888963407n);
        return Number(seed >> 11n) / 2 ** 53 * 2 - 1;
      };
      for (let n = 0; n < CLOUD_PATHS; n += 1) {
        let offset = [random(), random(), random()];
        while (Math.hypot(...offset) > 1) { offset = [random(), random(), random()]; }
        const whole = path(key.system, key.start.map((c, i) => c + offset[i] * 0.5), this.scratch);
        const points = new Float32Array(3 * CLOUD_POINTS);
        for (let i = 0; i < CLOUD_POINTS; i += 1) {
          scene(key.system, whole[12 * i], whole[12 * i + 1], whole[12 * i + 2], points, 3 * i);
        }
        this.cloud.push(points);
      }
    }
  },
};

// MARK: The world

// Indices into the state's values.
const SYSTEM = 0;
const SIGMA = 1;
const RHO = 2;
const BETA = 3;
const A = 4;
const B = 5;
const C = 6;
const TIME = 7;
const PLAY = 8;
const SPEED = 29;
const TWIN = 9;
const DELTA_POWER = 10;
const CLOUD = 11;
const ARROWS = 12;
const START_X = 13;

const defaults = newState();
defaults.values[SIGMA] = 10;
defaults.values[RHO] = 28;
defaults.values[BETA] = 8 / 3;
defaults.values[A] = 0.2;
defaults.values[B] = 0.2;
defaults.values[C] = 5.7;
defaults.values[TIME] = DURATION;
defaults.values[PLAY] = 1;
defaults.values[SPEED] = 1;
defaults.values[DELTA_POWER] = 5;
defaults.values[START_X] = 2;
defaults.values[START_X + 1] = 3;
defaults.values[START_X + 2] = 12;
// The two wings lie near the plane x = y; this looks at them face on.
defaults.yaw = -0.62;
defaults.pitch = -0.12;
defaults.cameraDistance = 4.7;

const isRossler = state => state.values[SYSTEM] > 0.5;

const flow = state => (isRossler(state)
  ? { isRossler: true, p1: state.values[A], p2: state.values[B], p3: state.values[C] }
  : { isRossler: false, p1: state.values[SIGMA], p2: state.values[RHO], p3: state.values[BETA] });

const start = state => [state.values[START_X], state.values[START_X + 1], state.values[START_X + 2]];

const delta = state => 10 ** -Math.round(state.values[DELTA_POWER]);

function paths(state) {
  cache.update({ system: flow(state), start: start(state), delta: delta(state), cloud: state.values[CLOUD] > 0.5 });
  return cache;
}

/** How far along the paths the picture has reached, in time units. */
function shownTime(state) { return state.values[TIME]; }

/** The arrows of the rule, the cloud, and the two paths with their dots. */
const LINE_CAPACITY = 2 * 9 * 7 * 9 + 2 * CLOUD_PATHS + 2 * COUNT;
const lineData = new Float32Array(12 * LINE_CAPACITY);
let lineCount = 0;
const P = new Float32Array(3);
const Q = new Float32Array(3);
const V = [0, 0, 0];

/** Adds one line: its two ends, colour and half-width in points. A dot is a
    segment with no length. */
function addLine(ax, ay, az, bx, by, bz, r, g, b, alpha, width) {
  const at = 12 * lineCount;
  lineData[at] = ax;
  lineData[at + 1] = ay;
  lineData[at + 2] = az;
  lineData[at + 3] = width;
  lineData[at + 4] = bx;
  lineData[at + 5] = by;
  lineData[at + 6] = bz;
  lineData[at + 7] = 0;
  lineData[at + 8] = r;
  lineData[at + 9] = g;
  lineData[at + 10] = b;
  lineData[at + 11] = alpha;
  lineCount += 1;
}

function lines(state, probe, clock) {
  const system = flow(state);
  const all = paths(state);
  const shown = shownTime(state, clock);
  const head = Math.min(Math.trunc(shown / STEP), COUNT - 1);
  lineCount = 0;

  // The rule itself, as short arrows: where a point at each spot is
  // being carried.
  if (state.values[ARROWS] > 0.5) {
    const reach = system.isRossler ? 1.2 : 2.6;
    for (let ix = -4; ix <= 4; ix += 1) {
      for (let iy = -3; iy <= 3; iy += 1) {
        for (let iz = -4; iz <= 4; iz += 1) {
          const s = fromScene(system, [ix * 0.28, iy * 0.3, iz * 0.28]);
          velocity(system, s[0], s[1], s[2], V);
          const speed = Math.hypot(V[0], V[1], V[2]);
          if (!(speed > 1e-6)) { continue; }
          scene(system, s[0] + V[0] / speed * reach, s[1] + V[1] / speed * reach, s[2] + V[2] / speed * reach, Q);
          scene(system, s[0], s[1], s[2], P);
          const strength = Math.min(speed / (system.isRossler ? 12 : 120), 1);
          const r = 0.35 + 0.5 * strength, g = 0.55, b = 0.9 - 0.5 * strength;
          addLine(P[0], P[1], P[2], Q[0], Q[1], Q[2], r, g, b, 0.5, 0.7);
          addLine(Q[0], Q[1], Q[2], Q[0], Q[1], Q[2], r, g, b, 0.9, 1.6);
        }
      }
    }
  }

  const trail = (points, r, g, b) => {
    if (!(head > 0)) { return; }
    scene(system, points[0], points[1], points[2], P);
    for (let index = 1; index <= head; index += 1) {
      scene(system, points[3 * index], points[3 * index + 1], points[3 * index + 2], Q);
      // Older parts of the path fade.
      const age = (head - index) / COUNT;
      const alpha = 0.07 + 0.30 * (1 - age) * (1 - age);
      addLine(P[0], P[1], P[2], Q[0], Q[1], Q[2], r, g, b, alpha, 0.9);
      P[0] = Q[0];
      P[1] = Q[1];
      P[2] = Q[2];
    }
    addLine(P[0], P[1], P[2], P[0], P[1], P[2], 1, 1, 1, 1, 4.5);
  };

  if (state.values[CLOUD] > 0.5) {
    const index = Math.min(Math.trunc(head / 4), CLOUD_POINTS - 1);
    for (const points of all.cloud) {
      const at = 3 * index;
      addLine(points[at], points[at + 1], points[at + 2], points[at], points[at + 1], points[at + 2],
        1.0, 0.75, 0.3, 0.8, 2.4);
      if (index > 6) {
        addLine(points[at - 18], points[at - 17], points[at - 16], points[at], points[at + 1], points[at + 2],
          1.0, 0.6, 0.2, 0.25, 1.0);
      }
    }
  }

  trail(all.main, 0.25, 0.75, 1.0);
  if (state.values[TWIN] > 0.5) { trail(all.twin, 1.0, 0.35, 0.55); }
  return { data: lineData, count: lineCount };
}

const one = value => value.toFixed(1);
const two = value => value.toFixed(2);
const SUPERSCRIPTS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

// MARK: Guided tour

/** Tour stops scrub time themselves instead of playing. */
function still(base, shown) {
  const s = copyState(base);
  s.values[PLAY] = 0;
  s.values[TIME] = shown;
  return s;
}

const tour = [
  {
    title: 'Three numbers and a rule',
    body: `
      In 1963 the meteorologist Edward Lorenz boiled a model of the
      atmosphere down to three numbers, x, y and z, and three short
      equations that say how fast each one changes.

      The white dot is the present state: one point in a space whose
      axes are those three numbers. The rule tells it which way to
      move at every instant, and the curve is the path it has taken.`,
    tryIt: 'Time → Time shown',
    build: base => [keyframe(still(base, 0), 2.0, 0.5), keyframe(still(base, 9), 14.0)],
  },
  {
    title: 'It never repeats, and never leaves',
    body: `
      The path loops round one centre a few times, crosses over, loops
      round the other, and crosses back. How many loops it makes on
      each side before switching follows no pattern at all.

      Yet it stays for ever on this two-winged shape, the Lorenz
      attractor. Paths from almost any starting point are drawn onto
      it. The curve never crosses itself and never closes up.`,
    build(base) {
      const end = still(base, DURATION);
      end.yaw = 0.3;
      return [keyframe(still(base, 9), 2.0), keyframe(end, 16.0)];
    },
  },
  {
    title: 'The rule is a wind',
    body: `
      The small arrows show the rule itself. At every point of the
      space it gives a velocity, like a wind that blows the same way
      for all time. A point released anywhere is simply carried along.

      Nothing here is random. The same start always gives the same
      path. The irregularity comes entirely from the shape of the wind.`,
    tryIt: 'Time → Flow arrows',
    build(base) {
      const begin = still(base, 0);
      begin.values[ARROWS] = 1;
      begin.cameraDistance = 4.6;
      const end = copyState(begin);
      end.values[TIME] = 14;
      end.yaw = -0.2;
      return [keyframe(begin, 3.0, 1.5), keyframe(end, 14.0)];
    },
  },
  {
    title: 'Two starts, a hair apart',
    body: `
      A second path, in red, starts one hundred-thousandth of a unit
      away from the first. For a long time you can see only one curve,
      because they lie on top of each other.

      Then, quite suddenly, they separate, and from there on they are
      on different wings as often as not. This is what Lorenz noticed
      when he restarted a run from rounded-off numbers and got
      different weather.`,
    tryIt: 'Sensitivity → Twin path, Gap',
    build(base) {
      const begin = still(base, 0);
      begin.values[TWIN] = 1;
      const end = copyState(begin);
      end.values[TIME] = 32;
      return [keyframe(begin, 2.0, 0.5), keyframe(end, 22.0)];
    },
  },
  {
    title: 'Why forecasts run out',
    body: `
      The gap between the twins grows about tenfold every two and a
      half time units, until it is as big as the attractor itself.

      So a measurement ten times more precise buys only two and a
      half more units of forecast. A thousand times more precise buys
      seven and a half. The future is fixed by the present, but no
      real measurement of the present is good enough to reach far
      into it. This is the butterfly effect.`,
    tryIt: 'Sensitivity → Gap',
    build(base) {
      const coarse = still(base, DURATION);
      coarse.values[TWIN] = 1;
      coarse.values[DELTA_POWER] = 2;
      const fine = copyState(coarse);
      fine.values[DELTA_POWER] = 9;
      return [keyframe(coarse, 3.0, 4.0), keyframe(fine, 0.0, 4.0)];
    },
  },
  {
    title: 'A cloud of starts',
    body: `
      Now 160 points are released together from a small ball. At first
      they travel as a clump. The flow stretches the clump into a
      thread, then folds the thread over on itself, again and again.

      Stretching pulls neighbours apart; folding keeps everything
      inside a bounded region. Together they spread the cloud over the
      whole attractor, the way kneading spreads a drop of dye through
      dough.`,
    tryIt: 'Sensitivity → Cloud of starts',
    build(base) {
      const begin = still(base, 0);
      begin.values[CLOUD] = 1;
      const end = copyState(begin);
      end.values[TIME] = 22;
      return [keyframe(begin, 2.0, 1.0), keyframe(end, 20.0)];
    },
  },
  {
    title: 'Turn the heat down',
    body: `
      ρ measures how strongly the layer of air is heated. Here it has
      been lowered from 28 to 15. The path spirals into one of two
      steady states and stays there: steady, predictable convection.

      As ρ rises past about 24.74 those steady states stop attracting,
      and the path is left to wander between them for ever. Chaos
      arrives at a definite threshold.`,
    tryIt: 'Rule → ρ',
    build(base) {
      const calm = still(base, DURATION);
      calm.values[RHO] = 15;
      const wild = copyState(calm);
      wild.values[RHO] = 28;
      return [keyframe(calm, 3.0, 3.0), keyframe(wild, 12.0)];
    },
  },
  {
    title: 'A simpler chaos',
    body: `
      Otto Rössler looked for the simplest rule that would do the same,
      and found one with a single non-linear term. Its path spirals
      outward in a plane, is lifted up, and is folded back into the
      middle of the spiral.

      Stretch and fold again, with one spiral instead of two wings.`,
    tryIt: 'Rule → System → Rössler',
    build(base) {
      const begin = still(base, 0);
      begin.values[SYSTEM] = 1;
      begin.values[START_X] = 1;
      begin.values[START_X + 1] = 1;
      begin.values[START_X + 2] = 0;
      begin.pitch = -0.6;
      const end = copyState(begin);
      end.values[TIME] = DURATION;
      end.yaw = 0.6;
      return [keyframe(begin, 2.0, 0.5), keyframe(end, 18.0)];
    },
  },
  {
    title: 'Your turn',
    body: `
      Drag to turn the attractor. Change ρ and find where chaos starts.
      Turn on the twin and the cloud, and scrub time to see exactly
      when they come apart. Every group of controls has an ⓘ note.

      The address of this page always holds the view on screen, so a
      copied link brings anyone to the very same spot.`,
    build: base => [keyframe(base, 3.0)],
  },
];

export const world = {
  id: 'attractors',
  title: 'Strange attractors',
  formula: 'ẋ = σ(y − x),  ẏ = x(ρ − z) − y,  ż = xy − βz',
  summary: 'Three numbers that change by a simple rule, and a path that never repeats and never leaves. Start two points a hair apart and watch them end up on opposite wings of the butterfly.',
  fragment: FRAGMENT,
  defaults,
  cameraDistanceRange: [1.2, 12.0],
  paletteNames: ['Glow'],
  controlGroups: [
    group('Time', `
      The state of the system is one point, with coordinates x, y
      and z. The rule gives its velocity at every instant, and the
      curve is the path it follows. Time shown is how much of the
      path has been drawn; Play runs it continuously.

      The path is computed in steps of 0.01 time units, each using
      four samples of the velocity (the Runge–Kutta method).`, [
      toggle('Play', PLAY),
      slider('Playback speed', SPEED, [0.25, 2], value => value.toFixed(2) + '×'),
      slider('Time shown', TIME, [0, DURATION], one, state => state.values[PLAY] < 0.5),
      toggle('Flow arrows', ARROWS),
    ]),
    group('Rule', `
      Lorenz's equations are a drastically simplified model of a
      layer of air heated from below. x is how fast it turns over,
      y and z describe the temperature differences. ρ is how hard
      it is heated.

      Below ρ ≈ 24.74 every path spirals into one of two steady
      states. Above it they never settle: the path circles one
      state, then the other, in an order that never repeats.
      Rössler's system is a simpler rule built to do the same with
      a single spiral and a fold.`, [
      picker('System', SYSTEM, ['Lorenz', 'Rössler']),
      slider('σ', SIGMA, [2, 20], one, state => !isRossler(state)),
      slider('ρ', RHO, [0.5, 45], one, state => !isRossler(state)),
      slider('β', BETA, [0.5, 5], two, state => !isRossler(state)),
      slider('a', A, [0.05, 0.4], two, isRossler),
      slider('b', B, [0.05, 1], two, isRossler),
      slider('c', C, [2, 10], two, isRossler),
      readout('Steady states', state => {
        if (isRossler(state)) { return 'see note'; }
        const r = state.values[RHO];
        if (!(r > 1)) { return 'the origin only'; }
        const e = Math.sqrt(state.values[BETA] * (r - 1));
        return `(±${e.toFixed(1)}, ±${e.toFixed(1)}, ${(r - 1).toFixed(1)})`;
      }),
    ]),
    group('Sensitivity', `
      Twin draws a second path, in red, whose start differs from
      the first by the tiny Gap, along x only. For a while the two
      are indistinguishable. Then they part, and from there on
      they have nothing to do with each other.

      Cloud releases 160 points from a small ball round the start.
      The flow stretches the ball into a thread, folds it, and
      spreads it over the whole attractor.`, [
      toggle('Twin path', TWIN),
      slider('Gap, 10⁻ⁿ', DELTA_POWER, [1, 10],
        value => '10⁻' + [...String(Math.round(value))].map(digit => SUPERSCRIPTS[Number(digit)] ?? '⁰').join(''),
        state => state.values[TWIN] > 0.5),
      toggle('Cloud of starts', CLOUD),
    ]),
  ],
  viewNote: `
    Drag to turn the picture and zoom to move in. The white dot is the
    present state; the path behind it fades with age. Lines add their
    light, so the parts of the attractor visited most often are brightest.`,
  tour,
  discreteValues: new Set([SYSTEM, PLAY, TWIN, CLOUD, ARROWS, DELTA_POWER]),
  lines,
  playback: { play: PLAY, speed: SPEED, value: TIME, rate: 6, period: DURATION + 12, maximum: DURATION },
};
