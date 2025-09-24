import os
import uuid
from pathlib import Path
from typing import List, Dict, Any

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

from .services.image_processing import process_and_save, guess_role
from .services.remove_bg import RemoveBGClient

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
STATIC_DIR = BASE_DIR / "static"

load_dotenv(BASE_DIR / ".env")

app = FastAPI(title="3D Try-On MVP")

# Mount static content and data for direct serving
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.mount("/data", StaticFiles(directory=str(DATA_DIR)), name="data")


class UploadResponse(BaseModel):
    session_id: str
    processed: List[Dict[str, Any]]


@app.get("/")
def index() -> FileResponse:
    return FileResponse(str(STATIC_DIR / "index.html"))


@app.post("/api/upload_tshirt", response_model=UploadResponse)
async def upload_tshirt(files: List[UploadFile] = File(...)):
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    session_id = uuid.uuid4().hex
    session_dir = DATA_DIR / session_id
    uploads_dir = session_dir / "uploads"
    processed_dir = session_dir / "processed"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    processed_dir.mkdir(parents=True, exist_ok=True)

    saved_files = []
    for f in files:
        suffix = Path(f.filename).suffix or ".png"
        role = guess_role(f.filename)
        save_name = f"{role}{suffix}"
        dest = uploads_dir / save_name
        content = await f.read()
        dest.write_bytes(content)
        saved_files.append(dest)

    removebg_key = os.getenv("REMOVEBG_API_KEY")
    remover = RemoveBGClient(removebg_key)

    processed = process_and_save(saved_files, processed_dir, remover)

    # Build payload with URLs and basic metadata
    payload = []
    for item in processed:
        payload.append(
            {
                "role": item["role"],
                "filename": item["filename"],
                "url": f"/data/{session_id}/processed/{item['filename']}",
                "width": item["width"],
                "height": item["height"],
            }
        )

    return JSONResponse(UploadResponse(session_id=session_id, processed=payload).model_dump())


@app.get("/api/session/{session_id}")
def get_session(session_id: str):
    session_dir = DATA_DIR / session_id
    processed_dir = session_dir / "processed"
    if not processed_dir.exists():
        raise HTTPException(status_code=404, detail="Session not found")
    files = []
    for p in sorted(processed_dir.glob("*.png")):
        files.append({
            "filename": p.name,
            "url": f"/data/{session_id}/processed/{p.name}",
        })
    return {"session_id": session_id, "processed": files}


@app.get("/healthz")
def healthz():
    return {"ok": True}
