// The Menger sponge: a cube from which the middle cross is removed, again and
// again at every scale. This is Worlds/Menger/MengerWorld.swift, without its
// explorer; the tour's words are copied from it.
import { newState, copyState, keyframe, slider, readout, group, Format } from './engine.js';
import { rideRandom, pick, nearestTurn } from './ride-support.js';
import { FRAGMENT } from './shaders/menger.js';

// Indices into the state's values.
const LEVEL = 0;
const SLICE_OFFSET = 1;
const SLICE_TILT = 2;

const MAXIMUM_LEVEL = 8;
/** Slice offsets at or above this value leave the whole sponge visible. */
const SLICE_DISABLED = 1.8;

const defaults = newState();
defaults.values[LEVEL] = 4;
defaults.values[SLICE_OFFSET] = SLICE_DISABLED;
defaults.yaw = 0.62;
defaults.pitch = -0.42;
defaults.cameraDistance = 5.2;

/** CPU mirror of worldField in Menger.metal, used to fly to a clicked wall. */
function distance(p, state) {
  const level = Math.min(Math.max(state.values[LEVEL], 0), MAXIMUM_LEVEL);
  const whole = Math.floor(level);
  const partial = level - whole;
  const levels = whole + (partial > 0.001 ? 1 : 0);

  const q = p.map(c => Math.abs(c) - 1);
  let d = Math.hypot(...q.map(c => Math.max(c, 0))) + Math.min(Math.max(...q), 0);

  let s = 1;
  for (let k = 1; k <= levels; k += 1) {
    const a = p.map(c => {
      const shifted = c * s + 1;
      return Math.abs(shifted - 2 * Math.floor(shifted * 0.5) - 1);
    });
    const width = (k <= whole ? 1 : partial) / 3;
    const cross = Math.min(Math.max(a[0], a[1]), Math.min(Math.max(a[1], a[2]), Math.max(a[2], a[0]))) - width;
    d = Math.max(d, -cross / s);
    s *= 3;
  }

  const tilt = Math.min(Math.max(state.values[SLICE_TILT], 0), 1);
  const diagonal = 1 / Math.sqrt(3);
  const normal = [diagonal * tilt, 1 + (diagonal - 1) * tilt, diagonal * tilt];
  const length = Math.hypot(...normal);
  return Math.max(d, (p[0] * normal[0] + p[1] * normal[1] + p[2] * normal[2]) / length - state.values[SLICE_OFFSET]);
}

const levelText = value => (value === Math.round(value) ? String(value) : value.toFixed(1));

/** Looking at the corner (1, 1, 1) from outside, along the long diagonal. */
const CORNER_YAW = Math.PI / 4;
const CORNER_PITCH = -0.6155;

