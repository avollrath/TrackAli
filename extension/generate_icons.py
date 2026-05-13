"""Generate extension PNG icons from the packaged logo.svg.

Run from the repo root or extension directory:
    python extension/generate_icons.py

Requires ImageMagick's `magick` command on PATH.
"""
import shutil
import subprocess
from pathlib import Path


EXTENSION_DIR = Path(__file__).resolve().parent
ICONS_DIR = EXTENSION_DIR / "icons"
SOURCE_LOGO = ICONS_DIR / "logo.svg"
SIZES = (16, 48, 128)


def main():
    magick = shutil.which("magick")
    if not magick:
        raise SystemExit("ImageMagick `magick` command not found on PATH.")
    if not SOURCE_LOGO.exists():
        raise SystemExit(f"Missing source logo: {SOURCE_LOGO}")

    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        output = ICONS_DIR / f"icon{size}.png"
        subprocess.run(
            [magick, str(SOURCE_LOGO), "-resize", f"{size}x{size}", str(output)],
            check=True,
        )
        print(f"wrote {output.relative_to(EXTENSION_DIR)}")


if __name__ == "__main__":
    main()
