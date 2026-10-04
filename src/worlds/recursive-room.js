// The recursive room: a room whose back wall opens onto a smaller copy of
// itself, which opens onto a smaller copy still. This is
// Worlds/Recursive/RecursiveRoomWorld.swift, without its explorer; the tour's
// words are copied from it.
import { newState, copyState, keyframe, slider, toggle, readout, group, Format } from './engine.js';
import { Hyp } from './hyperbolic-math.js';
import { FRAGMENT } from './shaders/recursive-room.js';

// Indices into the state's values.
const SCALE = 0;
const TWIST = 1;
const ACROSS = 2;
const HEIGHT = 3;
const DEPTH = 4;
const COPIES = 5;
const TINT = 6;
const SHOW_PATH = 7;

/** Half the room's width, height and depth; RecursiveRoom.metal uses the same. */
const ROOM_HALF = [1.5, 1.0, 2.0];

const defaults = newState();
defaults.values[SCALE] = 0.34;
defaults.values[HEIGHT] = 0.08;
defaults.values[COPIES] = 10;
defaults.yaw = 0.26;
defaults.pitch = -0.10;
defaults.cameraDistance = 2.5;
defaults.focus = [0, -0.05, -0.6];

// MARK: The similarity

/** S(x) = k·R(θ)·x + t, which carries the room onto its copy. */
class Similarity {
  constructor(state) {
    this.k = Math.min(Math.max(state.values[SCALE], 0.05), 0.9);
    this.theta = state.values[TWIST];
    this.t = [state.values[ACROSS], state.values[HEIGHT], -ROOM_HALF[2] * (1 + this.k)];
  }

  rotated(p, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]];
  }

  apply(p) {
    return this.rotated(p, this.theta).map((c, i) => c * this.k + this.t[i]);
  }

  /** The one point with S(x) = x. In depth, z = t_z ⁄ (1 − k); across and
      up, the same formula with complex numbers: c ⁄ (1 − k·e^{iθ}). */
  get fixedPoint() {
    const c = [this.t[0], this.t[1]];
    const w = Hyp.div(c, Hyp.sub(Hyp.ONE, Hyp.scale(Hyp.expi(this.theta), this.k)));
    return [w[0], w[1], this.t[2] / (1 - this.k)];
  }

  /** S applied a whole or fractional number of times: shrink by kⁿ and turn
      by nθ about the fixed point. */
  power(n, p) {
    const f = this.fixedPoint;
    const size = this.k ** n;
    return this.rotated(p.map((c, i) => c - f[i]), n * this.theta).map((c, i) => f[i] + c * size);
  }
}

/** The path of a point through the copies, as markers: the point in the room
    the camera is in, then in each copy inward. */
function pathMarkers(point, state) {
  const s = new Similarity(state);
  const markers = [];
  const count = 9;
  const near = [0.25, 0.9, 1.0];
  const far = [1.0, 0.3, 0.65];
  for (let n = 0; n < count; n += 1) {
    const t = n / (count - 1);
    markers.push({
      position: s.power(n, point),
      size: 1.5 * s.k ** n,
      color: n === 0 ? [1, 1, 1] : near.map((c, i) => c + (far[i] - c) * t),
      connectsToNext: n < count - 1,
    });
  }
  markers.push({
    position: s.fixedPoint,
    size: 1.5 * s.k ** (count - 2),
    color: [1.0, 0.8, 0.2],
    connectsToNext: false,
  });
  return markers;
}

// MARK: Guided tour

