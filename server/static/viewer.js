import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/loaders/GLTFLoader.js';

// Core Three.js setup
const container = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ 
  antialias: true, 
  alpha: true,
  powerPreference: "high-performance"
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, 0.15, 2.2);

// Enhanced lighting for realistic rendering
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
keyLight.position.set(0.5, 1.0, 0.5);
keyLight.castShadow = true;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x8090ff, 0.3);
fillLight.position.set(-0.5, 0.5, 0.5);
scene.add(fillLight);

const backLight = new THREE.DirectionalLight(0xffffff, 0.2);
backLight.position.set(0, 0.5, -1);
scene.add(backLight);

// Camera controls (disabled by default for AR mode)
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.target.set(0, 0, 0);
controls.enabled = false; // Disable for AR mode

// Pose tracking state
let detector = null;
let modelChoice = 'lightning';
let currentModel = null;
let poseHistory = [];
const MAX_POSE_HISTORY = 5;
let lastValidPose = null;
let poseConfidence = 0;

// Enhanced tracking parameters
const TRACKING_CONFIG = {
  minConfidence: 0.4,
  shoulderConfidenceThreshold: 0.5,
  hipConfidenceThreshold: 0.3,
  smoothingFactor: 0.65,
  scaleSmoothing: 0.4,
  rotationSmoothing: 0.3,
  positionSmoothing: 0.5,
  torsoRatio: 2.2, // Average torso height to shoulder width ratio
  depthEstimationFactor: 2.5,
  neckOffset: 0.15, // Percentage of shoulder width to place anchor below neck
};

// UI elements
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
  smoothing: document.getElementById('smoothing'),
  smoothingNum: document.getElementById('smoothingNum'),
  depthOffset: document.getElementById('depthOffset'),
  depthOffsetNum: document.getElementById('depthOffsetNum'),
  showSkeleton: document.getElementById('showSkeleton'),
  status: document.getElementById('status'),
};

// Link range and number inputs
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
const syncSmoothing = linkRangeNumber(ui.smoothing, ui.smoothingNum);
const syncDepth = linkRangeNumber(ui.depthOffset, ui.depthOffsetNum);

// Window resize handler
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  resizeOverlay();
}
window.addEventListener('resize', onResize);

// Initialize webcam with optimal settings
async function initWebcam() {
  const video = document.getElementById('webcam');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { 
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      }, 
      audio: false 
    });
    video.srcObject = stream;
    await new Promise(r => {
      video.onloadedmetadata = () => {
        video.play();
        setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
        r();
      };
    });
    updateStatus('Webcam ready', 'good');
  } catch (err) {
    updateStatus('Webcam access denied', 'error');
    throw err;
  }
}