const tour = [
  {
    title: 'Start with a cube',
    body: `
      Cut the cube into 27 smaller cubes, three along each edge, like a
      Rubik's cube. Remove 7 of them: the one in the very centre, and
      the one in the middle of each of the six faces.

      What is left is 20 small cubes, and a hole straight through the
      middle in all three directions. Watch the holes open.`,
    tryIt: 'Shape → Level',
    build(base) {
      const solid = copyState(base);
      solid.values[LEVEL] = 0;
      const carved = copyState(solid);
      carved.values[LEVEL] = 1;
      return [keyframe(solid, 2.0, 1.5), keyframe(carved, 6.0)];
    },
  },
  {
    title: 'Now do it again',
    body: `
      Each of the 20 small cubes is a cube, so the same rule applies to
      it: cut it into 27, remove 7. That leaves 20 × 20 = 400 smaller
      cubes. Then again: 8,000. Then 160,000.

      The Menger sponge is what remains if this never stops. It was
      described by Karl Menger in 1926.`,
    tryIt: 'Shape → Level',
    build(base) {
      const one = copyState(base);
      one.values[LEVEL] = 1;
      const four = copyState(one);
      four.values[LEVEL] = 4;
      return [keyframe(one, 2.0, 0.8), keyframe(four, 12.0)];
    },
  },
  {
    title: 'A face is a carpet',
    body: `
      Seen straight on, one face shows the same rule in two dimensions:
      cut a square into 9, remove the middle one, repeat. This is the
      Sierpinski carpet.

      Through each hole you can see the far side of the sponge, because
      every hole runs the whole way through.`,
    build(base) {
      const p = copyState(base);
      p.yaw = 0;
      p.pitch = 0;
      p.cameraDistance = 5.2;
      p.values[LEVEL] = 5;
      return [keyframe(p, 4.0)];
    },
  },
  {
    title: 'Less and less stuff, more and more wall',
    body: `
      Every step keeps 20 of 27 pieces, so the volume is multiplied by
      20⁄27 each time: 74%, 55%, 41%, … heading for zero. Meanwhile each
      new hole adds walls, and the surface area grows without limit.

      The finished sponge has no volume at all and infinite surface.
      It is neither a solid nor a surface, but something in between.`,
    tryIt: 'Shape → Level, and read the numbers under it',
    build(base) {
      const p = copyState(base);
      p.yaw = 0.9;
      p.pitch = -0.5;
      p.cameraDistance = 4.4;
      p.values[LEVEL] = 2;
      const q = copyState(p);
      q.values[LEVEL] = 5;
      q.yaw = 1.5;
      return [keyframe(p, 3.0, 0.5), keyframe(q, 10.0)];
    },
  },
  {
    title: 'Dimension 2.73',
    body: `
      Triple the size of a line and you get 3 copies of it. Triple a
      square: 9 copies, which is 3². Triple a cube: 27 copies, 3³. The
      exponent is the dimension.

      Triple the sponge and you get 20 copies. So its dimension d
      satisfies 3ᵈ = 20, which gives d = log 20 ⁄ log 3 ≈ 2.727. More
      than a surface, less than a solid.`,
    build(base) {
      const p = copyState(base);
      p.yaw = CORNER_YAW;
      p.pitch = CORNER_PITCH;
      p.cameraDistance = 4.6;
      p.values[LEVEL] = 4;
      return [keyframe(p, 4.0)];
    },
  },
  {
    title: 'Zoom in, and nothing changes',
    body: `
      We are flying toward a corner, getting 3 times closer, then 9,
      then 27. Each time the camera pauses, compare the picture with
      the one before. It is exactly the same.

      The corner piece of the sponge is a perfect copy of the whole, one
      third the size. Unlike the Mandelbulb's bent, approximate copies,
      these are exact.`,
    tryIt: 'View → Zoom, with Shape → Level raised to match',
    build(base) {
      const p = copyState(base);
      p.yaw = CORNER_YAW;
      p.pitch = CORNER_PITCH;
      p.focus = [1, 1, 1];
      p.cameraDistance = 2.7;
      p.values[LEVEL] = 4;
      const frames = [keyframe(p, 3.5, 2.0)];
      for (let step = 1; step <= 3; step += 1) {
        // One more level keeps the picture identical after each
        // threefold zoom.
        p.values[LEVEL] = 4 + step;
        p.cameraDistance = 2.7 / 3 ** step;
        frames.push(keyframe(p, 5.0, 2.0));
      }
      return frames;
    },
  },
  {
    title: 'Go inside',
    body: `
      The camera is now in the hollow centre, where the middle cube used
      to be, looking down one of the three tunnels. The square of light
      at the end is the hole in the far face.

      Every wall around you is pierced by the next level of holes, and
      those by the next. From in here the sponge is a building with
      rooms at every scale.`,
    tryIt: 'Double-click a wall or a tunnel to fly there',
    build(base) {
      const outside = copyState(base);
      outside.yaw = 0.25;
      outside.pitch = -0.12;
      outside.cameraDistance = 3.4;
      outside.values[LEVEL] = 5;
      const inside = copyState(outside);
      inside.cameraDistance = 0.30;
      const turned = copyState(inside);
      turned.yaw = 1.75;
      turned.pitch = -0.30;
      return [keyframe(outside, 3.0, 0.5), keyframe(inside, 7.0, 1.0, true), keyframe(turned, 8.0, 0, true)];
    },
  },
  {
    title: 'From a parent hole to its child',
    body: `
      Still inside. We leave the big central chamber and fly to the
      small chamber at the centre of a neighbouring cube. It is the same
      room, three times smaller, with the same tunnels leading out of it.

      Then on to its own child, three times smaller again. Every room
      in the sponge has 20 children like this.`,
    tryIt: 'Double-click, then View → Zoom',
    build(base) {
      const parent = copyState(base);
      parent.yaw = 0.5;
      parent.pitch = -0.35;
      parent.cameraDistance = 0.30;
      parent.values[LEVEL] = 6;
      // Along the big tunnel to the mouth of a small one...
      const mouth = copyState(parent);
      mouth.focus = [0, 2 / 3, 0];
      mouth.cameraDistance = 0.10;
      // ...and down it into the centre of the level-1 cube with
      // digits (2, 2, 1): a hollow room one third the size.
      const child = copyState(mouth);
      child.focus = [2 / 3, 2 / 3, 0];
      const grandchild = copyState(child);
      grandchild.focus = [2 / 3 + 2 / 9, 2 / 3 + 2 / 9, 0];
      grandchild.cameraDistance = 0.10 / 3;
      grandchild.values[LEVEL] = 7;
      const door = copyState(child);
      door.focus = [2 / 3, 2 / 3 + 2 / 9, 0];
      door.cameraDistance = 0.10 / 3;
      door.values[LEVEL] = 7;
      return [
        keyframe(parent, 3.0, 1.5),
        keyframe(mouth, 4.0, 0, true),
        keyframe(child, 5.0, 2.0, true),
        keyframe(door, 3.0, 0, true),
        keyframe(grandchild, 4.0, 0, true),
      ];
    },
  },
  {
    title: 'The hidden stars',
    body: `
      A plane is slicing the sponge from one corner toward the opposite
      one, at right angles to the diagonal between them. Nothing about
      a cube full of square holes suggests what the cut will show.

      At the centre the cut face is a hexagon, and the holes in it are
      six-pointed stars, each ringed by smaller stars. Three sets of
      square tunnels, met at this angle, overlap as two triangles.`,
    tryIt: 'Slice → Offset, with Tilt at Diagonal',
    build(base) {
      const whole = copyState(base);
      whole.yaw = CORNER_YAW;
      whole.pitch = CORNER_PITCH;
      whole.cameraDistance = 4.4;
      whole.values[LEVEL] = 4;
      whole.values[SLICE_TILT] = 1;
      whole.values[SLICE_OFFSET] = 1.74;
      const cut = copyState(whole);
      cut.values[SLICE_OFFSET] = 0;
      const close = copyState(cut);
      close.cameraDistance = 3.3;
      close.values[LEVEL] = 5;
      return [keyframe(whole, 3.5, 0.5), keyframe(cut, 10.0, 1.5), keyframe(close, 4.0)];
    },
  },
  {
    title: 'How the picture is drawn',
    body: `
      No list of 160,000 cubes is stored anywhere. For any point, the
      shader asks one question per level: how far is the nearest cross
      of holes? Space is folded so that a single cross stands for all
      of them, which makes level 8 cost only twice as much as level 4.

      The largest of those answers is a safe distance a ray can travel
      without hitting anything. Each pixel's ray takes such steps until
      it lands on a wall.`,
    build(base) {
      const p = copyState(base);
      p.yaw = 0.25;
      p.pitch = -0.2;
      p.focus = [0, 0, 1];
      p.cameraDistance = 0.9;
      p.values[LEVEL] = 6;
      return [keyframe(p, 5.0)];
    },
  },
  {
    title: 'Your turn',
    body: `
      Drag to turn the sponge. Pinch, scroll or use the Zoom slider to
      move in, and double-click any wall or tunnel to fly to it. Every
      group of controls has an ⓘ button with a short note.

      The address of this page always holds the view on screen, so a
      copied link brings anyone to the very same spot.`,
    build: base => [keyframe(base, 4.0)],
  },
];

