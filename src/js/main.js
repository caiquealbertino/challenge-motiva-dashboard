/**
 * main.js
 * Application entry point — orchestrates map, weather, dashboard, tabs, and custom points.
 * Imports modules from reorganized dashboards structure.
 */

import { initGrassAnalysis } from "./dashboards/grass-analysis/grass-analysis.js";
import { LOCATIONS }       from "./shared/locations.js";
import { fetchWeather }    from "./shared/weather.js";
import { initMap, getMapInstance, addOrUpdateMarker, onMapClick, showPendingMarker, clearPendingMarker } from "./dashboards/monitor/monitor-map.js";
import {
    initDashboard, renderCard, renderErrorCard,
    updateStats, updatePointCount, setStatusBadge, updateTimestamp,
    appendCustomCard,
} from "./dashboards/monitor/monitor-dashboard.js";
import { registerPoint } from "./shared/points-store.js";
import { initPrediction } from "./dashboards/ai-prediction/ai-prediction.js";
import { initCapturasSync } from "./dashboards/monitor/capturas-sync.js";

const weatherResults = [];
let customIdCounter  = 100;
let pendingLatLng    = null;

async function init() {
    initMap();
    initDashboard();
    setStatusBadge("loading");
    initTabs();
    initCustomPointFlow();
    initGrassAnalysis();
    seedGrassExamplesOnMap();
    initPrediction();
    initCapturasSync();
    // Monitor only image-analysis points from now on.
    updatePointCount(0);
    setStatusBadge("done");
    updateTimestamp();
}

function seedGrassExamplesOnMap() {
    const key = "vegwatch-grass-examples";
    const examples = (() => {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return [
                { id: "fernaodias", name: "Foto Fernão Dias 1", label: "fernaodias", image: "img/fernaodias.png", coords: { lat: -23.3489427, lon: -46.5550686 }, description: "Guia da estrada com vegetação de frente e linha de fundo mais distante.", stats: { critical: 0, attention: 0, ok: 1, max: 36.0 }, accent: "#9b5de5" },
                { id: "fernaodias2", name: "Foto Fernão Dias 2", label: "fernaodias2", image: "img/fernaodias2.png", coords: { lat: -23.355216, lon: -46.5494565 }, description: "Vegetação lateral mais densa, com faixa de grama ativa na borda.", stats: { critical: 0, attention: 1, ok: 0, max: 34.0 }, accent: "#f2a61f" },
                { id: "fernaodias3", name: "Foto Fernão Dias 3", label: "fernaodias3", image: "img/fernaodias3.png", coords: { lat: -23.3731585, lon: -46.5588124 }, description: "Guia de acostamento com crescimento mais elevado, sem misturar a mata do fundo.", stats: { critical: 1, attention: 0, ok: 0, max: 34.5 }, accent: "#ff4d6d" },
            ];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) && parsed.length ? parsed : [];
        } catch {
            return [];
        }
    })();

    if (!examples.length) return;

    const map = getMapInstance();
    if (!map) return;

    examples.forEach((example) => {
        const coords = example.coords || { lat: example.lat, lon: example.lon };
        const stats = example.stats || { critical: 0, attention: 0, ok: 0, max: 0 };
        const risk = stats.max >= 45 ? "high" : stats.max >= 40 ? "mid" : "low";
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
            id: example.id || `grass-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
            name: example.name || example.label || "Ponto da grama",
            type: "Análise de grama",
            lat: coords.lat,
            lon: coords.lon,
            description: example.description || "",
            grassStats: {
                critical: stats.critical || 0,
                attention: stats.attention || 0,
                ok: stats.ok || 0,
                max: stats.max || 0,
            },
        };

        addOrUpdateMarker(location, weather, true);
        appendCustomCard(location, weather);
        registerPoint(location, weather);
        weatherResults.push(weather);
    });

    updateStats(weatherResults.filter(Boolean));
    updatePointCount(examples.length);
}

async function loadDefaultLocations() {
    // Default sample points were removed from the monitor view.
    // Only image-analysis points are kept in the map/list.
    updatePointCount(0);
    updateStats([]);
    setStatusBadge("done");
    updateTimestamp();
    return;
}

function initTabs() {
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
        });
    });
}

function initCustomPointFlow() {
    const overlay  = document.getElementById("modal-overlay");
    const coordsEl = document.getElementById("modal-coords");
    const nameEl   = document.getElementById("modal-name");
    const typeEl   = document.getElementById("modal-type");
    const hint     = document.getElementById("map-hint");

    onMapClick((latlng) => {
        pendingLatLng = latlng;
        showPendingMarker(latlng.lat, latlng.lng);
        coordsEl.textContent = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
        nameEl.value = "";
        overlay.classList.remove("hidden");
    });

    const closeModal = () => {
        overlay.classList.add("hidden");
        clearPendingMarker();
        pendingLatLng = null;
    };

    document.getElementById("modal-close").addEventListener("click", closeModal);
    document.getElementById("modal-cancel").addEventListener("click", closeModal);

    document.getElementById("modal-confirm").addEventListener("click", async () => {
        if (!pendingLatLng) return;

        const name = nameEl.value.trim() || "Ponto Customizado";
        const type = typeEl.value;
        const id   = ++customIdCounter;

        const loc = {
            id,
            name,
            type,
            lat: pendingLatLng.lat,
            lon: pendingLatLng.lng,
        };

        closeModal();

        try {
            setStatusBadge("loading", "● Carregando ponto…");
            const weather = await fetchWeather(loc.lat, loc.lon);
            addOrUpdateMarker(loc, weather, true);
            appendCustomCard(loc, weather);
            weatherResults.push(weather);
            updateStats(weatherResults.filter(Boolean));
            registerPoint(loc, weather);
            setStatusBadge("done");
            updateTimestamp();
            hint.textContent = `✅ "${name}" adicionado! Clique novamente para mais pontos.`;
            setTimeout(() => { hint.textContent = "🖱️ Clique no mapa para adicionar um ponto"; }, 3000);
        } catch (err) {
            console.error("[VegWatch] Erro ao carregar ponto customizado:", err);
            setStatusBadge("error");
        }
    });
}

init();

// ── Grass tab bootstrap (imported separately but needs DOM ready) ──
