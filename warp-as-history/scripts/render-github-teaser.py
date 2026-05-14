#!/usr/bin/env python3
from __future__ import annotations

import argparse
import math
from pathlib import Path

import cv2
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


CANVAS = (1920, 900)
BG_BLUR = 1
VIDEO = Path("demo/hero_montage_preview.mp4")
OUTPUT = Path("demo/github_teaser.jpg")
FRAME_DIR = Path("demo/teaser_frames")
BACKGROUND = Path("demo/teaser_frames/frame_05.jpg")
SERIF = Path("/usr/share/fonts/urw-base35/NimbusRoman-Regular.otf")
SANS = Path("/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf")


def load_font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    if path.exists():
        return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def cover_resize(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    src_w, src_h = image.size
    dst_w, dst_h = size
    scale = max(dst_w / src_w, dst_h / src_h)
    resized = image.resize((math.ceil(src_w * scale), math.ceil(src_h * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - dst_w) // 2
    top = (resized.height - dst_h) // 2
    return resized.crop((left, top, left + dst_w, top + dst_h))


def rounded_image(image: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", image.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, image.width - 1, image.height - 1), radius=radius, fill=255)
    out = Image.new("RGBA", image.size, (0, 0, 0, 0))
    out.paste(image.convert("RGBA"), (0, 0), mask)
    return out


def read_frame(cap: cv2.VideoCapture, seconds: float) -> Image.Image:
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 1
    frame_index = max(0, min(int(seconds * fps), int(frame_count) - 1))
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
    ok, frame = cap.read()
    if not ok:
        raise RuntimeError(f"Could not read frame at {seconds:.2f}s")
    frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    return Image.fromarray(frame)


def alpha_gradient(size: tuple[int, int], top_alpha: int, mid_alpha: int, bottom_alpha: int) -> Image.Image:
    width, height = size
    overlay = Image.new("RGBA", size, (8, 8, 7, 0))
    pix = overlay.load()
    for y in range(height):
        t = y / max(1, height - 1)
        if t < 0.45:
            local = t / 0.45
            alpha = int(top_alpha * (1 - local) + mid_alpha * local)
        else:
            local = (t - 0.45) / 0.55
            alpha = int(mid_alpha * (1 - local) + bottom_alpha * local)
        for x in range(width):
            pix[x, y] = (8, 8, 7, alpha)
    return overlay


def draw_centered(draw: ImageDraw.ImageDraw, text: str, y: int, font: ImageFont.FreeTypeFont, fill, shadow=True):
    bbox = draw.textbbox((0, 0), text, font=font)
    x = (CANVAS[0] - (bbox[2] - bbox[0])) // 2
    if shadow:
        draw.text((x, y + 8), text, font=font, fill=(0, 0, 0, 128))
    draw.text((x, y), text, font=font, fill=fill)


def draw_centered_highlighted(
    draw: ImageDraw.ImageDraw,
    parts: list[tuple[str, tuple[int, int, int, int]]],
    y: int,
    font: ImageFont.FreeTypeFont,
    shadow=True,
):
    widths = [draw.textbbox((0, 0), text, font=font)[2] - draw.textbbox((0, 0), text, font=font)[0] for text, _ in parts]
    x = (CANVAS[0] - sum(widths)) // 2
    cursor = x
    for (text, fill), width in zip(parts, widths):
        if shadow:
            draw.text((cursor, y + 8), text, font=font, fill=(0, 0, 0, 128))
        draw.text((cursor, y), text, font=font, fill=fill)
        cursor += width


def draw_teaser(frames: list[Image.Image], output: Path, frame_dir: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    frame_dir.mkdir(parents=True, exist_ok=True)

    for index, frame in enumerate(frames, 1):
        frame.save(frame_dir / f"frame_{index:02d}.jpg", quality=94)

    bg = cover_resize(frames[len(frames) // 2], CANVAS)
    bg = ImageEnhance.Color(bg).enhance(0.92)
    bg = ImageEnhance.Contrast(bg).enhance(1.08)
    bg = bg.filter(ImageFilter.GaussianBlur(BG_BLUR))
    canvas = bg.convert("RGBA")
    canvas.alpha_composite(alpha_gradient(CANVAS, 166, 58, 188))

    vignette = Image.new("L", CANVAS, 0)
    vdraw = ImageDraw.Draw(vignette)
    vdraw.ellipse((-260, -250, CANVAS[0] + 260, CANVAS[1] + 300), fill=185)
    vignette = Image.eval(vignette.filter(ImageFilter.GaussianBlur(60)), lambda p: 190 - p)
    canvas.paste(Image.new("RGBA", CANVAS, (0, 0, 0, 120)), (0, 0), vignette)

    draw = ImageDraw.Draw(canvas)
    serif_1 = load_font(SERIF, 106)
    serif_2 = load_font(SERIF, 48)
    serif_3 = load_font(SERIF, 42)
    sans = load_font(SANS, 17)

    draw_centered(draw, "Warp-as-History", 132, serif_1, (234, 248, 246, 255))
    draw_centered(draw, "Generalizable Camera-Controlled Video Generation", 258, serif_2, (255, 249, 239, 242))
    draw_centered(draw, "from One Training Video", 318, serif_3, (255, 249, 239, 230))

    label = "Video History is More Than Context."
    label_bbox = draw.textbbox((0, 0), label, font=sans)
    label_x = (CANVAS[0] - (label_bbox[2] - label_bbox[0])) // 2
    draw.text((label_x, 98), label, font=sans, fill=(188, 203, 218, 210))

    card_w, card_h = 276, 164
    gap = 18
    start_x = (CANVAS[0] - (card_w * len(frames) + gap * (len(frames) - 1))) // 2
    y = 596

    for index, frame in enumerate(frames):
        x = start_x + index * (card_w + gap)
        card = cover_resize(frame, (card_w, card_h))
        card = ImageEnhance.Color(card).enhance(0.96)
        card = ImageEnhance.Contrast(card).enhance(1.04)
        card = rounded_image(card, 18)

        shadow = Image.new("RGBA", (card_w + 34, card_h + 34), (0, 0, 0, 0))
        sdraw = ImageDraw.Draw(shadow)
        sdraw.rounded_rectangle((17, 17, card_w + 17, card_h + 17), radius=20, fill=(0, 0, 0, 138))
        shadow = shadow.filter(ImageFilter.GaussianBlur(15))
        canvas.alpha_composite(shadow, (x - 17, y - 12))

        border = Image.new("RGBA", (card_w + 2, card_h + 2), (0, 0, 0, 0))
        bdraw = ImageDraw.Draw(border)
        bdraw.rounded_rectangle((0, 0, card_w + 1, card_h + 1), radius=19, outline=(228, 240, 250, 76), width=2)
        canvas.alpha_composite(border, (x - 1, y - 1))
        canvas.alpha_composite(card, (x, y))

    draw.rounded_rectangle((450, 814, 1150, 815), radius=1, fill=(228, 240, 250, 70))

    final = canvas.convert("RGB")
    final.save(output, quality=94, subsampling=1)


def draw_minimal_teaser(background_path: Path, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    source = Image.open(background_path).convert("RGB")
    bg = cover_resize(source, CANVAS)
    bg = ImageEnhance.Color(bg).enhance(1.06)
    bg = ImageEnhance.Contrast(bg).enhance(1.08)
    bg = bg.filter(ImageFilter.GaussianBlur(BG_BLUR))
    canvas = bg.convert("RGBA")

    canvas.alpha_composite(Image.new("RGBA", CANVAS, (8, 8, 7, 46)))

    top = Image.new("RGBA", CANVAS, (8, 8, 7, 0))
    tpix = top.load()
    for y in range(CANVAS[1]):
        t = y / max(1, CANVAS[1] - 1)
        vertical = int(126 * (1 - min(t / 0.34, 1)) + 14 * min(t / 0.34, 1))
        bottom = int(146 * max((t - 0.38) / 0.62, 0))
        alpha = max(vertical, bottom)
        for x in range(CANVAS[0]):
            edge = abs((x / CANVAS[0]) - 0.5) * 2
            side = int(142 * max((edge - 0.42) / 0.58, 0))
            tpix[x, y] = (8, 8, 7, max(alpha, side))
    canvas.alpha_composite(top)

    draw = ImageDraw.Draw(canvas)
    serif_1 = load_font(SERIF, 128)
    serif_2 = load_font(SERIF, 68)
    serif_3 = load_font(SERIF, 62)

    title_lines = [
        ("Warp-as-History", serif_1, 0, (234, 248, 246, 255)),
        ("Generalizable Camera-Controlled Video Generation", serif_2, 124, (255, 249, 239, 244)),
        ("from One Training Video", serif_3, 194, (255, 249, 239, 232)),
    ]
    line_bounds = []
    for text, font, offset, _ in title_lines:
        bbox = draw.textbbox((0, 0), text, font=font)
        line_bounds.append((offset + bbox[1], offset + bbox[3]))
    group_top = min(top for top, _ in line_bounds)
    group_bottom = max(bottom for _, bottom in line_bounds)
    title_y = round((CANVAS[1] - (group_bottom - group_top)) / 2 - group_top)

    draw_centered(draw, title_lines[0][0], title_y + title_lines[0][2], title_lines[0][1], title_lines[0][3])
    draw_centered(draw, title_lines[1][0], title_y + title_lines[1][2], title_lines[1][1], title_lines[1][3])
    draw_centered_highlighted(
        draw,
        [
            ("from ", (255, 249, 239, 232)),
            ("One", (242, 196, 102, 255)),
            (" Training Video", (255, 249, 239, 232)),
        ],
        title_y + title_lines[2][2],
        title_lines[2][1],
    )

    canvas.convert("RGB").save(output, quality=94, subsampling=1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=VIDEO)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--frame-dir", type=Path, default=FRAME_DIR)
    parser.add_argument("--background", type=Path, default=BACKGROUND)
    parser.add_argument("--frames", type=int, default=5)
    parser.add_argument("--minimal", action="store_true", default=True)
    args = parser.parse_args()

    if args.minimal:
        draw_minimal_teaser(args.background, args.output)
        print(f"Wrote {args.output}")
        return

    cap = cv2.VideoCapture(str(args.input))
    if not cap.isOpened():
        raise RuntimeError(f"Could not open {args.input}")

    frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 1
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    duration = frame_count / fps
    samples = [duration * (0.12 + 0.76 * i / max(1, args.frames - 1)) for i in range(args.frames)]
    frames = [read_frame(cap, seconds) for seconds in samples]
    cap.release()
    draw_teaser(frames, args.output, args.frame_dir)
    print(f"Wrote {args.output}")
    print(f"Wrote {len(frames)} frames to {args.frame_dir}")


if __name__ == "__main__":
    main()
