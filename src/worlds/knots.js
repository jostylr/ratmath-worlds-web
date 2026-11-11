// Knots: closed loops in space, the pictures they make, and the numbers
// that stay the same however the loop is moved. This is
// Worlds/Knots/KnotWorld.swift, without its explorer; the tour's words are
// copied from it.
import { newState, copyState, keyframe, slider, picker, readout, group, Camera } from './engine.js';
import { FRAGMENT } from './shaders/backdrop.js';

// Indices into the state's values.
const KNOT = 0;
const RELAX = 1;

const COUNT = 180;
const SIDES = 14;
const STEPS = 3000;
const EVERY = 4;

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a); return l > 1e-12 ? mul(a, 1 / l) : a; };

function torus(p, q, scale = 0.75) {
  return t => {
    const r = Math.cos(q * t) + 2;
    return mul([r * Math.cos(p * t), -Math.sin(q * t), r * Math.sin(p * t)], scale);
  };
}

const PRESETS = [
  { name: 'Unknot', crossingNumber: 0, curve: t => [2 * Math.cos(t), 0, 2 * Math.sin(t)] },
  { name: 'Tangled unknot', crossingNumber: 0,
    curve: t => [1.5 * Math.cos(t) + 0.9 * Math.cos(4 * t), 1.1 * Math.sin(t), 1.5 * Math.sin(t) - 0.9 * Math.sin(4 * t)] },
  { name: 'Trefoil, 3₁', crossingNumber: 3, curve: torus(2, 3) },
  { name: 'Figure-eight, 4₁', crossingNumber: 4,
    curve: t => mul([(2 + Math.cos(2 * t)) * Math.cos(3 * t), Math.sin(4 * t), (2 + Math.cos(2 * t)) * Math.sin(3 * t)], 0.75) },
  { name: 'Cinquefoil, 5₁', crossingNumber: 5, curve: torus(2, 5) },
  { name: 'Torus knot T(3, 4), 8₁₉', crossingNumber: 8, curve: torus(3, 4, 0.7) },
];

const preset = state => Math.min(Math.max(Math.round(state.values[KNOT]), 0), PRESETS.length - 1);
const sample = p => Array.from({ length: COUNT }, (_, i) => PRESETS[p].curve(2 * Math.PI * i / COUNT));

/** One step of relaxation, as in the app. */
function relax(x, rest) {
  const n = x.length;
  const force = x.map(() => [0, 0, 0]);
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const d = sub(x[j], x[i]);
    const l = len(d);
    const f = mul(d, (l - rest) * 4.0 / Math.max(l, 1e-9));
    force[i] = add(force[i], f);
    force[j] = sub(force[j], f);
  }
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 3; j < i + n - 2; j += 1) {
      const k = j % n;
      if (k <= i) { continue; }
      const d = sub(x[i], x[k]);
      const l2 = Math.max(dot(d, d), 1e-4);
      const f = mul(d, 0.0009 / (l2 * Math.sqrt(l2)) + 0.00004 / (l2 * l2 * Math.sqrt(l2)));
      force[i] = add(force[i], f);
      force[k] = sub(force[k], f);
    }
  }
  const out = x.map((p, i) => {
    let step = mul(force[i], 0.12);
    const l = len(step);
    if (l > 0.02) { step = mul(step, 0.02 / l); }
    return add(p, step);
  });
  const centre = mul(out.reduce(add, [0, 0, 0]), 1 / n);
  return out.map(p => sub(p, centre));
}

const relaxed = new Map();
function shapeOf(p, progress) {
  let list = relaxed.get(p);
  if (!list) { list = [sample(p)]; relaxed.set(p, list); }
  const first = list[0];
  let total = 0;
  for (let i = 0; i < first.length; i += 1) { total += len(sub(first[(i + 1) % first.length], first[i])); }
  const rest = total / first.length;
  const wanted = Math.round(Math.min(Math.max(progress, 0), 1) * (STEPS / EVERY));
  let budget = 240;
  while (list.length <= wanted && budget > 0) {
    let x = list[list.length - 1];
    for (let i = 0; i < EVERY; i += 1) { x = relax(x, rest); }
    list.push(x);
    budget -= EVERY;
  }
  return list[Math.min(wanted, list.length - 1)];
}

