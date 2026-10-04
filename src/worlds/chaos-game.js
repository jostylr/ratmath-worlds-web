// The chaos game: throw a die, jump part of the way to a corner, mark the
// spot, and repeat. Random throws draw Sierpinski's triangle, Barnsley's
// fern and Koch's coastline, the shapes of Mandelbrot's chapter in Chaos.
// This is Worlds/Flat/ChaosGameWorld.swift, without its explorer; the tour's
// words are copied from it.
import { newState, copyState, keyframe, slider, picker, toggle, readout, group } from './engine.js';
import { SHELF, lookDown, scale, pan, dive, dice } from './flat-support.js';
import { FRAGMENT } from './shaders/backdrop.js';

// Indices into the state's values.
const RULE = 0;
const RATIO = 1;
const COUNT_POWER = 2;
const TRAIL = 3;

/** The nearest and farthest the picture can be seen from. */
const RANGE = [4.0 / 400, 9.0];
/** The most marks drawn, and the most throws made looking for them. */
const BUDGET = 90000;
const PATIENCE = 2500000;
/** The throws joined up by First jumps. */
const TRAIL_THROWS = 30;

const defaults = lookDown(newState(), 4.0);
defaults.values[RATIO] = 0.5;
defaults.values[COUNT_POWER] = 4.5;

const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);

// MARK: The games

const ruleIndex = state => Math.round(clamp(state.values[RULE], 0, 3));
const jump = state => clamp(state.values[RATIO], 0.05, 0.95);

/** One thing a throw of the die can do: x → a·x + b·y + e, y → c·x + d·y + f.
    `corner` is the corner jumped toward, for the games played with corners. */
const move = (name, weight, a, b, c, d, e, f, corner = null) => ({ name, weight, a, b, c, d, e, f, corner });

const apply = (m, p) => [m.a * p[0] + m.b * p[1] + m.e, m.c * p[0] + m.d * p[1] + m.f];

const corners = (points, q) => points.map((corner, index) =>
  move(`corner ${['A', 'B', 'C', 'D'][index]}`, 1, 1 - q, 0, 0, 1 - q, q * corner[0], q * corner[1], corner));

function turned(name, degrees, e, f) {
  const angle = degrees * Math.PI / 180;
  return move(name, 1, Math.cos(angle) / 3, -Math.sin(angle) / 3, Math.sin(angle) / 3, Math.cos(angle) / 3, e, f);
}

function moves(state) {
  switch (ruleIndex(state)) {
    case 0:
      return corners([0, 1, 2].map(index => {
        const angle = Math.PI / 2 + 2 * Math.PI / 3 * index;
        return [1.3 * Math.cos(angle), 1.3 * Math.sin(angle) - 0.25];
      }), jump(state));
    case 1:
      return corners([[-1.15, 1.15], [-1.15, -1.15], [1.15, -1.15], [1.15, 1.15]], jump(state));
    case 2:
      return [
        move('stem', 0.01, 0, 0, 0, 0.16, 0, 0),
        move('the next frond up', 0.85, 0.85, 0.04, -0.04, 0.85, 0, 1.6),
        move('left leaflet', 0.07, 0.20, -0.26, 0.23, 0.22, 0, 1.6),
        move('right leaflet', 0.07, -0.15, 0.28, 0.26, 0.24, 0, 0.44),
      ];
    default:
      return [
        turned('first third', 0, 0, 0),
        turned('rising side', 60, 1.0 / 3, 0),
        turned('falling side', -60, 0.5, Math.sqrt(3) / 6),
        turned('last third', 0, 2.0 / 3, 0),
      ];
  }
}

/** Where a point of the game is drawn. */
function scene(p, rule) {
  switch (rule) {
    case 2: return [p[0] / 3.4, (p[1] - 5) / 3.4];
    case 3: return [(p[0] - 0.5) * 3.3, p[1] * 3.3 - 0.45];
    default: return [p[0], p[1]];
  }
}

/** The throws, in order: which move, and where it lands. `visit` is given
    the throw's number, the move chosen, where the point was and where it
    landed, and returns false to stop. */
