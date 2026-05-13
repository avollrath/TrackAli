"""Generate transparent extension PNG icons.

Run from the repo root:
    python extension/generate_icons.py

Creates base icons plus ready-state icons with a round green status dot.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


EXTENSION_DIR = Path(__file__).resolve().parent
ICONS_DIR = EXTENSION_DIR / "icons"
FONT_PATH = EXTENSION_DIR / "Voltymore.ttf"
SIZES = (16, 48, 128)
ACCENT = (0, 194, 232, 255)
TEXT = (15, 23, 42, 255)
GREEN = (34, 197, 94, 255)
WHITE = (255, 255, 255, 255)


def load_font(size):
    if FONT_PATH.exists():
        return ImageFont.truetype(str(FONT_PATH), size)
    return ImageFont.load_default()


def draw_wr(size, ready=False):
    scale = 4
    canvas_size = size * scale
    img = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    font = load_font(int(canvas_size * 0.5))
    text = "WR"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = (canvas_size - text_w) / 2 - bbox[0]
    y = (canvas_size - text_h) / 2 - bbox[1] - canvas_size * 0.02

    draw.text((x, y), text, font=font, fill=TEXT)

    underline_h = max(2 * scale, int(canvas_size * 0.08))
    underline_w = int(canvas_size * 0.62)
    underline_x = (canvas_size - underline_w) // 2
    underline_y = int(canvas_size * 0.78)
    draw.rounded_rectangle(
        [underline_x, underline_y, underline_x + underline_w, underline_y + underline_h],
        radius=underline_h // 2,
        fill=ACCENT,
    )

    if ready:
        dot_r = int(canvas_size * 0.15)
        dot_margin = int(canvas_size * 0.08)
        cx = canvas_size - dot_margin - dot_r
        cy = dot_margin + dot_r
        border = max(scale, int(canvas_size * 0.025))
        draw.ellipse([cx - dot_r - border, cy - dot_r - border, cx + dot_r + border, cy + dot_r + border], fill=WHITE)
        draw.ellipse([cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r], fill=GREEN)

    return img.resize((size, size), Image.LANCZOS)


def main():
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        base = ICONS_DIR / f"icon{size}.png"
        ready = ICONS_DIR / f"icon{size}-ready.png"
        draw_wr(size).save(base)
        draw_wr(size, ready=True).save(ready)
        print(f"wrote {base.relative_to(EXTENSION_DIR)}")
        print(f"wrote {ready.relative_to(EXTENSION_DIR)}")


if __name__ == "__main__":
    main()
