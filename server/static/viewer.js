import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/loaders/GLTFLoader.js';

const container = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, 0.2, 1.5);

const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.8);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(1, 1.6, 1.2);
scene.add(dir);
// Debug axes to verify renderer visibility
scene.add(new THREE.AxesHelper(0.5));

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.target.set(0, 0.1, 0);

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);

async function initWebcam() {
  const video = document.getElementById('webcam');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
  video.srcObject = stream;
  await new Promise(r => {
    video.onloadedmetadata = () => {
      video.play();
      setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
      r();
    };
  });
}

function frameObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  let z = Math.abs(maxDim / (2 * Math.tan(fov / 2)));
  z *= 1.8; // more padding to expand visible world
  camera.position.set(center.x, center.y + size.y * 0.05, z);
  controls.target.copy(center);
  controls.update();
}

async function loadModel() {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(
      '/static/models/tshirt.glb',
      (gltf) => {
        const model = gltf.scene;
        const overrideMaterial = new THREE.MeshStandardMaterial({
            color: 0xff0000, // Bright Red
            side: THREE.DoubleSide // Renders both sides of a face
        });

        model.traverse((node) => {
            if (node.isMesh) {
                node.material = overrideMaterial;
            }
        });
        model.rotation.y = Math.PI;
        scene.add(model);
        frameObject(model);
        document.getElementById('label').textContent = 'Loaded: /static/models/tshirt.glb';
        resolve(model);
      },
      (xhr) => {
        const pct = ((xhr.loaded / (xhr.total || 1)) * 100).toFixed(0);
        document.getElementById('label').textContent = `Loading: ${pct}%`;
      },
      (err) => {
        document.getElementById('label').textContent = 'Failed to load model';
        console.error(err);
        // Fallback: add a simple cube so something is visible
        const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
        const mat = new THREE.MeshStandardMaterial({ color: 0x66aaff, metalness: 0.1, roughness: 0.7 });
        const cube = new THREE.Mesh(geo, mat);
        scene.add(cube);
        frameObject(cube);
        resolve(cube);
      }
    );
  });
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// Pose tracking (MediaPipe BlazePose through TF.js API)
let detector = null;
let modelChoice = 'lightning';
let currentModel = null;

const ui = {
  scaleMul: document.getElementById('scaleMul'),
  scaleMulNum: document.getElementById('scaleMulNum'),
  offX: document.getElementById('offX'),
  offXNum: document.getElementById('offXNum'),
  offY: document.getElementById('offY'),
  offYNum: document.getElementById('offYNum'),
  rotZ: document.getElementById('rotZ'),
  rotZNum: document.getElementById('rotZNum'),
  poseModel: document.getElementById('poseModel'),
  uniform: document.getElementById('uniform'),
};

function linkRangeNumber(range, number) {
  const sync = (v) => { range.value = v; number.value = v; };
  range.addEventListener('input', () => number.value = range.value);
  number.addEventListener('input', () => range.value = number.value);
  return sync;
}

const syncScale = linkRangeNumber(ui.scaleMul, ui.scaleMulNum);
const syncOffX = linkRangeNumber(ui.offX, ui.offXNum);
const syncOffY = linkRangeNumber(ui.offY, ui.offYNum);
const syncRotZ = linkRangeNumber(ui.rotZ, ui.rotZNum);

async function initPoseDetector() {
  if (detector) { try { await detector.dispose(); } catch(e) {} }
  if (modelChoice === 'off') { detector = null; return; }
  const model = poseDetection.SupportedModels.MoveNet;
  const type = modelChoice === 'thunder'
    ? poseDetection.movenet.modelType.SINGLEPOSE_THUNDER
    : poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING;
  detector = await poseDetection.createDetector(model, {
    modelType: type,
    enableSmoothing: true,
  });
}

// Pose overlay drawing (mirrored to match video)
const overlay = document.getElementById('overlay');
const octx = overlay.getContext('2d');
function resizeOverlay() {
  const video = document.getElementById('webcam');
  const rect = video.getBoundingClientRect();
  const w = rect.width || video.videoWidth || window.innerWidth;
  const h = rect.height || video.videoHeight || window.innerHeight;
  overlay.width = w;
  overlay.height = h;
}
window.addEventListener('resize', resizeOverlay);

