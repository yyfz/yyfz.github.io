#!/usr/bin/env python3
"""Render a prerendered hero montage with ffmpeg.

This script intentionally uses ffmpeg for all decoding/encoding. Python only
builds the filter graph and launches the ffmpeg binary.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "demo" / "catalog.json"
DRAGON_TITLE = "Dragon in the Forbidden City"
VIDEO_MEDIA_ASPECT = 640 / 384


def ffmpeg_exe() -> str:
    configured = os.environ.get("FFMPEG")
    if configured:
        return configured

    found = shutil.which("ffmpeg")
    if found:
        return found

    probe = subprocess.run(
        [
            "python3",
            "-c",
            "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())",
        ],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )
    return probe.stdout.strip()


def local_path(path: str) -> Path:
    return ROOT / unquote(path)


def load_demos() -> list[dict]:
    catalog = json.loads(CATALOG.read_text())
    demos = [item for item in catalog["representatives"] if item.get("demo_video") and item.get("first_frame")]
    demos.sort(key=lambda item: 0 if item.get("title") == DRAGON_TITLE else 1)
    return demos


def group_from_cursor(demos: list[dict], start: int, count: int) -> list[dict]:
    return [demos[(start + offset) % len(demos)] for offset in range(count)]


def edge_demos_from_pool(pool: list[dict], excluded_group: list[dict], count: int, start: int) -> list[dict]:
    excluded = {demo["demo_video"] for demo in excluded_group}
    candidates = [pool[(start + offset) % len(pool)] for offset in range(len(pool))]
    candidates = [demo for demo in candidates if demo["demo_video"] not in excluded]
    source = candidates or pool
    return [source[index % len(source)] for index in range(count)]


def grid_for_count(count: int) -> tuple[int, int]:
    side = int(math.sqrt(count))
    return side, side


def board_geometry(width: int, height: int, columns: int, rows: int, media_aspect: float) -> dict:
    board_aspect = columns * media_aspect / rows
    if width / height > board_aspect:
        board_h = height
        board_w = int(round(height * board_aspect))
    else:
        board_w = width
        board_h = int(round(width / board_aspect))

    board_w -= board_w % columns
    board_h -= board_h % rows
    edge_x = (width - board_w) // 2
    edge_y = (height - board_h) // 2
    cell_w = board_w // columns
    cell_h = board_h // rows
    return {
        "board_w": board_w,
        "board_h": board_h,
        "edge_x": edge_x,
        "edge_y": edge_y,
        "cell_w": cell_w,
        "cell_h": cell_h,
    }


def edge_position_for_tile(index: int, columns: int, rows: int) -> tuple[str, str]:
    column = index % columns
    row = index // columns
    horizontal_center = (columns - 1) / 2
    vertical_center = (rows - 1) / 2
    x = "right" if column < horizontal_center else "left" if column > horizontal_center else "center"
    y = "bottom" if row < vertical_center else "top" if row > vertical_center else "center"
    return x, y


def cover_chain(label_in: str, label_out: str, width: int, height: int, x_pos: str, y_pos: str) -> str:
    x_expr = {
        "left": "0",
        "center": "(iw-ow)/2",
        "right": "iw-ow",
    }[x_pos]
    y_expr = {
        "top": "0",
        "center": "(ih-oh)/2",
        "bottom": "ih-oh",
    }[y_pos]
    return (
        f"{label_in}"
        f"scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height}:{x_expr}:{y_expr},setsar=1"
        f"{label_out}"
    )


def contain_scale_chain(label_in: str, label_out: str, width: int, height: int) -> str:
    return (
        f"{label_in}"
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,setsar=1"
        f"{label_out}"
    )


def timed_video(label: int, duration: float, fps: int, speed: float) -> str:
    return f"[{label}:v]setpts=PTS/{speed},fps={fps},trim=duration={duration},setpts=PTS-STARTPTS"


def timed_image(label: int, duration: float, fps: int) -> str:
    return f"[{label}:v]fps={fps},trim=duration={duration},setpts=PTS-STARTPTS"


def video_duration(ffmpeg: str, path: Path) -> float:
    probe = subprocess.run(
        [ffmpeg, "-hide_banner", "-i", str(path)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", probe.stdout)
    if not match:
        raise RuntimeError(f"Could not read duration for {path}")

    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def segment_duration(ffmpeg: str, group: list[dict], speed: float, override: float | None) -> float:
    if override is not None:
        return override

    durations = [video_duration(ffmpeg, local_path(demo["demo_video"])) for demo in group]
    return min(durations) / speed


def poster_for_demo(ffmpeg: str, demo: dict, poster_dir: Path) -> Path:
    """Extract an ffmpeg poster from the actual mp4 so crop coordinates match."""
    source = local_path(demo["demo_video"])
    poster = poster_dir / f"{source.parent.name}.png"
    if poster.exists():
        return poster

    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(source),
            "-frames:v",
            "1",
            str(poster),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return poster


def render_segment(
    ffmpeg: str,
    segment_path: Path,
    group: list[dict],
    edge_demos: list[dict],
    poster_dir: Path,
    width: int,
    height: int,
    duration: float,
    fps: int,
    speed: float,
) -> None:
    columns, rows = grid_for_count(len(group))
    media_aspect = VIDEO_MEDIA_ASPECT
    geo = board_geometry(width, height, columns, rows, media_aspect)
    board_w = geo["board_w"]
    board_h = geo["board_h"]
    edge_x = geo["edge_x"]
    edge_y = geo["edge_y"]
    cell_w = geo["cell_w"]
    cell_h = geo["cell_h"]

    inputs: list[Path] = []
    edge_specs: list[tuple[int, int, int, int, str, str]] = []
    main_specs: list[tuple[int, int, int, int, int]] = []

    def add_video_input(demo: dict) -> int:
        inputs.append(local_path(demo["demo_video"]))
        return len(inputs) - 1

    def add_image_input(demo: dict) -> int:
        inputs.append(poster_for_demo(ffmpeg, demo, poster_dir))
        return len(inputs) - 1

    edge_cursor = 0
    if edge_x > 0:
        strip_w = edge_x
        for row in range(rows):
            left_idx = add_image_input(edge_demos[edge_cursor])
            edge_cursor += 1
            right_idx = add_image_input(edge_demos[edge_cursor])
            edge_cursor += 1
            y = edge_y + row * cell_h
            edge_specs.append((left_idx, 0, y, strip_w, cell_h, "right", "center"))
            edge_specs.append((right_idx, edge_x + board_w, y, strip_w, cell_h, "left", "center"))

    if edge_y > 0:
        strip_h = edge_y
        for column in range(columns):
            top_idx = add_image_input(edge_demos[edge_cursor])
            edge_cursor += 1
            bottom_idx = add_image_input(edge_demos[edge_cursor])
            edge_cursor += 1
            x = edge_x + column * cell_w
            edge_specs.append((top_idx, x, 0, cell_w, strip_h, "center", "bottom"))
            edge_specs.append((bottom_idx, x, edge_y + board_h, cell_w, strip_h, "center", "top"))

    for index, demo in enumerate(group):
        input_index = add_video_input(demo)
        column = index % columns
        row = index // columns
        x = edge_x + column * cell_w
        y = edge_y + row * cell_h
        main_specs.append((input_index, x, y, cell_w, cell_h))

    filters: list[str] = [f"color=c=black:s={width}x{height}:r={fps}:d={duration}[base0]"]
    base_label = "base0"
    overlay_count = 0

    for input_index, x, y, w, h, x_pos, y_pos in edge_specs:
        video_label = f"edge{overlay_count}"
        filters.append(timed_image(input_index, duration, fps) + f"[{video_label}raw]")
        filters.append(cover_chain(f"[{video_label}raw]", f"[{video_label}]", w, h, x_pos, y_pos))
        next_base = f"base{overlay_count + 1}"
        filters.append(f"[{base_label}][{video_label}]overlay={x}:{y}:shortest=1[{next_base}]")
        base_label = next_base
        overlay_count += 1

    for tile_index, (input_index, x, y, w, h) in enumerate(main_specs):
        cell = f"main{tile_index}cell"
        filters.append(timed_video(input_index, duration, fps, speed) + f"[main{tile_index}video]")
        filters.append(contain_scale_chain(f"[main{tile_index}video]", f"[{cell}]", w, h))
        next_base = f"base{overlay_count + 1}"
        filters.append(f"[{base_label}][{cell}]overlay={x}:{y}:shortest=1[{next_base}]")
        base_label = next_base
        overlay_count += 1

    filters.append(f"[{base_label}]format=yuv420p[outv]")

    with tempfile.NamedTemporaryFile("w", suffix=".ffgraph", delete=False) as graph:
        graph.write(";\n".join(filters))
        graph_path = graph.name

    try:
        command = [ffmpeg, "-y"]
        for input_path in inputs:
            if input_path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
                command.extend(["-loop", "1", "-t", str(duration), "-i", str(input_path)])
            else:
                command.extend(["-i", str(input_path)])
        command.extend(
            [
                "-filter_complex_script",
                graph_path,
                "-map",
                "[outv]",
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-pix_fmt",
                "yuv420p",
                "-r",
                str(fps),
                "-movflags",
                "+faststart",
                str(segment_path),
            ]
        )
        subprocess.run(command, check=True)
    finally:
        Path(graph_path).unlink(missing_ok=True)


def concat_segments(ffmpeg: str, segments: list[Path], output: Path) -> None:
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as listing:
        for segment in segments:
            listing.write(f"file '{segment.resolve()}'\n")
        list_path = listing.name

    try:
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                list_path,
                "-c",
                "copy",
                "-movflags",
                "+faststart",
                str(output),
            ],
            check=True,
        )
    finally:
        Path(list_path).unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="demo/hero_montage_preview.mp4")
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=900)
    parser.add_argument(
        "--seconds",
        type=float,
        default=None,
        help="Optional seconds per 1/4/16 segment after speed-up. Default uses each group's full video duration.",
    )
    parser.add_argument("--fps", type=int, default=24)
    parser.add_argument("--speed", type=float, default=1.5)
    parser.add_argument("--keep-temp", action="store_true")
    args = parser.parse_args()

    demos = load_demos()
    ffmpeg = ffmpeg_exe()
    output = ROOT / args.output
    output.parent.mkdir(parents=True, exist_ok=True)

    temp_dir = output.parent / "_hero_montage_tmp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    poster_dir = temp_dir / "posters"
    poster_dir.mkdir(parents=True, exist_ok=True)

    segments: list[Path] = []
    cursor = 0
    for count in (1, 4, 16):
        group = group_from_cursor(demos, cursor, count)
        columns, rows = grid_for_count(count)
        edge_count = rows * 2 + columns * 2
        edge_group = edge_demos_from_pool(demos, group, edge_count, count + math.ceil(len(demos) / 3))
        duration = segment_duration(ffmpeg, group, args.speed, args.seconds)
        segment_path = temp_dir / f"segment_{count}.mp4"
        print(f"Rendering {count}-tile segment ({duration:.2f}s) -> {segment_path}")
        render_segment(
            ffmpeg=ffmpeg,
            segment_path=segment_path,
            group=group,
            edge_demos=edge_group,
            poster_dir=poster_dir,
            width=args.width,
            height=args.height,
            duration=duration,
            fps=args.fps,
            speed=args.speed,
        )
        segments.append(segment_path)
        cursor = (cursor + count) % len(demos)

    print(f"Concatenating -> {output}")
    concat_segments(ffmpeg, segments, output)

    if not args.keep_temp:
        for segment in segments:
            segment.unlink(missing_ok=True)
        for poster in poster_dir.iterdir():
            poster.unlink(missing_ok=True)
        poster_dir.rmdir()
        temp_dir.rmdir()

    print(output)


if __name__ == "__main__":
    main()
