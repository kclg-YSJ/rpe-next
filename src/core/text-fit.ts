/** The raster a fitting request describes, plus the stroke geometry to fit it with. */
export interface TextFitRequest {
  /** One byte per pixel, row-major; non-zero means the glyph covers the pixel. */
  mask: Uint8Array;
  width: number;
  height: number;
  /** Stroke length and thickness, in pixels. */
  length: number;
  thickness: number;
  /** The largest number of strokes the caller will accept. */
  limit: number;
  /** The error the caller is willing to accept, as a fraction of the covered target. */
  tolerance: number;
  /** The share of the glyph skeleton every stroke must reach. */
  requiredCoverage?: number;
}

/** A single fitted stroke, in pixel coordinates with its rotation in radians. */
export interface FittedStroke {
  x: number;
  y: number;
  angle: number;
}

/** The outcome of a fitting run, including the diagnostics the panel reports. */
export interface TextFitResult {
  strokes: FittedStroke[];
  error: number;
  passed: boolean;
  covered: Uint8Array;
  target: number;
  missing: number;
  excess: number;
  skeletonCoverage: number;
  requiredCoverage: number;
}

/** A candidate stroke awaiting selection, ordered by `score` in a max-heap. */
interface StrokeCandidate extends FittedStroke {
  pixels: Uint32Array;
  outside: number;
  preference: number;
  score: number;
}

/** Every pixel a rotated rectangle covers, as row-major indices. */
export function rectanglePixels(width: number, height: number, horizontal: number, vertical: number, length: number, thickness: number, angle: number): number[] {
  const cosine = Math.cos(angle); const sine = Math.sin(angle);
  // Half-extents of the rotated rectangle's axis-aligned bounding box, used to bound the scan.
  const radiusX = (Math.abs(cosine) * length + Math.abs(sine) * thickness) / 2;
  const radiusY = (Math.abs(sine) * length + Math.abs(cosine) * thickness) / 2;
  const pixels: number[] = [];
  for (let row = Math.max(0, Math.floor(vertical - radiusY)); row < Math.min(height, Math.ceil(vertical + radiusY)); row++) {
    for (let column = Math.max(0, Math.floor(horizontal - radiusX)); column < Math.min(width, Math.ceil(horizontal + radiusX)); column++) {
      const deltaX = column + 0.5 - horizontal; const deltaY = row + 0.5 - vertical;
      // Tested in the rectangle's own frame: `length` along the rotated axis, `thickness` across it.
      if (Math.abs(deltaX * cosine + deltaY * sine) <= length / 2 && Math.abs(-deltaX * sine + deltaY * cosine) <= thickness / 2) pixels.push(row * width + column);
    }
  }
  return pixels;
}

/**
 * Thins the glyph down to a one-pixel skeleton.
 *
 * This is a Zhang-Suen thinning pass: repeatedly delete boundary pixels that are not endpoints and
 * whose neighbourhood has exactly one 0-to-1 transition, in two alternating sub-iterations so the
 * result stays connected and roughly centred. Short spurs are then extended back out along their own
 * direction, which recovers the tapered ends of a glyph that thinning alone would round off.
 */
export function textSkeleton(mask: Uint8Array, width: number, height: number): Uint8Array {
  // A one-pixel border of zeros, so the neighbourhood tests below need no bounds checks.
  const stride = width + 2; const pixels = new Uint8Array(stride * (height + 2));
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) pixels[(row + 1) * stride + column + 1] = mask[row * width + column] ? 1 : 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (let phase = 0; phase < 2; phase++) {
      const remove: number[] = [];
      for (let row = 1; row <= height; row++) for (let column = 1; column <= width; column++) {
        const index = row * stride + column; if (!pixels[index]) continue;
        const north = pixels[index - stride]; const east = pixels[index + 1]; const south = pixels[index + stride]; const west = pixels[index - 1];
        const neighbors = [north, pixels[index - stride + 1], east, pixels[index + stride + 1], south, pixels[index + stride - 1], west, pixels[index - stride - 1]];
        const count = neighbors.reduce((sum, value) => sum + value, 0); if (count < 2 || count > 6) continue;
        let transitions = 0;
        for (let side = 0; side < 8; side++) if (!neighbors[side] && neighbors[(side + 1) % 8]) transitions++;
        if (transitions !== 1) continue;
        // The phase-specific term: only remove a pixel whose removal cannot break a 2-pixel-wide run.
        if (phase === 0 ? north * east * south || east * south * west : north * east * west || north * south * west) continue;
        remove.push(index);
      }
      if (remove.length) { changed = true; for (const index of remove) pixels[index] = 0; }
    }
  }
  const skeleton = new Uint8Array(mask.length);
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) skeleton[row * width + column] = pixels[(row + 1) * stride + column + 1];
  const neighborsOf = (index: number): number[] => {
    const column = index % width; const row = Math.floor(index / width); const neighbors: number[] = [];
    for (let vertical = -1; vertical <= 1; vertical++) for (let horizontal = -1; horizontal <= 1; horizontal++) if ((horizontal || vertical) && column + horizontal >= 0 && column + horizontal < width && row + vertical >= 0 && row + vertical < height) {
      const neighbor = (row + vertical) * width + column + horizontal; if (skeleton[neighbor]) neighbors.push(neighbor);
    }
    return neighbors;
  };
  const extensions: number[] = [];
  for (let index = 0; index < skeleton.length; index++) if (skeleton[index] && neighborsOf(index).length === 1) {
    // Walk up to six steps along the spur to learn its direction.
    let previous = -1; let current = index;
    for (let step = 0; step < 6; step++) { const neighbors = neighborsOf(current).filter(neighbor => neighbor !== previous); if (neighbors.length !== 1) break; previous = current; current = neighbors[0]; }
    const column = index % width; const row = Math.floor(index / width);
    const deltaX = column - current % width; const deltaY = row - Math.floor(current / width); const distance = Math.hypot(deltaX, deltaY);
    if (!distance) continue;
    for (let step = 0.5; step < Math.max(width, height); step += 0.5) {
      const horizontal = Math.round(column + deltaX / distance * step); const vertical = Math.round(row + deltaY / distance * step);
      if (horizontal < 0 || horizontal >= width || vertical < 0 || vertical >= height || !mask[vertical * width + horizontal]) break;
      extensions.push(vertical * width + horizontal);
    }
  }
  for (const index of extensions) skeleton[index] = 1;
  return skeleton;
}