function drawPose(keypoints) {
  octx.clearRect(0, 0, overlay.width, overlay.height);
  octx.save();
  octx.translate(overlay.width, 0);
  octx.scale(-1, 1);
  octx.strokeStyle = 'rgba(0,255,180,0.9)';
  octx.fillStyle = 'rgba(0,255,180,0.9)';
  octx.lineWidth = 3;

  const pairs = [
    ['left_shoulder','right_shoulder'], ['left_shoulder','left_elbow'], ['left_elbow','left_wrist'],
    ['right_shoulder','right_elbow'], ['right_elbow','right_wrist'], ['left_shoulder','left_hip'],
    ['right_shoulder','right_hip'], ['left_hip','right_hip'], ['left_hip','left_knee'], ['left_knee','left_ankle'],
    ['right_hip','right_knee'], ['right_knee','right_ankle']
  ];

  const map = {};
  const video = document.getElementById('webcam');
  for (const kp of keypoints) {
    if (kp.score != null && kp.score < 0.3) continue;
    map[kp.name] = kp;
    const sx = kp.x / video.videoWidth * overlay.width;
    const sy = kp.y / video.videoHeight * overlay.height;
    octx.beginPath();
    octx.arc(sx, sy, 4, 0, Math.PI*2);
    octx.fill();
  }
  for (const [a,b] of pairs) {
    const p = map[a], q = map[b];
    if (!p || !q) continue;
    const px = p.x / video.videoWidth * overlay.width;
    const py = p.y / video.videoHeight * overlay.height;
    const qx = q.x / video.videoWidth * overlay.width;
    const qy = q.y / video.videoHeight * overlay.height;
    octx.beginPath();
    octx.moveTo(px, py);
    octx.lineTo(qx, qy);
    octx.stroke();
  }
  octx.restore();
}

function drawAnchor(xDisp, yDisp) {
  octx.save();
  // Overlay is mirrored; incoming x is in display space already
  const x = overlay.width - (xDisp / (document.getElementById('webcam').videoWidth || 1)) * overlay.width;
  const y = (yDisp / (document.getElementById('webcam').videoHeight || 1)) * overlay.height;
  octx.strokeStyle = 'rgba(255,200,0,0.9)';
  octx.lineWidth = 2;
  octx.beginPath();
  octx.moveTo(x - 10, y);
  octx.lineTo(x + 10, y);
  octx.moveTo(x, y - 10);
  octx.lineTo(x, y + 10);
  octx.stroke();
  octx.restore();
}

function imgToWorld(x, y) {
  // Convert image pixel to world pos at z=0 plane
  const video = document.getElementById('webcam');
  const w = video.videoWidth, h = video.videoHeight;
  const ndcX = (x / w) * 2 - 1;
  const ndcY = -((y / h) * 2 - 1);
  const vec = new THREE.Vector3(ndcX, ndcY, 0);
  vec.unproject(camera);
  const dir = vec.sub(camera.position).normalize();
  const distance = -camera.position.z / dir.z;
  return camera.position.clone().add(dir.multiplyScalar(distance));
}

// Use display (mirrored) pixel coords directly for unprojection
function imgToWorldDisplay(xDisp, y) {
  return imgToWorld(xDisp, y);
}

function measureModelBounds(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  return { box, size };
}

