// Clip note quads to their own time plane before camera projection. UV values are
// interpolated with the edges so partial Holds and rotated notes keep their texture.
export function clipSpatialSprite(points, bounds) {
  let polygon = points;
  for (const [axis, boundary, sign] of [['x', bounds.left, 1], ['x', bounds.right, -1], ['y', bounds.bottom, 1], ['y', bounds.top, -1]]) {
    const result = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length], insideA = (a[axis] - boundary) * sign >= 0, insideB = (b[axis] - boundary) * sign >= 0;
      if (insideA) result.push(a);
      if (insideA !== insideB) {
        const f = (boundary - a[axis]) / (b[axis] - a[axis]);
        result.push(Object.fromEntries(['x', 'y', 'u', 'v'].map(key => [key, a[key] + (b[key] - a[key]) * f])));
      }
    }
    polygon = result; if (!polygon.length) break;
  }
  return polygon;
}