function play(state, count, visit) {
  const all = moves(state);
  const total = all.reduce((sum, m) => sum + m.weight, 0);
  const rule = ruleIndex(state);
  const noRepeats = rule === 1;
  const roll = dice(0x4F6CDD1D);
  let p = rule === 2 ? [0.3, 2.0] : [0.2, 0.1];
  let previous = -1;
  for (let throwIndex = 0; throwIndex < count; throwIndex += 1) {
    let chosen = 0;
    do {
      let rolled = roll() * total;
      chosen = all.length - 1;
      for (let index = 0; index < all.length; index += 1) {
        if (rolled < all[index].weight) { chosen = index; break; }
        rolled -= all[index].weight;
      }
    } while (noRepeats && chosen === previous);
    previous = chosen;
    const landed = apply(all[chosen], p);
    if (!visit(throwIndex, chosen, p, landed)) { return; }
    p = landed;
  }
}

const shownCount = state => Math.min(Math.round(10 ** clamp(state.values[COUNT_POWER], 0, 5)), BUDGET);

function dimension(state) {
  const size = 1 - jump(state);
  switch (ruleIndex(state)) {
    case 0:
    case 1:
      if (!(size <= 0.5 + 1e-9)) { return 'copies overlap'; }
      return `log 3 ⁄ log ${(1 / size).toFixed(2)} = ${(Math.log(3) / Math.log(1 / size)).toFixed(3)}`;
    case 2:
      return 'no simple formula: its copies differ';
    default:
      return 'log 4 ⁄ log 3 = 1.262';
  }
}

function copies(state) {
  switch (ruleIndex(state)) {
    case 0: return `3, each ${(1 - jump(state)).toFixed(2)} the size`;
    case 1: return `4, each ${(1 - jump(state)).toFixed(2)} the size`;
    case 2: return '4, all different';
    default: return '4, each a third the size';
  }
}

const TINTS = [[1.0, 0.36, 0.22], [0.30, 0.85, 0.45], [0.28, 0.60, 1.0], [1.0, 0.78, 0.25]];
const PLAIN = [0.75, 0.86, 1.0];

// MARK: Lines

/** The marks, the first jumps with their yellow dot, and the corners. They
    are recomputed only when what they depend on changes. */
const lineData = new Float32Array(12 * (BUDGET + TRAIL_THROWS + 1 + 4));
let lineCount = 0;
let cacheKey = null;

/** Adds one line: its two ends, colour and half-width in points. A dot is a
    segment with no length. */
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

const addDot = (x, y, r, g, b, alpha, width) => addLine(x, y, x, y, r, g, b, alpha, width);

function lines(state) {
  const key = [
    state.values[RULE], state.values[RATIO], state.values[COUNT_POWER], state.values[TRAIL],
    state.focus[0], state.focus[1], state.cameraDistance, state.palette,
  ];
  if (cacheKey !== null && key.every((value, index) => value === cacheKey[index])) {
    return { data: lineData, count: lineCount };
  }
  lineCount = 0;
  const rule = ruleIndex(state);
  const wanted = shownCount(state);
  const half = scale(state) * 2.4;
  const whole = state.cameraDistance >= defaults.cameraDistance * 0.97;
  const plain = state.palette === 1;
  const alpha = wanted < 300 ? 1.0 : 0.62;
  const width = wanted < 300 ? 3.0 : 1.1;
  const focusX = state.focus[0];
  const focusY = state.focus[1];
  let kept = 0;
  play(state, PATIENCE, (index, chosen, from, landed) => {
    const at = scene(landed, rule);
    if (Math.abs(Math.fround(at[0]) - focusX) < half && Math.abs(Math.fround(at[1]) - focusY) < half) {
      // Each point takes the colour of the throw that made it, which
      // is also the copy of the whole that it lies in.
      const tint = plain ? PLAIN : TINTS[chosen];
      addDot(at[0], at[1], tint[0], tint[1], tint[2], alpha, width);
      kept += 1;
    }
    return kept < wanted && !(whole && index + 1 >= wanted);
  });

  if (state.values[TRAIL] > 0.5) {
    play(state, TRAIL_THROWS, (index, chosen, from, landed) => {
      const a = scene(from, rule);
      const b = scene(landed, rule);
      const fade = 1 - index / 45;
      addLine(a[0], a[1], b[0], b[1], 1, 1, 1, 0.45 * fade, 0.9);
      if (index === 0) { addDot(a[0], a[1], 1, 0.8, 0.2, 1, 4.5); }
      return true;
    });
  }
  if (rule < 2) {
    for (const m of moves(state)) {
      if (m.corner) {
        const at = scene(m.corner, rule);
        addDot(at[0], at[1], 1, 1, 1, 1, 4.0);
      }
    }
  }
  cacheKey = key;
  return { data: lineData, count: lineCount };
}

