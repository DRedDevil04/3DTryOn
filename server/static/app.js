// Simple 2.5D overlay: billboarded plane textured with processed front image.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

let detector, camStream;
let videoEl, canvasEl, renderer, scene, camera, controls, tshirtMesh, tshirtTexture;
let sessionId = null;

async function initPoseDetector() {
  const model = poseDetection.SupportedModels.MoveNet;
  detector = await poseDetection.createDetector(model, {
    modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
    enableSmoothing: true,
  });
}

async function initWebcam() {
  videoEl = document.getElementById('webcam');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
  videoEl.srcObject = stream;
  camStream = stream;
  await new Promise(resolve => {
    videoEl.onloadedmetadata = () => {
      // force layout update and trigger resize once dimensions are known
      videoEl.play();
      setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
      resolve();
    };
  });
}

function initThree() {
  canvasEl = document.getElementById('overlay');
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000, 0);
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 2);
  scene.add(camera);

  const light = new THREE.DirectionalLight(0xffffff, 1.0);
  light.position.set(0, 0, 2);
  scene.add(light);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableZoom = false;

  window.addEventListener('resize', onResize);
  onResize();
}

function onResize() {
  const rect = videoEl.getBoundingClientRect();
  const w = rect.width || videoEl.videoWidth || window.innerWidth;
  const h = rect.height || videoEl.videoHeight || window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function createOrUpdateTShirtMesh(textureUrl) {
  const loader = new THREE.TextureLoader();
  loader.load(textureUrl, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tshirtTexture = tex;

    const width = 1.0;
    const height = 1.2; // slightly taller than wide

    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshBasicMaterial({ map: tshirtTexture, transparent: true });

    if (tshirtMesh) {
      tshirtMesh.geometry.dispose();
      tshirtMesh.material.dispose();
      scene.remove(tshirtMesh);
    }

    tshirtMesh = new THREE.Mesh(geometry, material);
    scene.add(tshirtMesh);
  });
}

function estimateScale(landmarks) {
  // Use shoulder distance as a proxy for scale
  const left = landmarks.find(l => l.name === 'left_shoulder') || landmarks[5];
  const right = landmarks.find(l => l.name === 'right_shoulder') || landmarks[6];
  if (!left || !right) return 1.0;
  const dx = (left.x - right.x);
  const dy = (left.y - right.y);
  const dist = Math.sqrt(dx*dx + dy*dy);
  // Map pixel distance to world units (~0.5–1.5)
  const scale = THREE.MathUtils.clamp(dist / 200, 0.6, 1.6);
  return scale;
}

function imageToNDC(x, y, width, height) {
  const ndcX = (x / width) * 2 - 1;
  const ndcY = -((y / height) * 2 - 1);
  return { x: ndcX, y: ndcY };
}

function ndcToWorld(ndcX, ndcY, z = 0) {
  const vec = new THREE.Vector3(ndcX, ndcY, z);
  vec.unproject(camera);
  const dir = vec.sub(camera.position).normalize();
  const distance = -camera.position.z / dir.z;
  const pos = camera.position.clone().add(dir.multiplyScalar(distance));
  return pos;
}

async function renderLoop() {
  if (videoEl.readyState >= 2 && detector) {
    const detections = await detector.estimatePoses(videoEl, { flipHorizontal: true });
    if (detections && detections[0] && detections[0].keypoints) {
      const kp = detections[0].keypoints;
      const w = videoEl.videoWidth;
      const h = videoEl.videoHeight;

      const left = kp.find(p => p.name === 'left_shoulder') || kp[5];
      const right = kp.find(p => p.name === 'right_shoulder') || kp[6];
      const nose = kp.find(p => p.name === 'nose') || kp[0];

      if (left && right && tshirtMesh) {
        // Position between shoulders, slightly lower
        const cx = (left.x + right.x) / 2;
        const cy = ((left.y + right.y) / 2) + h * 0.08;
        const ndc = imageToNDC(cx, cy, w, h);
        const pos = ndcToWorld(ndc.x, ndc.y, 0);
        tshirtMesh.position.lerp(pos, 0.5);

        // Scale: based on shoulder distance
        const dx = (left.x - right.x);
        const dy = (left.y - right.y);
        const dist = Math.sqrt(dx*dx + dy*dy);
        const scale = THREE.MathUtils.clamp(dist / 260, 0.7, 1.8);
        tshirtMesh.scale.lerp(new THREE.Vector3(scale, scale, 1), 0.5);

        // Rotation: yaw from shoulder vector
        const angle = Math.atan2(dy, dx);
        // Map to small Z rotation (billboarded plane already faces camera)
        tshirtMesh.rotation.z = angle;
      }
    }
  }
  renderer.render(scene, camera);
  requestAnimationFrame(renderLoop);
}

async function handleUpload(evt) {
  evt.preventDefault();
  const input = document.getElementById('files');
  if (!input.files || input.files.length === 0) return;

  const formData = new FormData();
  for (const f of input.files) formData.append('files', f, f.name);
  const resp = await fetch('/api/upload_tshirt', { method: 'POST', body: formData });
  if (!resp.ok) {
    alert('Upload failed');
    return;
  }
  const data = await resp.json();
  sessionId = data.session_id;
  document.getElementById('sessionId').value = sessionId;

  // Prefer front texture
  const front = data.processed.find(p => p.role === 'front') || data.processed[0];
  if (front) {
    createOrUpdateTShirtMesh(front.url);
  }
}

async function main() {
  await initWebcam();
  initThree();
  await initPoseDetector();

  document.getElementById('upload-form').addEventListener('submit', handleUpload);
  document.getElementById('copySession').addEventListener('click', (e) => {
    e.preventDefault();
    if (!sessionId) return;
    navigator.clipboard.writeText(sessionId);
  });

  renderLoop();
}

main().catch(err => {
  console.error(err);
  alert('Initialization failed: ' + err.message);
});