/** How far the relaxation asked for has actually got: every picture made
    from the shape is kept under this, so none outlives the shape it shows. */
function reached(state) {
  const wanted = Math.round(Math.min(Math.max(state.values[RELAX], 0), 1) * (STEPS / EVERY));
  return Math.min(wanted, (relaxed.get(preset(state))?.length ?? 1) - 1);
}

/** True while the shape asked for has not been reached, after working a
    little further toward it. */
function isBehind(state) {
  shapeOf(preset(state), state.values[RELAX]);
  const wanted = Math.round(Math.min(Math.max(state.values[RELAX], 0), 1) * (STEPS / EVERY));
  return (relaxed.get(preset(state))?.length ?? 0) <= wanted;
}

function shape(state) {
  const x = shapeOf(preset(state), state.values[RELAX]);
  const reach = Math.max(...x.map(len));
  return reach > 2.4 ? x.map(p => mul(p, 2.4 / reach)) : x;
}

const eye = state => norm(Camera.rotate([0, 0, 1], state.yaw, state.pitch));

// MARK: The picture

function crossings(x, e) {
  const n = x.length;
  let a = norm(cross(e, [0, 1, 0]));
  if (len(a) < 0.5) { a = norm(cross(e, [1, 0, 0])); }
  const b = cross(e, a);
  const flat = x.map(p => [dot(p, a), dot(p, b)]);
  const depth = x.map(p => dot(p, e));
  const result = [];
  for (let i = 0; i < n; i += 1) {
    const i2 = (i + 1) % n;
    const p = flat[i];
    const r = [flat[i2][0] - p[0], flat[i2][1] - p[1]];
    for (let j = i + 2; j < n; j += 1) {
      const j2 = (j + 1) % n;
      if (j2 === i) { continue; }
      const q = flat[j];
      const s = [flat[j2][0] - q[0], flat[j2][1] - q[1]];
      const den = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(den) <= 1e-12) { continue; }
      const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den;
      const u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
      if (!(t >= 0 && t < 1 && u >= 0 && u < 1)) { continue; }
      const di = depth[i] + (depth[i2] - depth[i]) * t;
      const dj = depth[j] + (depth[j2] - depth[j]) * u;
      const iOver = di > dj;
      const over = iOver ? r : s;
      const under = iOver ? s : r;
      result.push({
        over: iOver ? i + t : j + u,
        under: iOver ? j + u : i + t,
        sign: over[0] * under[1] - over[1] * under[0] > 0 ? 1 : -1,
      });
    }
  }
  return result;
}

function diagram(c) {
  const starts = c.map(x => x.under).sort((p, q) => p - q);
  const arcAt = place => {
    let k = 0;
    while (k < starts.length && starts[k] <= place) { k += 1; }
    return starts.length ? (k + starts.length - 1) % starts.length : 0;
  };
  const arcs = c.map(x => {
    const out = arcAt(x.under);
    return { over: arcAt(x.over), into: (out + starts.length - 1) % Math.max(starts.length, 1), out };
  });
  return { crossings: c, arcs, arcCount: starts.length, starts };
}

let pictureCache = { key: '', value: null };
function picture(state) {
  const x = shape(state);
  const key = [state.values[KNOT], reached(state), state.yaw, state.pitch].join(',');
  if (key !== pictureCache.key) { pictureCache = { key, value: diagram(crossings(x, eye(state))) }; }
  return pictureCache.value;
}

