// What the rides that find their own way share: a list of random numbers
// that can be made the same every time, and the turning of a camera the
// short way round.

/** Random numbers from 0 up to 1. With a whole-number seed the list is the
    same on every run, so a ride can be repeated exactly (?ride=7). */
export function rideRandom(seed) {
  if (!Number.isInteger(seed)) { return Math.random; }
  let state = (seed * 0x9E3779B1 + 0x7F4A7C15) >>> 0;
  return () => {
    // xorshift32.
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

/** One of a list, chosen by a random number. */
export const pick = (random, list) => list[Math.min(Math.floor(random() * list.length), list.length - 1)];

/** The angle equal to `angle` (give or take whole turns) that is nearest to
    `near`, so that a camera turns the short way. */
export const nearestTurn = (angle, near) => angle + 2 * Math.PI * Math.round((near - angle) / (2 * Math.PI));