/**
 * Widens the skeleton into the band a stroke of `thickness` must land inside.
 *
 * A two-pass chamfer distance transform gives every pixel its distance to the nearest skeleton pixel
 * in 8-connected metric; pixels within half the thickness become the target. This is what lets a
 * stroke be scored by how much *target* it covers rather than how many raw glyph pixels it touches.
 */
function skeletonTarget(skeleton: Uint8Array, width: number, height: number, thickness: number): Uint8Array {
  const distance = Float32Array.from(skeleton, value => value ? 0 : Infinity); const diagonal = Math.SQRT2;
  for (let index = 0; index < distance.length; index++) {
    const column = index % width;
    if (column) distance[index] = Math.min(distance[index], distance[index - 1] + 1);
    if (index >= width) distance[index] = Math.min(distance[index], distance[index - width] + 1, column ? distance[index - width - 1] + diagonal : Infinity, column + 1 < width ? distance[index - width + 1] + diagonal : Infinity);
  }
  for (let index = distance.length - 1; index >= 0; index--) {
    const column = index % width;
    if (column + 1 < width) distance[index] = Math.min(distance[index], distance[index + 1] + 1);
    if (index + width < distance.length) distance[index] = Math.min(distance[index], distance[index + width] + 1, column ? distance[index + width - 1] + diagonal : Infinity, column + 1 < width ? distance[index + width + 1] + diagonal : Infinity);
  }
  return Uint8Array.from(distance, value => value <= Math.max(0.75, thickness / 2) ? 1 : 0);
}

/**
 * Labels the skeleton's connected components and reports each one's size.
 *
 * `sizes` is indexed by component id, and `membership` gives every pixel its component, so the
 * coverage check below can require that *each* stroke reaches *every* component rather than
 * accepting a good average that leaves one stroke of a character untouched.
 */
function skeletonComponents(skeleton: Uint8Array, width: number, height: number): { membership: Int32Array; sizes: number[] } {
  const membership = new Int32Array(skeleton.length).fill(-1); const sizes: number[] = [];
  for (let index = 0; index < skeleton.length; index++) if (skeleton[index] && membership[index] < 0) {
    const component = sizes.length; const queue = [index]; membership[index] = component;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const column = queue[cursor] % width; const row = Math.floor(queue[cursor] / width);
      for (let vertical = -1; vertical <= 1; vertical++) for (let horizontal = -1; horizontal <= 1; horizontal++) if (column + horizontal >= 0 && column + horizontal < width && row + vertical >= 0 && row + vertical < height) {
        const neighbor = (row + vertical) * width + column + horizontal;
        if (skeleton[neighbor] && membership[neighbor] < 0) { membership[neighbor] = component; queue.push(neighbor); }
      }
    }
    sizes.push(queue.length);
  }
  return { membership, sizes };
}

/**
 * Fits the glyph with as few strokes of the given geometry as the tolerance allows.
 *
 * Greedy best-first selection over a max-heap: every stroke position and angle is seeded as a
 * candidate, the best one is taken, and the remaining candidates are re-scored against what is still
 * uncovered. A candidate that has fallen behind the current heap maximum is pushed back rather than
 * discarded, so a stroke that only becomes worthwhile later is not lost.
 */
