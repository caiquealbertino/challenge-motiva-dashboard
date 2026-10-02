/**
 * monitor-dashboard.js
 * Renders sidebar cards, stats, badges, and handles custom point appending.
 * Exclusive to the Monitor dashboard tab.
 */

import { flyToLocation } from "./monitor-map.js";

export function initDashboard() {
    document.getElementById("point-list").innerHTML = "";
}

export function renderCard(location, weather, delay = 0) {
    _appendCard(location, weather, delay, false);
}

export function appendCustomCard(location, weather) {
    _appendCard(location, weather, 0, true);
}

function _appendCard(location, weather, delay, isCustom) {
    const list = document.getElementById("point-list");

    const precipHtml = weather.precipProb !== null
        ? `<div class="metric"><span class="metric-val ${precipColor(weather.precipProb)}">${weather.precipProb}%</span><span class="metric-key">Prob. Chuva</span></div>`
        : "";

    const humidHtml = weather.humidity !== null
        ? `<div class="metric"><span class="metric-val">${weather.humidity}%</span><span class="metric-key">Umidade</span></div>`
        : "";

    const customBadge = isCustom
        ? `<span class="custom-badge">Customizado</span>`
        : "";

    const grassMeta = location.grassStats ? `
        <div class="card-grass">
            <span class="card-grass-label">Altura da grama</span>
            <span class="card-grass-value">${location.grassStats.max.toFixed(1)} cm</span>
            <span class="card-grass-desc">${location.description || ""}</span>
        </div>
    ` : "";

    list.querySelector(`.point-card[data-location-id="${location.id}"]`)?.remove();

    const card = document.createElement("div");
    card.className = `point-card risk-${weather.risk}`;
    card.style.animationDelay = `${delay}ms`;
    card.dataset.locationId = location.id;

    card.innerHTML = `
        <div class="card-header">
            <span class="card-name">${location.name} ${customBadge}</span>
            <span class="card-id">#${location.displayId ?? String(location.id).padStart(2, "0")}</span>
        </div>
        <div class="card-coords">${location.lat.toFixed(4)}, ${location.lon.toFixed(4)} · ${location.type}</div>
        <div class="card-metrics">
            <div class="metric">
                <span class="metric-val ${tempColor(weather.temperature)}">${weather.temperature}°C</span>
                <span class="metric-key">Temperatura</span>
            </div>
            <div class="metric">
                <span class="metric-val ${windColor(weather.windspeed)}">${weather.windspeed} km/h</span>
                <span class="metric-key">Vento</span>
            </div>
            ${precipHtml || humidHtml}
        </div>
        ${grassMeta}
        <div class="card-condition">
            <span class="condition-icon">${weather.icon}</span>
            <span>${weather.label}</span>
        </div>
    `;

    card.addEventListener("click", () => flyToLocation(location.id));
    list.appendChild(card);
}

export function removeCard(locationId) {
    document.querySelector(`#point-list .point-card[data-location-id="${locationId}"]`)?.remove();
}

export function renderErrorCard(location) {
    const list = document.getElementById("point-list");
    const card = document.createElement("div");
    card.className = "error-card";
    card.textContent = `#${location.id} ${location.name} — erro ao carregar dados`;
    list.appendChild(card);
}

export function updateStats(weatherResults) {
    const valid = weatherResults.filter(Boolean);
    if (!valid.length) return;

    const avgTemp  = (valid.reduce((s, w) => s + w.temperature, 0) / valid.length).toFixed(1);
    const maxWind  = Math.max(...valid.map(w => w.windspeed));
    const highRisk = valid.filter(w => w.risk === "high").length;

    document.getElementById("stat-avg-temp").textContent = `${avgTemp}°C`;
    document.getElementById("stat-max-wind").textContent = `${maxWind} km/h`;
    document.getElementById("stat-high-risk").textContent = `${highRisk}`;

    const riskEl = document.getElementById("stat-high-risk");
    if (highRisk >= 3)      riskEl.style.color = "var(--red)";
    else if (highRisk >= 1) riskEl.style.color = "var(--amber)";
}

export function updatePointCount(count) {
    document.getElementById("point-count").textContent = String(count);
}

export function setStatusBadge(state, text) {
    const badge = document.getElementById("status-badge");
    badge.className = `badge ${state}`;
    const labels = { loading: "● Carregando…", done: "● Online", error: "● Erro parcial" };
    badge.textContent = text || labels[state];
}

export function updateTimestamp() {
    document.getElementById("last-update").textContent =
        new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function tempColor(t)   { return t >= 35 ? "red" : t >= 28 ? "amber" : ""; }
function windColor(w)   { return w >= 40 ? "red" : w >= 25 ? "amber" : ""; }
function precipColor(p) { return p <= 10 ? "red" : p <= 30 ? "amber" : ""; }
