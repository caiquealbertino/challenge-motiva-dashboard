/**
 * monitor-map.js
 * Leaflet map initialization, marker management, and click-to-add-point feature.
 */

let mapInstance = null;
const markerRegistry = new Map();

let onMapClickCallback = null;
let pendingMarker = null;

export function initMap() {
    mapInstance = L.map("map", {
        center: [-23.5505, -46.6333],
        zoom: 11,
        zoomControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
    }).addTo(mapInstance);

    mapInstance.on("click", (e) => {
        if (onMapClickCallback) {
            onMapClickCallback(e.latlng);
        }
    });

    return mapInstance;
}

export function getMapInstance() {
    return mapInstance;
}

export function onMapClick(cb) {
    onMapClickCallback = cb;
}

export function showPendingMarker(lat, lon) {
    if (pendingMarker) pendingMarker.remove();
    pendingMarker = L.circleMarker([lat, lon], {
        radius: 10,
        color: "#cba6f7",
        fillColor: "#9b5de5",
        fillOpacity: 0.5,
        dashArray: "4 4",
        weight: 2,
    }).addTo(mapInstance);
}

export function clearPendingMarker() {
    if (pendingMarker) {
        pendingMarker.remove();
        pendingMarker = null;
    }
}

function createMarkerIcon(risk, isCustom = false) {
    const colors = {
        low:  { border: "#9b5de5", fill: "#3c2754" },
        mid:  { border: "#f2a61f", fill: "#4d3a1a" },
        high: { border: "#ff4d6d", fill: "#4d1520" },
    };
    const c = colors[risk] || colors.low;
    const shape = isCustom
        ? `border-radius: 50%; width:26px; height:26px;`
        : `border-radius: 50% 50% 50% 0; width:26px; height:26px; transform: rotate(-45deg);`;

    return L.divIcon({
        className: "",
        html: `
            <div style="
                ${shape}
                border: 2px solid ${c.border};
                background: ${c.fill};
                box-shadow: 0 0 8px ${c.border}88;
                display: flex; align-items: center; justify-content: center;
            ">
                <div style="
                    width: 9px; height: 9px; border-radius: 50%;
                    background: ${c.border};
                    ${!isCustom ? "transform: rotate(45deg);" : ""}
                "></div>
            </div>`,
        iconSize:    [26, 26],
        iconAnchor:  [13, 26],
        popupAnchor: [0, -28],
    });
}

function buildPopup(location, weather) {
    return `
        <div class="popup-title">${location.name}</div>
        <div style="font-size:.68rem; color:var(--text-muted); margin-bottom:.4rem;">${location.type}</div>
        <div class="popup-row"><span>Temperatura</span><span class="popup-val">${weather.temperature}°C</span></div>
        <div class="popup-row"><span>Vento</span><span class="popup-val">${weather.windspeed} km/h</span></div>
        ${weather.precipProb !== null ? `<div class="popup-row"><span>Prob. Chuva</span><span class="popup-val">${weather.precipProb}%</span></div>` : ""}
        ${weather.humidity !== null ? `<div class="popup-row"><span>Humidade</span><span class="popup-val">${weather.humidity}%</span></div>` : ""}
        <div style="margin-top:.5rem; font-size:.72rem; color:var(--text-secondary);">${weather.icon} ${weather.label}</div>
    `;
}

export function addOrUpdateMarker(location, weather, isCustom = false) {
    if (!mapInstance) return;
    const icon = createMarkerIcon(weather.risk, isCustom);
    const popup = buildPopup(location, weather);

    if (markerRegistry.has(location.id)) {
        const m = markerRegistry.get(location.id);
        m.setIcon(icon);
        m.getPopup().setContent(popup);
    } else {
        const marker = L.marker([location.lat, location.lon], { icon })
            .addTo(mapInstance)
            .bindPopup(popup, { maxWidth: 220 });
        markerRegistry.set(location.id, marker);
    }
}

export function flyToLocation(locationId) {
    const marker = markerRegistry.get(locationId);
    if (!marker || !mapInstance) return;
    mapInstance.flyTo(marker.getLatLng(), 14, { duration: 1 });
    marker.openPopup();
}
