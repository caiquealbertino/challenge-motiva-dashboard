/**
 * grass-analysis.js
 * Grass height analysis via browser Canvas API.
 * Ports the OpenCV/Python HSV masking + contour detection logic
 * to pure JavaScript using ImageData pixel manipulation.
 *
 * Algorithm (mirrors the Python script):
 *  1. Decode uploaded image onto a hidden canvas
 *  2. Detect where the gray asphalt (the street the car is on) ends and the green
 *     grass begins, by scanning row-wide grass density from the bottom upward
 *  3. Build the analysis block around that edge with a size that varies per photo:
 *     it grows into the road and into the grass until reaching a 75% road (gray) /
 *     25% vegetation composition, bounded by how much clean road/grass is available
 *  4. Build HSV mask for grass/low vegetation (hue 25–65, sat 40–255, val 80–255) inside the block
 *  5. Morphological opening (erosion then dilation) to remove noise
 *  6. Run-length connected components to simulate contour bounding boxes
 *  7. Estimate height in cm (PIXEL_TO_CM = 0.5) and classify risk
 *  8. Draw mask and annotated result onto two visible canvases
 */

import { addOrUpdateMarker, getMapInstance } from "../monitor/monitor-map.js";
import { appendCustomCard, updatePointCount } from "../monitor/monitor-dashboard.js";
import { registerPoint } from "../../shared/points-store.js";

const PIXEL_TO_CM         = 0.5;
const LIMITE_CRITICO_CM   = 45.0;
const LIMITE_ATENCAO_CM   = 40.0;
const MORPH_KERNEL        = 5;
const ROI_X_START_RATIO   = 0.15;
const ROI_X_END_RATIO     = 0.85;

// Analysis block is anchored on the detected road/grass color edge (end of the street,
// start of the grass) and its height is derived per photo: it grows into the road and
// into the grass until it reaches a 75% road (gray) / 25% vegetation composition,
// bounded by how much clean road/grass each photo actually shows.
const EDGE_SEARCH_Y_START_RATIO  = 0.25;
const EDGE_SEARCH_Y_END_RATIO    = 0.98;
const EDGE_DENSITY_THRESHOLD     = 0.30; // row is considered "grass" once density crosses this
const ROAD_ROW_DENSITY_MAX       = 0.15; // rows below the edge must stay this grass-free to count as road
const GRASS_ROW_DENSITY_MIN      = 0.40; // rows above the edge must be this grass-dense to count as vegetation
const ROAD_BLOCK_SHARE           = 0.85;
const GRASS_BLOCK_SHARE          = 0.15;
const MIN_GRASS_ROWS             = 4;    // safety floor so the block never collapses to near-zero
const MIN_BLOCK_HEIGHT_RATIO     = 0.07; // block is scaled up to at least this share of the photo height
const EXTENT_NOISE_TOLERANCE     = 2;    // consecutive off-color rows allowed before an extent scan stops
const EDGE_FALLBACK_Y_RATIO       = 0.72; // used when the road/grass edge can't be found
const GRASS_HUE_MIN       = 30;
const GRASS_HUE_MAX       = 95;
const GRASS_SAT_MIN       = 30;
const GRASS_VAL_MIN       = 45;
const GRASS_VAL_MAX       = 255;
const DEFAULT_GRASS_EXAMPLES = [
    {
        id: "fernaodias",
        name: "Foto Fernão Dias 1",
        label: "fernaodias",
        image: "img/fernaodias.png",
        coords: { lat: -23.3489427, lon: -46.5550686 },
        description: "Guia da estrada com vegetação de frente e linha de fundo mais distante.",
        stats: { critical: 0, attention: 0, ok: 1, max: 36.0 },
        accent: "#9b5de5",
    },
    {
        id: "fernaodias2",
        name: "Foto Fernão Dias 2",
        label: "fernaodias2",
        image: "img/fernaodias2.png",
        coords: { lat: -23.355216, lon: -46.5494565 },
        description: "Vegetação lateral mais densa, com faixa de grama ativa na borda.",
        stats: { critical: 0, attention: 1, ok: 0, max: 34.0 },
        accent: "#f2a61f",
    },
    {
        id: "fernaodias3",
        name: "Foto Fernão Dias 3",
        label: "fernaodias3",
        image: "img/fernaodias3.png",
        coords: { lat: -23.3731585, lon: -46.5588124 },
        description: "Guia de acostamento com crescimento mais elevado, sem misturar a mata do fundo.",
        stats: { critical: 1, attention: 0, ok: 0, max: 34.5 },
        accent: "#ff4d6d",
    },
];