function determinant(d) {
  const n = d.crossings.length;
  if (n <= 1) { return 1; }
  const m = Array.from({ length: n }, () => new Array(n).fill(0));
  d.arcs.forEach((a, row) => { m[row][a.over] += 2; m[row][a.into] -= 1; m[row][a.out] -= 1; });
  const size = n - 1;
  const a = m.slice(0, size).map(r => r.slice(0, size));
  let det = 1;
  for (let col = 0; col < size; col += 1) {
    let pivot = col;
    for (let r = col; r < size; r += 1) { if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) { pivot = r; } }
    if (Math.abs(a[pivot][col]) < 1e-9) { return 0; }
    if (pivot !== col) { [a[pivot], a[col]] = [a[col], a[pivot]]; det = -det; }
    det *= a[col][col];
    for (let r = col + 1; r < size; r += 1) {
      const f = a[r][col] / a[col][col];
      if (f === 0) { continue; }
      for (let k = col; k < size; k += 1) { a[r][k] -= f * a[col][k]; }
    }
  }
  return Math.round(Math.abs(det));
}

function threeColouring(d) {
  const n = d.arcCount;
  if (n < 3) { return null; }
  const rows = d.arcs.map(a => {
    const r = new Array(n).fill(0);
    r[a.over] = (r[a.over] + 2) % 3;
    r[a.into] = (r[a.into] + 2) % 3;
    r[a.out] = (r[a.out] + 2) % 3;
    return r;
  });
  const pivots = [];
  let rank = 0;
  for (let col = 0; col < n; col += 1) {
    let p = -1;
    for (let r = rank; r < rows.length; r += 1) { if (rows[r][col] !== 0) { p = r; break; } }
    if (p < 0) { continue; }
    [rows[rank], rows[p]] = [rows[p], rows[rank]];
    const inverse = rows[rank][col] === 1 ? 1 : 2;
    rows[rank] = rows[rank].map(v => (v * inverse) % 3);
    for (let r = 0; r < rows.length; r += 1) {
      if (r === rank || rows[r][col] === 0) { continue; }
      const f = rows[r][col];
      for (let k = 0; k < n; k += 1) { rows[r][k] = (((rows[r][k] - f * rows[rank][k]) % 3) + 3) % 3; }
    }
    pivots.push(col);
    rank += 1;
  }
  const free = [...Array(n).keys()].filter(c => !pivots.includes(c));
  for (const chosen of free) {
    const x = new Array(n).fill(0);
    x[chosen] = 1;
    pivots.forEach((col, r) => {
      let sum = 0;
      for (const f of free) { sum += rows[r][f] * x[f]; }
      x[col] = ((-sum % 3) + 3) % 3;
    });
    if (new Set(x).size > 1) { return x; }
  }
  return null;
}

// MARK: The tube

const vertices = new Float32Array(8 * (COUNT + 1) * (SIDES + 1));
const indices = new Uint32Array(6 * COUNT * SIDES);
for (let i = 0, k = 0; i < COUNT; i += 1) {
  for (let j = 0; j < SIDES; j += 1) {
    const a = i * (SIDES + 1) + j;
    const b = a + 1;
    const c = a + SIDES + 1;
    const d = c + 1;
    indices.set([a, c, b, b, c, d], k);
    k += 6;
  }
}
const tube = { vertices, indices, revision: '' };

