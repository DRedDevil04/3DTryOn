from pathlib import Path
from typing import List, Dict

import numpy as np
from PIL import Image, ImageOps
import cv2

from .remove_bg import RemoveBGClient


MAX_SIZE = 1024


def guess_role(filename: str) -> str:
    name = filename.lower()
    if "back" in name:
        return "back"
    if "side" in name:
        return "side"
    return "front"


def _basic_grabcut_alpha(img_bgr: np.ndarray) -> np.ndarray:
    h, w = img_bgr.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    rect = (1, 1, w - 2, h - 2)
    bgdModel = np.zeros((1, 65), np.float64)
    fgdModel = np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(img_bgr, mask, rect, bgdModel, fgdModel, 2, cv2.GC_INIT_WITH_RECT)
        mask2 = np.where((mask == 2) | (mask == 0), 0, 255).astype("uint8")
    except Exception:
        mask2 = np.ones((h, w), dtype=np.uint8) * 255
    return mask2


def _standardize(image: Image.Image) -> Image.Image:
    # Ensure RGBA
    if image.mode != "RGBA":
        image = image.convert("RGBA")
    # Fit inside square canvas MAX_SIZE with padding
    image.thumbnail((MAX_SIZE, MAX_SIZE), Image.Resampling.LANCZOS)
    w, h = image.size
    size = max(w, h)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    offset = ((size - w) // 2, (size - h) // 2)
    canvas.paste(image, offset, image)
    # Optionally add a small border of transparent padding and center
    canvas = ImageOps.expand(canvas, border=int(size * 0.02), fill=(0, 0, 0, 0))
    # Limit to MAX_SIZE x MAX_SIZE
    canvas = canvas.resize((MAX_SIZE, MAX_SIZE), Image.Resampling.LANCZOS)
    return canvas


def process_and_save(paths: List[Path], out_dir: Path, remover: RemoveBGClient) -> List[Dict]:
    out: List[Dict] = []
    out_dir.mkdir(parents=True, exist_ok=True)

    for p in paths:
        image = Image.open(p).convert("RGBA")

        # Background removal: Remove.bg first, else GrabCut fallback
        processed = None
        if remover and remover.available():
            try:
                processed = remover.remove(image)
            except Exception:
                processed = None
        if processed is None:
            bgr = cv2.cvtColor(np.array(image.convert("RGB")), cv2.COLOR_RGB2BGR)
            alpha = _basic_grabcut_alpha(bgr)
            rgba = np.dstack([bgr[:, :, ::-1], alpha])  # BGR->RGB and alpha
            processed = Image.fromarray(rgba, mode="RGBA")

        standardized = _standardize(processed)

        role = guess_role(p.name)
        out_name = f"{role}.png"
        out_path = out_dir / out_name
        standardized.save(out_path)

        out.append({
            "role": role,
            "filename": out_name,
            "width": standardized.width,
            "height": standardized.height,
        })

    # Deduplicate by role, preferring the last occurrence
    dedup: Dict[str, Dict] = {}
    for item in out:
        dedup[item["role"]] = item
    return list(dedup.values())
