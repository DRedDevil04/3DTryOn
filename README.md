# 3D Try-On (MVP)

Web MVP to upload 2–3 T‑shirt images and preview the shirt on yourself via webcam in real time.

This MVP focuses on a lightweight pipeline: background removal + standardization (server), and a 2.5D overlay in the browser using pose tracking. A pluggable hook is provided to swap in a real 3D generator (e.g., PIFuHD) later.

## Stack
- Frontend: Plain HTML/JS, Three.js, TensorFlow.js Pose Detection (MoveNet)
- Backend: FastAPI (Python), Pillow, OpenCV; optional Remove.bg API

## Quick Start (macOS, zsh)

1) Create and activate a virtual environment:

```zsh
cd /Users/devam/Programs/Projects/3DTryOn
python3 -m venv .venv
source .venv/bin/activate
```

2) Install server dependencies:

```zsh
pip install -r server/requirements.txt
```

3) Configure environment (optional):

- Copy `.env.example` to `.env` and set `REMOVEBG_API_KEY` if you have one.

```zsh
cp server/.env.example server/.env
```

4) Run the server:

```zsh
uvicorn server.main:app --reload --host 127.0.0.1 --port 8000
```

5) Open the app:

- Visit http://127.0.0.1:8000 in your browser.

## MVP Flow
- Upload 2–3 T‑shirt images (front/back/side recommended)
- Server optionally removes background (Remove.bg if configured; fallback to basic OpenCV GrabCut)
- Images are standardized (transparent PNG, centered, square, max 1024px)
- Frontend loads the processed front texture and overlays it as a billboarded plane
- MoveNet (TF.js) tracks shoulders/torso to position, rotate, and scale the shirt in real time

## Notes on 3D Generation
This MVP uses a 2.5D approximation (alpha-textured plane) for speed and simplicity. The server contains a stubbed extension point to integrate a real 3D reconstruction model (e.g., PIFuHD) later. When you’re ready, implement the generator in `server/services/mesh_generator.py` and expose results via an endpoint returning `.obj/.glb`.

## Project Structure

```
server/
  main.py              # FastAPI app and routes
  requirements.txt
  .env.example
  services/
    image_processing.py
    remove_bg.py
    mesh_generator.py  # stub for future 3D
  data/                # session folders (uploads, processed)
    .gitkeep
  static/
    index.html
    app.js
    style.css
```

## Troubleshooting
- If webcam doesn’t start, check browser permissions.
- If background removal is poor, try images with a neutral background, or set a Remove.bg API key.
- Performance: Prefer Chrome; ensure "Use hardware acceleration" is enabled.
