/**
 * grass-types.js
 * Catalog of grass species relevant to roadside/urban vegetation monitoring.
 * Each type carries a growth multiplier (relative to the model's baseline)
 * and a cutting threshold profile, since some species are naturally taller
 * or grow faster than others.
 * 
 * Shared between grass-analysis and ai-prediction dashboards.
 */

export const GRASS_TYPES = [
    {
        id: "esmeralda",
        name: "Grama Esmeralda",
        growthMultiplier: 1.15,
        thresholdAtencao: 40,
        thresholdCritico: 45,
        description: "Crescimento denso e rápido, comum em áreas urbanas e canteiros.",
    },
    {
        id: "santo_agostinho",
        name: "Grama Santo Agostinho (São Carlos)",
        growthMultiplier: 0.85,
        thresholdAtencao: 40,
        thresholdCritico: 45,
        description: "Crescimento mais lento, tolerante à sombra parcial.",
    },
    {
        id: "bermuda",
        name: "Grama Bermuda",
        growthMultiplier: 1.35,
        thresholdAtencao: 35,
        thresholdCritico: 40,
        description: "Crescimento agressivo, alta resistência a pisoteio, comum em acostamentos.",
    },
    {
        id: "amendoim",
        name: "Grama Amendoim",
        growthMultiplier: 0.7,
        thresholdAtencao: 30,
        thresholdCritico: 35,
        description: "Baixo crescimento vertical, usada como cobertura de solo.",
    },
    {
        id: "capim_nativo",
        name: "Capim / Vegetação Nativa (Acostamento)",
        growthMultiplier: 1.6,
        thresholdAtencao: 40,
        thresholdCritico: 45,
        description: "Vegetação espontânea de rodovias, crescimento rápido e irregular.",
    },
    {
        id: "indefinido",
        name: "Não identificado / Misto",
        growthMultiplier: 1.0,
        thresholdAtencao: 40,
        thresholdCritico: 45,
        description: "Usa a taxa-base do modelo sem ajuste por espécie.",
    },
];

export function getGrassType(id) {
    return GRASS_TYPES.find(g => g.id === id) || GRASS_TYPES[GRASS_TYPES.length - 1];
}
