// Image -> inflated heightfield -> double-sided mesh data.
// Pure functions, no DOM except `imageToGray`.

/** Draw an image source onto a canvas (fit to maxSize), flatten alpha on white, return grayscale 0..255. */
export function imageToGray(source, maxSize) {
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  const scale = Math.min(1, maxSize / Math.max(sw, sh));
  const w = Math.max(2, Math.round(sw * scale));
  const h = Math.max(2, Math.round(sh * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  }
  return { gray, w, h };
}

function boxBlur(src, w, h, r) {
  if (r < 1) return src;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / win;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** Threshold grayscale into a binary mask (1 = shape). Blur first to round off jaggies. */
export function makeMask(gray, w, h, { threshold, invert, edgeSoften }) {
  let g = gray;
  for (let i = 0; i < 3; i++) g = boxBlur(g, w, h, Math.round(edgeSoften));
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const dark = g[i] < threshold;
    mask[i] = (invert ? !dark : dark) ? 1 : 0;
  }
  // Frame the image with background so shapes touching the border still close up.
  for (let x = 0; x < w; x++) mask[x] = mask[(h - 1) * w + x] = 0;
  for (let y = 0; y < h; y++) mask[y * w] = mask[y * w + w - 1] = 0;
  return mask;
}

// Felzenszwalb & Huttenlocher squared Euclidean distance transform.
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    const inter = (p) => (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
    let s = inter(v[k]);
    while (s <= z[k]) {
      k--;
      s = inter(v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
}

/** Distance (in px) from each shape pixel to the nearest background pixel. Background = 0. */
export function distanceInside(mask, w, h) {
  const INF = 1e12;
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = mask[i] ? INF : 0;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n);
  const v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = mask[i] ? Math.sqrt(grid[i]) : 0;
  return out;
}

/**
 * Build the inflated height (in px units) per pixel.
 * radius: px at which the round profile reaches full height.
 * depth: height multiplier relative to radius (1 = circular tube cross-section).
 * smooth: Laplacian iterations; removes the ridge crease along the medial axis for a liquid look.
 */
export function buildHeight(mask, w, h, { radius, depth, smooth }) {
  const dist = distanceInside(mask, w, h);
  // dd = 0 on the boundary ring, so front and back surfaces meet exactly there.
  let dd = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) dd[i] = dist[i] > 1 ? dist[i] - 1 : 0;

  let next = new Float32Array(w * h);
  for (let it = 0; it < smooth; it++) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (dd[i] === 0) { next[i] = 0; continue; }
        const avg = (dd[i - 1] + dd[i + 1] + dd[i - w] + dd[i + w]) * 0.25;
        next[i] = dd[i] * 0.4 + avg * 0.6;
      }
    }
    [dd, next] = [next, dd];
  }

  const height = new Float32Array(w * h);
  const H = radius * depth;
  for (let i = 0; i < w * h; i++) {
    if (dd[i] <= 0) continue;
    const t = Math.min(1, dd[i] / radius);
    height[i] = H * Math.sqrt(1 - (1 - t) * (1 - t));
  }
  return height;
}

/**
 * Create indexed double-sided mesh arrays. Boundary vertices (height 0) are shared by both sides,
 * so smooth normals come out continuous around the rim.
 * World units: longest image side maps to `worldSize`.
 */
