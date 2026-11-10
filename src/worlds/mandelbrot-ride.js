// The ride through the Mandelbrot set: an endless, unguided tour that glides
// to a spot on the border, dives in, climbs out, crosses over to the Julia
// set of that spot, dives into that, and moves on. This is
// Worlds/Flat/MandelbrotRide.swift for the web; the numbers and words are
// the same.
import { copyState, keyframe } from './engine.js';

/** Plane units from the centre of the view to the edge of its shorter side,
    at 1× zoom (SPAN in mandelbrot.js). */
const SPAN = 1.35;
/** How deep the plain Julia pictures go before they blur into blocks. */
const JULIA_DEEPEST = 5000;
/** How deep a dive can go: as far as sixteen digits find their way. */
const DEEPEST = 1e12;
/** The zoom at which the two pictures are crossed between. */
const CROSSING = 4;
/** The zoom the ride glides at between dives: the whole set in view. */
const GLIDE = 1.1;

/** Famous places to start from; the ride wanders off each one its own way. */
const LANDMARKS = [
  [-0.7453, 0.1127], // the valley between the heart and the disc
  [0.2925, 0.0149], // the valley on the right, where the heart meets itself
  [-0.0880, 0.6544], // spirals on the bulb of three
  [-1.7549, 0.0], // the copy far out on the needle
  [-0.1011, 0.9563], // a branch point at the top
  [-1.2500, 0.0200], // the neck between the disc and the next bulb
  [-0.5600, 0.6400], // between the bulbs of three and five
  [0.3600, 0.3600], // the right-hand edge of the heart
];

/** Anchors well inside the set, for finding the border by halving. */
const INSIDE = [[-0.2, 0.0], [-1.0, 0.0], [-0.12, 0.74], [-0.12, -0.74], [-1.31, 0.0]];

/** How many steps z → z² + c takes from z to pass 2; −1 if it never does. */
function escapes(z, c, limit) {
  let x = z[0], y = z[1];
  for (let n = 0; n < limit; n += 1) {
    const x2 = x * x, y2 = y * y;
    if (x2 + y2 > 4) { return n; }
    y = 2 * x * y + c[1];
    x = x2 - y2 + c[0];
  }
  return -1;
}

/** Steps worth trying at a zoom: the picture's own rule (stepLimit). */
const stepsAt = zoom => Math.round(Math.min(250 + 160 * Math.log10(Math.max(zoom, 1)), 3000));

