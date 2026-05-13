"""Generate favicon and extension icons: cyan circle + yellow star."""
import math
import struct
import zlib
from pathlib import Path
from PIL import Image, ImageDraw

CYAN   = (0, 194, 232, 255)
YELLOW = (245, 158, 11, 255)


def star_points(cx, cy, outer, inner, points=5):
    """Return pixel coordinates for a star polygon."""
    coords = []
    for i in range(points * 2):
        r     = outer if i % 2 == 0 else inner
        angle = math.pi * i / points - math.pi / 2
        coords.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    return coords


def make_icon(size):
    img  = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Cyan circle — fill entire canvas with a bit of padding
    pad = max(1, size // 16)
    draw.ellipse([pad, pad, size - pad - 1, size - pad - 1], fill=CYAN)

    # Star — outer radius ~38% of size, inner ~15%
    cx     = size / 2
    cy     = size / 2
    outer  = size * 0.38
    inner  = size * 0.15
    pts    = star_points(cx, cy, outer, inner)
    draw.polygon(pts, fill=YELLOW)

    return img


# ── Extension icons ──────────────────────────────────────────────────────────
ext_dir = Path("extension/icons")
ext_dir.mkdir(parents=True, exist_ok=True)

for size in (16, 48, 128):
    make_icon(size).save(ext_dir / f"icon{size}.png")
    print(f"  wrote extension/icons/icon{size}.png")

# ── Favicon (.ico with 16, 32, 48 layers) ────────────────────────────────────
ico_images = [make_icon(s) for s in (16, 32, 48)]
ico_path   = Path("frontend/favicon.ico")
ico_images[0].save(ico_path, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)],
                   append_images=ico_images[1:])
print(f"  wrote frontend/favicon.ico")

# ── 32×32 PNG favicon for browsers that prefer it ────────────────────────────
make_icon(32).save(Path("frontend/favicon.png"))
print(f"  wrote frontend/favicon.png")

print("Done.")