const RULE_NAMES = ['Three corners', 'Four corners, no repeats', "Barnsley's fern", "Koch's curve"];

// MARK: Guided tour

function playing(base, rule, points) {
  const state = copyState(base);
  state.values[RULE] = rule;
  state.values[COUNT_POWER] = points;
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
    title: 'A game with a die',
    body: `
      Mark three corners. Start anywhere: the yellow dot. Throw a
      die to choose a corner, jump exactly half-way to it, and mark
      where you land. Throw again from there.

      The lines show the first thirty jumps. There is no telling
      where the next one will go. Each is decided by chance.`,
    tryIt: 'Picture → First jumps',
    build(base) {
      const state = playing(base, 0, 1.5);
      state.values[TRAIL] = 1;
      return [keyframe(state, 2.5)];
    },
  },
  {
    title: 'Chance draws a triangle',
    body: `
      Keep throwing. A hundred marks look like a scatter. Ten
      thousand are Sierpinski's triangle: a triangle with its
      middle missing, and the middle of each remaining piece
      missing, for ever.

      Nothing in the rule mentions holes. The order of the throws
      is random, and would be different with another die. The
      picture would be exactly the same.`,
    tryIt: 'Picture → Points',
    build: base => [
      keyframe(playing(base, 0, 1.5), 1.0, 1.0),
      keyframe(playing(base, 0, 4.6), 12.0),
    ],
  },
  {
    title: 'Three copies of itself',
    body: `
      The colours say which corner each point was last thrown
      toward. Jumping half-way to a corner squeezes the whole
      triangle into the half-size triangle at that corner, so each
      colour is a complete small copy of the whole picture.

      The empty middle is where no half-way jump can land. Closer
      in on one corner, the copy is made of three copies, each made
      of three more.`,
    tryIt: 'Double-tap a corner',
    build(base) {
      const state = playing(base, 0, 4.7);
      return [
        keyframe(state, 1.5, 3.0),
        keyframe(looking(state, 0, 1.05, 9), 9.0),
      ];
    },
  },
  {
    title: 'A dimension between one and two',
    body: `
      Double the size of a line and you get 2 copies of it. Double
      a square and you get 4, which is 2². Double this triangle and
      you get 3 copies. So its dimension is the power of 2 that
      gives 3: about 1.585. It is more than a line and less than a
      surface.

      Now the jump lengthens. The copies shrink and pull apart, and
      the dimension falls toward that of scattered dust.`,
    tryIt: 'Game → Jump',
    build(base) {
      const half = playing(base, 0, 4.6);
      const long = copyState(half);
      long.values[RATIO] = 0.66;
      return [
        keyframe(half, 1.5, 4.0),
        keyframe(long, 9.0),
      ];
    },
  },
  {
    title: 'One rule of memory',
    body: `
      With four corners and half-way jumps, the marks would fill
      the square evenly: four half-size squares tile it with
      nothing left out.

      This game adds one rule: never the same corner twice running.
      That is enough to empty most of the square. Every blank
      region is a place that could only be reached by repeating a
      corner.`,
    tryIt: 'Game → Rule → Four corners, no repeats',
    build: base => [keyframe(playing(base, 1, 4.7), 2.5)],
  },
  {
    title: 'A fern from four moves',
    body: `
      Michael Barnsley's fern uses four moves. One, chosen 85 times
      in 100, shrinks the whole fern slightly and tips it: that
      makes each frond a smaller copy of the fern above the one
      below. Two more turn the whole fern into its lowest left and
      right fronds. The last flattens it into the stem.

      Twenty-four numbers describe the entire picture. Barnsley's
      point was that a shape this intricate can be stored as the
      few rules that rebuild it.`,
    tryIt: "Game → Rule → Barnsley's fern",
    build: base => [
      keyframe(playing(base, 2, 2), 1.0, 1.0),
      keyframe(playing(base, 2, 4.9), 10.0),
    ],
  },
  {
    title: 'How long is a coastline?',
    body: `
      Koch's curve is four copies of itself, each a third the size.
      Measure it with a ruler a third as long and you find a third
      more coast, because the ruler now follows bays it used to
      skip. Shorten the ruler again and the same happens. The
      length has no answer.

      Benoit Mandelbrot asked the question of the coast of Britain
      in 1967. What does have an answer is the dimension: log 4 ⁄
      log 3, about 1.26. The west coast of Britain measures about
      1.25.`,
    tryIt: "Game → Rule → Koch's curve; double-tap to dive",
    build(base) {
      const state = playing(base, 3, 4.7);
      return [
        keyframe(state, 1.5, 4.0),
        keyframe(looking(state, -1.1, -0.13, 9), 9.0),
      ];
    },
  },
  {
    title: 'Your turn',
    body: `
      Change the game and the length of the jump. Dive into any
      part and wait for the throws to fill it in. Switch the
      colours off to see the shape alone. Every group of controls
      has an ⓘ button with a short note.

      The address of this page always holds the view on screen, so a
      copied link brings anyone to the very same spot.`,
    build: base => [keyframe(base, 2.5)],
  },
];