/** A small random-number generator that can be started from a seed. */
function generator(seed) {
  if (seed === undefined) { return Math.random; }
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A point on the border of the Mandelbrot set: a landmark, or found by
    halving the way between a point outside and one inside. */
function borderPoint(random) {
  if (random() < 0.35) {
    return LANDMARKS[Math.floor(random() * LANDMARKS.length)].slice();
  }
  for (let tries = 0; tries < 60; tries += 1) {
    const outside = [-2.1 + 2.7 * random(), (random() < 0.5 ? -1 : 1) * 1.2 * random()];
    if (escapes([0, 0], outside, 400) < 0) { continue; }
    let inside = INSIDE[Math.floor(random() * INSIDE.length)];
    let out = outside;
    for (let i = 0; i < 46; i += 1) {
      const middle = [(inside[0] + out[0]) / 2, (inside[1] + out[1]) / 2];
      if (escapes([0, 0], middle, 600) < 0) { inside = middle; } else { out = middle; }
    }
    return out;
  }
  return LANDMARKS[0].slice();
}

/**
 * Follows the border down from `start` at zoom `from` toward zoom `to`: at
 * each level the view is sampled on a grid, and the next point is one of
 * the few that took longest to escape, which keeps the dive on the richest
 * part of the border. Stops early if the whole view falls inside the set.
 * `count(point, limit)` is the escape count for the picture being dived.
 */
function followBorder(start, from, to, count, random) {
  let point = start.slice();
  let zoom = from;
  let reached = from;
  const GRID = 9;
  while (zoom < to) {
    zoom = Math.min(zoom * 3, to);
    const s = SPAN / zoom;
    const limit = stepsAt(zoom);
    const found = [];
    for (let row = 0; row < GRID; row += 1) {
      for (let column = 0; column < GRID; column += 1) {
        const jitter = () => (random() - 0.5) * 0.08;
        const candidate = [
          point[0] + ((column / (GRID - 1)) - 0.5 + jitter()) * 0.9 * s,
          point[1] + ((row / (GRID - 1)) - 0.5 + jitter()) * 0.9 * s,
        ];
        const n = count(candidate, limit);
        if (n >= 0) { found.push({ candidate, n }); }
      }
    }
    if (found.length === 0) { break; }
    found.sort((a, b) => b.n - a.n);
    point = found[Math.floor(random() * Math.min(3, found.length))].candidate;
    reached = zoom;
  }
  return { point, zoom: reached };
}

const decades = (a, b) => Math.abs(Math.log10(b / a));
const signed = (value, digits) => (value < 0 ? '−' : '') + Math.abs(value).toFixed(digits);
const complexText = p => `${signed(p[0], 4)} ${p[1] < 0 ? '−' : '+'} ${Math.abs(p[1]).toFixed(4)}i`;
/** A zoom in words: 300×, 45 thousand×, 2.1 million×. */
function zoomText(zoom) {
  const names = [[1e12, 'million million'], [1e9, 'thousand million'], [1e6, 'million'], [1e3, 'thousand']];
  for (const [size, name] of names) {
    if (zoom >= size) {
      const value = zoom / size;
      return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${name}×`;
    }
  }
  return `${Math.round(zoom)}×`;
}

/**
 * The ride for the Mandelbrot world. `index` names the state's values in
 * mandelbrot.js; `setCentre(x, y, state)` takes wide numbers.
 */
export function mandelbrotRide(index, setCentre) {
  const { PICTURE, C_X, C_Y, INSET, ORBIT, LIMIT, FADE, CENTRE_X, CENTRE_Y } = index;
  const isJulia = state => state.values[PICTURE] > 0.5 || state.values[FADE] >= 0.5;

  function at(base, point, zoom) {
    const state = copyState(base);
    setCentre([point[0], 0], [point[1], 0], state);
    state.cameraDistance = 1 / zoom;
    return state;
  }
  /** The same view, about its own centre, at another zoom. */
  function zoomed(base, zoom) {
    const state = copyState(base);
    state.cameraDistance = 1 / zoom;
    return state;
  }
  const withC = (base, point) => {
    const state = copyState(base);
    state.values[C_X] = point[0];
    state.values[C_Y] = point[1];
    return state;
  };
  const showing = (base, julia, fade) => {
    const state = copyState(base);
    state.values[PICTURE] = julia ? 1 : 0;
    state.values[FADE] = fade;
    return state;
  };

  return {
    title: 'Ride',
    note: `
      The ride goes on by itself: it glides to a spot on the border of the
      Mandelbrot set, dives in, climbs back out, and crosses over to the
      Julia set of that spot, since near c the one looks like the other.
      Then it dives into the Julia set, pulls back to see all of it, and
      moves on. Touching the picture pauses it.`,
    /** What the ride is looking at, for the line under its caption. */
    where: state => (isJulia(state)
      ? `Julia set of c = ${complexText([state.values[C_X], state.values[C_Y]])}`
      : 'Mandelbrot set'),
    settings: [
      {
        key: 'speed', title: 'Speed', range: [0.1, 0.8], initial: 0.3,
        display: value => `${(10 ** value).toFixed(1)}× closer a second`,
      },
      {
        key: 'depth', title: 'Deepest dive', range: [2, 12], initial: 6,
        display: value => zoomText(10 ** value),
      },
    ],
    start(seed) {
      const random = generator(seed);
      let upcoming = borderPoint(random);

      return {
        /** One round of the ride, starting from wherever the view is now. */
        next(current, settings) {
          const speed = Math.min(Math.max(settings.speed, 0.05), 2);
          const depth = Math.min(Math.max(settings.depth, 1), Math.log10(DEEPEST));
          /** Seconds for the gentler moves, quicker as the speed goes up. */
          const pace = seconds => seconds * Math.sqrt(0.3 / speed);
          const dive = (from, to) => Math.max(decades(from, to) / speed, 2);
          const climb = (from, to) => Math.max(decades(from, to) / (speed * 1.3), 1.5);

          const frames = [];
          let state = copyState(current);
          state.values[INSET] = 1;
          state.values[ORBIT] = 0;
          state.values[LIMIT] = 300;
          const push = (target, duration, hold, caption) => {
            frames.push({ ...keyframe(target, duration, hold), caption });
            state = copyState(target);
          };

          const here = [state.values[CENTRE_X], state.values[CENTRE_Y]];
          const zoom = 1 / state.cameraDistance;
          const spot = upcoming;
          upcoming = borderPoint(random);

          if (isJulia(state)) {
            // Come out of the Julia set, let c travel to the new spot, and
            // cross back to the Mandelbrot set.
            push(showing(state, true, 0), 0, 0);
            if (zoom > 1.2) {
              push(zoomed(state, 1), climb(zoom, 1), 0, 'Pulling back to see the whole Julia set.');
            }
            push(at(state, [0, 0], 0.85), pace(3), 1.5, 'The whole Julia set of this c.');
            const from = [state.values[C_X], state.values[C_Y]];
            const travel = Math.hypot(spot[0] - from[0], spot[1] - from[1]);
            push(withC(state, spot), pace(Math.min(Math.max(3 + 4 * travel, 4), 9)), 0.5,
              'Now c moves on to a new spot, and its Julia set changes shape as it goes. Where c leaves the Mandelbrot set, the Julia set breaks up into dust.');
            push(showing(state, false, 1), 0, 0);
            push(showing(state, false, 0), pace(3), 0.5,
              'Back to the Mandelbrot set. The yellow dot is c, and the small picture is its Julia set.');
          } else if (zoom > GLIDE * 1.2) {
            push(zoomed(showing(state, false, 0), GLIDE), climb(zoom, GLIDE), 0, 'Climbing back out.');
          }

          // Glide over to the spot with the whole set in view.
          const fromHere = [state.values[CENTRE_X], state.values[CENTRE_Y]];
          const across = Math.hypot(spot[0] - fromHere[0], spot[1] - fromHere[1]) / (SPAN / GLIDE);
          push(withC(at(state, spot, GLIDE), spot), pace(Math.min(Math.max(2.5 + 1.6 * across, 3), 8)), 0.5,
            'Gliding to a new spot on the border of the Mandelbrot set.');

          // Dive into the Mandelbrot set, keeping to the border.
          const goal = 10 ** (depth * (0.55 + 0.45 * random()));
          const mandelbrot = followBorder(spot, GLIDE, Math.max(goal, 20), (p, limit) => escapes([0, 0], p, limit), random);
          const bottom = mandelbrot.point;
          const deep = Math.max(mandelbrot.zoom, 10);
          const diving = `Diving into the Mandelbrot set toward ${complexText(bottom)}, down to ${zoomText(deep)}.`;
          push(withC(at(state, bottom, GLIDE), bottom), pace(1.5), 0, diving);
          push(at(state, bottom, deep), dive(GLIDE, deep), 0, diving);
          push(state, 0, pace(3),
            `${zoomText(deep)} deep, and the border is as crinkled as ever. Every pixel is a different c, with the rule run afresh.`);

          // Up to where the two pictures look alike, and across.
          push(at(state, bottom, CROSSING), climb(deep, CROSSING), 0.5,
            'Climbing back out. Near c, the Mandelbrot set looks like the Julia set of that c.');
          push(showing(state, false, 1), pace(3), 0,
            'So the picture crosses over to the Julia set of c, centred on the point z = c.');
          push(showing(state, true, 0), 0, 0);

          // Dive into the Julia set, as deep as its plain picture allows.
          const juliaGoal = Math.min(10 ** Math.min(depth, 3.7) * (0.35 + 0.65 * random()), JULIA_DEEPEST);
          const julia = followBorder(bottom, CROSSING, Math.max(juliaGoal, 40), (p, limit) => escapes(p, bottom, limit), random);
          const juliaDeep = Math.max(julia.zoom, 3 * CROSSING);
          push(at(state, julia.point, juliaDeep), dive(CROSSING, juliaDeep), 0,
            `Diving into the Julia set of c, down to ${zoomText(juliaDeep)}. Every pixel is now a different starting z, with c the same for all.`);
          push(state, 0, pace(3),
            `${zoomText(juliaDeep)} into the Julia set. A Julia set looks much the same all the way round and at every scale, unlike the Mandelbrot set.`);
          return frames;
        },
        /** The ride is over: leave one picture or the other, not a mixture. */
        settle(state) {
          if (state.values[FADE] > 0) {
            state.values[PICTURE] = state.values[FADE] >= 0.5 ? 1 : state.values[PICTURE];
            state.values[FADE] = 0;
          }
        },
      };
    },
  };
}

export const forTesting = { escapes, borderPoint, followBorder, generator, zoomText };