// MARK: Ride

// The ride flies the tunnels. From level 2 on, the sponge is hollow along
// every line that runs parallel to an axis through the middle of a cube of
// side 2 ⁄ 3: the three tunnels of that cube, or the hole where the cube was
// cut out. Those lines cross at the 27 points whose coordinates are −2 ⁄ 3, 0
// or 2 ⁄ 3, and the ride wanders from crossing to crossing.
const CROSSING = 2 / 3;
/** How far the camera sits behind the point it looks at: well inside the
    narrowest tunnel, which is 2 ⁄ 9 across. */
const RIDE_REACH = 0.05;
const HEADINGS = [[1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1]];

/** The view from a crossing (three whole numbers, −1 to 1), or a point
    between two, looking along a heading. */
function inTunnel(base, place, heading, yawNear) {
  const state = copyState(base);
  state.values[LEVEL] = Math.max(base.values[LEVEL], 3);
  state.values[SLICE_OFFSET] = SLICE_DISABLED;
  state.cameraDistance = RIDE_REACH;
  state.focus = place.map((c, i) => c * CROSSING + heading[i] * RIDE_REACH);
  // The camera sits behind the focus, on the side away from the heading.
  state.yaw = nearestTurn(Math.atan2(-heading[0], -heading[2]), yawNear);
  state.pitch = 0;
  return state;
}

