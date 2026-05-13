"""Generate extension PNG icons from icons/logo.svg.

Run from the repo root:
    python extension/generate_icons.py

Creates base icons that match the favicon logo plus ready-state icons with a
round green status dot.
"""
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw


EXTENSION_DIR = Path(__file__).resolve().parent
ICONS_DIR = EXTENSION_DIR / "icons"
SOURCE_LOGO = ICONS_DIR / "logo.svg"
SIZES = (16, 48, 128)
GREEN = (34, 197, 94, 255)
WHITE = (255, 255, 255, 255)


def render_svg(size, output):
    magick = shutil.which("magick")
    if not magick:
        raise SystemExit("ImageMagick `magick` command not found on PATH.")
    subprocess.run(
        [
            magick,
            "-background",
            "none",
            str(SOURCE_LOGO),
            "-resize",
            f"{size}x{size}",
            str(output),
        ],
        check=True,
    )


def add_ready_dot(size, source, output):
    scale = 4
    img = Image.open(source).convert("RGBA").resize((size * scale, size * scale), Image.LANCZOS)
    draw = ImageDraw.Draw(img)

    dot_r = int(size * scale * 0.16)
    margin = int(size * scale * 0.07)
    cx = size * scale - margin - dot_r
    cy = margin + dot_r
    border = max(scale, int(size * scale * 0.03))

    draw.ellipse([cx - dot_r - border, cy - dot_r - border, cx + dot_r + border, cy + dot_r + border], fill=WHITE)
    draw.ellipse([cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r], fill=GREEN)
    img.resize((size, size), Image.LANCZOS).save(output)


def main():
    if not SOURCE_LOGO.exists():
        raise SystemExit(f"Missing source logo: {SOURCE_LOGO}")

    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        base = ICONS_DIR / f"icon{size}.png"
        ready = ICONS_DIR / f"icon{size}-ready.png"
        render_svg(size, base)
        add_ready_dot(size, base, ready)
        print(f"wrote {base.relative_to(EXTENSION_DIR)}")
        print(f"wrote {ready.relative_to(EXTENSION_DIR)}")


if __name__ == "__main__":
    main()
