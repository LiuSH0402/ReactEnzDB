"""Generate ReactEnzDB favicon raster assets from the brand mark geometry."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT / "src" / "app"
SCALE = 8


def point(value: float) -> int:
    return round(value * SCALE)


def box(values: tuple[float, float, float, float]) -> tuple[int, int, int, int]:
    return tuple(point(value) for value in values)  # type: ignore[return-value]


def polygon(values: list[tuple[float, float]]) -> list[tuple[int, int]]:
    return [(point(x), point(y)) for x, y in values]


def master_icon() -> Image.Image:
    canvas = Image.new("RGBA", (64 * SCALE, 64 * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    navy = "#10243a"
    teal = "#2dd4c7"
    letter = "#edf5ff"

    draw.rounded_rectangle(box((2, 2, 62, 62)), radius=point(14), fill=navy)
    draw.rectangle(box((8.5, 15, 15.5, 49)), fill=letter)
    draw.rounded_rectangle(box((8.5, 15, 31.5, 36.5)), radius=point(9), fill=letter)
    draw.rounded_rectangle(box((15.5, 21.5, 25.5, 30)), radius=point(4), fill=navy)
    draw.polygon(polygon([(20, 32), (26.5, 33), (34, 49), (26.5, 49)]), fill=letter)
    draw.polygon(
        polygon([(35.5, 15), (55.5, 15), (55.5, 21.5), (43, 21.5), (43, 28.5), (51, 28.5), (57.5, 32),
                 (51, 35.5), (43, 35.5), (43, 42.5), (55.5, 42.5), (55.5, 49), (35.5, 49)]),
        fill=teal,
    )
    return canvas


def resize(master: Image.Image, size: int) -> Image.Image:
    return master.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    master = master_icon()
    favicon_master = resize(master, 256)
    favicon_master.save(
        APP_DIR / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    resize(master, 180).save(APP_DIR / "apple-icon.png", format="PNG", optimize=True)


if __name__ == "__main__":
    main()
