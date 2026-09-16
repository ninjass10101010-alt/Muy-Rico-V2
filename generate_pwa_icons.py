#!/usr/bin/env python3
"""Generate PWA/home-screen icons from the Muy Rico logo."""
import sys
from PIL import Image

SRC = "muy_rico_logo_transparent.webp"
BG = (250, 246, 236, 255)  # sand #FAF6EC, opaque

OUT = {
    "apple-touch-icon.png": 180,
    "icon-192.png": 192,
    "icon-512.png": 512,
}

def main():
    logo = Image.open(SRC).convert("RGBA")
    for name, size in OUT.items():
        canvas = Image.new("RGBA", (size, size), BG)
        # Fit logo to ~78% of the canvas, centered.
        s = int(size * 0.78)
        scaled = logo.resize((s, s), Image.LANCZOS)
        x = (size - s) // 2
        canvas.paste(scaled, (x, x), scaled)
        canvas.convert("RGB").save(name, "PNG")
        print(f"wrote {name} ({size}x{size})")

if __name__ == "__main__":
    sys.exit(main())
