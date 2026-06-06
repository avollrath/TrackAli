"""Generate extension PNG icons from icons/logo.svg."""
import shutil
import subprocess
from pathlib import Path


EXTENSION_DIR = Path(__file__).resolve().parent
SOURCE_LOGO = EXTENSION_DIR / "icons" / "logo.svg"


def main():
    magick = shutil.which("magick")
    if not magick:
        raise SystemExit("ImageMagick `magick` command not found on PATH.")
    for size in (16, 48, 128):
        output = SOURCE_LOGO.with_name(f"icon{size}.png")
        subprocess.run(
            [magick, "-background", "none", str(SOURCE_LOGO), "-resize", f"{size}x{size}", str(output)],
            check=True,
        )
        shutil.copyfile(output, SOURCE_LOGO.with_name(f"icon{size}-ready.png"))


if __name__ == "__main__":
    main()
