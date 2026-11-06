// Procedural reflection environments. Chrome is only as good as what it reflects,
// so these are high-contrast: bright sky, hard dark horizon, strip lights.
import * as THREE from 'three';

function makeEquirect(draw) {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 1024;
  const ctx = c.getContext('2d');
  draw(ctx, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const PRESETS = {
  // Soft white sky, sharp dark horizon band, bright floor: close to the classic "Y2K chrome" look.
  chrome(ctx, W, H) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0.0, '#ffffff');
    g.addColorStop(0.32, '#dfe3e8');
    g.addColorStop(0.47, '#6b7078');
    g.addColorStop(0.5, '#050506');
    g.addColorStop(0.56, '#15161a');
    g.addColorStop(0.66, '#8d939c');
    g.addColorStop(1.0, '#ffffff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // vertical strip lights
    ctx.fillStyle = '#ffffff';
    for (const [x, w] of [[0.08, 0.02], [0.3, 0.05], [0.55, 0.015], [0.78, 0.04]]) {
      ctx.fillRect(x * W, H * 0.12, w * W, H * 0.7);
    }
    // dark flags to carve contrast
    ctx.fillStyle = '#0a0a0c';
    for (const [x, w] of [[0.18, 0.04], [0.43, 0.06], [0.67, 0.03], [0.9, 0.05]]) {
      ctx.fillRect(x * W, H * 0.2, w * W, H * 0.55);
    }
  },
  // Dark room with a few softboxes.
  studio(ctx, W, H) {
    ctx.fillStyle = '#0b0c0f';
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#c9ced6');
    g.addColorStop(0.45, '#20232a');
    g.addColorStop(0.5, '#000');
    g.addColorStop(1, '#3a3f49');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.fillRect(W * 0.12, H * 0.18, W * 0.1, H * 0.3);
    ctx.fillRect(W * 0.45, H * 0.05, W * 0.12, H * 0.2);
    ctx.fillRect(W * 0.7, H * 0.22, W * 0.06, H * 0.32);
  },
  // Mostly white, low contrast: a soft satin silver.
  soft(ctx, W, H) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, '#9aa0a8');
    g.addColorStop(1, '#f2f4f7');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  },
};

export const ENV_NAMES = Object.keys(PRESETS);

export function buildEnvironment(renderer, name) {
  const equirect = makeEquirect(PRESETS[name]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromEquirectangular(equirect);
  equirect.dispose();
  pmrem.dispose();
  return rt.texture;
}
