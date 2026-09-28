import { predictCutRisk as predictCutRiskSimulated } from "./predictive-backend-sim.js";

const DEFAULT_API_BASE = "http://127.0.0.1:8000";

async function predictCutRiskFromApi(payload) {
    const response = await fetch(`${DEFAULT_API_BASE}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`API prediction failed (${response.status}): ${text}`);
    }

    const data = await response.json();

    return {
        model: data.model || "unknown",
        source: "python-api",
        growthRateCmDay: data.growthRateCmDay,
        daysToAttention: data.daysToAttention,
        daysToCritical: data.daysToCritical,
        recommendedCutDays: data.recommendedCutDays,
        probabilities: data.probabilities,
        expectedHeights: data.expectedHeights,
        factors: data.factors,
        schedule: data.schedule,
    };
}

export async function predictCutRisk(payload) {
    try {
        return await predictCutRiskFromApi(payload);
    } catch (error) {
        console.warn("[AI Prediction] API indisponível, usando fallback simulado:", error);
        return predictCutRiskSimulated(payload);
    }
}
