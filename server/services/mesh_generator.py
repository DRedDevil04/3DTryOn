from pathlib import Path
from typing import Optional

# Placeholder for future integration with PIFuHD or other 3D recon.
# For now, this module returns None and is unused by the MVP.


def generate_mesh_from_images(front: Path, back: Optional[Path] = None, side: Optional[Path] = None) -> Optional[Path]:
    """
    Given processed images (transparent PNGs), generate a 3D mesh (.obj/.glb).
    Return the path to the generated model or None if not implemented.
    """
    return None
