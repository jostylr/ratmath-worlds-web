// Port of RatMathWorlds/Model/MandelbulbTour.swift. Keep the text in step
// with that file.
import { cloneParameters, defaultParameters, surfacePointFromAngles } from './math.js';

const keyframe = (target, duration, hold = 0) => ({ target, duration, hold });
const derive = (base, changes) => ({ ...cloneParameters(base), ...changes });

// The close-up steps share one focus point. It is found with the deepest
// step's iteration count so the camera never ends up inside the surface.
const CLOSE_UP_YAW = 2.2;
const CLOSE_UP_PITCH = 0.6;

function closeUp(base, distance, iterations) {
  const probe = derive(base, { iterations: 18 });
  return derive(base, {
    yaw: CLOSE_UP_YAW,
    pitch: CLOSE_UP_PITCH,
    focus: surfacePointFromAngles(CLOSE_UP_YAW, CLOSE_UP_PITCH, probe) ?? [0, 0, 0],
    cameraDistance: distance,
    iterations,
  });
}

export const steps = [
  {
    title: 'A shape made by one rule',
    body: [
      'Pick any point c in space. Start with z = c and repeat a single rule: z → zⁿ + c. If z stays near the origin forever, c belongs to the Mandelbulb. If z flies away, it does not.',
      'What you see is the border between those two fates. Nothing here is modelled or stored; every pixel is worked out from the rule as you watch.',
    ],
    tryIt: null,
    explore: 'Follow one point through the rule and see every number along the way.',
    build: base => [keyframe(derive(base, { cameraDistance: 3.7 }), 2.5)],
  },
  {
    title: 'What “power” means',
    body: [
      'Points in space cannot be multiplied the way complex numbers can, so zⁿ is defined in spherical coordinates: raise the distance from the origin to the power n, and multiply both angles by n.',
      'At n = 2 the result is stretched and wispy, with no buds at all. Watch as n climbs to 8: multiplying the angles by a larger number wraps space around itself more times, and each wrap leaves a bud.',
    ],
    tryIt: 'Shape → Power',
    explore: 'Change n in the explorer and watch the same point\'s orbit take a different path.',
    build: base => {
      const low = derive(base, { power: 2, yaw: 0.5, pitch: 0.55, cameraDistance: 4.2 });
      const high = derive(low, { power: 8, cameraDistance: 3.6 });
      return [keyframe(low, 2.5, 2.0), keyframe(high, 9.0)];
    },
  },
  {
    title: 'Count the symmetry',
    body: [
      'You are now looking straight down the polar axis. Multiplying the longitude angle by n makes the shape repeat every 360° / (n − 1) around this axis. For power 8 that is seven identical sectors.',
      'Later, change Power and count again: power 5 gives four sectors, power 10 gives nine.',
    ],
    tryIt: 'Shape → Power',
    explore: null,
    build: base => [keyframe(derive(base, { yaw: 0, pitch: 0, cameraDistance: 3.5 }), 3.0)],
  },
  {
    title: 'Iterations: how patient we are',
    body: [
      'A computer can only repeat the rule a finite number of times. After 3 repetitions almost every nearby point still looks as if it stays, so the shape is a blob.',
      'Each extra repetition removes the points that escape one step later, carving finer detail. The true Mandelbulb is the limit of this carving, and it is never finished.',
    ],
    tryIt: 'Shape → Iterations',
    explore: 'The explorer lists every repetition for a point. Raise “steps” and see when it finally escapes.',
    build: base => {
      const coarse = derive(base, {
        yaw: CLOSE_UP_YAW, pitch: CLOSE_UP_PITCH, cameraDistance: 3.4, iterations: 3,
      });
      const fine = derive(coarse, { iterations: 14 });
      return [keyframe(coarse, 2.5, 1.5), keyframe(fine, 10.0)];
    },
  },
  {
    title: 'Zoom in: buds upon buds',
    body: [
      'We are now about 7 times closer. Every bud carries smaller buds laid out in the same pattern, because the same rule acts at every scale.',
      'Unlike an exact fractal such as the Menger sponge, the small copies are bent and stretched. They resemble the whole without repeating it.',
    ],
    tryIt: 'View → Zoom, or double-tap a spot',
    explore: 'Slide a point across these buds with the arrow keys and watch its escape step change.',
    build: base => [keyframe(closeUp(base, 0.48, 14), 6.0)],
  },
  {
    title: 'Deeper still',
    body: [
      'About 50 times closer than where we started. More iterations have been switched on along the way. Without them this surface would look smooth, because detail of this size only appears after the rule has been repeated more times.',
      'There is no bottom. New structure keeps appearing for as long as the arithmetic has digits left to describe it.',
    ],
    tryIt: 'View → Zoom together with Shape → Iterations',
    explore: 'Neighbouring points here escape at very different steps. Move one a little and compare.',
    build: base => [keyframe(closeUp(base, 0.065, 18), 8.0)],
  },
  {
    title: 'How the picture is drawn',
    body: [
      'There are no triangles. For each pixel a ray walks forward through space. The rule also supplies a safe step length, roughly ½ · r · ln r / |r′|, which says how far the ray may jump without passing through the surface.',
      'Rays that skim the surface need many small steps. That step count is used to darken creases, which is why crevices look deep.',
    ],
    tryIt: null,
    explore: null,
    build: base => [keyframe(closeUp(base, 0.20, 16), 5.0)],
  },
  {
    title: 'Slice it open',
    body: [
      'Cutting through the middle shows that the inside is solid. Interior points never escape, so there is nothing to see there but the cut itself. The bands on the cut show how far from the origin each point\'s path has settled. They are plain rings: deep inside, a point barely moves.',
      'All of the complexity lives on the boundary.',
    ],
    tryIt: 'Slice → Height',
    explore: 'Turn off “Keep it on the surface” and push a point inside: its orbit never leaves.',
    build: base => {
      const whole = derive(base, { yaw: 0.45, pitch: -0.80, cameraDistance: 3.7, sliceHeight: 1.25 });
      const cut = derive(whole, { sliceHeight: 0 });
      return [keyframe(whole, 4.0, 0.5), keyframe(cut, 7.0)];
    },
  },
  {
    title: 'Julia sets: freeze c',
    body: [
      'Until now c was the point being tested. Here c is frozen to one value for every point, and only the starting z changes. The result is a Julia set, and there is a different one for every choice of c.',
      'The Mandelbulb is the catalogue of them all: each of its points names one Julia set, and points near its surface name the most intricate ones.',
    ],
    tryIt: 'Julia → Morph, and c x / y / z',
    explore: 'In the explorer\'s Julia mode, c is the green point. Move it and the whole set changes.',
    build: base => {
      const start = derive(base, { yaw: 0.4, pitch: 0.5, cameraDistance: 3.7 });
      const julia = derive(start, { juliaMix: 1 });
      const moved = derive(julia, { juliaC: [-0.45, 0.35, 0.60] });
      return [keyframe(start, 3.0, 0.5), keyframe(julia, 8.0, 1.5), keyframe(moved, 8.0)];
    },
  },
  {
    title: 'Twist the angles',
    body: [
      'Adding a constant to an angle after multiplying it turns each fold a little. The shape is not simply rotated: the same offset is added again at every repetition, so the turn compounds and the buds shear into spirals.',
    ],
    tryIt: 'Twist → Longitude and Latitude',
    explore: null,
    build: base => {
      const start = derive(base, { yaw: 0.15, pitch: 0.30, cameraDistance: 3.5 });
      const twisted = derive(start, { phasePhi: 2.2 });
      const both = derive(twisted, { phaseTheta: 0.9 });
      return [keyframe(start, 3.0, 0.5), keyframe(twisted, 7.0, 1.0), keyframe(both, 6.0)];
    },
  },
  {
    title: 'Your turn',
    body: [
      'Drag to turn the object. Pinch, scroll, use the Zoom slider, or double-tap any spot to fly toward it. Every group of controls has an ⓘ button with a short note on what it changes and why. The orbit explorer, also in the control panel, shows the arithmetic for any point.',
      'Reset view and Reset shape bring you back here.',
    ],
    tryIt: null,
    explore: 'Pick any point and see exactly how the rule treats it.',
    build: base => [keyframe(base, 4.0)],
  },
];

/**
 * Steps always animate to a fully specified state, so the tour looks the same
 * whatever was changed beforehand. Only the palette is kept.
 */
export function keyframesFor(index, current) {
  const base = defaultParameters();
  base.palette = current.palette;
  return steps[index].build(base);
}
