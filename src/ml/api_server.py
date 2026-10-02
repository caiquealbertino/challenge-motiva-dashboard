"""
api_server.py
FastAPI inference server for trained grass-cut prediction model.

Run:
  uvicorn src.ml.api_server:app --reload --port 8000
"""

from __future__ import annotations

import hmac
import json
import os
import re
import sqlite3
from datetime import datetime
from math import exp
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from src.ml.grass_analysis import LIMITE_ATENCAO_CM, LIMITE_CRITICO_CM, analisar_bytes

MODEL_PATH = Path("src/ml/model_bundle.joblib")
DB_PATH = Path("src/ml/local_predictions.db")
CAPTURES_DIR = Path("src/ml/capturas")
RUN_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")
MAX_PHOTO_BYTES = 8 * 1024 * 1024
API_KEY = os.getenv("MOTIVA_API_KEY", "")
CORS_ORIGINS = [o.strip() for o in os.getenv("MOTIVA_CORS_ORIGINS", "").split(",") if o.strip()]
CORS_ORIGIN_REGEX = r"http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?"
BASE_RATE_CM_DAY = 0.18

app = FastAPI(title="Motiva Predictive API", version="1.0.0")

CAPTURES_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/capturas", StaticFiles(directory=CAPTURES_DIR), name="capturas")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class WeatherInput(BaseModel):
    temperature: float
    humidity: Optional[float] = None
    windspeed: float
    precipProb: Optional[float] = None


class GrassTypeInput(BaseModel):
    growthMultiplier: float


class PredictRequest(BaseModel):
    weather: WeatherInput
    grassType: GrassTypeInput
    currentHeight: float
    thresholdAttentionCm: float = 40.0
    thresholdCriticalCm: float = 45.0


_bundle_cache = None


def clamp(value: float, min_value: float, max_value: float) -> float:
    return min(max_value, max(min_value, value))


def sigmoid(z: float) -> float:
    return 1.0 / (1.0 + exp(-z))


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS prediction_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                model TEXT NOT NULL,
                source TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                result_json TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS capturas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                corrida_id TEXT NOT NULL,
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                timestamp INTEGER NOT NULL,
                caminho TEXT NOT NULL,
                altura_cm REAL,
                recebida_em TEXT NOT NULL,
                UNIQUE (corrida_id, timestamp)
            )
            """
        )
        conn.commit()


def save_prediction(model_name: str, source: str, payload: PredictRequest, result: dict) -> int:
    payload_json = payload.model_dump_json()
    result_json = json.dumps(result, ensure_ascii=False)
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute(
            """
            INSERT INTO prediction_history (created_at, model, source, payload_json, result_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            (datetime.utcnow().isoformat(), model_name, source, payload_json, result_json),
        )
        conn.commit()
        return int(cur.lastrowid)


def load_bundle():
    global _bundle_cache
    if _bundle_cache is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(
                f"Model bundle not found at {MODEL_PATH}. Train it first with train_cut_model.py"
            )
        _bundle_cache = joblib.load(MODEL_PATH)
    return _bundle_cache


def build_features(payload: PredictRequest, feature_names: list[str]) -> np.ndarray:
    temp = payload.weather.temperature
    humidity = payload.weather.humidity if payload.weather.humidity is not None else 60.0
    windspeed = payload.weather.windspeed
    precip_prob = payload.weather.precipProb if payload.weather.precipProb is not None else 35.0
    current_height = payload.currentHeight
    growth_multiplier = payload.grassType.growthMultiplier
    threshold_attention = payload.thresholdAttentionCm
    threshold_critical = payload.thresholdCriticalCm

    values = {
        "temperature": temp,
        "humidity": humidity,
        "windspeed": windspeed,
        "precip_prob": precip_prob,
        "current_height": current_height,
        "growth_multiplier": growth_multiplier,
        "threshold_attention": threshold_attention,
        "threshold_critical": threshold_critical,
        "humidity_x_temp": humidity * temp,
        "wind_x_temp": windspeed * temp,
        "height_to_attention_gap": threshold_attention - current_height,
        "height_to_critical_gap": threshold_critical - current_height,
    }

    return np.array([[values[name] for name in feature_names]], dtype=float)