function mesh(state) {
  const colourKey = state.palette === 1 ? [state.yaw, state.pitch].join(',') : '';
  const x = shape(state);
  const key = [state.values[KNOT], reached(state), state.palette, colourKey].join('|');
  if (key === tube.revision) { return tube; }
  tube.revision = key;
  const n = x.length;
  let colours = null;
  let starts = [];
  if (state.palette === 1) {
    const d = diagram(crossings(x, eye(state)));
    colours = threeColouring(d);
    starts = d.starts;
  }
  const tangents = x.map((_, i) => norm(sub(x[(i + 1) % n], x[(i + n - 1) % n])));
  let normal = norm(cross(tangents[0], [0.31, 0.83, 0.47]));
  const normals = [];
  for (let i = 0; i < n; i += 1) {
    const t = tangents[i];
    normal = norm(sub(normal, mul(t, dot(normal, t))));
    normals.push(normal);
  }
  const t0 = tangents[0];
  const back = norm(sub(normal, mul(t0, dot(normal, t0))));
  const turn = Math.atan2(dot(cross(normals[0], back), t0), dot(normals[0], back));
  for (let i = 0; i < n; i += 1) {
    const a = -turn * i / n;
    const b = cross(tangents[i], normals[i]);
    normals[i] = add(mul(normals[i], Math.cos(a)), mul(b, Math.sin(a)));
  }
  let at = 0;
  for (let i = 0; i <= n; i += 1) {
    const k = i % n;
    const nn = normals[k];
    const bb = cross(tangents[k], nn);
    let colour = 0;
    if (colours && starts.length) {
      let arc = 0;
      while (arc < starts.length && starts[arc] <= k) { arc += 1; }
      colour = colours[(arc + starts.length - 1) % starts.length] / 2;
    }
    for (let j = 0; j <= SIDES; j += 1) {
      const a = 2 * Math.PI * j / SIDES;
      const dir = add(mul(nn, Math.cos(a)), mul(bb, Math.sin(a)));
      const p = add(x[k], mul(dir, 0.13));
      vertices.set([p[0], p[1], p[2], i / n, dir[0], dir[1], dir[2], colour], at);
      at += 8;
    }
  }
  return tube;
}

const defaults = newState();
defaults.values[KNOT] = 2;
defaults.yaw = 0.3;
defaults.pitch = -0.9;
defaults.cameraDistance = 7.5;

function showing(base, k, relaxBy, yaw, pitch, palette = 0) {
  const state = copyState(base);
  state.values[KNOT] = k;
  state.values[RELAX] = relaxBy;
  state.yaw = yaw;
  state.pitch = pitch;
  state.palette = palette;
  return state;
}

// MARK: Guided tour

const tour = [
  {
    title: 'A loop that cannot be undone',
    body: `
      Tie an overhand knot in a string and join the ends. This is
      the trefoil, the simplest true knot. However you push and pull
      it, without cutting the string or passing it through itself,
      you cannot turn it into a plain circle.

      Proving that is harder than it sounds. A knot that looks
      hopeless may come undone, and one that looks simple may not.`,
    tryIt: 'Drag to turn the knot',
    build: base => [keyframe(showing(base, 2, 0, 0.3, -0.9), 2.0), keyframe(showing(base, 2, 0, 2.2, -0.3), 12.0)],
  },
  {
    title: 'The picture is not the knot',
    body: `
      Seen from above the trefoil crosses itself three times. Turned
      on its side, its picture has more crossings, and the writhe,
      the count of right-handed minus left-handed crossings, changes
      with it.

      In 1926 Kurt Reidemeister showed that any two pictures of the
      same knot are linked by three kinds of small move: a twist,
      sliding one strand over another, and sliding a strand past a
      crossing. Anything that survives all three belongs to the knot.`,
    tryIt: 'This picture → Crossings seen',
    build: base => [keyframe(showing(base, 2, 0, 0.0, -1.5), 4.0, 3.0), keyframe(showing(base, 2, 0, 0.0, -0.15), 6.0)],
  },
  {
    title: 'A tangle that falls open',
    body: `
      This loop looks knotted: its picture crosses itself again and
      again. But its height has just one top and one bottom, and such
      a loop is always the unknot.

      Now it relaxes. Every part of the string pushes every other
      part away, and the string tries to shorten. No strand passes
      through another, and yet the tangle opens out into a circle.`,
    tryIt: 'Knot → Relax',
    build: base => [keyframe(showing(base, 1, 0, 0.4, -1.2), 2.0, 2.0), keyframe(showing(base, 1, 1, 0.4, -1.2), 22.0)],
  },
  {
    title: 'A trefoil stays a trefoil',
    body: `
      Relax the trefoil the same way. It rounds out and becomes
      beautifully symmetric, but it never opens: at least three
      crossings remain in every picture of it.

      Relaxing can show that a knot is the unknot. It cannot show
      that a knot is not. For that we need a number.`,
    build: base => [keyframe(showing(base, 2, 0, 0.3, -1.2), 2.0, 1.0), keyframe(showing(base, 2, 1, 0.3, -1.2), 18.0)],
  },
  {
    title: 'Three colours',
    body: `
      Cut the picture where strands pass underneath, and it falls into
      arcs. Paint each arc red, yellow or blue so that at every
      crossing the three arcs meeting are all one colour or all
      different. The trefoil can be painted using more than one
      colour; the circle cannot.

      Every Reidemeister move keeps such a painting possible, so this
      proves the trefoil is knotted. The rule is tied to a number,
      the determinant: a painting exists exactly when 3 divides it.
      The trefoil's is 3, the unknot's 1.`,
    tryIt: 'Colour → Three colours',
    build: base => [keyframe(showing(base, 2, 1, 0.3, -1.3, 1), 4.0)],
  },
  {
    title: 'The figure-eight is something else',
    body: `
      The figure-eight knot has four crossings at the least. Its
      determinant is 5, so it cannot be painted with three colours,
      and since the trefoil's is 3, the two are different knots.

      The figure-eight is also its own mirror image, which the
      trefoil is not: a left-handed trefoil cannot be turned into a
      right-handed one.`,
    tryIt: 'Knot → Figure-eight; Invariants → Determinant',
    build: base => [keyframe(showing(base, 3, 0.6, 0.5, -1.0), 5.0)],
  },
  {
    title: 'Knots on a doughnut',
    body: `
      Wind a string round a doughnut p times one way while it goes q
      times the other: a torus knot. Two and three gives the trefoil,
      two and five the cinquefoil, three and four a knot that needs
      eight crossings.

      Knots have been tabulated by their fewest crossings since the
      1870s, when Tait and Kirkman drew them by hand. There are
      1,701,936 prime knots with sixteen crossings or fewer.`,
    build: base => [keyframe(showing(base, 4, 0, 0.2, -1.2), 3.0, 3.0), keyframe(showing(base, 5, 0, 0.2, -1.2), 0.0, 0.5), keyframe(showing(base, 5, 0, 1.4, -0.9), 8.0)],
  },
  {
    title: 'Your turn',
    body: `
      Choose a knot, turn it, and relax it. Watch the crossings and
      writhe of the picture change while the determinant stays put.
      Paint knots with three colours where they allow it. Every group
      of controls has an ⓘ note.

      The address of this page always holds the view on screen, so a
      copied link brings anyone to the very same spot.`,
    build: base => [keyframe(base, 3.0)],
  },
];