export function buildMeshData(mask, height, w, h, worldSize, rimSmooth = 12) {
  const s = worldSize / Math.max(w, h);
  const front = new Int32Array(w * h).fill(-1);
  const back = new Int32Array(w * h).fill(-1);
  const pos = [];
  let n = 0;

  const used = new Uint8Array(w * h);
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const a = y * w + x;
      if (mask[a] && mask[a + 1] && mask[a + w] && mask[a + w + 1]) {
        used[a] = used[a + 1] = used[a + w] = used[a + w + 1] = 1;
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (!used[i]) continue;
    const x = (i % w - w / 2) * s;
    const y = -(Math.floor(i / w) - h / 2) * s;
    const z = height[i] * s;
    front[i] = n++;
    pos.push(x, y, z);
    if (z > 1e-6) {
      back[i] = n++;
      pos.push(x, y, -z);
    } else {
      back[i] = front[i];
    }
  }

  const idx = [];
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const a = y * w + x, b = a + 1, c = a + w, d = a + w + 1;
      if (!(used[a] && used[b] && used[c] && used[d])) continue;
      if (!(mask[a] && mask[b] && mask[c] && mask[d])) continue;
      // Skip fully flat cells (1px-thin slivers) to avoid degenerate faces.
      if (height[a] + height[b] + height[c] + height[d] <= 0) continue;
      // Pick the diagonal that follows the surface better.
      const flip = Math.abs(height[a] - height[d]) > Math.abs(height[b] - height[c]);
      if (flip) {
        idx.push(front[a], front[c], front[d], front[a], front[d], front[b]);
        idx.push(back[a], back[d], back[c], back[a], back[b], back[d]);
      } else {
        idx.push(front[a], front[c], front[b], front[b], front[c], front[d]);
        idx.push(back[a], back[b], back[c], back[b], back[d], back[c]);
      }
    }
  }
  const positions = new Float32Array(pos);
  smoothRim(positions, front, height, used, w, h, rimSmooth);
  return { positions, indices: new Uint32Array(idx), vertexCount: n };
}

/** Average each vertex normal with its triangle neighbours; evens out per-pixel noise in reflections. */
export function smoothNormals(normals, indices, iterations) {
  const n = normals.length / 3;
  const acc = new Float32Array(normals.length);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < normals.length; i++) acc[i] = normals[i];
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
      for (let k = 0; k < 3; k++) {
        acc[a + k] += normals[b + k] + normals[c + k];
        acc[b + k] += normals[a + k] + normals[c + k];
        acc[c + k] += normals[a + k] + normals[b + k];
      }
    }
    for (let v = 0; v < n; v++) {
      const x = acc[v * 3], y = acc[v * 3 + 1], z = acc[v * 3 + 2];
      const len = Math.hypot(x, y, z) || 1;
      normals[v * 3] = x / len;
      normals[v * 3 + 1] = y / len;
      normals[v * 3 + 2] = z / len;
    }
  }
}

/**
 * The silhouette ring sits on the pixel grid, which shows up as staircase streaks in chrome reflections.
 * Taubin smoothing (shrink step then inflate step) of the ring's x/y removes the steps without shrinking shapes.
 */
function smoothRim(positions, front, height, used, w, h, iterations) {
  if (iterations <= 0) return;
  const rim = [];
  for (let i = 0; i < w * h; i++) if (used[i] && height[i] <= 0) rim.push(i);
  const nbrs = rim.map((i) => {
    const x = i % w, y = (i - x) / w, list = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (used[j] && height[j] <= 0) list.push(front[j] * 3);
      }
    }
    return list;
  });
  const tmp = new Float32Array(rim.length * 2);
  const pass = (lambda) => {
    for (let r = 0; r < rim.length; r++) {
      const list = nbrs[r], p = front[rim[r]] * 3;
      if (!list.length) { tmp[r * 2] = positions[p]; tmp[r * 2 + 1] = positions[p + 1]; continue; }
      let ax = 0, ay = 0;
      for (const q of list) { ax += positions[q]; ay += positions[q + 1]; }
      ax /= list.length; ay /= list.length;
      tmp[r * 2] = positions[p] + lambda * (ax - positions[p]);
      tmp[r * 2 + 1] = positions[p + 1] + lambda * (ay - positions[p + 1]);
    }
    for (let r = 0; r < rim.length; r++) {
      const p = front[rim[r]] * 3;
      positions[p] = tmp[r * 2];
      positions[p + 1] = tmp[r * 2 + 1];
    }
  };
  for (let it = 0; it < iterations; it++) { pass(0.5); pass(-0.53); }
}
