/**
 * predictive-backend-sim.js
 * Simulates a Python-style prediction backend in-browser.
 * Returns probability of cut need in 7/14/30 days.
 */

const BASE_RATE_CM_DAY = 0.18;

// Coefficients mirror a logistic model that can be re-trained in Python.
const MODEL = {
    version: "v1-logit",
    means: {
        temperature: 22,
        humidity: 60,
        windspeed: 6,
        precipProb: 35,
        currentHeight: 30,
        growthMultiplier: 1,
    },
    scales: {
        temperature: 8,
        humidity: 20,
        windspeed: 5,
        precipProb: 25,
        currentHeight: 12,
        growthMultiplier: 0.35,
    },
    horizons: {
        d7:  { b: -1.25, w: [0.72, 0.30, -0.26, 0.20, 0.96, 0.88] },
        d14: { b: -0.35, w: [0.78, 0.36, -0.28, 0.25, 1.04, 0.95] },
        d30: { b:  0.55, w: [0.83, 0.40, -0.31, 0.30, 1.12, 1.00] },
    },
};

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function sigmoid(z) {
    return 1 / (1 + Math.exp(-z));
}

function normalize(name, value) {
    const mean = MODEL.means[name];
    const scale = MODEL.scales[name] || 1;
    return (value - mean) / scale;
}

function computeGrowthRate(weather, grassType) {
    const temp = weather.temperature;
    const wind = weather.windspeed;
    const humidity = weather.humidity;
    const precipProb = weather.precipProb;

    let tempFactor = 1 + (temp - 22) * 0.045;
    tempFactor = clamp(tempFactor, 0.2, 2.2);
    if (temp < 8) tempFactor = 0.15;

    let moistureBasis;
    if (humidity !== null && humidity !== undefined) {
        moistureBasis = humidity;
    } else if (precipProb !== null && precipProb !== undefined) {
        moistureBasis = 40 + precipProb * 0.5;
    } else {
        moistureBasis = 55;
    }

    let moistureFactor = 0.5 + (moistureBasis / 100) * 0.9;
    moistureFactor = clamp(moistureFactor, 0.45, 1.6);

    let windFactor = 1;
    if (wind > 10) windFactor = Math.max(0.6, 1 - (wind - 10) * 0.012);

    const speciesFactor = grassType.growthMultiplier;
    const rate = BASE_RATE_CM_DAY * tempFactor * moistureFactor * windFactor * speciesFactor;

    return {
        rate: Math.max(0.01, rate),
        tempFactor,
        moistureFactor,
        windFactor,
        speciesFactor,
        moistureBasis,
    };
}

function logisticProbability(horizonModel, features) {
    const z = horizonModel.b + features.reduce((acc, value, index) => acc + value * horizonModel.w[index], 0);
    return sigmoid(z);
}

function monotonicProbabilities(p7, p14, p30) {
    const d7 = clamp(p7, 0.01, 0.99);
    const d14 = clamp(Math.max(d7, p14), 0.01, 0.995);
    const d30 = clamp(Math.max(d14, p30), 0.01, 0.999);
    return { d7, d14, d30 };
}

function expectedHeight(currentHeight, rate, days) {
    return currentHeight + rate * days;
}

function estimateCutSchedule({ currentHeight, thresholdCm, rate, probabilities }) {
    const baseDays = Math.max(0, (thresholdCm - currentHeight) / Math.max(rate, 0.01));

    // Certainty grows when near-term and long-term risks diverge clearly.
    const certainty = clamp(Math.abs(probabilities.d30 - probabilities.d7), 0.15, 0.95);
    const uncertaintyDays = Math.round(clamp((1 - certainty) * 7, 2, 8));

    const estimatedDays = Math.max(0, Math.round(baseDays));
    const windowStartDays = Math.max(0, estimatedDays - uncertaintyDays);
    const windowEndDays = estimatedDays + uncertaintyDays;

    return {
        estimatedDays,
        windowStartDays,
        windowEndDays,
        certainty,
    };
}

function daysToReach(currentHeight, targetHeight, rate) {
    if (currentHeight >= targetHeight) return 0;
    return (targetHeight - currentHeight) / Math.max(rate, 0.01);
}

export async function predictCutRisk({ weather, grassType, currentHeight, thresholdAttentionCm, thresholdCriticalCm }) {
    // Simulate network/backend latency to mimic API behavior.
    await Promise.resolve();

    const factors = computeGrowthRate(weather, grassType);

    const featureVector = [
        normalize("temperature", weather.temperature ?? MODEL.means.temperature),
        normalize("humidity", weather.humidity ?? MODEL.means.humidity),
        normalize("windspeed", weather.windspeed ?? MODEL.means.windspeed),
        normalize("precipProb", weather.precipProb ?? MODEL.means.precipProb),
        normalize("currentHeight", currentHeight),
        normalize("growthMultiplier", grassType.growthMultiplier),
    ];

    const raw7 = logisticProbability(MODEL.horizons.d7, featureVector);
    const raw14 = logisticProbability(MODEL.horizons.d14, featureVector);
    const raw30 = logisticProbability(MODEL.horizons.d30, featureVector);

    const attentionThreshold = thresholdAttentionCm ?? 40;
    const criticalThreshold = thresholdCriticalCm ?? 45;

    const h7 = expectedHeight(currentHeight, factors.rate, 7);
    const h14 = expectedHeight(currentHeight, factors.rate, 14);
    const h30 = expectedHeight(currentHeight, factors.rate, 30);

    // Domain calibration: if expected height exceeds threshold, increase confidence.
    const calibrate = (raw, expected) => {
        const margin = (expected - attentionThreshold) / 8;
        return clamp(raw + sigmoid(margin) * 0.18 - 0.09, 0.01, 0.999);
    };

    const c7 = calibrate(raw7, h7);
    const c14 = calibrate(raw14, h14);
    const c30 = calibrate(raw30, h30);
    const probabilities = monotonicProbabilities(c7, c14, c30);
    const schedule = estimateCutSchedule({
        currentHeight,
        thresholdCm: attentionThreshold,
        rate: factors.rate,
        probabilities,
    });

    const daysToAttention = daysToReach(currentHeight, attentionThreshold, factors.rate);
    const daysToCritical = daysToReach(currentHeight, criticalThreshold, factors.rate);

    return {
        model: MODEL.version,
        source: "simulated",
        growthRateCmDay: factors.rate,
        daysToAttention,
        daysToCritical,
        recommendedCutDays: daysToAttention,
        probabilities,
        schedule,
        expectedHeights: { d7: h7, d14: h14, d30: h30 },
        factors,
    };
}
