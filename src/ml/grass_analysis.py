import io
import math

import numpy as np
from PIL import Image

PIXEL_TO_CM = 0.5
LIMITE_CRITICO_CM = 45.0
LIMITE_ATENCAO_CM = 40.0
MORPH_KERNEL = 5
ROI_X_START_RATIO = 0.15
ROI_X_END_RATIO = 0.85
EDGE_SEARCH_Y_START_RATIO = 0.25
EDGE_SEARCH_Y_END_RATIO = 0.98
EDGE_DENSITY_THRESHOLD = 0.30
ROAD_ROW_DENSITY_MAX = 0.15
GRASS_ROW_DENSITY_MIN = 0.40
ROAD_BLOCK_SHARE = 0.85
GRASS_BLOCK_SHARE = 0.15
MIN_GRASS_ROWS = 4
MIN_BLOCK_HEIGHT_RATIO = 0.07
EXTENT_NOISE_TOLERANCE = 2
EDGE_FALLBACK_Y_RATIO = 0.72
GRASS_HUE_MIN = 30
GRASS_HUE_MAX = 95
GRASS_SAT_MIN = 30
GRASS_VAL_MIN = 45
GRASS_VAL_MAX = 255
RATIO = ROAD_BLOCK_SHARE / GRASS_BLOCK_SHARE


def js_round(value):
    return int(math.floor(value + 0.5))


def grass_mask(rgb):
    x = rgb.astype(np.float64) / 255.0
    r, g, b = x[..., 0], x[..., 1], x[..., 2]
    mx = x.max(axis=-1)
    mn = x.min(axis=-1)
    d = mx - mn
    safe_d = np.where(d == 0, 1.0, d)
    h = np.where(
        mx == r,
        ((g - b) / safe_d + 6) % 6,
        np.where(mx == g, (b - r) / safe_d + 2, (r - g) / safe_d + 4),
    )
    h = np.where(d == 0, 0.0, h) / 6
    hue = np.floor(h * 179 + 0.5)
    sat = np.where(mx == 0, 0.0, np.floor(d / np.where(mx == 0, 1.0, mx) * 255 + 0.5))
    val = np.floor(mx * 255 + 0.5)
    return (
        (hue >= GRASS_HUE_MIN) & (hue <= GRASS_HUE_MAX)
        & (sat >= GRASS_SAT_MIN)
        & (val >= GRASS_VAL_MIN) & (val <= GRASS_VAL_MAX)
    )


def detect_edge_y(dens, h):
    start = int(h * EDGE_SEARCH_Y_START_RATIO)
    end = min(h - 1, int(h * EDGE_SEARCH_Y_END_RATIO))
    for y in range(end, start - 1, -1):
        if dens[y] >= EDGE_DENSITY_THRESHOLD:
            return y
    return -1


def measure_road_extent(dens, h, edge_y):
    rows = 0
    bad = 0
    for y in range(edge_y + 1, h):
        if dens[y] > ROAD_ROW_DENSITY_MAX:
            bad += 1
            if bad > EXTENT_NOISE_TOLERANCE:
                break
        else:
            bad = 0
        rows += 1
    return rows


def measure_grass_extent(dens, edge_y):
    rows = 0
    bad = 0
    for y in range(edge_y - 1, -1, -1):
        if dens[y] < GRASS_ROW_DENSITY_MIN:
            bad += 1
            if bad > EXTENT_NOISE_TOLERANCE:
                break
        else:
            bad = 0
        rows += 1
    return rows


def build_analysis_block(mask, h, x_start, x_end):
    step = max(1, (x_end - x_start) // 120)
    dens = mask[:, x_start:x_end:step].mean(axis=1)
    edge_y = detect_edge_y(dens, h)

    if edge_y < 0:
        fallback_y = int(h * EDGE_FALLBACK_Y_RATIO)
        fallback_rows = js_round(h * 0.045)
        return max(0, fallback_y - fallback_rows), min(h, fallback_y + js_round(fallback_rows * RATIO))

    road_extent = measure_road_extent(dens, h, edge_y)
    grass_extent = max(MIN_GRASS_ROWS, measure_grass_extent(dens, edge_y))

    grass_rows = max(MIN_GRASS_ROWS, min(grass_extent, road_extent / RATIO))
    road_rows = grass_rows * RATIO

    min_block = h * MIN_BLOCK_HEIGHT_RATIO
    block = grass_rows + road_rows
    if block < min_block:
        scale = min_block / block
        grass_rows *= scale
        road_rows *= scale

    return max(0, js_round(edge_y - grass_rows)), min(h, js_round(edge_y + road_rows))


def erode(m, k):
    half = k // 2
    h, w = m.shape
    out = np.zeros_like(m)
    core = m[half:h - half, half:w - half].copy()
    for dy in range(-half, half + 1):
        for dx in range(-half, half + 1):
            core &= m[half + dy:h - half + dy, half + dx:w - half + dx]
    out[half:h - half, half:w - half] = core
    return out


def dilate(m, k):
    half = k // 2
    h, w = m.shape
    out = np.zeros_like(m)
    core = m[half:h - half, half:w - half]
    for dy in range(-half, half + 1):
        for dx in range(-half, half + 1):
            out[half + dy:h - half + dy, half + dx:w - half + dx] |= core
    return out


def find_boxes(mask, w, y_start, y_end):
    h = mask.shape[0]
    strip = max(1, w // 40)
    x_min = int(w * ROI_X_START_RATIO)
    x_max = int(w * ROI_X_END_RATIO)
    boxes = []
    for sx in range(x_min, x_max, strip):
        col = mask[:, sx:min(sx + strip, x_max)].any(axis=1)
        in_run = False
        run_y = 0
        run_h = 0
        for y in range(y_start, y_end + 1):
            has = bool(col[y]) if y < h else False
            if has and not in_run:
                in_run = True
                run_y = y
                run_h = 1
            elif has:
                run_h += 1
            elif in_run:
                boxes.append((sx, run_y, strip, run_h))
                in_run = False
        if in_run:
            boxes.append((sx, run_y, strip, run_h))
    return boxes


def analisar_imagem(rgb):
    h, w = rgb.shape[:2]
    x_start = int(w * ROI_X_START_RATIO)
    x_end = int(w * ROI_X_END_RATIO)

    grass = grass_mask(rgb)
    y_start, y_end = build_analysis_block(grass, h, x_start, x_end)

    mask = np.zeros((h, w), dtype=bool)
    mask[y_start:y_end, x_start:x_end] = grass[y_start:y_end, x_start:x_end]
    cleaned = dilate(erode(mask, MORPH_KERNEL), MORPH_KERNEL)

    min_area = w * h * 0.0003
    critical = attention = ok = 0
    max_cm = 0.0
    for bx, by, bw, bh in find_boxes(cleaned, w, y_start, y_end):
        cx = bx + bw / 2
        cy = by + bh / 2
        valid = (
            bw * bh > min_area
            and by >= y_start and by + bh <= y_end
            and y_start <= cy <= y_end
            and x_start <= cx <= x_end
            and bw <= w * 0.55
            and bh <= h * 0.18
        )
        if not valid:
            continue
        height_cm = bh * PIXEL_TO_CM
        max_cm = max(max_cm, height_cm)
        if height_cm > LIMITE_CRITICO_CM:
            critical += 1
        elif height_cm >= LIMITE_ATENCAO_CM:
            attention += 1
        else:
            ok += 1
    return {"critical": critical, "attention": attention, "ok": ok, "max": max_cm}


def analisar_bytes(data):
    img = Image.open(io.BytesIO(data)).convert("RGB")
    return analisar_imagem(np.asarray(img))