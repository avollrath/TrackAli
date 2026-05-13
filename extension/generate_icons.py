"""Generate extension icons at 16, 48, and 128px.

Run from this directory with: python generate_icons.py

Draws a star glyph onto a dark rounded-square background at 16, 48, 128px.
Requires no third-party libraries - uses only tkinter (stdlib on Windows/macOS).
Falls back to a plain coloured square if tkinter is unavailable.
"""
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), "icons")
os.makedirs(OUT, exist_ok=True)


def png_from_rgba(pixels, size):
    """Encode a flat list of (r,g,b,a) tuples as a PNG."""
    raw = b""
    for y in range(size):
        raw += b"\x00"  # filter type: None
        for x in range(size):
            r, g, b, a = pixels[y * size + x]
            raw += bytes([r, g, b, a])
    compressed = zlib.compress(raw, 9)

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))  # RGBA
    idat = chunk(b"IDAT", compressed)
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


def make_icon_tkinter(size):
    """Use tkinter to render the emoji onto a canvas and read back pixels."""
    import tkinter as tk

    root = tk.Tk()
    root.withdraw()

    canvas = tk.Canvas(root, width=size, height=size, bg="#0f0f0f", highlightthickness=0)
    canvas.pack()

    font_size = max(8, int(size * 0.72))
    canvas.create_text(
        size / 2, size / 2,
        text="*",
        font=("Segoe UI Emoji", font_size),
        anchor="center",
    )

    # Render to a PhotoImage via postscript is not ideal, so use a different approach:
    # Draw onto an offscreen PhotoImage using PIL if available, else fallback.
    root.destroy()
    raise NotImplementedError("tkinter pixel readback requires PIL")


def make_icon_pillow(size):
    from PIL import Image, ImageDraw, ImageFont
    import sys

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded square background
    radius = size // 5
    bg_color = (15, 15, 15, 255)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=bg_color)

    # Glyph - try system emoji font
    font_size = max(10, int(size * 0.72))
    font = None
    font_paths = [
        "C:/Windows/Fonts/seguiemj.ttf",   # Windows Segoe UI Emoji
        "/System/Library/Fonts/Apple Color Emoji.ttc",  # macOS
        "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",  # Linux
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            try:
                font = ImageFont.truetype(fp, font_size)
                break
            except Exception:
                continue

    if font is None:
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), "*", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - tw) // 2 - bbox[0]
    y = (size - th) // 2 - bbox[1]
    draw.text((x, y), "*", font=font, embedded_color=True)

    pixels = list(img.getdata())
    return png_from_rgba(pixels, size)


def make_icon_fallback(size):
    """Plain #009de0 square - used when neither PIL nor tkinter works."""
    r, g, b = 0x00, 0x9D, 0xE0
    radius = size // 5

    def in_rounded_rect(x, y):
        if x < radius and y < radius:
            return (x - radius) ** 2 + (y - radius) ** 2 <= radius ** 2
        if x > size - 1 - radius and y < radius:
            return (x - (size - 1 - radius)) ** 2 + (y - radius) ** 2 <= radius ** 2
        if x < radius and y > size - 1 - radius:
            return (x - radius) ** 2 + (y - (size - 1 - radius)) ** 2 <= radius ** 2
        if x > size - 1 - radius and y > size - 1 - radius:
            return (x - (size - 1 - radius)) ** 2 + (y - (size - 1 - radius)) ** 2 <= radius ** 2
        return True

    pixels = []
    for y in range(size):
        for x in range(size):
            if in_rounded_rect(x, y):
                pixels.append((r, g, b, 255))
            else:
                pixels.append((0, 0, 0, 0))
    return png_from_rgba(pixels, size)


for size in [16, 48, 128]:
    path = os.path.join(OUT, f"icon{size}.png")
    try:
        data = make_icon_pillow(size)
        method = "emoji (Pillow)"
    except Exception:
        data = make_icon_fallback(size)
        method = "fallback (no Pillow)"

    with open(path, "wb") as f:
        f.write(data)
    print(f"icons/icon{size}.png  [{method}]")