const ride = {
  title: 'Ride',
  note: `
    The ride flies through the sponge's tunnels by itself, turning at the
    crossings and rising and falling through the shafts, and never the same
    way twice. Touching the picture pauses it.`,
  where: state => `level ${Math.round(state.values[LEVEL])}, inside the sponge`,
  settings: [
    { key: 'speed', title: 'Speed', range: [0.1, 0.6], initial: 0.25, display: value => `${value.toFixed(2)} of the cube a second` },
    { key: 'legs', title: 'Legs before a pause', range: [3, 16], initial: 8, display: value => String(Math.round(value)) },
  ],
  start(seed) {
    const random = rideRandom(seed);
    let place = null;
    let heading = 0;
    return {
      next(current, settings) {
        const speed = Math.min(Math.max(settings.speed ?? 0.25, 0.05), 2);
        const frames = [];
        let yaw = current.yaw;
        const add = (state, duration, caption) => {
          yaw = state.yaw;
          const frame = keyframe(state, duration, 0, true);
          if (caption) { frame.caption = caption; }
          frames.push(frame);
        };
        if (!place || current.cameraDistance > 2 * RIDE_REACH) {
          // Not in a tunnel yet: come round to the mouth of the big one and fly in.
          place = [-1, 0, 0];
          heading = 0;
          const mouth = inTunnel(current, [-2.4, 0, 0], HEADINGS[0], yaw);
          const approach = keyframe(mouth, 4.5);
          approach.caption = 'Into the sponge by its largest tunnel, the hole left by the first cut.';
          frames.push(approach);
          yaw = mouth.yaw;
          add(inTunnel(current, place, HEADINGS[0], yaw), 1.4 * CROSSING / speed);
        }
        const legs = Math.round(Math.min(Math.max(settings.legs ?? 8, 1), 40));
        for (let leg = 0; leg < legs; leg += 1) {
          // What can be done from here: go on, turn, or take the shaft.
          const ahead = place.map((c, i) => c + HEADINGS[heading][i]);
          const choices = [];
          if (ahead.every(c => Math.abs(c) <= 1)) { choices.push('on', 'on', 'on'); }
          choices.push('left', 'right');
          if (place[1] < 1) { choices.push('up'); }
          if (place[1] > -1) { choices.push('down'); }
          const choice = pick(random, choices);
          if (choice === 'left' || choice === 'right') {
            heading = (heading + (choice === 'left' ? 3 : 1)) % 4;
            add(inTunnel(current, place, HEADINGS[heading], yaw), 0.45 / speed,
              leg === 0 ? 'At every crossing three tunnels meet, one along each direction of space.' : undefined);
          } else if (choice === 'up' || choice === 'down') {
            place = [place[0], place[1] + (choice === 'up' ? 1 : -1), place[2]];
            add(inTunnel(current, place, HEADINGS[heading], yaw), CROSSING / speed,
              choice === 'up' ? 'Up a shaft: the tunnels run upright as well as level.' : 'Down a shaft, to the tunnels of the floor below.');
          } else {
            place = ahead;
            add(inTunnel(current, place, HEADINGS[heading], yaw), CROSSING / speed,
              leg === 0 ? 'Every wall is pierced by smaller tunnels, and those by smaller ones still.' : undefined);
          }
        }
        return frames;
      },
    };
  },
};

