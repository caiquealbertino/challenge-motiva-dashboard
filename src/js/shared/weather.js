/**
 * weather.js
 * Module responsible for fetching weather data from the Open-Meteo public API.
 * Provides helpers to interpret weather codes and assess risk level.
 */

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";

/**
 * Fetches current weather conditions for a given lat/lon.
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<object>} Current weather data object
 */
export async function fetchWeather(lat, lon) {
    const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        current_weather: true,
        hourly: "precipitation_probability,relative_humidity_2m",
        forecast_days: 1,
    });

    const response = await fetch(`${OPEN_METEO_BASE}?${params}`);

    if (!response.ok) {
        throw new Error(`Open-Meteo API error: ${response.status}`);
    }

    const data = await response.json();
    const weather = data.current_weather;

    // Get current hour index for hourly data
    const currentHour = new Date().getHours();
    const precipProb = data.hourly?.precipitation_probability?.[currentHour] ?? null;
    const humidity   = data.hourly?.relative_humidity_2m?.[currentHour] ?? null;

    return {
        temperature:   weather.temperature,
        windspeed:     weather.windspeed,
        weathercode:   weather.weathercode,
        precipProb,
        humidity,
        label:         decodeWeatherCode(weather.weathercode),
        icon:          weatherIcon(weather.weathercode),
        risk:          assessRisk(weather.temperature, weather.windspeed, precipProb),
    };
}

/**
 * Decodes WMO weather interpretation codes to Portuguese labels.
 * Reference: https://open-meteo.com/en/docs (WMO Weather interpretation codes)
 * @param {number} code
 * @returns {string}
 */
export function decodeWeatherCode(code) {
    const codes = {
        0:  "Céu limpo",
        1:  "Predominantemente limpo",
        2:  "Parcialmente nublado",
        3:  "Nublado",
        45: "Neblina",
        48: "Neblina com gelo",
        51: "Garoa leve",
        53: "Garoa moderada",
        55: "Garoa densa",
        61: "Chuva leve",
        63: "Chuva moderada",
        65: "Chuva forte",
        71: "Neve leve",
        73: "Neve moderada",
        75: "Neve forte",
        80: "Pancadas de chuva leves",
        81: "Pancadas de chuva moderadas",
        82: "Pancadas de chuva violentas",
        95: "Tempestade",
        96: "Tempestade com granizo leve",
        99: "Tempestade com granizo forte",
    };
    return codes[code] ?? `Código ${code}`;
}

/**
 * Returns an emoji icon for the weather code.
 * @param {number} code
 * @returns {string}
 */
export function weatherIcon(code) {
    if (code === 0)                    return "☀️";
    if (code <= 2)                     return "🌤️";
    if (code === 3)                    return "☁️";
    if (code <= 48)                    return "🌫️";
    if (code <= 55)                    return "🌦️";
    if (code <= 65)                    return "🌧️";
    if (code <= 75)                    return "🌨️";
    if (code <= 82)                    return "⛈️";
    if (code >= 95)                    return "🌩️";
    return "🌡️";
}

function assessRisk(temp, windspeed, precipProb) {
    let riskLevel = "low";
    if (temp >= 30 || windspeed >= 40) riskLevel = "high";
    else if (temp >= 25 || windspeed >= 20) riskLevel = "mid";
    if (precipProb !== null && precipProb >= 80) riskLevel = "high";
    return riskLevel;
}
