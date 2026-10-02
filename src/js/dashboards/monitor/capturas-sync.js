import { fetchCorridas, fetchTrechos, fotoSrc } from "../../shared/capturas-api.js";
import { fetchWeather } from "../../shared/weather.js";
import { registerPoints, removePoint } from "../../shared/points-store.js";
import { getMapInstance, addOrUpdateMarker, removeMarker } from "./monitor-map.js";
import {
    appendCustomCard, removeCard, updatePointCount, updateStats, setStatusBadge, updateTimestamp,
} from "./monitor-dashboard.js";

const POLL_MS = 15000;
const MAX_CARDS = 30;
const WEATHER_TTL_MS = 30 * 60 * 1000;
const LIMITE_CRITICO_CM = 45;
const LIMITE_ATENCAO_CM = 40;
const FALLBACK_WEATHER = {
    temperature: 22, windspeed: 5, humidity: 60, precipProb: 35,
    icon: "🌤️", label: "Clima indisponível", risk: "low",
};

const weatherCache = new Map();
const rendered = new Map();
let selectEl = null;
let fitted = false;

function riskFromHeight(cm) {
    return cm >= LIMITE_CRITICO_CM ? "high" : cm >= LIMITE_ATENCAO_CM ? "mid" : "low";
}

async function weatherFor(corridaId, lat, lon) {
    const hit = weatherCache.get(corridaId);
    if (hit && Date.now() - hit.at < WEATHER_TTL_MS) return hit.data;
    let data;
    try {
        data = await fetchWeather(lat, lon);
    } catch {
        data = FALLBACK_WEATHER;
    }
    weatherCache.set(corridaId, { at: Date.now(), data });
    return data;
}

function toLocation(t) {
    const shortRun = t.corridaId.slice(0, 6);
    const max = t.alturaMaxCm;
    return {
        id: `cap-${shortRun}${t.id.slice(t.corridaId.length)}`,
        displayId: shortRun,
        name: `Corrida ${shortRun}`,
        type: "Captura do app",
        lat: t.lat,
        lon: t.lng,
        fotoUrl: fotoSrc(t.fotoUrl),
        description: `${t.total} fotos neste trecho, ${t.comMedida} com medida`,
        grassStats: {
            critical: max > LIMITE_CRITICO_CM ? 1 : 0,
            attention: max >= LIMITE_ATENCAO_CM && max <= LIMITE_CRITICO_CM ? 1 : 0,
            ok: max < LIMITE_ATENCAO_CM ? 1 : 0,
            max,
        },
    };
}

function renderSelect(corridas) {
    const atual = selectEl.value;
    selectEl.innerHTML = `<option value="">Todas as corridas</option>` + corridas.map((c) => {
        const quando = new Date(c.fim).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        return `<option value="${c.corridaId}">${quando} · ${c.corridaId.slice(0, 6)} · ${c.total} fotos</option>`;
    }).join("");
    if (atual && corridas.some((c) => c.corridaId === atual)) selectEl.value = atual;
}

async function render(trechos) {
    const medidos = trechos.filter((t) => typeof t.alturaMaxCm === "number");
    const locais = medidos.map(toLocation);
    const vivos = new Set(locais.map((l) => l.id));
    let mudou = false;

    for (const id of [...rendered.keys()]) {
        if (vivos.has(id)) continue;
        removeMarker(id);
        removeCard(id);
        removePoint(id);
        rendered.delete(id);
        mudou = true;
    }

    const entries = [];
    for (let i = 0; i < medidos.length; i++) {
        const t = medidos[i];
        const loc = locais[i];
        const base = await weatherFor(t.corridaId, t.lat, t.lng);
        const weather = { ...base, risk: riskFromHeight(t.alturaMaxCm) };
        const assinatura = `${t.alturaMaxCm}|${t.total}|${t.timestamp}`;
        const anterior = rendered.get(loc.id);
        if (anterior?.assinatura !== assinatura) mudou = true;
        addOrUpdateMarker(loc, weather, true);
        rendered.set(loc.id, { assinatura, loc, weather });
        entries.push({ location: loc, weather });
    }

    if (mudou) {
        registerPoints(entries);
        locais.forEach((l) => removeCard(l.id));
        entries.slice(0, MAX_CARDS).forEach((e) => appendCustomCard(e.location, e.weather));
        updateStats(entries.map((e) => e.weather));
    }

    updatePointCount(document.querySelectorAll(".point-card").length);

    const map = getMapInstance();
    if (!fitted && map && locais.length) {
        map.fitBounds(locais.map((l) => [l.lat, l.lon]), { maxZoom: 15, padding: [40, 40] });
        fitted = true;
    }
}

async function tick(force = false) {
    if (document.hidden && !force) return;
    try {
        renderSelect(await fetchCorridas());
        await render(await fetchTrechos({ corridaId: selectEl.value }));
        setStatusBadge("done");
        updateTimestamp();
    } catch (err) {
        console.warn("[Capturas] API indisponível:", err);
        setStatusBadge("error", "● API offline");
    }
}

export function initCapturasSync() {
    selectEl = document.getElementById("corrida-select");
    if (!selectEl) return;
    selectEl.addEventListener("change", () => {
        fitted = false;
        tick(true);
    });
    tick(true);
    setInterval(() => tick(), POLL_MS);
}
