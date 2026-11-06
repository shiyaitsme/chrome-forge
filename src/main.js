import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { imageToGray, makeMask, buildHeight, buildMeshData, smoothNormals } from './inflate.js';
import { buildEnvironment } from './env.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');

// ---------- three.js scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.NoToneMapping;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 0, 11);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const material = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.03 });
let mesh = null;
let envTex = null;

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

function applyEnv() {
  envTex?.dispose();
  envTex = buildEnvironment(renderer, $('env').value);
  scene.environment = envTex;
}
function applyLook() {
  material.roughness = +$('rough').value;
  material.color.set($('tint').value);
  const transparent = $('transparent').checked;
  renderer.setClearColor($('bg').value, transparent ? 0 : 1);
  controls.autoRotate = $('spin').checked;
}

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

// ---------- source image state ----------
let source = null; // { gray, w, h, key }
let lastKey = '';

function readParams() {
  return {
    threshold: +$('threshold').value,
    invert: $('invert').checked,
    edgeSoften: +$('soften').value,
    res: +$('res').value,
    radius: +$('radius').value,
    depth: +$('depth').value,
    smooth: +$('smooth').value,
  };
}

function updateReadouts(p) {
  $('o-threshold').textContent = p.threshold;
  $('o-soften').textContent = p.edgeSoften;
  $('o-res').textContent = '';
  $('o-radius').textContent = p.radius + 'px';
  $('o-depth').textContent = p.depth.toFixed(2);
  $('o-smooth').textContent = p.smooth;
  $('o-rough').textContent = (+$('rough').value).toFixed(2);
}

function drawPreview(mask, w, h) {
  const c = $('preview');
  const aspect = w / h;
  c.width = 240;
  c.height = Math.round(240 / aspect);
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const t = tmp.getContext('2d');
  const img = t.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = mask[i] ? 20 : 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  t.putImageData(img, 0, 0);
  c.getContext('2d').drawImage(tmp, 0, 0, c.width, c.height);
}

let pending = 0;
function scheduleRebuild() {
  clearTimeout(pending);
  $('busy').hidden = false;
  pending = setTimeout(rebuild, 60);
}

function rebuild() {
  if (!source) { $('busy').hidden = true; return; }
  const p = readParams();
  updateReadouts(p);
  const t0 = performance.now();

  // Re-sample the source only when resolution or image changes.
  const key = source.id + ':' + p.res;
  if (key !== lastKey || !source.cache) {
    source.cache = imageToGray(source.el, p.res);
    lastKey = key;
  }
  const { gray, w, h } = source.cache;

  const mask = makeMask(gray, w, h, p);
  drawPreview(mask, w, h);

  // Radius/smooth sliders are in "fraction of 512px" so they keep their meaning at other resolutions.
  const k = Math.max(w, h) / 512;
  const height = buildHeight(mask, w, h, { radius: p.radius * k, depth: p.depth, smooth: Math.round(p.smooth * k) });
  const data = buildMeshData(mask, height, w, h, 8);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geo.computeVertexNormals();
  smoothNormals(geo.attributes.normal.array, data.indices, 3);
  geo.computeBoundingBox();

  if (mesh) {
    mesh.geometry.dispose();
    mesh.geometry = geo;
  } else {
    mesh = new THREE.Mesh(geo, material);
    scene.add(mesh);
  }
  $('stats').textContent = `${w}×${h} · ${data.vertexCount.toLocaleString()} 顶点 · ${(data.indices.length / 3).toLocaleString()} 三角面 · ${Math.round(performance.now() - t0)}ms`;
  $('busy').hidden = true;
}

function frameMesh() {
  if (!mesh) return;
  const size = new THREE.Vector3();
  mesh.geometry.boundingBox.getSize(size);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const dist = (Math.max(size.x / camera.aspect, size.y) / 2) / Math.tan(fov / 2) * 1.15 + size.z;
  camera.position.set(0, 0, dist);
  controls.target.set(0, 0, 0);
  controls.update();
}

// ---------- loading images ----------
let imgCounter = 0;
function setSource(el) {
  source = { el, id: ++imgCounter, cache: null };
  rebuild();
  frameMesh();
}

$('file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const img = new Image();
  img.onload = () => { setSource(img); URL.revokeObjectURL(img.src); };
  img.src = URL.createObjectURL(f);
});
stage.addEventListener('dragover', (e) => e.preventDefault());
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('image/')) {
    const img = new Image();
    img.onload = () => { setSource(img); URL.revokeObjectURL(img.src); };
    img.src = URL.createObjectURL(f);
  }
});

// Procedural demo: thorny tribal-style arcs, black on white.
function makeDemo() {
  const c = document.createElement('canvas');
  c.width = 900; c.height = 600;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#000'; g.strokeStyle = '#000'; g.lineCap = 'round';
  // thorn: tapered curved spike from (x0,y0) to tip
  const thorn = (x0, y0, cx, cy, tx, ty, w) => {
    g.beginPath();
    g.moveTo(x0 - w, y0);
    g.quadraticCurveTo(cx - w * 0.4, cy, tx, ty);
    g.quadraticCurveTo(cx + w * 0.4, cy, x0 + w, y0);
    g.closePath(); g.fill();
  };
  // main ring chain
  g.lineWidth = 46;
  g.beginPath(); g.arc(300, 300, 150, Math.PI * 0.15, Math.PI * 1.85); g.stroke();
  g.lineWidth = 30;
  g.beginPath(); g.arc(610, 300, 110, Math.PI * 1.1, Math.PI * 2.9); g.stroke();
  g.lineWidth = 26;
  g.beginPath(); g.moveTo(450, 300); g.bezierCurveTo(480, 150, 520, 450, 560, 300); g.stroke();
  // thorns
  thorn(300, 160, 330, 90, 420, 30, 26);
  thorn(300, 160, 250, 80, 150, 40, 22);
  thorn(180, 380, 100, 440, 40, 560, 24);
  thorn(300, 450, 340, 520, 380, 590, 22);
  thorn(610, 190, 650, 110, 760, 60, 20);
  thorn(700, 330, 780, 360, 880, 330, 18);
  thorn(610, 410, 590, 490, 640, 580, 18);
  thorn(120, 300, 60, 270, 10, 190, 20);
  return c;
}
$('demo').addEventListener('click', () => setSource(makeDemo()));

// ---------- controls ----------
for (const id of ['threshold', 'invert', 'soften', 'res', 'radius', 'depth', 'smooth']) {
  $(id).addEventListener('input', scheduleRebuild);
}
$('env').addEventListener('change', applyEnv);
for (const id of ['rough', 'tint', 'bg', 'transparent', 'spin']) {
  $(id).addEventListener('input', () => { applyLook(); updateReadouts(readParams()); });
}

// ---------- export ----------
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('png').addEventListener('click', () => {
  renderer.render(scene, camera);
  renderer.domElement.toBlob((b) => download(b, 'chrome.png'));
});
$('glb').addEventListener('click', async () => {
  if (!mesh) return;
  const out = await new GLTFExporter().parseAsync(mesh, { binary: true });
  download(new Blob([out], { type: 'model/gltf-binary' }), 'chrome.glb');
});
$('stl').addEventListener('click', () => {
  if (!mesh) return;
  const out = new STLExporter().parse(mesh, { binary: true });
  download(new Blob([out], { type: 'model/stl' }), 'chrome.stl');
});

// ---------- boot ----------
applyEnv();
applyLook();
updateReadouts(readParams());
setSource(makeDemo());

// Test hook for automated checks.
window.__forge = { scene, camera, renderer, get mesh() { return mesh; } };