const GRASS_EXAMPLES_KEY = "vegwatch-grass-examples";

function normalizeExampleImagePath(image, fallback) {
    const value = (image || "").trim();
    if (!value) return fallback;

    // Keep absolute/data URLs untouched.
    if (/^(https?:)?\/\//i.test(value) || value.startsWith("data:")) {
        return value;
    }

    // Normalize local assets to the img/ folder.
    const cleaned = value.replace(/^\.\//, "");
    if (cleaned.startsWith("img/")) return cleaned;

    return `img/${cleaned.replace(/^\/+/, "")}`;
}

function normalizeGrassExample(example, fallbackIndex = 0) {
    const fallback = DEFAULT_GRASS_EXAMPLES[fallbackIndex] || DEFAULT_GRASS_EXAMPLES[0];
    return {
        ...fallback,
        ...example,
        id: example?.id || fallback.id,
        label: example?.label || fallback.label,
        image: normalizeExampleImagePath(example?.image, fallback.image),
        coords: example?.coords || fallback.coords,
        description: example?.description || fallback.description,
        stats: example?.stats || fallback.stats,
        accent: example?.accent || fallback.accent,
    };
}

function getStoredGrassExamples() {
    try {
        const raw = localStorage.getItem(GRASS_EXAMPLES_KEY);
        if (!raw) return DEFAULT_GRASS_EXAMPLES.map((example, index) => normalizeGrassExample(example, index));
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || !parsed.length) {
            return DEFAULT_GRASS_EXAMPLES.map((example, index) => normalizeGrassExample(example, index));
        }
        return parsed.map((example, index) => normalizeGrassExample(example, index));
    } catch {
        return DEFAULT_GRASS_EXAMPLES.map((example, index) => normalizeGrassExample(example, index));
    }
}

function saveGrassExamples(examples) {
    try {
        localStorage.setItem(GRASS_EXAMPLES_KEY, JSON.stringify(examples));
    } catch {
        // ignore storage failures in non-persistent environments
    }
}

export function initGrassAnalysis() {
    const zone      = document.getElementById("upload-zone");
    const input     = document.getElementById("file-input");
    const trigger   = document.getElementById("upload-trigger");
    const workspace = document.getElementById("grass-workspace");
    const resetBtn  = document.getElementById("grass-reset");

    const grassExamples = getStoredGrassExamples();
    saveGrassExamples(grassExamples);
    renderGrassExamples(grassExamples);
    if (grassExamples.length) {
        simulateGrassExample(grassExamples[0]);
    }

    trigger.addEventListener("click", () => input.click());

    zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", (e) => {
        e.preventDefault();
        zone.classList.remove("drag-over");
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith("image/")) processFile(file);
    });

    input.addEventListener("change", () => {
        if (input.files[0]) processFile(input.files[0]);
    });

    resetBtn.addEventListener("click", () => {
        workspace.classList.add("hidden");
        zone.classList.remove("hidden");
        moveExamplesGalleryOutOfWorkspace();
        input.value = "";
    });
}

