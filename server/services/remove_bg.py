import os
import io
import requests
from PIL import Image
from typing import Optional

REMOVEBG_ENDPOINT = "https://api.remove.bg/v1.0/removebg"

class RemoveBGClient:
    def __init__(self, api_key: Optional[str]):
        self.api_key = api_key

    def available(self) -> bool:
        return bool(self.api_key)

    def remove(self, image: Image.Image) -> Optional[Image.Image]:
        if not self.api_key:
            return None
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        buf.seek(0)
        files = {"image_file": ("image.png", buf.getvalue(), "image/png")}
        data = {"size": "auto", "type": "auto"}
        headers = {"X-Api-Key": self.api_key}
        resp = requests.post(REMOVEBG_ENDPOINT, files=files, data=data, headers=headers, timeout=60)
        if resp.status_code == 200:
            return Image.open(io.BytesIO(resp.content)).convert("RGBA")
        return None
