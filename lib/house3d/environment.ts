/**
 * The built-in surroundings that shiny things reflect with Pretty graphics:
 * a soft bright sky above, a warm floor below and a few bright window
 * shapes near eye level, so counters, tile and steel catch highlights.
 * Made in code (no downloaded picture), as an equirectangular image:
 * RGBA floats in linear light, `width` by `width / 2`, top row first.
 */
export function roomEnvironment(width = 256): Float32Array {
  const height = width / 2;
  const out = new Float32Array(width * height * 4);
  // Windows: around the room at eye level, [middle angle, half width, bottom, top] (radians).
  const windows: [number, number, number, number][] = [
    [0.3, 0.32, -0.05, 0.55],
    [2.2, 0.22, 0.0, 0.5],
    [4.0, 0.4, -0.05, 0.6],
  ];
  for (let y = 0; y < height; y++) {
    const el = Math.PI / 2 - ((y + 0.5) / height) * Math.PI; // up is +pi/2
    for (let x = 0; x < width; x++) {
      const az = ((x + 0.5) / width) * Math.PI * 2;
      let c: [number, number, number];
      if (el > 0) {
        const t = el / (Math.PI / 2);
        c = [0.85 + 0.25 * t, 0.9 + 0.25 * t, 0.98 + 0.3 * t];
      } else {
        const t = Math.min(1, -el / 0.6);
        c = [0.5 - 0.22 * t, 0.46 - 0.21 * t, 0.4 - 0.18 * t];
      }
      for (const [mid, half, lo, hi] of windows) {
        let d = Math.abs(az - mid);
        d = Math.min(d, Math.PI * 2 - d);
        if (d < half && el > lo && el < hi) {
          // Soft edges so highlights aren't hard-cut.
          const edge = Math.min(1, (half - d) / 0.06, (el - lo) / 0.06, (hi - el) / 0.06);
          const b = 2.6 * edge;
          c = [c[0] + b, c[1] + b * 0.98, c[2] + b * 0.95];
        }
      }
      const i = (y * width + x) * 4;
      out[i] = c[0];
      out[i + 1] = c[1];
      out[i + 2] = c[2];
      out[i + 3] = 1;
    }
  }
  return out;
}
