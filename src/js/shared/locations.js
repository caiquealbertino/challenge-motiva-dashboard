/**
 * locations.js
 * Module responsible for the 10 geographic monitoring points in São Paulo.
 * Each point represents a vegetation/environmental sensor site.
 */

export const LOCATIONS = [
    {
        id: 1,
        name: "Foto Fernão Dias 1",
        type: "Rodovia Fernão Dias",
        lat: -23.3489427,
        lon: -46.5550686,
        description: "Guia da estrada com vegetação de frente e linha de fundo mais distante.",
        grassStats: { critical: 0, attention: 0, ok: 1, max: 36.0 },
    },
    {
        id: 2,
        name: "Foto Fernão Dias 2",
        type: "Rodovia Fernão Dias",
        lat: -23.355216,
        lon: -46.5494565,
        description: "Vegetação lateral mais densa, com faixa de grama ativa na borda.",
        grassStats: { critical: 0, attention: 1, ok: 0, max: 34.0 },
    },
    {
        id: 3,
        name: "Foto Fernão Dias 3",
        type: "Rodovia Fernão Dias",
        lat: -23.3731585,
        lon: -46.5588124,
        description: "Guia de acostamento com crescimento mais elevado, sem misturar a mata do fundo.",
        grassStats: { critical: 1, attention: 0, ok: 0, max: 34.5 },
    }
];
