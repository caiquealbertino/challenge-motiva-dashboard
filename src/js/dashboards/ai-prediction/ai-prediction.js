/**
 * ai-prediction.js
 * "IA de Corte" — heuristic growth-prediction engine.
 * Estimates grass growth rate (cm/day) from the point's current weather
 * (temperature, humidity, wind) and projects the date the vegetation
 * will reach the "Atenção" (40cm) and "Crítico" (45cm) thresholds.
 *
 * Model (transparent, rule-based — no black box):
 *   growthRate = BASE_RATE × tempFactor × moistureFactor × windFactor
 *
 *   tempFactor     — grass grows faster in warm weather, stalls below ~10°C
 *   moistureFactor — humidity/rain accelerates growth; drought slows it
 *   windFactor     — sustained strong wind increases evapotranspiration,
 *                     mildly suppressing growth
 */

import { getAllPoints, onPointsChange } from "../../shared/points-store.js";
import { GRASS_TYPES, getGrassType } from "../../shared/grass-types.js";
import { predictCutRisk } from "./predictive-api-client.js";

const PROJECTION_DAYS   = 60;
const PREDICTION_HISTORY_KEY = "motiva-prediction-history";
const PREDICTION_HISTORY_LIMIT = 25;

export function initPrediction() {
    const select     = document.getElementById("predict-point-select");
    const grassEl    = document.getElementById("predict-grass-type");
    const heightEl   = document.getElementById("predict-height");
    const heightHint = document.getElementById("predict-height-hint");
    const btn        = document.getElementById("predict-btn");
    const emptyMsg   = document.getElementById("predict-empty");
    const clearHistoryBtn = document.getElementById("predict-history-clear");

    populateGrassTypes(grassEl);

    const autoFillHeight = (id) => {
        const point = getAllPoints().find(p => String(p.location.id) === String(id));
        const max = point?.location.grassStats?.max;
        if (typeof max === "number" && max > 0) {
            heightEl.value = max.toFixed(1);
            heightEl.classList.remove("input-error");
        } else {
            heightEl.value = "";
            heightHint.textContent = "Este ponto ainda não possui altura detectada por imagem.";
        }
    };

    const refreshSelect = (points) => {
        const prevValue = select.value;
        select.innerHTML = points.length
            ? points.map(p => `<option value="${p.location.id}">${p.location.name} (#${p.location.id})</option>`).join("")
            : `<option value="">Nenhum ponto disponível</option>`;
        if (prevValue && points.some(p => String(p.location.id) === prevValue)) {
            select.value = prevValue;
        }
        select.disabled = points.length === 0;
        btn.disabled = points.length === 0;
        emptyMsg.classList.toggle("hidden", points.length > 0);
        autoFillHeight(select.value);
    };

    refreshSelect(getAllPoints());
    onPointsChange(refreshSelect);
    renderPredictionHistory();

    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener("click", () => {
            localStorage.removeItem(PREDICTION_HISTORY_KEY);
            renderPredictionHistory();
        });
    }

    select.addEventListener("change", () => autoFillHeight(select.value));

    btn.addEventListener("click", async () => {
        const id = select.value;
        const height = Number(heightEl.value);
        const grassType = getGrassType(grassEl.value);

        if (!id) return;
        if (!height || height <= 0 || height > 60) {
            heightEl.classList.add("input-error");
            return;
        }
        heightEl.classList.remove("input-error");

        const point = getAllPoints().find(p => String(p.location.id) === String(id));
        if (!point) return;

        btn.disabled = true;
        btn.textContent = "Processando...";
        try {
            await runPrediction(point, height, grassType);
        } finally {
            btn.disabled = select.disabled;
            btn.textContent = "Gerar Previsão";
        }
    });
}

function populateGrassTypes(selectEl) {
    selectEl.innerHTML = GRASS_TYPES
        .map(g => `<option value="${g.id}">${g.name}</option>`)
        .join("");
}

function addDays(days) {
    const d = new Date();
    d.setDate(d.getDate() + Math.round(days));
    return d;
}

function daysToReach(currentHeight, targetHeight, rate) {
    if (currentHeight >= targetHeight) return 0;
    return (targetHeight - currentHeight) / Math.max(rate, 0.01);
}