// MARK: Explorer

/** The level-k cell that contains a point: one of the 3ᵏ × 3ᵏ × 3ᵏ cubes of
    side 2 ⁄ 3ᵏ that tile the starting cube. */
function cellContaining(p, level) {
  if (Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2])) > 1) { return null; }
  const count = 3 ** level;
  const centre = [0, 1, 2].map(axis => {
    const index = Math.min(Math.floor((p[axis] + 1) / 2 * count), count - 1);
    return -1 + (index + 0.5) * 2 / count;
  });
  return { centre, halfSide: 1 / count };
}

/** What the explorer says about one point: MengerMath.report in the app. */
function explorerReport(p, state) {
  const levels = Math.max(Math.floor(state.values[LEVEL]), 0);
  const marker = { position: [p[0], p[1], p[2]], size: 1.1 };
  const names = ['x', 'y', 'z'];
  if (Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2])) > 1) {
    return {
      headline: 'Outside the starting cube',
      details: ['The cube runs from −1 to 1 along each axis. A point outside it was never part of the sponge.'],
      tableTitle: 'Address', columns: [], rows: [], markers: [marker],
    };
  }
  const rows = [];
  const address = [];
  let removedAt = null;
  for (let k = 1; k <= levels; k += 1) {
    const count = 3 ** k;
    const digits = [];
    const worked = [['cell side, 2 ⁄ 3ᵏ', Format.significant(2 / count, 4)]];
    for (let axis = 0; axis < 3; axis += 1) {
      const scaled = (p[axis] + 1) / 2 * count;
      const index = Math.min(Math.floor(scaled), count - 1);
      const digit = index % 3;
      digits.push(digit);
      worked.push([`${names[axis]}: 3ᵏ·(${names[axis]}+1)⁄2`, Format.number(scaled, 3)]);
      worked.push([`${names[axis]} digit`, `${index} mod 3 = ${digit}${digit === 1 ? '  (middle)' : ''}`]);
    }
    const middles = digits.filter(digit => digit === 1).length;
    const removed = middles >= 2;
    worked.push(['middle digits', `${middles} of 3`]);
    worked.push(['verdict', removed ? 'cut out' : 'kept']);
    address.push(`(${digits.join(',')})`);
    rows.push({
      id: k,
      cells: [String(k), ...digits.map(String), String(middles), removed ? 'cut' : 'kept'],
      workedTitle: `Level ${k}, worked`,
      worked,
      note: `Each coordinate is rescaled to 0…1 and multiplied by 3ᵏ; the whole part, mod 3, says whether the point is in the first (0), middle (1) or last (2) third of its level-${k - 1} cube. A cube is cut out when it is in the middle along two or more axes: the centre of a face (two) or the centre of the cube (three).`,
    });
    if (removed) {
      removedAt = k;
      break;
    }
  }
  const estimate = distance(p, state);
  let headline;
  let details;
  if (removedAt !== null) {
    headline = `Cut out at level ${removedAt}`;
    details = [`At level ${removedAt} two or more of its digits are 1, so it lies in the cross that level removes. Nothing at later levels can put it back.`];
  } else {
    headline = levels === 0 ? 'In the cube: no cuts made yet' : `Still in the sponge after ${levels} level${levels === 1 ? '' : 's'}`;
    details = [levels === 0
      ? 'Raise Level to start cutting.'
      : 'At every level so far, at most one digit is 1. A deeper level could still cut it out; raise Level to keep testing.'];
  }
  if (address.length) { details.push(`Address: ${address.join(' ')}`); }
  details.push(estimate > 0
    ? `Distance to the nearest wall: ${Format.significant(estimate)}`
    : `Depth inside the material: ${Format.significant(-estimate)}`);
  return {
    headline, details, tableTitle: 'Base-3 digits, level by level', columns: ['k', 'x', 'y', 'z', '1s', ''], rows,
    markers: [marker],
  };
}

