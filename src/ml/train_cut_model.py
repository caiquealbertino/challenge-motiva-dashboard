"""
train_cut_model.py
Trains a real predictive model for grass-cut scheduling.

Expected input CSV columns:
- observed_at (datetime)
- temperature
- humidity
- windspeed
- precip_prob
- current_height
- growth_multiplier
- threshold_attention
- threshold_critical
- days_to_attention
- days_to_critical

Usage:
  python train_cut_model.py --data src/ml/data/cut_training.csv --out src/ml/model_bundle.joblib
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import TimeSeriesSplit
from sklearn.multioutput import MultiOutputRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


REQUIRED_COLUMNS = [
    "temperature",
    "humidity",
    "windspeed",
    "precip_prob",
    "current_height",
    "growth_multiplier",
    "threshold_attention",
    "threshold_critical",
    "days_to_attention",
    "days_to_critical",
]


def load_dataset(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    if "observed_at" in df.columns:
        df["observed_at"] = pd.to_datetime(df["observed_at"], errors="coerce")
        df = df.sort_values("observed_at")

    df = df.dropna(subset=REQUIRED_COLUMNS).reset_index(drop=True)
    if len(df) < 30:
        raise ValueError("Dataset too small. Provide at least 30 valid rows.")
    return df


def make_features(df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame]:
    X = df[
        [
            "temperature",
            "humidity",
            "windspeed",
            "precip_prob",
            "current_height",
            "growth_multiplier",
            "threshold_attention",
            "threshold_critical",
        ]
    ].copy()

    # Intermediate feature engineering
    X["humidity_x_temp"] = X["humidity"] * X["temperature"]
    X["wind_x_temp"] = X["windspeed"] * X["temperature"]
    X["height_to_attention_gap"] = X["threshold_attention"] - X["current_height"]
    X["height_to_critical_gap"] = X["threshold_critical"] - X["current_height"]

    y = df[["days_to_attention", "days_to_critical"]].copy()
    return X, y


def train_model(X: pd.DataFrame, y: pd.DataFrame) -> Tuple[Pipeline, dict]:
    model = Pipeline(
        steps=[
            ("scaler", StandardScaler()),
            (
                "regressor",
                MultiOutputRegressor(
                    RandomForestRegressor(
                        n_estimators=450,
                        max_depth=14,
                        min_samples_leaf=2,
                        random_state=42,
                        n_jobs=-1,
                    )
                ),
            ),
        ]
    )

    # Choose temporal CV folds based on dataset size so sample datasets can train.
    n_rows = len(X)
    n_splits = min(5, max(2, n_rows // 12), n_rows - 1)
    splitter = TimeSeriesSplit(n_splits=n_splits)
    fold_metrics = []

    X_values = X.values
    y_values = y.values

    for fold, (train_idx, test_idx) in enumerate(splitter.split(X_values), start=1):
        X_train, X_test = X_values[train_idx], X_values[test_idx]
        y_train, y_test = y_values[train_idx], y_values[test_idx]

        model.fit(X_train, y_train)
        preds = model.predict(X_test)

        mae_attention = mean_absolute_error(y_test[:, 0], preds[:, 0])
        mae_critical = mean_absolute_error(y_test[:, 1], preds[:, 1])
        fold_metrics.append(
            {
                "fold": fold,
                "mae_attention": float(mae_attention),
                "mae_critical": float(mae_critical),
            }
        )

    model.fit(X_values, y_values)

    summary = {
        "fold_metrics": fold_metrics,
        "mae_attention_avg": float(np.mean([m["mae_attention"] for m in fold_metrics])),
        "mae_critical_avg": float(np.mean([m["mae_critical"] for m in fold_metrics])),
    }

    return model, summary


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True, help="Path to training CSV")
    parser.add_argument("--out", default="src/ml/model_bundle.joblib", help="Output model path")
    args = parser.parse_args()

    data_path = Path(args.data)
    out_path = Path(args.out)

    df = load_dataset(data_path)
    X, y = make_features(df)
    model, metrics = train_model(X, y)

    bundle = {
        "model": model,
        "features": list(X.columns),
        "metrics": metrics,
        "rows": int(len(df)),
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, out_path)

    print("Model trained successfully")
    print(f"Rows: {len(df)}")
    print(f"MAE attention (avg): {metrics['mae_attention_avg']:.2f} days")
    print(f"MAE critical (avg): {metrics['mae_critical_avg']:.2f} days")
    print(f"Saved to: {out_path}")


if __name__ == "__main__":
    main()