function formatDate(date) {
    return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

async function runPrediction(point, currentHeight, grassType) {
    const { location, weather } = point;
    const limiteAtencao = grassType.thresholdAtencao;
    const limiteCritico = grassType.thresholdCritico;

    const prediction = await predictCutRisk({
        weather,
        grassType,
        currentHeight,
        thresholdAttentionCm: limiteAtencao,
        thresholdCriticalCm: limiteCritico,
    });

    const rate = prediction.growthRateCmDay;
    const { factors } = prediction;
    const daysAtencao = Number.isFinite(prediction.daysToAttention)
        ? prediction.daysToAttention
        : daysToReach(currentHeight, limiteAtencao, rate);
    const daysCritico = Number.isFinite(prediction.daysToCritical)
        ? prediction.daysToCritical
        : daysToReach(currentHeight, limiteCritico, rate);

    renderResultCards({
        location,
        grassType,
        currentHeight,
        rate,
        limiteAtencao,
        limiteCritico,
        prediction,
    });
    renderExplanation(weather, factors, grassType);
    renderChart(currentHeight, rate, limiteAtencao, limiteCritico);
    persistPredictionHistory({
        createdAt: new Date().toISOString(),
        locationName: location.name,
        grassName: grassType.name,
        currentHeight,
        daysToAttention: daysAtencao,
        daysToCritical: daysCritico,
        recommendedDate: addDays(daysAtencao).toISOString(),
        source: prediction.source || "unknown",
        model: prediction.model || "unknown",
    });
    renderPredictionHistory();

    document.getElementById("predict-results").classList.remove("hidden");
}

function getPredictionHistory() {
    try {
        const raw = localStorage.getItem(PREDICTION_HISTORY_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function persistPredictionHistory(entry) {
    const history = getPredictionHistory();
    history.unshift(entry);
    const trimmed = history.slice(0, PREDICTION_HISTORY_LIMIT);
    localStorage.setItem(PREDICTION_HISTORY_KEY, JSON.stringify(trimmed));
}

function formatHistoryDate(dateLike) {
    const d = new Date(dateLike);
    if (Number.isNaN(d.getTime())) return "data inválida";
    return d.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function renderPredictionHistory() {
    const container = document.getElementById("predict-history-list");
    if (!container) return;

    const history = getPredictionHistory();
    if (!history.length) {
        container.innerHTML = '<div class="predict-history-empty">Nenhuma previsão salva localmente ainda.</div>';
        return;
    }

    container.innerHTML = history.map((item) => {
        const recommendedDate = formatDate(new Date(item.recommendedDate));
        const generatedAt = formatHistoryDate(item.createdAt);
        const attentionDays = Math.max(0, Math.round(item.daysToAttention || 0));
        return `
            <article class="predict-history-item">
                <div class="predict-history-row">
                    <span class="predict-history-point">${item.locationName}</span>
                    <span class="predict-history-date">${generatedAt}</span>
                </div>
                <div class="predict-history-cut">Corte recomendado: ${recommendedDate} (~${attentionDays} dias)</div>
                <div class="predict-history-meta">${item.grassName} · Altura ${Number(item.currentHeight).toFixed(1)}cm · ${item.source === "python-api" ? "API Python" : "simulado"}</div>
            </article>
        `;
    }).join("");
}

function urgencyClassByDays(days) {
    if (days <= 7) return "urgent-high";
    if (days <= 14) return "urgent-mid";
    return "urgent-low";
}

function renderResultCards({ location, grassType, currentHeight, rate, limiteAtencao, limiteCritico, prediction }) {
    const wrap = document.getElementById("predict-results");

    const daysAtencao = Number.isFinite(prediction.daysToAttention)
        ? prediction.daysToAttention
        : daysToReach(currentHeight, limiteAtencao, rate);
    const daysCritico = Number.isFinite(prediction.daysToCritical)
        ? prediction.daysToCritical
        : daysToReach(currentHeight, limiteCritico, rate);

    const dateAtencao = addDays(daysAtencao);
    const dateCritico = addDays(daysCritico);
    const dateRecommended = addDays(daysAtencao);

    const atencaoClass = urgencyClassByDays(Math.ceil(daysAtencao));
    const criticoClass = urgencyClassByDays(Math.ceil(daysCritico));
    const alreadyAtencao = daysAtencao <= 0;
    const alreadyCritico = daysCritico <= 0;

    wrap.innerHTML = `
        <div class="predict-summary">
            <span class="predict-point-name">📍 ${location.name}</span>
            <span class="predict-grass-tag">🌱 ${grassType.name}</span>
            <span class="predict-rate">Taxa estimada: <strong>${rate.toFixed(3)} cm/dia</strong> (${(rate * 7).toFixed(1)} cm/semana)</span>
        </div>

        <div class="predict-cards">
            <div class="predict-card ${atencaoClass}">
                <span class="predict-card-label">⚠ Nível de Atenção (${limiteAtencao}cm)</span>
                <span class="predict-card-value">${alreadyAtencao ? "já atingido" : `${Math.ceil(daysAtencao)} dias`}</span>
                <span class="predict-card-date">${formatDate(dateAtencao)}</span>
            </div>
            <div class="predict-card ${criticoClass}">
                <span class="predict-card-label">🔴 Nível Crítico (${limiteCritico}cm)</span>
                <span class="predict-card-value">${alreadyCritico ? "já atingido" : `${Math.ceil(daysCritico)} dias`}</span>
                <span class="predict-card-date">${formatDate(dateCritico)}</span>
            </div>
            <div class="predict-card recommend">
                <span class="predict-card-label">✂ Corte recomendado até</span>
                <span class="predict-card-value">${formatDate(dateRecommended)}</span>
                <span class="predict-card-date">Altura atual: ${currentHeight.toFixed(1)}cm</span>
            </div>
        </div>

        <div class="predict-explanation" style="margin-top:.2rem;">
            <strong>Limites de referência:</strong> atenção em ${limiteAtencao}cm e crítico em ${limiteCritico}cm. Altura atual: ${currentHeight.toFixed(1)}cm.
        </div>

        <div class="predict-explanation" style="margin-top:.2rem;">
            <strong>Origem da previsão:</strong> ${prediction.source === "python-api" ? "IA treinada (API Python)" : "Fallback simulado local"}.
        </div>
    `;
}

function renderExplanation(weather, factors, grassType) {
    const el = document.getElementById("predict-explanation");
    const tempLabel = factors.tempFactor >= 1.3 ? "acelerando" : factors.tempFactor <= 0.6 ? "reduzindo" : "estável";
    const moistLabel = factors.moistureFactor >= 1.2 ? "favorecendo" : factors.moistureFactor <= 0.7 ? "restringindo" : "neutra para";
    const windNote = factors.windFactor < 1 ? ` O vento de ${weather.windspeed}km/h também impõe leve estresse hídrico à vegetação.` : "";
    const speciesLabel = factors.speciesFactor > 1 ? "acelera" : factors.speciesFactor < 1 ? "reduz" : "não altera";

    el.innerHTML = `
        <p><strong>🧠 Como a IA chegou nesse número:</strong></p>
        <ul>
            <li>Temperatura de ${weather.temperature}°C está <strong>${tempLabel}</strong> o crescimento (fator ${factors.tempFactor.toFixed(2)}×).</li>
            <li>Condição de umidade (~${Math.round(factors.moistureBasis)}%) está <strong>${moistLabel}</strong> o desenvolvimento (fator ${factors.moistureFactor.toFixed(2)}×).${windNote}</li>
            <li>A espécie <strong>${grassType.name}</strong> ${speciesLabel} a taxa-base (fator ${factors.speciesFactor.toFixed(2)}×) — ${grassType.description}</li>
            <li>O motor preditivo estima uma data aproximada de corte com base no crescimento esperado e exibe uma janela recomendada para planejamento.</li>
        </ul>
    `;
}

function renderChart(currentHeight, rate, limiteAtencao, limiteCritico) {
    const canvas = document.getElementById("predict-chart");
    const W = canvas.clientWidth || 640;
    const H = 220;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const padL = 42, padR = 12, padT = 14, padB = 26;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const maxHeight = Math.max(limiteCritico + 5, currentHeight + rate * PROJECTION_DAYS);
    const scaleX = (day) => padL + (day / PROJECTION_DAYS) * plotW;
    const scaleY = (cm) => padT + plotH - (cm / maxHeight) * plotH;

    // ── Grid ──
    ctx.strokeStyle = "#383047";
    ctx.lineWidth = 1;
    ctx.font = "10px monospace";
    ctx.fillStyle = "#b6adca";
    for (let cm = 0; cm <= maxHeight; cm += 10) {
        const y = scaleY(cm);
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
        ctx.fillText(`${cm}`, 6, y + 3);
    }
    for (let d = 0; d <= PROJECTION_DAYS; d += 10) {
        const x = scaleX(d);
        ctx.fillText(`${d}d`, x - 8, H - padB + 14);
    }

    // ── Threshold lines ──
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "#f2a61f";
    ctx.beginPath(); ctx.moveTo(padL, scaleY(limiteAtencao)); ctx.lineTo(W - padR, scaleY(limiteAtencao)); ctx.stroke();
    ctx.strokeStyle = "#ff4d6d";
    ctx.beginPath(); ctx.moveTo(padL, scaleY(limiteCritico)); ctx.lineTo(W - padR, scaleY(limiteCritico)); ctx.stroke();
    ctx.setLineDash([]);

    // ── Growth curve ──
    ctx.strokeStyle = "#9b5de5";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let d = 0; d <= PROJECTION_DAYS; d++) {
        const h = currentHeight + rate * d;
        const x = scaleX(d), y = scaleY(Math.min(h, maxHeight));
        d === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // ── Current point marker ──
    ctx.fillStyle = "#cba6f7";
    ctx.beginPath();
    ctx.arc(scaleX(0), scaleY(currentHeight), 4, 0, Math.PI * 2);
    ctx.fill();
}
