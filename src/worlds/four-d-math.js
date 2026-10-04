// Arithmetic for slicing four-dimensional shapes: FourDMath.Slice in
// Worlds/FourD/FourDWorld.swift, shared by the 4D slices and the quaternion
// Julia set. A 4-vector is a plain array [x, y, z, w].

export const dot4 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

/**
 * The slice: three directions that span it and the hidden direction at right
 * angles to it. They are the columns of a 4D rotation built from turns in the
 * xw, yw and zw planes.
 */
export function makeSlice(xw, yw, zw, w) {
  // Turn the four axes one plane at a time.
  const axes = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  const turn = (i, angle) => {
    const c = Math.cos(angle), s = Math.sin(angle);
    for (const axis of axes) {
      const a = axis[i], b = axis[3];
      axis[i] = c * a + s * b;
      axis[3] = -s * a + c * b;
    }
  };
  turn(2, zw);
  turn(1, yw);
  turn(0, xw);
  return { e1: axes[0], e2: axes[1], e3: axes[2], n: axes[3], w };
}

/** The 4D point at the place u of the slice. */
export const slicePoint = (slice, u) =>
  [0, 1, 2, 3].map(i => slice.e1[i] * u[0] + slice.e2[i] * u[1] + slice.e3[i] * u[2] + slice.n[i] * slice.w);

/** The numbers both shaders take for a slice: e₁, e₂, e₃ and n in v[1] to v[4]. */
export function writeSlice(values, slice) {
  for (let i = 0; i < 4; i += 1) {
    values[4 + i] = slice.e1[i];
    values[8 + i] = slice.e2[i];
    values[12 + i] = slice.e3[i];
    values[16 + i] = slice.n[i];
  }
}
