#!/usr/bin/env python
"""把有封面的书的 A4 封面压成网页用的 1000px 封面与 240px 缩略图。

源封面在 books/<id>/<book.cover>，输出到 site/assets/covers/。
只读源文件，不修改书稿。9 本文字封面书没有封面文件，自动跳过。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BOOKS = ROOT / "books"
OUT = ROOT / "site" / "assets" / "covers"

FULL_WIDTH = 1000
LARGE_WIDTH = 1800
THUMB_WIDTH = 240
FULL_QUALITY = 87
LARGE_QUALITY = 85
THUMB_QUALITY = 82


def flatten(image: Image.Image) -> Image.Image:
    if image.mode in ("RGBA", "LA", "P"):
        image = image.convert("RGBA")
        canvas = Image.new("RGB", image.size, "white")
        canvas.paste(image, mask=image.split()[-1])
        return canvas
    return image.convert("RGB")


def save_variant(source: Image.Image, destination: Path, width: int, quality: int) -> tuple[int, int]:
    height = round(source.height * width / source.width)
    resized = source.resize((width, height), Image.Resampling.LANCZOS)
    resized.save(destination, "JPEG", quality=quality, optimize=True, progressive=True)
    return resized.size


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    manifest = json.loads((BOOKS / "manifest.json").read_text(encoding="utf-8"))
    books_by_id = {book["id"]: book for book in manifest.get("books", [])}
    OUT.mkdir(parents=True, exist_ok=True)

    made = 0
    for book_id in manifest.get("order", []):
        book = books_by_id.get(book_id, {})
        cover = book.get("cover")
        if not cover:
            meta_path = BOOKS / book_id / "publish" / "book.json"
            if meta_path.exists():
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                cover = meta.get("cover")
        if not cover:
            continue

        source_path = BOOKS / book_id / cover
        if not source_path.exists():
            print(f"[cover] {book_id}: missing {source_path}")
            continue

        with Image.open(source_path) as opened:
            source = flatten(opened)

        full = OUT / f"{book_id}.jpg"
        large = OUT / f"{book_id}-large.jpg"
        thumb = OUT / f"{book_id}-thumb.jpg"
        full_size = save_variant(source, full, FULL_WIDTH, FULL_QUALITY)
        large_size = save_variant(source, large, min(LARGE_WIDTH, source.width), LARGE_QUALITY)
        thumb_size = save_variant(source, thumb, THUMB_WIDTH, THUMB_QUALITY)
        made += 1
        print(
            f"[cover] {book_id:16} {source.width}x{source.height} -> "
            f"{full_size[0]}x{full_size[1]} / {large_size[0]}x{large_size[1]} / {thumb_size[0]}x{thumb_size[1]}"
        )

    print(f"[cover] {made} cover(s) written to {OUT}")
    return 0 if made else 1


if __name__ == "__main__":
    raise SystemExit(main())