const explorer = {
  title: 'Address explorer',
  subtitle: 'Is this point still in the sponge?',
  buttonTitle: 'Address explorer',
  blurb: 'The explorer writes a point\'s coordinates in base 3 and shows the level at which it is cut out, if it ever is.',
  pointTitle: 'Point (white)',
  coordinates: [{ label: 'x', range: [-1, 1] }, { label: 'y', range: [-1, 1] }, { label: 'z', range: [-1, 1] }],
  moveHint: 'Arrow keys move the point across the view; with Shift, ↑ and ↓ move it away and nearer. Click or tap a wall to put the point there. The cell that holds the point at the selected level is lit in yellow.',
  initialProbe: () => [0.52, 0.86, 0.30, 0],
  report: (probe, state) => explorerReport(probe, state),
};

export const world = {
  id: 'menger',
  title: 'Menger sponge',
  formula: 'Cut out the middle. Repeat.',
  summary: 'A cube with its middle cross removed, then the same again in every piece that is left. Fly inside and find the whole sponge repeated at every scale.',
  fragment: FRAGMENT,
  defaults,
  cameraDistanceRange: [0.004, 9.0],
  paletteNames: ['Sandstone', 'Glacier', 'Levels', 'Chalk'],
  controlGroups: [
    group('Shape', `
      Level is how many times the rule has been applied. Each
      application cuts every remaining cube into 27 and removes 7:
      the one in the centre and the one in the middle of each face.
      Between whole numbers the newest holes are only part open,
      so you can watch them grow.

      The numbers below follow from counting. Each step keeps 20 of
      27 pieces, so the volume shrinks toward nothing while the
      walls of the new holes add surface without limit.`, [
      slider('Level', LEVEL, [0, MAXIMUM_LEVEL], levelText),
      readout('Cubes, 20ⁿ', state => (20 ** Math.max(Math.floor(state.values[LEVEL]), 0)).toLocaleString('en-US')),
      readout('Volume left, (20⁄27)ⁿ', state => Format.fixed((20 / 27) ** Math.floor(state.values[LEVEL]) * 100, 1) + '%'),
      readout('Surface, × the cube\'s', state => {
        const n = Math.floor(state.values[LEVEL]);
        return Format.fixed((2 * (20 / 9) ** n + 4 * (8 / 9) ** n) / 6, 2);
      }),
      readout('Dimension, log 20 ⁄ log 3', () => '2.7268'),
    ]),
    group('Slice', `
      Removes everything above a plane. Offset moves the plane;
      Tilt turns it from horizontal to the diagonal that is
      perpendicular to the line between opposite corners.

      A horizontal cut shows squares within squares. The diagonal
      cut through the centre shows something the outside never
      hints at: six-pointed stars, surrounded by smaller stars.`, [
      slider('Offset', SLICE_OFFSET, [-1.2, SLICE_DISABLED], value => (value >= 1.74 ? 'Off' : value.toFixed(2))),
      slider('Tilt', SLICE_TILT, [0, 1], value =>
        (value < 0.02 ? 'Flat' : (value > 0.98 ? 'Diagonal' : (value * 100).toFixed(0) + '%'))),
    ]),
  ],
  viewNote: `
    Zoom moves the camera toward the point it orbits. Double-click any
    wall to orbit that spot instead and fly toward it, including down
    the tunnels. Raise Level as you go deeper: each level adds holes one
    third the size of the last.

    Colour shows which level carved the wall you are looking at.`,
  tour,
  explorer,
  ride,
  shaderValues(state, probe, row) {
    const values = [...state.values];
    // Light the cell that holds the explorer's point at the selected level
    // (never deeper than the level that cut it out).
    if (probe) {
      const rows = explorerReport(probe, state).rows;
      const cell = rows.length ? cellContaining(probe, Math.min(Math.max(row, 1), rows[rows.length - 1].id)) : null;
      if (cell) {
        values[8] = cell.centre[0];
        values[9] = cell.centre[1];
        values[10] = cell.centre[2];
        values[11] = cell.halfSide;
      }
    }
    return values;
  },
  distance,
  prepareForZoom(state) {
    // Keep enough levels switched on for detail at the new scale.
    const magnification = defaults.cameraDistance / state.cameraDistance;
    const wanted = Math.min(3 + Math.log(Math.max(magnification, 1)) / Math.log(3), MAXIMUM_LEVEL);
    state.values[LEVEL] = Math.max(state.values[LEVEL], Math.round(wanted));
  },
};