// Enhanced model loading with proper positioning
async function loadModel() {
  const loader = new GLTFLoader();
  updateStatus('Loading 3D model...', 'warning');
  
  return new Promise((resolve, reject) => {
    loader.load(
      '/static/models/tshirt.glb',
      (gltf) => {
        const model = gltf.scene;
        
        // Apply material with better shading
        const overrideMaterial = new THREE.MeshStandardMaterial({
          color: 0xff0000,
          roughness: 0.8,
          metalness: 0.1,
          side: THREE.DoubleSide,
          flatShading: false,
        });

        model.traverse((node) => {
          if (node.isMesh) {
            node.material = overrideMaterial;
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });
        
        // Initial rotation to face camera
        model.rotation.y = -Math.PI;
        model.rotation.x = Math.PI;    // flip vertically

        // Center the model geometry
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        
        // Create a group for easier manipulation
        const modelGroup = new THREE.Group();
        modelGroup.add(model);
        scene.add(modelGroup);
        
        document.getElementById('label').textContent = 'Model loaded successfully';
        updateStatus('Ready for tracking', 'good');
        resolve(modelGroup);
      },
      (xhr) => {
        const pct = ((xhr.loaded / (xhr.total || 1)) * 100).toFixed(0);
        document.getElementById('label').textContent = `Loading model: ${pct}%`;
      },
      (err) => {
        document.getElementById('label').textContent = 'Model loading failed';
        updateStatus('Failed to load 3D model', 'error');
        console.error(err);
        
        // Fallback cube for testing
        const geo = new THREE.BoxGeometry(0.3, 0.4, 0.1);
        const mat = new THREE.MeshStandardMaterial({ color: 0x66aaff });
        const cube = new THREE.Mesh(geo, mat);
        scene.add(cube);
        resolve(cube);
      }
    );
  });
}

// Initialize pose detector with optimal settings
async function initPoseDetector() {
  if (detector) { 
    try { await detector.dispose(); } catch(e) {} 
  }
  
  if (modelChoice === 'off') { 
    detector = null; 
    updateStatus('Tracking disabled', 'warning');
    return; 
  }
  
  updateStatus('Initializing pose detector...', 'warning');
  
  const model = poseDetection.SupportedModels.MoveNet;
  const type = modelChoice === 'thunder'
    ? poseDetection.movenet.modelType.SINGLEPOSE_THUNDER
    : poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING;
    
  detector = await poseDetection.createDetector(model, {
    modelType: type,
    enableSmoothing: true,
    minPoseScore: 0.25,
    multiPoseMaxDimension: 256,
  });
  
  updateStatus('Pose detector ready', 'good');
}

// Overlay canvas for pose visualization
const overlay = document.getElementById('overlay');
const octx = overlay.getContext('2d');

function resizeOverlay() {
  const video = document.getElementById('webcam');
  const rect = video.getBoundingClientRect();
  overlay.width = rect.width;
  overlay.height = rect.height;
}

// Enhanced pose drawing with confidence visualization
function drawPose(keypoints) {
  if (!ui.showSkeleton.checked) {
    octx.clearRect(0, 0, overlay.width, overlay.height);
    return;
  }
  
  octx.clearRect(0, 0, overlay.width, overlay.height);
  octx.save();
  octx.translate(overlay.width, 0);
  octx.scale(-1, 1);
  
  const video = document.getElementById('webcam');
  const scaleX = overlay.width / video.videoWidth;
  const scaleY = overlay.height / video.videoHeight;
  
  // Draw skeleton connections
  const connections = [
    ['left_shoulder','right_shoulder'], 
    ['left_shoulder','left_elbow'], 
    ['left_elbow','left_wrist'],
    ['right_shoulder','right_elbow'], 
    ['right_elbow','right_wrist'], 
    ['left_shoulder','left_hip'],
    ['right_shoulder','right_hip'], 
    ['left_hip','right_hip'], 
    ['left_hip','left_knee'], 
    ['left_knee','left_ankle'],
    ['right_hip','right_knee'], 
    ['right_knee','right_ankle'],
    ['left_ear','left_shoulder'],
    ['right_ear','right_shoulder'],
    ['nose','left_eye'],
    ['nose','right_eye']
  ];
  
  const kpMap = {};
  for (const kp of keypoints) {
    if (kp.score && kp.score > 0.2) {
      kpMap[kp.name] = kp;
    }
  }
  
  // Draw connections
  octx.strokeStyle = 'rgba(0,255,180,0.4)';
  octx.lineWidth = 2;
  for (const [a, b] of connections) {
    const p = kpMap[a], q = kpMap[b];
    if (!p || !q) continue;
    octx.beginPath();
    octx.moveTo(p.x * scaleX, p.y * scaleY);
    octx.lineTo(q.x * scaleX, q.y * scaleY);
    octx.stroke();
  }
  
  // Draw keypoints with confidence coloring
  for (const kp of keypoints) {
    if (kp.score && kp.score > 0.2) {
      const confidence = kp.score;
      const hue = confidence * 120; // Red to green
      octx.fillStyle = `hsla(${hue}, 100%, 50%, 0.9)`;
      octx.beginPath();
      octx.arc(kp.x * scaleX, kp.y * scaleY, 4 + confidence * 4, 0, Math.PI * 2);
      octx.fill();
    }
  }
  
  octx.restore();
}

// Draw anchor point for debugging
function drawAnchor(x, y, color = 'rgba(255,200,0,0.9)') {
  if (!ui.showSkeleton.checked) return;
  
  octx.save();
  const video = document.getElementById('webcam');
  const scaleX = overlay.width / video.videoWidth;
  const scaleY = overlay.height / video.videoHeight;
  
  // Mirror x coordinate
  const displayX = overlay.width - (x * scaleX);
  const displayY = y * scaleY;
  
  octx.strokeStyle = color;
  octx.lineWidth = 3;
  octx.beginPath();
  octx.moveTo(displayX - 15, displayY);
  octx.lineTo(displayX + 15, displayY);
  octx.moveTo(displayX, displayY - 15);
  octx.lineTo(displayX, displayY + 15);
  octx.stroke();
  
  // Draw circle
  octx.beginPath();
  octx.arc(displayX, displayY, 8, 0, Math.PI * 2);
  octx.stroke();
  
  octx.restore();
}

// Convert image coordinates to 3D world coordinates
function imgToWorld(x, y, depth = 0) {
  const video = document.getElementById('webcam');
  const w = video.videoWidth, h = video.videoHeight;
  
  // Normalize to NDC
  const ndcX = (x / w) * 2 - 1;
  const ndcY = -((y / h) * 2 - 1);
  
  // Create ray from camera
  const vec = new THREE.Vector3(ndcX, ndcY, 0.5);
  vec.unproject(camera);
  
  const ray = vec.sub(camera.position).normalize();
  const distance = (depth - camera.position.z) / ray.z;
  
  return camera.position.clone().add(ray.multiplyScalar(distance));
}

// Estimate depth based on shoulder width
function estimateDepth(shoulderWidthPx, videoWidth) {
  const normalizedWidth = shoulderWidthPx / videoWidth;
  const avgShoulderWidth = 0.15; // Average normalized shoulder width at optimal distance
  const depthScale = avgShoulderWidth / normalizedWidth;
  return depthScale * TRACKING_CONFIG.depthEstimationFactor + parseFloat(ui.depthOffset.value);
}

// Calculate pose metrics for better tracking
function calculatePoseMetrics(keypoints) {
  const metrics = {
    shoulderWidth: 0,
    torsoHeight: 0,
    shoulderAngle: 0,
    centerX: 0,
    centerY: 0,
    confidence: 0,
    depth: 0,
  };
  
  const leftShoulder = keypoints.find(kp => kp.name === 'left_shoulder');
  const rightShoulder = keypoints.find(kp => kp.name === 'right_shoulder');
  const leftHip = keypoints.find(kp => kp.name === 'left_hip');
  const rightHip = keypoints.find(kp => kp.name === 'right_hip');
  const nose = keypoints.find(kp => kp.name === 'nose');
  
  if (!leftShoulder || !rightShoulder) return null;
  
  // Check confidence
  if (leftShoulder.score < TRACKING_CONFIG.shoulderConfidenceThreshold || 
      rightShoulder.score < TRACKING_CONFIG.shoulderConfidenceThreshold) {
    return null;
  }
  
  // Calculate shoulder metrics
  const dx = rightShoulder.x - leftShoulder.x;
  const dy = rightShoulder.y - leftShoulder.y;
  metrics.shoulderWidth = Math.sqrt(dx * dx + dy * dy);
  metrics.shoulderAngle = Math.atan2(dy, dx);
  
  // Calculate center position (between shoulders, slightly below)
  metrics.centerX = (leftShoulder.x + rightShoulder.x) / 2;
  metrics.centerY = (leftShoulder.y + rightShoulder.y) / 2;
  
  // Adjust center to chest position (below neck)
  if (nose && nose.score > 0.3) {
    // Use nose to better estimate neck position
    const neckY = metrics.centerY + (nose.y - metrics.centerY) * 0.3;
    metrics.centerY = neckY + metrics.shoulderWidth * TRACKING_CONFIG.neckOffset;
  } else {
    // Fallback: place below shoulders
    metrics.centerY += metrics.shoulderWidth * TRACKING_CONFIG.neckOffset;
  }
  
  // Calculate torso height if hips are visible
  if (leftHip && rightHip && 
      leftHip.score > TRACKING_CONFIG.hipConfidenceThreshold && 
      rightHip.score > TRACKING_CONFIG.hipConfidenceThreshold) {
    const hipCenterY = (leftHip.y + rightHip.y) / 2;
    metrics.torsoHeight = Math.abs(hipCenterY - metrics.centerY);
  } else {
    // Estimate torso height from shoulder width
    metrics.torsoHeight = metrics.shoulderWidth * TRACKING_CONFIG.torsoRatio;
  }
  
  // Calculate overall confidence
  const scores = [leftShoulder.score, rightShoulder.score];
  if (leftHip) scores.push(leftHip.score);
  if (rightHip) scores.push(rightHip.score);
  metrics.confidence = scores.reduce((a, b) => a + b, 0) / scores.length;
  
  // Estimate depth
  const video = document.getElementById('webcam');
  metrics.depth = estimateDepth(metrics.shoulderWidth, video.videoWidth);
  
  return metrics;
}

// Smooth pose data over time
function smoothPoseMetrics(newMetrics) {
  if (!lastValidPose) {
    lastValidPose = newMetrics;
    return newMetrics;
  }
  
  const smoothingFactor = parseFloat(ui.smoothing.value);
  const smoothed = {};
  
  for (const key in newMetrics) {
    if (key === 'confidence') {
      smoothed[key] = newMetrics[key];
    } else if (key === 'shoulderAngle') {
      // Special handling for angles
      let diff = newMetrics[key] - lastValidPose[key];
      if (diff > Math.PI) diff -= 2 * Math.PI;
      if (diff < -Math.PI) diff += 2 * Math.PI;
      smoothed[key] = lastValidPose[key] + diff * (1 - smoothingFactor * TRACKING_CONFIG.rotationSmoothing);
    } else if (key === 'shoulderWidth' || key === 'torsoHeight') {
      smoothed[key] = lastValidPose[key] * smoothingFactor * TRACKING_CONFIG.scaleSmoothing + 
                      newMetrics[key] * (1 - smoothingFactor * TRACKING_CONFIG.scaleSmoothing);
    } else {
      smoothed[key] = lastValidPose[key] * smoothingFactor * TRACKING_CONFIG.positionSmoothing + 
                      newMetrics[key] * (1 - smoothingFactor * TRACKING_CONFIG.positionSmoothing);
    }
  }
  
  lastValidPose = smoothed;
  return smoothed;
}

// Update model transform based on pose
function updateModelTransform(metrics) {
  if (!currentModel || !metrics) return;
  
  const video = document.getElementById('webcam');
  const videoW = video.videoWidth;
  const videoH = video.videoHeight;
  
  // Apply manual offsets
  const offsetX = parseFloat(ui.offX.value) * videoW;
  const offsetY = parseFloat(ui.offY.value*1.3) * videoH;
  
  // Calculate target position in world space
  const targetX = videoW - metrics.centerX - offsetX; // Mirror for selfie mode
  const targetY = metrics.centerY + offsetY;
  const worldPos = imgToWorld(targetX, targetY, -metrics.depth);
  
  // Smooth position update
  currentModel.position.lerp(worldPos, 0.3);
  
  // Calculate model scale based on pose measurements
  const box = new THREE.Box3().setFromObject(currentModel);
  const modelSize = box.getSize(new THREE.Vector3());
  
  // Convert pixel measurements to world units
  const worldShoulderWidth = Math.abs(
    imgToWorld(0, 0, -metrics.depth).x - 
    imgToWorld(metrics.shoulderWidth, 0, -metrics.depth).x
  );
  
  const worldTorsoHeight = Math.abs(
    imgToWorld(0, 0, -metrics.depth).y - 
    imgToWorld(0, metrics.torsoHeight, -metrics.depth).y
  );
  
  // Calculate scale factors
  const manualScale = parseFloat(ui.scaleMul.value);
  const baseScaleX = (worldShoulderWidth / modelSize.x) * 1.6; // 1.4x for clothing fit
  const baseScaleY = (worldTorsoHeight / modelSize.y) * 1.3; // 1.1x for proper length
  
  const targetScaleX = baseScaleX * manualScale;
  const targetScaleY = ui.uniform.checked ? targetScaleX : baseScaleY * manualScale;
  const targetScaleZ = (targetScaleX + targetScaleY) / 2 * manualScale * 0.5; // Thinner depth
  
  // Apply smooth scaling
  currentModel.scale.x = THREE.MathUtils.lerp(currentModel.scale.x, targetScaleX, 0.2);
  currentModel.scale.y = THREE.MathUtils.lerp(currentModel.scale.y, targetScaleY, 0.2);
  currentModel.scale.z = THREE.MathUtils.lerp(currentModel.scale.z, targetScaleZ, 0.2);
  
  // Apply rotation based on shoulder angle
  const manualRotation = parseFloat(ui.rotZ.value);
  const targetRotation = metrics.shoulderAngle + manualRotation;
  currentModel.rotation.z = THREE.MathUtils.lerp(currentModel.rotation.z, targetRotation, 0.25);
  
  // Add subtle breathing animation
  const time = Date.now() * 0.001;
  currentModel.position.y += Math.sin(time * 2) * 0.005;
  
  // Draw debug anchor
  drawAnchor(metrics.centerX, metrics.centerY, 'rgba(0,255,0,0.9)');
}

// Update status display
function updateStatus(message, type = 'good') {
  const status = ui.status;
  status.textContent = message;
  status.className = `status ${type}`;
}

// Main pose detection loop
async function poseLoop() {
  const video = document.getElementById('webcam');
  
  if (!detector || !currentModel || video.readyState < 2) {
    requestAnimationFrame(poseLoop);
    return;
  }
  
  try {
    const poses = await detector.estimatePoses(video, { 
      flipHorizontal: false,
      maxPoses: 1,
      scoreThreshold: TRACKING_CONFIG.minConfidence
    });
    
    if (poses && poses.length > 0 && poses[0].keypoints) {
      const keypoints = poses[0].keypoints;
      
      // Calculate pose metrics
      const metrics = calculatePoseMetrics(keypoints);
      
      if (metrics && metrics.confidence > TRACKING_CONFIG.minConfidence) {
        // Apply temporal smoothing
        const smoothedMetrics = smoothPoseMetrics(metrics);
        
        // Update model transform
        updateModelTransform(smoothedMetrics);
        
        // Draw pose skeleton
        drawPose(keypoints);
        
        // Update confidence indicator
        poseConfidence = metrics.confidence;
        const confidencePercent = Math.round(poseConfidence * 100);
        updateStatus(`Tracking (${confidencePercent}% confidence)`, 
                    poseConfidence > 0.6 ? 'good' : 'warning');
        
        // Store in history for prediction
        poseHistory.push(smoothedMetrics);
        if (poseHistory.length > MAX_POSE_HISTORY) {
          poseHistory.shift();
        }
      } else {
        // Poor tracking quality
        updateStatus('Poor tracking - adjust position', 'warning');
        
        // Use last valid pose with decay
        if (lastValidPose) {
          lastValidPose.confidence *= 0.95;
          if (lastValidPose.confidence > 0.3) {
            updateModelTransform(lastValidPose);
          }
        }
      }
    } else {
      // No pose detected
      octx.clearRect(0, 0, overlay.width, overlay.height);
      updateStatus('No pose detected - step into view', 'error');
      
      // Fade out model when no pose
      if (currentModel.scale.x > 0.1) {
        currentModel.scale.multiplyScalar(0.9);
      }
    }
  } catch (err) {
    console.error('Pose detection error:', err);
    updateStatus('Tracking error', 'error');
  }
  
  requestAnimationFrame(poseLoop);
}

// Animation loop for rendering
function animate() {
  requestAnimationFrame(animate);
  
  // Update controls if enabled
  if (controls.enabled) {
    controls.update();
  }
  
  // Render scene
  renderer.render(scene, camera);
}

// Initialize UI event listeners
function initUIListeners() {
  ui.poseModel.addEventListener('change', async (e) => {
    modelChoice = e.target.value;
    await initPoseDetector();
  });
  
  ui.smoothing.addEventListener('input', (e) => {
    TRACKING_CONFIG.smoothingFactor = parseFloat(e.target.value);
  });
  
  // Add keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    switch(e.key) {
      case ' ':
        ui.showSkeleton.checked = !ui.showSkeleton.checked;
        break;
      case 'c':
        controls.enabled = !controls.enabled;
        break;
      case 'r':
        // Reset all controls
        syncScale(1.15);
        syncOffX(0);
        syncOffY(0.05);
        syncRotZ(0);
        syncSmoothing(0.65);
        syncDepth(0.1);
        break;
    }
  });
}

// Main initialization
async function main() {
  try {
    document.getElementById('label').textContent = 'Initializing...';
    
    // Start all initialization in parallel
    const [model] = await Promise.all([
      loadModel(),
      initWebcam(),
      initPoseDetector()
    ]);
    
    currentModel = model;
    
    // Set up UI
    initUIListeners();
    resizeOverlay();
    
    // Sync initial values
    syncScale(ui.scaleMul.value * 1.5);
    syncOffX(ui.offX.value);
    syncOffY(ui.offY.value * 1.3);
    syncRotZ(ui.rotZ.value*1.2);
    syncSmoothing(ui.smoothing.value);
    syncDepth(ui.depthOffset.value);
    
    // Start loops
    poseLoop();
    animate();
    
    document.getElementById('label').textContent = 'AR T-shirt Try-On Active';
    updateStatus('System ready - position yourself in view', 'good');
    
  } catch (err) {
    console.error('Initialization error:', err);
    document.getElementById('label').textContent = 'Failed to initialize';
    updateStatus(`Error: ${err.message}`, 'error');
  }
}

// Start application
main().catch(err => {
  console.error('Fatal error:', err);
  updateStatus('Application failed to start', 'error');
});