def compute_weather_factors(payload: PredictRequest) -> dict:
    temp = payload.weather.temperature
    wind = payload.weather.windspeed
    humidity = payload.weather.humidity
    precip_prob = payload.weather.precipProb

    temp_factor = 1 + (temp - 22) * 0.045
    temp_factor = clamp(temp_factor, 0.2, 2.2)
    if temp < 8:
        temp_factor = 0.15

    if humidity is not None:
        moisture_basis = humidity
    elif precip_prob is not None:
        moisture_basis = 40 + precip_prob * 0.5
    else:
        moisture_basis = 55.0

    moisture_factor = 0.5 + (moisture_basis / 100) * 0.9
    moisture_factor = clamp(moisture_factor, 0.45, 1.6)

    wind_factor = 1.0
    if wind > 10:
        wind_factor = max(0.6, 1 - (wind - 10) * 0.012)

    species_factor = payload.grassType.growthMultiplier
    weather_rate = BASE_RATE_CM_DAY * temp_factor * moisture_factor * wind_factor * species_factor

    return {
        "tempFactor": float(temp_factor),
        "moistureFactor": float(moisture_factor),
        "windFactor": float(wind_factor),
        "speciesFactor": float(species_factor),
        "moistureBasis": float(moisture_basis),
        "weatherRate": float(max(0.01, weather_rate)),
    }


def certainty_from_metrics(metrics: dict | None) -> float:
    if not metrics:
        return 0.65
    mae_att = metrics.get("mae_attention_avg")
    mae_crit = metrics.get("mae_critical_avg")
    if mae_att is None or mae_crit is None:
        return 0.65
    mae = (float(mae_att) + float(mae_crit)) / 2
    # 0 day MAE -> 0.95, 10+ day MAE -> ~0.45
    return float(clamp(0.95 - mae * 0.05, 0.45, 0.95))


@app.on_event("startup")
def _startup() -> None:
    init_db()
    if not API_KEY:
        print("[motiva] MOTIVA_API_KEY nao definida: POST /api/capturas esta aberto")


def exigir_chave(x_api_key: Optional[str] = Header(default=None)) -> None:
    if API_KEY and not hmac.compare_digest(x_api_key or "", API_KEY):
        raise HTTPException(status_code=401, detail="chave invalida")


def status_altura(altura: Optional[float]) -> str:
    if altura is None:
        return "sem_medida"
    if altura > LIMITE_CRITICO_CM:
        return "critico"
    if altura >= LIMITE_ATENCAO_CM:
        return "atencao"
    return "ok"


def foto_url(corrida_id: str, timestamp: int) -> str:
    return f"/capturas/{corrida_id}/{timestamp}.jpg"


def filtro_capturas(corrida_id: Optional[str], de: Optional[int], ate: Optional[int]):
    where = []
    params: list = []
    if corrida_id:
        where.append("corrida_id = ?")
        params.append(corrida_id)
    if de is not None:
        where.append("timestamp >= ?")
        params.append(de)
    if ate is not None:
        where.append("timestamp <= ?")
        params.append(ate)
    return (" WHERE " + " AND ".join(where)) if where else "", params


@app.get("/health")
def health():
    return {"status": "ok", "model_exists": MODEL_PATH.exists(), "db_exists": DB_PATH.exists()}


