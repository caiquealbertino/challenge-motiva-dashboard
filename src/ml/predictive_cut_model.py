"""
predictive_cut_model.py
Reference Python implementation of the same predictive logic used in
front-end simulated backend (7/14/30 day cut-need probability).

You can later expose this through FastAPI/Flask with minimal changes.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import exp
from typing import Dict


@dataclass
class GrassType:
    growth_multiplier: float


@dataclass
class Weather:
    temperature: float
    windspeed: float
    humidity: float | None = None
    precip_prob: float | None = None


BASE_RATE_CM_DAY = 0.18

MODEL = {
    "version": "v1-logit",
    "means": {
        "temperature": 22.0,
        "humidity": 60.0,
        "windspeed": 6.0,
        "precipProb": 35.0,
        "currentHeight": 30.0,
        "growthMultiplier": 1.0,
    },
    "scales": {
        "temperature": 8.0,
        "humidity": 20.0,
        "windspeed": 5.0,
        "precipProb": 25.0,
        "currentHeight": 12.0,
        "growthMultiplier": 0.35,
    },
    "horizons": {
        "d7": {"b": -1.25, "w": [0.72, 0.30, -0.26, 0.20, 0.96, 0.88]},
        "d14": {"b": -0.35, "w": [0.78, 0.36, -0.28, 0.25, 1.04, 0.95]},
        "d30": {"b": 0.55, "w": [0.83, 0.40, -0.31, 0.30, 1.12, 1.00]},
    },
}


def clamp(value: float, min_value: float, max_value: float) -> float:
    return min(max_value, max(min_value, value))


def sigmoid(z: float) -> float:
    return 1.0 / (1.0 + exp(-z))


def normalize(name: str, value: float) -> float:
    mean = MODEL["means"][name]
    scale = MODEL["scales"][name]
    return (value - mean) / scale


def compute_growth_rate(weather: Weather, grass_type: GrassType) -> Dict[str, float]:
    temp = weather.temperature
    wind = weather.windspeed
    humidity = weather.humidity
    precip_prob = weather.precip_prob

    temp_factor = 1 + (temp - 22) * 0.045
    temp_factor = clamp(temp_factor, 0.2, 2.2)
    if temp < 8:
        temp_factor = 0.15

    if humidity is not None:
        moisture_basis = humidity
    elif precip_prob is not None:
        moisture_basis = 40 + precip_prob * 0.5
    else:
        moisture_basis = 55

    moisture_factor = 0.5 + (moisture_basis / 100) * 0.9
    moisture_factor = clamp(moisture_factor, 0.45, 1.6)

    wind_factor = 1.0
    if wind > 10:
        wind_factor = max(0.6, 1 - (wind - 10) * 0.012)

    species_factor = grass_type.growth_multiplier

    rate = BASE_RATE_CM_DAY * temp_factor * moisture_factor * wind_factor * species_factor

    return {
        "rate": max(0.01, rate),
        "tempFactor": temp_factor,
        "moistureFactor": moisture_factor,
        "windFactor": wind_factor,
        "speciesFactor": species_factor,
        "moistureBasis": moisture_basis,
    }


def logistic_probability(horizon_model: Dict, features: list[float]) -> float:
    z = horizon_model["b"] + sum(w * x for w, x in zip(horizon_model["w"], features))
    return sigmoid(z)


def monotonic_probabilities(p7: float, p14: float, p30: float) -> Dict[str, float]:
    d7 = clamp(p7, 0.01, 0.99)
    d14 = clamp(max(d7, p14), 0.01, 0.995)
    d30 = clamp(max(d14, p30), 0.01, 0.999)
    return {"d7": d7, "d14": d14, "d30": d30}


def predict_cut_risk(
    weather: Weather,
    grass_type: GrassType,
    current_height: float,
    threshold_cm: float,
) -> Dict:
    factors = compute_growth_rate(weather, grass_type)

    features = [
        normalize("temperature", weather.temperature),
        normalize("humidity", weather.humidity if weather.humidity is not None else MODEL["means"]["humidity"]),
        normalize("windspeed", weather.windspeed),
        normalize("precipProb", weather.precip_prob if weather.precip_prob is not None else MODEL["means"]["precipProb"]),
        normalize("currentHeight", current_height),
        normalize("growthMultiplier", grass_type.growth_multiplier),
    ]

    raw7 = logistic_probability(MODEL["horizons"]["d7"], features)
    raw14 = logistic_probability(MODEL["horizons"]["d14"], features)
    raw30 = logistic_probability(MODEL["horizons"]["d30"], features)

    h7 = current_height + factors["rate"] * 7
    h14 = current_height + factors["rate"] * 14
    h30 = current_height + factors["rate"] * 30

    def calibrate(raw: float, expected: float) -> float:
        margin = (expected - threshold_cm) / 8
        return clamp(raw + sigmoid(margin) * 0.18 - 0.09, 0.01, 0.999)

    c7 = calibrate(raw7, h7)
    c14 = calibrate(raw14, h14)
    c30 = calibrate(raw30, h30)

    probabilities = monotonic_probabilities(c7, c14, c30)

    return {
        "model": MODEL["version"],
        "growthRateCmDay": factors["rate"],
        "probabilities": probabilities,
        "expectedHeights": {"d7": h7, "d14": h14, "d30": h30},
        "factors": factors,
    }


if __name__ == "__main__":
    sample = predict_cut_risk(
        weather=Weather(temperature=26, windspeed=4, humidity=68, precip_prob=45),
        grass_type=GrassType(growth_multiplier=1.15),
        current_height=36.0,
        threshold_cm=40.0,
    )
    print(sample)