// MARK: World

// MARK: Explorer

const subscript = n => [...String(n)].map(c => '₀₁₂₃₄₅₆₇₈₉'[c] ?? c).join('');

/** What the explorer says about the picture on screen: KnotWorld.report in the app. */
function explorerReport(state) {
  const d = picture(state);
  const det = determinant(d);
  const rows = d.crossings.map((crossing, i) => {
    const arc = d.arcs[i];
    return {
      id: i,
      cells: [String(i + 1), String(arc.over + 1), `${arc.into + 1} → ${arc.out + 1}`, crossing.sign > 0 ? '+1' : '−1'],
      workedTitle: `Crossing ${i + 1}, worked`,
      worked: [
        ['arc on top', String(arc.over + 1)],
        ['arcs underneath', `${arc.into + 1} in, ${arc.out + 1} out`],
        ['equation', `2·x${subscript(arc.over + 1)} − x${subscript(arc.into + 1)} − x${subscript(arc.out + 1)} = 0`],
        ['handedness', crossing.sign > 0 ? 'right-handed, +1' : 'left-handed, −1'],
      ],
      note: 'Each crossing gives one equation. Together they say which ways of numbering the arcs are consistent, and the determinant counts them.',
    };
  });
  const knot = PRESETS[preset(state)];
  return {
    headline: `${knot.name}: determinant ${det}`,
    details: [
      `This picture has ${d.crossings.length} crossings and ${d.arcCount} arcs; the fewest any picture of the ${knot.name.toLowerCase()} can have is ${knot.crossingNumber}.`,
      `Determinant ${det}: ${det === 1 ? 'the same as the unknot\'s, which does not prove this is the unknot, but cannot tell it apart' : 'not 1, so this cannot be the unknot'}.`,
      det % 3 === 0
        ? `3 divides ${det}, so the arcs can be painted with three colours by the rule. Choose Three colours to see it.`
        : `3 does not divide ${det}, so no painting with three colours follows the rule.`,
    ],
    tableTitle: d.crossings.length ? 'Crossings in this picture' : '',
    columns: d.crossings.length ? ['', 'top', 'under', 'sign'] : [],
    rows, markers: [],
  };
}