function renderGrassExamples(examples = getStoredGrassExamples()) {
    const container = document.getElementById("grass-examples");
    if (!container) return;

    container.innerHTML = examples.map((example) => `
        <button class="grass-example-card" data-example-id="${example.id}" type="button">
            <img src="${example.image || "img/fernaodias.png"}" alt="${example.label}" class="grass-example-image" />
            <span class="grass-example-name">${example.label}</span>
            <span class="grass-example-meta">${example.coords.lat.toFixed(7)}, ${example.coords.lon.toFixed(7)}</span>
            <span class="grass-example-desc">${example.description}</span>
        </button>
    `).join("");

    container.querySelectorAll(".grass-example-card").forEach((button) => {
        button.addEventListener("click", () => {
            const example = examples.find((entry) => entry.id === button.dataset.exampleId);
            if (example) simulateGrassExample(example);
        });
    });
}

function moveExamplesGalleryIntoWorkspace() {
    const gallery = document.getElementById("grass-examples");
    const workspace = document.getElementById("grass-workspace");
    const resetBtn = document.getElementById("grass-reset");

    if (!gallery || !workspace || !resetBtn) return;
    if (workspace.contains(gallery)) return;

    workspace.insertBefore(gallery, resetBtn.nextSibling);
}

function moveExamplesGalleryOutOfWorkspace() {
    const gallery = document.getElementById("grass-examples");
    const workspace = document.getElementById("grass-workspace");
    const panel = document.querySelector(".grass-panel");

    if (!gallery || !workspace || !panel) return;
    if (!workspace.contains(gallery)) return;

    panel.insertBefore(gallery, workspace);
}

function simulateGrassExample(example) {
    const zone = document.getElementById("upload-zone");
    const workspace = document.getElementById("grass-workspace");

    if (!zone || !workspace) return;

    const imageSource = example?.image || "img/fernaodias.png";
    const img = new Image();
    img.onload = () => {
        const stats = analyze(img);
        if (stats) syncExampleStats(example, stats);
        moveExamplesGalleryIntoWorkspace();
    };
    img.onerror = () => {
        const fallback = new Image();
        fallback.onload = () => {
            const stats = analyze(fallback);
            if (stats) syncExampleStats(example, stats);
            moveExamplesGalleryIntoWorkspace();
        };
        fallback.src = "img/fernaodias.png";
    };
    img.src = imageSource;
}

// Keeps the stored example and points-store in sync with the latest image analysis,
// so other dashboards (e.g. IA de Corte) always read the real detected height.
function syncExampleStats(example, stats) {
    const examples = getStoredGrassExamples();
    const updated = examples.map((entry) => entry.id === example.id
        ? { ...entry, stats: { critical: stats.critical, attention: stats.attention, ok: stats.ok, max: stats.max } }
        : entry);
    saveGrassExamples(updated);

    const current = updated.find((entry) => entry.id === example.id) || { ...example, stats };
    addGrassExampleMarker(current, false);
}