const tour = [
  {
    title: 'A room with a view of itself',
    body: `
      On the far wall is a gold frame. At first it holds a blank
      canvas. Now the canvas shows the room, including its far wall,
      with a gold frame on it. And that frame shows the room.

      Each step fills in one more copy. They get smaller by the same
      factor every time, about a third, so ten copies in, a room the
      size of yours is smaller than a grain of sand.`,
    tryIt: 'Depth → Copies drawn',
    build(base) {
      const blank = copyState(base);
      blank.values[COPIES] = 1;
      const full = copyState(base);
      full.values[COPIES] = 10;
      return [keyframe(blank, 2.5, 2.0), keyframe(full, 12.0)];
    },
  },
  {
    title: 'Not a picture: a doorway',
    body: `
      Watch the copies as the camera moves from side to side. A
      painting would stay flat. These shift against each other, the
      way things at different distances do.

      The small room is really there, behind the wall, and the smaller
      one is behind its wall. The frame is a doorway. Everything is in
      one ordinary space; it is only arranged in an unusual way.`,
    tryIt: 'Drag to look from the side',
    build(base) {
      const left = copyState(base);
      left.yaw = -0.42;
      left.pitch = -0.05;
      const right = copyState(base);
      right.yaw = 0.48;
      right.pitch = -0.22;
      return [keyframe(left, 5.0, 0.5), keyframe(right, 9.0, 0.5), keyframe(base, 5.0)];
    },
  },
  {
    title: 'One rule makes them all',
    body: `
      Call the rule S: shrink the room by a factor k, and slide it back
      so that its open front lands on the doorway. Apply S to the room
      and you get the first copy. Apply it to the first copy and you
      get the second.

      Each copy is tinted its own colour here. Their depths are 4, 4k,
      4k², … and that infinite list adds up to something finite:
      4 ⁄ (1 − k). All of them fit in about six units.`,
    tryIt: 'Depth → Tint each copy; Doorway → Scale',
    build(base) {
      const tinted = copyState(base);
      tinted.values[TINT] = 1;
      tinted.yaw = 0.5;
      tinted.pitch = -0.2;
      const small = copyState(tinted);
      small.values[SCALE] = 0.24;
      const large = copyState(tinted);
      large.values[SCALE] = 0.52;
      return [keyframe(tinted, 3.0, 2.0), keyframe(small, 5.0, 1.0), keyframe(large, 7.0, 1.5), keyframe(tinted, 4.0)];
    },
  },
  {
    title: 'The point that stays put',
    body: `
      The white dot is a point in the room. The next dot is the same
      point in the first copy, the next in the second, and so on. They
      march in a straight line toward the gold dot.

      The gold dot is the fixed point: the one place S does not move.
      It lies in every copy, however deep. Every point in the room,
      copied again and again, heads for it, getting k times closer at
      each step.`,
    tryIt: 'Depth → Show a point\'s path',
    build(base) {
      const p = copyState(base);
      p.values[SHOW_PATH] = 1;
      p.yaw = 0.62;
      p.pitch = -0.30;
      p.cameraDistance = 2.8;
      return [keyframe(p, 4.0)];
    },
  },
  {
    title: 'Fly in, and arrive where you began',
    body: `
      We are flying through the doorway, into the copy, and through its
      doorway, three times over. Each time the camera pauses, look
      around: it is the picture we started with.

      Nothing marks one copy as the real room. Going in one doorway is
      the same as shrinking yourself by k, and from the inside there is
      no way to tell which you did.`,
    tryIt: 'Depth → Rooms deep',
    build(base) {
      const frames = [keyframe(base, 3.0, 1.5)];
      for (let n = 1; n <= 3; n += 1) {
        const p = copyState(base);
        p.values[DEPTH] = n;
        frames.push(keyframe(p, 6.0, 1.5));
      }
      return frames;
    },
  },
  {
    title: 'Back out: your room was the copy',
    body: `
      Now the other way. We back out of the room through its open
      front, and find it hanging on the wall of a larger room, inside
      a gold frame. Back out of that one, and it too is a copy.

      The rule runs in both directions for ever. There is no largest
      room and no smallest.`,
    tryIt: 'Depth → Rooms deep, below zero',
    build(base) {
      const inside = copyState(base);
      const out = copyState(inside);
      out.values[DEPTH] = -2;
      return [keyframe(inside, 3.5, 1.5), keyframe(out, 12.0)];
    },
  },
  {
    title: 'Add a twist',
    body: `
      S may also turn the room. Here each copy is turned 35° more than
      the last, and the doorway is hung off-centre. The copies now
      spiral in toward the fixed point, and so does the path of any
      point.

      A curve that turns by a fixed angle every time it shrinks by a
      fixed factor is a logarithmic spiral. It is the curve of a
      nautilus shell, and the idea behind Escher's Print Gallery.`,
    tryIt: 'Doorway → Twist, Across and Up',
    build(base) {
      const start = copyState(base);
      start.values[SHOW_PATH] = 1;
      const twisted = copyState(start);
      twisted.values[TWIST] = 0.61;
      twisted.values[ACROSS] = 0.35;
      twisted.values[HEIGHT] = 0.10;
      const deeper = copyState(twisted);
      deeper.values[DEPTH] = 2;
      return [keyframe(start, 3.0, 0.5), keyframe(twisted, 8.0, 2.0), keyframe(deeper, 12.0)];
    },
  },
  {
    title: 'How the picture is drawn',
    body: `
      Only one room is described to the computer. A ray leaves the
      camera for each pixel. If it meets a wall or the furniture, that
      is its colour. If it passes through the doorway, its position
      and direction are run backwards through S, and it carries on in
      the same room, now standing for the copy.

      A ray that leaves by the open front is run forwards through S
      instead, and finds itself in the larger room.`,
    build(base) {
      const p = copyState(base);
      p.yaw = -0.3;
      p.pitch = -0.28;
      p.cameraDistance = 2.2;
      return [keyframe(p, 4.0)];
    },
  },
  {
    title: 'Your turn',
    body: `
      Drag to look around. Change the doorway's scale, twist and place,
      and use Rooms deep to travel in or out. Every group of controls
      has an ⓘ note.

      The address of this page always holds the view on screen, so a
      copied link brings anyone to the very same spot.`,
    build: base => [keyframe(base, 3.0)],
  },
];

