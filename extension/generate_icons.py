"""Run once to generate extension icons: python generate_icons.py"""
import struct, zlib, os

def png_chunk(chunk_type, data):
    c = chunk_type + data
    return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

def make_png(size):
    # Wolt blue #009de0 square icon
    r, g, b = 0x00, 0x9D, 0xE0
    raw = b""
    for _ in range(size):
        row = b"\x00" + bytes([r, g, b, 255] * size)
        raw += row
    compressed = zlib.compress(raw)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = png_chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    idat = png_chunk(b"IDAT", compressed)
    iend = png_chunk(b"IEND", b"")
    return sig + ihdr + idat + iend

out = os.path.join(os.path.dirname(__file__), "icons")
for size in [16, 48, 128]:
    with open(os.path.join(out, f"icon{size}.png"), "wb") as f:
        f.write(make_png(size))
    print(f"icons/icon{size}.png generated")