function processFile(file) {
    const metadata = readUploadMetadata(file);
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const result = analyze(img);
            if (!result) return;

            const example = buildUploadedExample(file, img, result, metadata.coords, metadata.name);
            const examples = [...getStoredGrassExamples(), example];
            saveGrassExamples(examples);
            renderGrassExamples(examples);
            addGrassExampleMarker(example);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function readUploadMetadata(file) {
    const fallbackName = (file?.name || "imagem").replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_ -]/g, "").trim() || `Imagem ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
    const fallbackCoords = (() => {
        const map = getMapInstance();
        const center = map ? map.getCenter() : { lat: -23.5505, lng: -46.6333 };
        return { lat: center.lat, lon: center.lng };
    })();

    const namePrompt = window.prompt("Informe o nome do ponto da imagem:", fallbackName);
    const coordsPrompt = window.prompt("Informe as coordenadas do ponto no formato lat,lon\nExemplo: -23.3489427,-46.5550686", `${fallbackCoords.lat.toFixed(7)},${fallbackCoords.lon.toFixed(7)}`);

    let parsedCoords = fallbackCoords;
    if (coordsPrompt) {
        const trimmed = coordsPrompt.trim();
        const match = trimmed.match(/^\s*([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\s*$/);
        if (match) {
            const lat = Number(match[1]);
            const lon = Number(match[2]);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
                parsedCoords = { lat, lon };
            }
        }
    }

    return {
        name: (namePrompt && namePrompt.trim()) ? namePrompt.trim() : fallbackName,
        coords: parsedCoords,
    };
}

function buildUploadedExample(file, img, stats, coords, nameOverride) {
    const sanitizedName = (nameOverride || file?.name || "imagem").replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_ -]/g, "").trim() || `Imagem ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;

    return {
        id: `upload-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        name: sanitizedName,
        label: sanitizedName,
        image: img.src,
        coords: { lat: coords.lat, lon: coords.lon },
        description: `Imagem enviada manualmente com análise de grama. Altura máxima registrada: ${stats.max.toFixed(1)} cm.`,
        stats: {
            critical: stats.critical,
            attention: stats.attention,
            ok: stats.ok,
            max: stats.max,
        },
    };
}

function addGrassExampleMarker(example, flyTo = true) {
    const map = getMapInstance();
    if (!map || !example?.coords) return;

    const stats = example.stats || { critical: 0, attention: 0, ok: 0, max: 0 };
    const risk = stats.max >= LIMITE_CRITICO_CM ? "high" : stats.max >= LIMITE_ATENCAO_CM ? "mid" : "low";
    const weather = {
        temperature: 15.5,
        windspeed: 3.1,
        precipProb: 17,
        humidity: 61,
        icon: "⛈️",
        label: "Pancadas de chuva leves",
        risk,
    };

    const location = {
        id: example.id || `grass-${Date.now()}`,
        name: example.name || example.label || "Ponto da grama",
        type: "Análise de grama",
        lat: example.coords.lat,
        lon: example.coords.lon,
        description: example.description || "",
        grassStats: {
            critical: stats.critical,
            attention: stats.attention,
            ok: stats.ok,
            max: stats.max,
        },
    };

    addOrUpdateMarker(location, weather, true);
    appendCustomCard(location, weather);
    registerPoint(location, weather);

    const totalCards = document.querySelectorAll(".point-card").length + document.querySelectorAll(".error-card").length;
    updatePointCount(totalCards);

    if (flyTo) map.flyTo([location.lat, location.lon], 12, { duration: 1 });
}

function analyze(img) {
    const W = img.naturalWidth;
    const H = img.naturalHeight;

    const offscreen = document.createElement("canvas");
    offscreen.width = W; offscreen.height = H;
    const ctx = offscreen.getContext("2d");
    ctx.drawImage(img, 0, 0);

    const { data: pixels } = ctx.getImageData(0, 0, W, H);

    const xStart = Math.floor(W * ROI_X_START_RATIO);
    const xEnd   = Math.floor(W * ROI_X_END_RATIO);

    const { yStart, yEnd } = buildAnalysisBlock(pixels, W, H, xStart, xEnd);

    // ── Build binary mask only in the front roadside vegetation strip ──
    const mask = new Uint8Array(W * H);

    for (let y = yStart; y < yEnd; y++) {
        for (let x = xStart; x < xEnd; x++) {
            const i = (y * W + x) * 4;
            if (isGrassPixel(pixels[i], pixels[i + 1], pixels[i + 2])) {
                mask[y * W + x] = 1;
            }
        }
    }

    // ── Morphological opening (erosion → dilation) ──
    const eroded  = erode(mask, W, H, MORPH_KERNEL);
    const cleaned = dilate(eroded, W, H, MORPH_KERNEL);

    // ── Find bounding boxes via row/col scanning ──
    const boxes = findBoundingBoxes(cleaned, W, H, yStart, yEnd);

    // ── Filter by minimum area and keep only the front roadside vegetation strip ──
    const minArea = W * H * 0.0003;
    const validBoxes = boxes.filter((b) => {
        const boxTop = b.y;
        const boxBottom = b.y + b.h;
        const boxCenterX = b.x + b.w / 2;
        const boxCenterY = b.y + b.h / 2;
        return (
            b.w * b.h > minArea &&
            boxTop >= yStart &&
            boxBottom <= yEnd &&
            boxCenterY >= yStart &&
            boxCenterY <= yEnd &&
            boxCenterX >= xStart &&
            boxCenterX <= xEnd &&
            b.w <= W * 0.55 &&
            b.h <= H * 0.18
        );
    });

    // ── Classify and render ──
    return renderResults(img, W, H, cleaned, validBoxes, yStart, yEnd);
}

// A pixel looks like grass under the same HSV thresholds used for masking.
function isGrassPixel(r, g, b) {
    const [h, s, v] = rgbToHsv(r, g, b);
    return h >= GRASS_HUE_MIN && h <= GRASS_HUE_MAX && s >= GRASS_SAT_MIN && v >= GRASS_VAL_MIN && v <= GRASS_VAL_MAX;
}

// Fraction of sampled pixels in a row that look like grass (row-wide, so noise from a
// single pothole/shadow/dashed line doesn't derail the reading like per-column scans did).
function rowGrassDensity(pixels, W, y, xStart, xEnd, step) {
    let hits = 0, samples = 0;
    for (let x = xStart; x < xEnd; x += step) {
        const i = (y * W + x) * 4;
        if (isGrassPixel(pixels[i], pixels[i + 1], pixels[i + 2])) hits++;
        samples++;
    }
    return samples > 0 ? hits / samples : 0;
}

// Scans upward from the street the car is on until row density crosses the grass
// threshold: that row is where the pavement ends and the vegetation begins.
function detectEdgeY(pixels, W, H, xStart, xEnd, step) {
    const searchYStart = Math.floor(H * EDGE_SEARCH_Y_START_RATIO);
    const searchYEnd   = Math.min(H - 1, Math.floor(H * EDGE_SEARCH_Y_END_RATIO));

    for (let y = searchYEnd; y >= searchYStart; y--) {
        if (rowGrassDensity(pixels, W, y, xStart, xEnd, step) >= EDGE_DENSITY_THRESHOLD) {
            return y;
        }
    }
    return -1;
}

// Counts consecutive rows below the edge (deeper into the street) that stay road-clean,
// tolerating a few noisy rows (shadows, tire marks) so the scan doesn't stop too early.
function measureRoadExtent(pixels, W, H, edgeY, xStart, xEnd, step) {
    let rows = 0, badStreak = 0;
    for (let y = edgeY + 1; y < H; y++) {
        if (rowGrassDensity(pixels, W, y, xStart, xEnd, step) > ROAD_ROW_DENSITY_MAX) {
            badStreak++;
            if (badStreak > EXTENT_NOISE_TOLERANCE) break;
        } else {
            badStreak = 0;
        }
        rows++;
    }
    return rows;
}

// Counts consecutive rows above the edge (into the foreground grass) that stay grass-dense,
// tolerating a few noisy rows before considering the vegetation strip over.
function measureGrassExtent(pixels, W, edgeY, xStart, xEnd, step) {
    let rows = 0, badStreak = 0;
    for (let y = edgeY - 1; y >= 0; y--) {
        if (rowGrassDensity(pixels, W, y, xStart, xEnd, step) < GRASS_ROW_DENSITY_MIN) {
            badStreak++;
            if (badStreak > EXTENT_NOISE_TOLERANCE) break;
        } else {
            badStreak = 0;
        }
        rows++;
    }
    return rows;
}

// Builds the analysis block per photo: 75% of its height sits on the road side of the
// edge and 25% on the grass side, sized by how much clean road/grass each photo has.
function buildAnalysisBlock(pixels, W, H, xStart, xEnd) {
    const step = Math.max(1, Math.floor((xEnd - xStart) / 120));
    const edgeY = detectEdgeY(pixels, W, H, xStart, xEnd, step);

    if (edgeY < 0) {
        const fallbackY = Math.floor(H * EDGE_FALLBACK_Y_RATIO);
        const fallbackGrassRows = Math.round(H * 0.045);
        return {
            yStart: Math.max(0, fallbackY - fallbackGrassRows),
            yEnd: Math.min(H, fallbackY + Math.round(fallbackGrassRows * (ROAD_BLOCK_SHARE / GRASS_BLOCK_SHARE))),
        };
    }

    const roadExtent  = measureRoadExtent(pixels, W, H, edgeY, xStart, xEnd, step);
    const grassExtent = Math.max(MIN_GRASS_ROWS, measureGrassExtent(pixels, W, edgeY, xStart, xEnd, step));

    let grassRows = Math.max(MIN_GRASS_ROWS, Math.min(grassExtent, roadExtent / (ROAD_BLOCK_SHARE / GRASS_BLOCK_SHARE)));
    let roadRows  = grassRows * (ROAD_BLOCK_SHARE / GRASS_BLOCK_SHARE);

    // Scale both sides up (keeping the 75/25 ratio) if the natural extents are too thin.
    const minBlockHeight = H * MIN_BLOCK_HEIGHT_RATIO;
    const blockHeight = grassRows + roadRows;
    if (blockHeight < minBlockHeight) {
        const scale = minBlockHeight / blockHeight;
        grassRows *= scale;
        roadRows  *= scale;
    }

    return {
        yStart: Math.max(0, Math.round(edgeY - grassRows)),
        yEnd: Math.min(H, Math.round(edgeY + roadRows)),
    };
}

// ── RGB → HSV (H: 0–179 like OpenCV, S/V: 0–255) ──
function rgbToHsv(r, g, b) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
        if      (max === rn) h = ((gn - bn) / d + 6) % 6;
        else if (max === gn) h = (bn - rn) / d + 2;
        else                 h = (rn - gn) / d + 4;
        h = h / 6;
    }
    return [
        Math.round(h * 179),
        max === 0 ? 0 : Math.round((d / max) * 255),
        Math.round(max * 255),
    ];
}

function erode(mask, W, H, k) {
    const half   = Math.floor(k / 2);
    const result = new Uint8Array(W * H);
    for (let y = half; y < H - half; y++) {
        for (let x = half; x < W - half; x++) {
            let ok = true;
            outer: for (let dy = -half; dy <= half; dy++) {
                for (let dx = -half; dx <= half; dx++) {
                    if (!mask[(y + dy) * W + (x + dx)]) { ok = false; break outer; }
                }
            }
            if (ok) result[y * W + x] = 1;
        }
    }
    return result;
}

function dilate(mask, W, H, k) {
    const half   = Math.floor(k / 2);
    const result = new Uint8Array(W * H);
    for (let y = half; y < H - half; y++) {
        for (let x = half; x < W - half; x++) {
            if (mask[y * W + x]) {
                for (let dy = -half; dy <= half; dy++) {
                    for (let dx = -half; dx <= half; dx++) {
                        result[(y + dy) * W + (x + dx)] = 1;
                    }
                }
            }
        }
    }
    return result;
}

// Simplified column-strip bounding-box detection
function findBoundingBoxes(mask, W, H, yStart, yEnd) {
    const STRIP_W = Math.max(1, Math.floor(W / 40));
    const boxes   = [];

    const xMin = Math.floor(W * ROI_X_START_RATIO);
    const xMax = Math.floor(W * ROI_X_END_RATIO);

    for (let sx = xMin; sx < xMax; sx += STRIP_W) {
        let inRun = false, runY = 0, runH = 0;

        for (let y = yStart; y <= yEnd; y++) {
            const hasMask = (() => {
                for (let x = sx; x < Math.min(sx + STRIP_W, xMax); x++) {
                    if (mask[y * W + x]) return true;
                }
                return false;
            })();

            if (hasMask && !inRun) { inRun = true; runY = y; runH = 1; }
            else if (hasMask)      { runH++; }
            else if (inRun)        {
                boxes.push({ x: sx, y: runY, w: STRIP_W, h: runH });
                inRun = false;
            }
        }
        if (inRun) boxes.push({ x: sx, y: runY, w: STRIP_W, h: runH });
    }

    return boxes;
}

function renderResults(img, W, H, mask, boxes, yStart, yEnd) {
    const SCALE = Math.min(1, 700 / W);
    const DW = Math.round(W * SCALE);
    const DH = Math.round(H * SCALE);

    // ── Mask canvas ──
    const maskCanvas = document.getElementById("canvas-mask");
    maskCanvas.width = DW; maskCanvas.height = DH;
    const mCtx = maskCanvas.getContext("2d");
    const mData = mCtx.createImageData(DW, DH);

    for (let y = 0; y < DH; y++) {
        for (let x = 0; x < DW; x++) {
            const sy = Math.floor(y / SCALE), sx = Math.floor(x / SCALE);
            const v  = mask[sy * W + sx] ? 255 : 0;
            const i  = (y * DW + x) * 4;
            mData.data[i] = mData.data[i+1] = mData.data[i+2] = v;
            mData.data[i+3] = 255;
        }
    }
    mCtx.putImageData(mData, 0, 0);

    // ROI lines on mask
    mCtx.strokeStyle = "#ffff00"; mCtx.lineWidth = 1.5;
    mCtx.beginPath(); mCtx.moveTo(0, yStart * SCALE); mCtx.lineTo(DW, yStart * SCALE); mCtx.stroke();
    mCtx.beginPath(); mCtx.moveTo(0, yEnd   * SCALE); mCtx.lineTo(DW, yEnd   * SCALE); mCtx.stroke();

    // ── Result canvas ──
    const resCanvas = document.getElementById("canvas-result");
    resCanvas.width = DW; resCanvas.height = DH;
    const rCtx = resCanvas.getContext("2d");
    rCtx.drawImage(img, 0, 0, DW, DH);

    let critical = 0, attention = 0, ok = 0, maxCm = 0;

    rCtx.font = `bold ${Math.max(9, Math.round(11 * SCALE))}px monospace`;

    for (const box of boxes) {
        const heightCm = box.h * PIXEL_TO_CM;
        if (heightCm > maxCm) maxCm = heightCm;

        let color, label;
        if (heightCm > LIMITE_CRITICO_CM) {
            color = "#ff0000"; label = `CRITICO: ${heightCm.toFixed(1)}cm`; critical++;
        } else if (heightCm >= LIMITE_ATENCAO_CM) {
            color = "#ffa500"; label = `ATENCAO: ${heightCm.toFixed(1)}cm`; attention++;
        } else {
            color = "#00ff00"; label = `OK: ${heightCm.toFixed(1)}cm`; ok++;
        }

        const bx = box.x * SCALE, by = box.y * SCALE;
        const bw = box.w * SCALE, bh = box.h * SCALE;

        rCtx.strokeStyle = color; rCtx.lineWidth = 1.5;
        rCtx.strokeRect(bx, by, bw, bh);
        rCtx.fillStyle = color;
        rCtx.fillText(label, bx, Math.max(12, by - 3));
    }

    // ROI lines on result
    rCtx.strokeStyle = "#ffff00"; rCtx.lineWidth = 1.5; rCtx.setLineDash([4, 4]);
    rCtx.beginPath(); rCtx.moveTo(0, yStart * SCALE); rCtx.lineTo(DW, yStart * SCALE); rCtx.stroke();
    rCtx.beginPath(); rCtx.moveTo(0, yEnd   * SCALE); rCtx.lineTo(DW, yEnd   * SCALE); rCtx.stroke();
    rCtx.setLineDash([]);

    // ── Update stats ──
    document.getElementById("gs-critical").textContent = critical;
    document.getElementById("gs-attention").textContent = attention;
    document.getElementById("gs-ok").textContent = ok;
    document.getElementById("gs-max").textContent = maxCm > 0 ? `${maxCm.toFixed(1)} cm` : "—";

    document.getElementById("gs-critical").style.color = critical > 0 ? "var(--red)"   : "";
    document.getElementById("gs-attention").style.color = attention > 0 ? "var(--amber)" : "";

    document.getElementById("upload-zone").classList.add("hidden");
    document.getElementById("grass-workspace").classList.remove("hidden");

    return { critical, attention, ok, max: maxCm };
}