async function poseLoop() {
  const video = document.getElementById('webcam');
  if (!detector || !currentModel || video.readyState < 2) {
    requestAnimationFrame(poseLoop);
    return;
  }
  try {
    // Do not flip in detector; we mirror overlay and video
    const poses = await detector.estimatePoses(video, { flipHorizontal: false });
    if (poses && poses[0] && poses[0].keypoints) {
      const kp = poses[0].keypoints;
      const left = kp.find(p => p.name === 'left_shoulder');
      const right = kp.find(p => p.name === 'right_shoulder');
      const leftHip = kp.find(p => p.name === 'left_hip');
      const rightHip = kp.find(p => p.name === 'right_hip');
      if (left && right && left.score > 0.3 && right.score > 0.3) {
        const cx = (left.x + right.x) / 2;
        const cy = (left.y + right.y) / 2;

        // Apply manual offsets in normalized screen space
        const videoW = video.videoWidth, videoH = video.videoHeight;
    const offXpx = parseFloat(ui.offX.value) * videoW;
    const offYpx = parseFloat(ui.offY.value) * videoH;
    const cxDisp = videoW - cx;

    // Fit scale using shoulder width (X) and shoulder-hip height (Y)
    const dx = left.x - right.x, dy = left.y - right.y;
    const shoulderDistPx = Math.sqrt(dx*dx + dy*dy);
  const shoulderWorldL = imgToWorldDisplay(videoW - left.x, left.y);
  const shoulderWorldR = imgToWorldDisplay(videoW - right.x, right.y);
        const worldShoulderWidth = shoulderWorldL.distanceTo(shoulderWorldR);

        // Height target from shoulders to hips if available
        let worldTorsoHeight = null;
        if (leftHip && rightHip && leftHip.score > 0.2 && rightHip.score > 0.2) {
          const midShoulder = imgToWorldDisplay(cxDisp, (left.y + right.y) / 2);
          const hipX = (leftHip.x + rightHip.x) / 2;
          const hipY = (leftHip.y + rightHip.y) / 2;
          const midHip = imgToWorldDisplay(videoW - hipX, hipY);
          worldTorsoHeight = midShoulder.distanceTo(midHip);
        }

        // Auto-lower the anchor toward hips so shirt sits naturally
        let autoYPx = 0;
        if (leftHip && rightHip && leftHip.score > 0.2 && rightHip.score > 0.2) {
          const hipMidY = (leftHip.y + rightHip.y) / 2;
          autoYPx = 0.5 * (hipMidY - cy) + 0.1 * shoulderDistPx; // 50% toward hips + extra drop
        } else {
          autoYPx = 0.6 * shoulderDistPx; // fallback: ~60% shoulder width downward
        }

  const targetXDisp = cxDisp + offXpx;
  const targetYDisp = cy + autoYPx + 7 + offYpx;
  const pos = imgToWorldDisplay(targetXDisp, targetYDisp);
        currentModel.position.lerp(pos, 0.5);

        const { size } = measureModelBounds(currentModel);
        const modelWidth = Math.max(size.x, 1e-6);
        const modelHeight = Math.max(size.y, 1e-6);

        if (worldShoulderWidth > 1e-4) {
          const scaleXTarget = THREE.MathUtils.clamp(worldShoulderWidth / modelWidth, 0.2, 5.0);
          const scaleYTarget = worldTorsoHeight ? THREE.MathUtils.clamp(worldTorsoHeight / modelHeight, 0.2, 5.0) : scaleXTarget;
        const manualMul = parseFloat(ui.scaleMul.value);
        const uniform = ui.uniform.checked;
          const sX = THREE.MathUtils.lerp(currentModel.scale.x, scaleXTarget * manualMul, 0.35);
          const sY = THREE.MathUtils.lerp(currentModel.scale.y, (uniform ? scaleXTarget : scaleYTarget) * manualMul, 0.35);
          const sZ = THREE.MathUtils.lerp(currentModel.scale.z, (uniform ? scaleXTarget : (scaleXTarget + sY)/2) * manualMul, 0.35);
          currentModel.scale.set(sX, sY, sZ);
        }

        // Rotation around Z using shoulder vector + manual rotation
        const yaw = Math.atan2(dy, dx);
        const manualZ = parseFloat(ui.rotZ.value);
        currentModel.rotation.z = -yaw + manualZ;
  drawPose(kp);
  drawAnchor(targetXDisp, targetYDisp);
      } else if (leftHip && rightHip) {
        // Fallback to hips if shoulders missing
        const cx = (leftHip.x + rightHip.x) / 2;
        const cy = (leftHip.y + rightHip.y) / 2;
  const pos = imgToWorldDisplay(video.videoWidth - cx, cy + 7);
        currentModel.position.lerp(pos, 0.5);
      } else {
        octx.clearRect(0, 0, overlay.width, overlay.height);
      }
    }
  } catch (e) {
    // ignore transient errors
  }
  requestAnimationFrame(poseLoop);
}

async function main() {
  await initWebcam();
  currentModel = await loadModel();
  // initialize pose detector and UI bindings
  await initPoseDetector();
  resizeOverlay();
  ui.poseModel.addEventListener('change', async (e) => {
    modelChoice = e.target.value;
    await initPoseDetector();
  });
  // Keep range <-> number fields in sync initially
  syncScale(ui.scaleMul.value); syncOffX(ui.offX.value); syncOffY(ui.offY.value); syncRotZ(ui.rotZ.value);
  poseLoop();
  animate();
}

main().catch(err => {
  console.error(err);
  document.getElementById('label').textContent = 'Init failed: ' + err.message;
});