// MARK: World

export const world = {
  id: 'chaos-game',
  title: 'Chaos game',
  formula: 'Throw a die, jump half-way, mark the spot',
  summary: "Pick a corner of a triangle at random and jump half-way to it, thousands of times. Chance draws a perfect lattice of triangles within triangles. Change the rules and it draws a fern, or a coastline whose length has no answer.",
  fragment: FRAGMENT,
  defaults,
  cameraDistanceRange: RANGE,
  paletteNames: ['By throw', 'Plain'],
  controlGroups: [
    group('Game', `
      Three corners: throw a die to choose a corner, and jump
      part of the way from where you are toward it. Four
      corners: the same, but never the corner just used.
      Without that one rule the square simply fills in.

      Barnsley's fern and Koch's curve are the same game with
      different moves. Each move shrinks the whole plane toward
      one place, turning or squashing it as it goes, and the
      die chooses which. The picture is the one shape that is
      exactly the sum of its own shrunken copies.

      The colours show which move made each point, and so
      which copy it lies in. A shape made of N copies, each
      1 ⁄ s the size, has dimension log N ⁄ log s.`, [
      picker('Rule', RULE, RULE_NAMES),
      {
        ...slider('Jump', RATIO, [0.3, 0.7], value => `${value.toFixed(2)} of the way`),
        visible: state => ruleIndex(state) < 2,
      },
      readout('Copies', copies),
      readout('Dimension', dimension),
    ]),
    group('Picture', `
      Points is how many throws are marked. When you zoom in,
      the game is played on, up to two and a half million
      throws, until that many marks fall inside the view: the
      detail was always there, waiting for enough throws.

      First jumps joins the first thirty throws with lines,
      from the yellow dot.`, [
      slider('Points', COUNT_POWER, [0, 4.95], value => String(Math.round(10 ** value))),
      toggle('First jumps', TRAIL),
    ]),
  ],
  viewNote: `
    Drag to move the picture and pinch to zoom. Double-tap a spot to dive
    toward it.`,
  tour,
  discreteValues: new Set([RULE, TRAIL]),
  cameraBacksAwayWhenMoving: false,
  drag: (state, probe, dx, dy) => pan(state, dx, dy),
  tourKeepsPalette: false,
  lines,
  pitchRange: [0, 0],
  flatFocus: true,
  zoomTarget: (viewPoint, state, factor) => dive(viewPoint, state, factor, RANGE),
  urlDigits: 10,
  shelf: SHELF,
};