export function fitTextMask({ mask, width, height, length, thickness, limit, tolerance, requiredCoverage = 0.95 }: TextFitRequest): TextFitResult {
  if (!(mask instanceof Uint8Array) || mask.length !== width * height || width * height > 300000 || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('文字栅格无效或过大');
  if (![length, thickness, tolerance].every(Number.isFinite) || length < 1 || thickness < 1 || length > 1024 || thickness > 1024 || length * thickness > 2048 || tolerance < 0 || tolerance >= 1 || !Number.isInteger(limit) || limit < 1 || limit > 5000) throw new Error('笔画尺寸、容忍度或可用线数无效');
  if (!Number.isFinite(requiredCoverage) || requiredCoverage < 0 || requiredCoverage > 1) throw new Error('骨架覆盖度下限须为 0–100%');
  const skeleton = textSkeleton(mask, width, height);
  mask = skeletonTarget(skeleton, width, height, thickness);
  const target = mask.reduce((sum, value) => sum + (value ? 1 : 0), 0);
  if (!target) throw new Error('文本没有可见字形');
  const covered = new Uint8Array(mask.length); const heap: StrokeCandidate[] = [];
  const push = (candidate: StrokeCandidate): void => {
    let index = heap.length; heap.push(candidate);
    while (index > 0) { const parent = (index - 1) >> 1; if (heap[parent].score >= candidate.score) break; heap[index] = heap[parent]; index = parent; }
    heap[index] = candidate;
  };
  const pop = (): StrokeCandidate => {
    const first = heap[0]; const last = heap.pop() as StrokeCandidate;
    if (heap.length) { let index = 0; while (index * 2 + 1 < heap.length) { let child = index * 2 + 1; if (child + 1 < heap.length && heap[child + 1].score > heap[child].score) child++; if (last.score >= heap[child].score) break; heap[index] = heap[child]; index = child; } heap[index] = last; }
    return first;
  };
  const centers: number[] = [];
  for (let index = 0; index < skeleton.length; index++) if (skeleton[index]) centers.push(index);
  const components = skeletonComponents(skeleton, width, height); const componentCovered = new Uint32Array(components.sizes.length);
  // Seed at most ~4000 centers: enough to find every stroke a glyph needs, without 16 candidates per
  // pixel of a large raster.
  const stride = Math.max(1, Math.ceil(centers.length / 4000));
  for (let center = 0; center < centers.length; center += stride) {
    const row = Math.floor(centers[center] / width); const column = centers[center] % width;
    // The 16 directions run axis-aligned first, then diagonals, then the finer angles, so ties favour
    // the orientations a human would draw with.
    for (const direction of [0, 4, 8, 12, 2, 6, 10, 14, 1, 3, 5, 7, 9, 11, 13, 15]) {
      const angle = direction * Math.PI / 16;
      const pixels = rectanglePixels(width, height, column + 0.5, row + 0.5, length, thickness, angle);
      const inside = pixels.reduce((sum, index) => sum + (mask[index] ? 1 : 0), 0); const outside = pixels.length - inside;
      const centerline = pixels.reduce((sum, index) => sum + skeleton[index], 0);
      const preference = direction % 4 === 0 ? 1.25 : direction % 2 === 0 ? 1 : 0.94;
      const score = (inside + centerline * thickness - outside * 0.9) * preference;
      if (score > 0) push({ x: column + 0.5, y: row + 0.5, angle, pixels: Uint32Array.from(pixels), outside, preference, score });
    }
  }
  const strokes: FittedStroke[] = []; let intersection = 0; let excess = 0; let error = 1; let skeletonCoverage = 0;
  while (heap.length && strokes.length < limit && (error > tolerance || skeletonCoverage < requiredCoverage)) {
    const candidate = pop(); let fresh = 0; let freshSkeleton = 0;
    for (const index of candidate.pixels) if (!covered[index]) { if (mask[index]) fresh++; if (skeleton[index]) freshSkeleton++; }
    // The `outside` penalty relaxes as the error falls, so late strokes are freer to overhang.
    const score = (fresh + freshSkeleton * thickness - candidate.outside * Math.max(0.9, 1 - error)) * candidate.preference;
    if (score <= 0) continue;
    // Re-queue rather than discard: the heap may still hold a better stroke for this region.
    if (heap.length && score < heap[0].score) { candidate.score = score; push(candidate); continue; }
    for (const index of candidate.pixels) if (!covered[index]) { covered[index] = 1; if (mask[index]) intersection++; else excess++; if (skeleton[index]) componentCovered[components.membership[index]]++; }
    strokes.push({ x: candidate.x, y: candidate.y, angle: candidate.angle });
    error = 1 - intersection / (target + excess);
    // The worst-covered component decides, so one untouched stroke of a character cannot be averaged away.
    skeletonCoverage = components.sizes.reduce((minimum, size, index) => Math.min(minimum, componentCovered[index] / size), 1);
  }
  return { strokes, error, passed: error <= tolerance && skeletonCoverage >= requiredCoverage, covered, target, missing: target - intersection, excess, skeletonCoverage, requiredCoverage };
}