const explorer = {
  title: 'Crossing explorer',
  subtitle: 'The picture\'s crossings, and the determinant',
  buttonTitle: 'Crossing explorer',
  blurb: 'The explorer lists the crossings of the picture on screen: which arc is on top and which two meet underneath, the equation each gives, and the determinant they make.',
  pointTitle: '',
  coordinates: [],
  moveHint: '',
  initialProbe: () => [0, 0, 0, 0],
  report: (probe, state) => explorerReport(state),
};

export const world = {
  id: 'knots',
  title: 'Knots',
  formula: 'det = |Δ(−1)|',
  summary: 'A knot is a loop of string with its ends joined, so it cannot be undone without cutting. Turn it, tangle it, let it relax: the picture changes, but some numbers never do, and they can prove that two knots are different.',
  fragment: FRAGMENT,
  defaults,
  cameraDistanceRange: [3, 14],
  paletteNames: ['Along the string', 'Three colours'],
  controlGroups: [
    group('Knot', `
      Each knot is a closed loop in space. Two loops are the same
      knot if one can be moved into the other without cutting it
      and without passing the string through itself.

      Relax lets the string settle: every part of it pushes every
      other part away, while the string tries to shorten. Strands
      never pass through each other, so the knot cannot change. A
      tangled unknot opens out into a circle; a trefoil stays a
      trefoil.`, [
      picker('Knot', KNOT, PRESETS.map(p => p.name)),
      slider('Relax', RELAX, [0, 1], value => Math.round(value * 100) + '%'),
      readout('Fewest crossings possible', state => String(PRESETS[preset(state)].crossingNumber)),
    ]),
    group('This picture', `
      Seen from one direction, the knot makes a picture with
      crossings, each with one strand on top. Turn the knot and the
      number of crossings changes, and so does the writhe: the sum
      of +1 for each right-handed crossing and −1 for each
      left-handed one. These belong to the picture, not to the knot.`, [
      readout('Crossings seen', state => String(picture(state).crossings.length)),
      readout('Writhe', state => String(picture(state).crossings.reduce((s, c) => s + c.sign, 0))),
    ]),
    group('Invariants', `
      Cut the picture at every place a strand goes under, and it
      falls into arcs. Give each arc a number x. At every crossing
      ask that twice the arc on top equals the sum of the two below:
      2·x_top − x_in − x_out = 0. The determinant of this system,
      with one equation and one arc left out, is the same for every
      picture of the knot. It is |Δ(−1)|, the Alexander polynomial
      at −1.

      The arcs can be painted with three colours, at least two
      used, so that at every crossing the three arcs are all alike
      or all different, exactly when 3 divides the determinant. The
      unknot cannot be, the trefoil can: so the trefoil is knotted.`, [
      readout('Determinant', state => String(determinant(picture(state)))),
      readout('Three-colourable', state => (determinant(picture(state)) % 3 === 0 ? 'yes' : 'no')),
    ]),
  ],
  viewNote: `
    Drag to turn the knot and pinch to zoom. Along the string paints it
    in a rainbow from start to finish; Three colours paints the arcs of
    this picture with a three-colouring, when there is one.`,
  tour,
  explorer,
  shaderValues(state) {
    const values = new Array(32).fill(0);
    values[3] = state.palette === 1 ? 2 : 1;
    return values;
  },
  discreteValues: new Set([KNOT]),
  cameraBacksAwayWhenMoving: false,
  tourKeepsPalette: false,
  mesh,
  catchUp: isBehind,
  pitchRange: [-1.5, 1.5],
};