// MARK: World

export const world = {
  id: 'recursive-room',
  title: 'Recursive room',
  formula: 'S(x) = k·R·x + t, again and again',
  summary: 'A room with a doorway onto a smaller copy of itself, which has a doorway onto a smaller copy still. Fly in for ever and arrive where you began; back out and find your room was the copy.',
  fragment: FRAGMENT,
  defaults,
  cameraDistanceRange: [0.4, 9.0],
  paletteNames: ['Warm', 'Cool'],
  controlGroups: [
    group('Doorway', `
      The copy behind the doorway is the whole room, shrunk by the
      factor Scale, turned by Twist, and moved to where the doorway
      is. That one transformation, S, is all there is: the copy
      contains a doorway too, because the room does.

      The copies have sizes 1, k, k², k³, … so although there are
      infinitely many, placed end to end they have a finite total
      depth, 4k ⁄ (1 − k). They close in on one point, the fixed
      point, which S leaves where it is.`, [
      slider('Scale, k', SCALE, [0.2, 0.6], value => value.toFixed(2)),
      slider('Twist, θ', TWIST, [-Math.PI / 2, Math.PI / 2], value => (value * 180 / Math.PI).toFixed(0) + '°'),
      slider('Across', ACROSS, [-0.7, 0.7], value => value.toFixed(2)),
      slider('Up', HEIGHT, [-0.4, 0.4], value => value.toFixed(2)),
      readout('Depth of all copies', state => {
        const k = new Similarity(state).k;
        return Format.number(4 * k / (1 - k), 3);
      }),
      readout('Fixed point', state => Format.vector(new Similarity(state).fixedPoint, 2)),
    ]),
    group('Depth', `
      Rooms deep moves you through the doorways: 1 means you have
      gone through one, and stand in the copy where you stood in
      the room. The picture at 0, 1, 2, … is identical, because
      each copy is exact. Negative values back out of the room,
      which turns out to be a copy inside a larger one.

      Copies drawn limits how many doorways a ray may pass. At 1
      the doorway is a blank canvas; each extra copy fills in the
      next.`, [
      slider('Rooms deep', DEPTH, [-3, 5], value => value.toFixed(2)),
      slider('Copies drawn', COPIES, [1, 12], value => String(Math.round(value))),
      toggle('Tint each copy', TINT),
      toggle('Show a point\'s path', SHOW_PATH),
    ]),
  ],
  viewNote: `
    Drag to look from a different side; the copies shift against each
    other, because they really are behind the wall, not painted on it.
    Zoom moves the camera toward the middle of the room.`,
  tour,
  shaderValues(state) {
    const values = new Array(32).fill(0);
    const s = new Similarity(state);
    values[0] = s.k;
    values[1] = s.theta;
    values[2] = s.t[0];
    values[3] = s.t[1];
    // Every whole number of rooms deep looks the same, so only the
    // fraction is needed, and the numbers stay small.
    values[4] = state.values[DEPTH] - Math.floor(state.values[DEPTH]);
    values[5] = Math.round(state.values[COPIES]);
    values[6] = state.values[TINT] > 0.5 ? 1 : 0;
    return values;
  },
  discreteValues: new Set([TINT, SHOW_PATH]),
  cameraBacksAwayWhenMoving: false,
  resetView(state) {
    state.values[DEPTH] = 0;
  },
  overlayMarkers(state) {
    return state.values[SHOW_PATH] > 0.5 ? pathMarkers([0.9, 0.3, 1.0], state) : [];
  },
};
