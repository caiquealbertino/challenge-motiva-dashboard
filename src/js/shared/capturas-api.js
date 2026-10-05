import { API_BASE } from "./api-config.js";

async function getJson(path, params = {}) {
    const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
    ).toString();
    const response = await fetch(`${API_BASE}${path}${qs ? `?${qs}` : ""}`);
    if (!response.ok) throw new Error(`${path} respondeu ${response.status}`);
    return response.json();
}

export const fetchCorridas = () => getJson("/api/corridas");
export const fetchTrechos = (filtros) => getJson("/api/trechos", filtros);
export const fotoSrc = (url) => `${API_BASE}${url}`;
