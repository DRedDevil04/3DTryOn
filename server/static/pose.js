const video = document.getElementById('webcam');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
let detector, modelType = 'lightning';

function resize() {
  const rect = video.getBoundingClientRect();
  const w = rect.width || video.videoWidth || window.innerWidth;
  const h = rect.height || video.videoHeight || window.innerHeight;
  canvas.width = w;
  canvas.height = h;
}
window.addEventListener('resize', resize);

async function initWebcam() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
  video.srcObject = stream;
  await new Promise(r => {
    video.onloadedmetadata = () => {
      video.play();
      setTimeout(() => { resize(); }, 0);
      r();
    };
  });
}

async function initDetector() {
  const model = poseDetection.SupportedModels.MoveNet;
  const type = modelType === 'thunder'
    ? poseDetection.movenet.modelType.SINGLEPOSE_THUNDER
    : poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING;
  detector = await poseDetection.createDetector(model, {
    modelType: type,
    enableSmoothing: true,
  });
}

function drawKeypoints(keypoints) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  // Mirror the canvas to match the mirrored <video>
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.strokeStyle = 'rgba(0,255,180,0.9)';
  ctx.fillStyle = 'rgba(0,255,180,0.9)';
  ctx.lineWidth = 3;

  const pairs = [
    ['left_shoulder','right_shoulder'], ['left_shoulder','left_elbow'], ['left_elbow','left_wrist'],
    ['right_shoulder','right_elbow'], ['right_elbow','right_wrist'], ['left_shoulder','left_hip'],
    ['right_shoulder','right_hip'], ['left_hip','right_hip'], ['left_hip','left_knee'], ['left_knee','left_ankle'],
    ['right_hip','right_knee'], ['right_knee','right_ankle']
  ];

  // Build a map name->point
  const map = {};
  for (const kp of keypoints) {
    if (kp.score != null && kp.score < 0.3) continue;
    map[kp.name] = kp;
    // point
    ctx.beginPath();
    const sx = kp.x / video.videoWidth * canvas.width;
    const sy = kp.y / video.videoHeight * canvas.height;
    ctx.arc(sx, sy, 4, 0, Math.PI*2);
    ctx.fill();
  }

  // lines
  for (const [a,b] of pairs) {
    const p = map[a], q = map[b];
    if (!p || !q) continue;
    ctx.beginPath();
    const px = p.x / video.videoWidth * canvas.width;
    const py = p.y / video.videoHeight * canvas.height;
    const qx = q.x / video.videoWidth * canvas.width;
    const qy = q.y / video.videoHeight * canvas.height;
    ctx.moveTo(px, py);
    ctx.lineTo(qx, qy);
    ctx.stroke();
  }
  ctx.restore();
}

let last = performance.now();
function updateFPS() {
  const now = performance.now();
  const fps = 1000 / (now - last);
  last = now;
  document.getElementById('fps').textContent = 'FPS: ' + fps.toFixed(0);
}

async function loop() {
  if (!detector || video.readyState < 2) {
    requestAnimationFrame(loop);
    return;
  }
  try {
    // Do not flip in the detector; we mirror the canvas instead
    const poses = await detector.estimatePoses(video, { flipHorizontal: false });
    if (poses && poses[0]) {
      drawKeypoints(poses[0].keypoints);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  } catch (e) {
    // ignore transient errors
  }
  updateFPS();
  requestAnimationFrame(loop);
}

async function main() {
  await initWebcam();
  await initDetector();
  loop();

  document.getElementById('model').addEventListener('change', async (e) => {
    modelType = e.target.value;
    if (detector) await detector.dispose();
    await initDetector();
  });
}

main().catch(err => {
  console.error(err);
  alert('Init failed: ' + err.message);
});