@app.get("/predictions")
def predictions(limit: int = 20):
    safe_limit = max(1, min(200, limit))
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT id, created_at, model, source, result_json
            FROM prediction_history
            ORDER BY id DESC
            LIMIT ?
            """,
            (safe_limit,),
        ).fetchall()

    parsed = []
    for row in rows:
        result = json.loads(row["result_json"])
        parsed.append(
            {
                "id": row["id"],
                "created_at": row["created_at"],
                "model": row["model"],
                "source": row["source"],
                "daysToAttention": result.get("daysToAttention"),
                "daysToCritical": result.get("daysToCritical"),
                "recommendedCutDays": result.get("recommendedCutDays"),
            }
        )
    return parsed


@app.post("/predict")
def predict(payload: PredictRequest):
    try:
        bundle = load_bundle()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    model = bundle["model"]
    feature_names = bundle["features"]

    X = build_features(payload, feature_names)
    pred = model.predict(X)[0]

    raw_days_attention = max(0.0, float(pred[0]))
    raw_days_critical = max(raw_days_attention, float(pred[1]))

    factors = compute_weather_factors(payload)
    weather_rate = factors["weatherRate"]

    model_rate = max(
        0.01,
        (payload.thresholdAttentionCm - payload.currentHeight) / max(raw_days_attention, 1.0)
        if payload.currentHeight < payload.thresholdAttentionCm
        else 0.02,
    )

    # Blend model signal with physical-weather signal.
    growth_rate = max(0.01, 0.7 * model_rate + 0.3 * weather_rate)

    days_attention = 0.0
    if payload.currentHeight < payload.thresholdAttentionCm:
        days_attention = (payload.thresholdAttentionCm - payload.currentHeight) / growth_rate
    days_critical = days_attention
    if payload.currentHeight < payload.thresholdCriticalCm:
        days_critical = (payload.thresholdCriticalCm - payload.currentHeight) / growth_rate
    days_critical = max(days_attention, days_critical)

    recommended_days = days_attention

    expected_h7 = payload.currentHeight + growth_rate * 7
    expected_h14 = payload.currentHeight + growth_rate * 14
    expected_h30 = payload.currentHeight + growth_rate * 30

    certainty = certainty_from_metrics(bundle.get("metrics"))

    probabilities = {
        "d7": float(clamp(sigmoid((7 - days_attention) / 2.4), 0.01, 0.99)),
        "d14": float(clamp(sigmoid((14 - days_attention) / 2.8), 0.01, 0.995)),
        "d30": float(clamp(sigmoid((30 - days_attention) / 3.4), 0.01, 0.999)),
    }

    result = {
        "model": "rf-multioutput-v1",
        "source": "python-api",
        "growthRateCmDay": growth_rate,
        "daysToAttention": days_attention,
        "daysToCritical": days_critical,
        "recommendedCutDays": recommended_days,
        "probabilities": probabilities,
        "expectedHeights": {"d7": expected_h7, "d14": expected_h14, "d30": expected_h30},
        "factors": {
            "tempFactor": factors["tempFactor"],
            "moistureFactor": factors["moistureFactor"],
            "windFactor": factors["windFactor"],
            "speciesFactor": factors["speciesFactor"],
            "moistureBasis": factors["moistureBasis"],
        },
        "schedule": {
            "estimatedDays": round(recommended_days),
            "windowStartDays": max(0, round(recommended_days - 3)),
            "windowEndDays": round(recommended_days + 3),
            "certainty": certainty,
        },
    }

    prediction_id = save_prediction("rf-multioutput-v1", "python-api", payload, result)
    result["predictionId"] = prediction_id

    return result

@app.post("/api/capturas", dependencies=[Depends(exigir_chave)])
async def receber_captura(
    corridaId: str = Form(...),
    lat: float = Form(...),
    lng: float = Form(...),
    timestamp: int = Form(...),
    foto: UploadFile = File(...),
):
    if not RUN_ID_RE.fullmatch(corridaId):
        raise HTTPException(status_code=400, detail="corridaId invalido")
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(status_code=400, detail="coordenadas invalidas")
    data = await foto.read()
    if not data or len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="foto vazia ou grande demais")
    if not data.startswith(b"\xff\xd8"):
        raise HTTPException(status_code=415, detail="a foto precisa ser JPEG")

    pasta = CAPTURES_DIR / corridaId
    pasta.mkdir(parents=True, exist_ok=True)
    arquivo = pasta / f"{timestamp}.jpg"

    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute(
            "INSERT OR IGNORE INTO capturas (corrida_id, lat, lng, timestamp, caminho, recebida_em) VALUES (?, ?, ?, ?, ?, ?)",
            (corridaId, lat, lng, timestamp, arquivo.as_posix(), datetime.utcnow().isoformat()),
        )
        conn.commit()
        if cur.rowcount == 0:
            row = conn.execute(
                "SELECT id FROM capturas WHERE corrida_id = ? AND timestamp = ?", (corridaId, timestamp)
            ).fetchone()
            return {"id": row[0], "duplicada": True}
        captura_id = int(cur.lastrowid)

    arquivo.write_bytes(data)

    try:
        analise = await run_in_threadpool(analisar_bytes, data)
    except Exception:
        analise = None

    altura = analise["max"] if analise and analise["max"] > 0 else None
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("UPDATE capturas SET altura_cm = ? WHERE id = ?", (altura, captura_id))
        conn.commit()

    return {"id": captura_id, "duplicada": False, "alturaCm": altura, "analise": analise}


@app.get("/api/corridas")
def listar_corridas(limite: int = Query(50, ge=1, le=200)):
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            """
            SELECT corrida_id, COUNT(*), COUNT(altura_cm), MIN(timestamp), MAX(timestamp), MAX(altura_cm), AVG(altura_cm)
            FROM capturas
            GROUP BY corrida_id
            ORDER BY MAX(timestamp) DESC
            LIMIT ?
            """,
            (limite,),
        ).fetchall()
    return [
        {
            "corridaId": r[0],
            "total": r[1],
            "comMedida": r[2],
            "inicio": r[3],
            "fim": r[4],
            "alturaMaxCm": r[5],
            "alturaMediaCm": r[6],
            "status": status_altura(r[5]),
        }
        for r in rows
    ]


@app.get("/api/capturas")
def listar_capturas(
    corridaId: Optional[str] = None,
    de: Optional[int] = None,
    ate: Optional[int] = None,
    limite: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    where, params = filtro_capturas(corridaId, de, ate)
    with sqlite3.connect(DB_PATH) as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM capturas{where}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT id, corrida_id, lat, lng, timestamp, altura_cm FROM capturas{where} ORDER BY timestamp DESC LIMIT ? OFFSET ?",
            [*params, limite, offset],
        ).fetchall()
    return {
        "total": total,
        "itens": [
            {
                "id": r[0],
                "corridaId": r[1],
                "lat": r[2],
                "lng": r[3],
                "timestamp": r[4],
                "alturaCm": r[5],
                "status": status_altura(r[5]),
                "fotoUrl": foto_url(r[1], r[4]),
            }
            for r in rows
        ],
    }


@app.get("/api/trechos")
def listar_trechos(
    corridaId: Optional[str] = None,
    de: Optional[int] = None,
    ate: Optional[int] = None,
    celula: float = Query(0.0005, gt=0.00001, le=0.05),
    limite: int = Query(500, ge=1, le=2000),
):
    where, params = filtro_capturas(corridaId, de, ate)
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            f"""
            SELECT corrida_id,
                   CAST(ROUND(lat / ?) AS INTEGER) AS gy,
                   CAST(ROUND(lng / ?) AS INTEGER) AS gx,
                   COUNT(*) AS total,
                   COUNT(altura_cm) AS com_medida,
                   AVG(lat), AVG(lng),
                   MAX(altura_cm) AS altura_max,
                   id, timestamp
            FROM capturas{where}
            GROUP BY corrida_id, gy, gx
            ORDER BY altura_max DESC, timestamp DESC
            LIMIT ?
            """,
            [celula, celula, *params, limite],
        ).fetchall()
    return [
        {
            "id": f"{r[0]}:{r[1]}:{r[2]}",
            "corridaId": r[0],
            "lat": r[5],
            "lng": r[6],
            "total": r[3],
            "comMedida": r[4],
            "alturaMaxCm": r[7],
            "status": status_altura(r[7]),
            "capturaId": r[8],
            "timestamp": r[9],
            "fotoUrl": foto_url(r[0], r[9]),
        }
        for r in rows
    ]
