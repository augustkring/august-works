"""Fixed optional numeric worker; no tenant identities, SQL, credentials or code input."""
import importlib.metadata
import json
import math
import platform
import os
import sys
from pathlib import Path

LIMIT = 65536

def integer(value, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError("invalid_integer")
    return value

def main():
    raw = sys.stdin.buffer.read(LIMIT + 1)
    if len(raw) > LIMIT:
        raise ValueError("input_limit")
    request = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite")))
    if type(request) is not dict:
        raise ValueError("invalid_request")
    pinned = json.loads(Path(__file__).with_name("statsforecast-dependencies.json").read_text())
    dependencies = {item["name"]: importlib.metadata.version(item["name"]) for item in pinned["packages"]}
    if platform.python_version() != pinned["python"] or any(dependencies[item["name"]] != item["version"] for item in pinned["packages"]):
        raise ValueError("runtime_version_drift")
    provenance = {"provider": "statsforecast", "version": "2.1.1", "python": platform.python_version()}
    if request == {"operation": "health"}:
        print(json.dumps({**provenance, "environmentNames": sorted(os.environ), "networkProxyDisabled": os.environ.get("NO_PROXY", "") == "" and os.environ.get("no_proxy", "") == "", "dependencies": dependencies}, allow_nan=False))
        return
    if set(request) != {"operation", "model", "seasonLength", "values", "origins", "horizon", "gapPeriods", "futureGapPeriods"} or request["operation"] != "forecast":
        raise ValueError("invalid_request")
    values = request["values"]
    if type(values) is not list or not 4 <= len(values) <= 1000 or any(type(value) not in [int, float] or not math.isfinite(value) or abs(value) > 1e12 for value in values):
        raise ValueError("invalid_history")
    horizon = integer(request["horizon"], 1, 60)
    gap = integer(request["gapPeriods"], 1, 7)
    future_gap = integer(request["futureGapPeriods"], 0, 2)
    season = integer(request["seasonLength"], 1, 365)
    origins = request["origins"]
    if type(origins) is not list or not 1 <= len(origins) <= 100 or any(integer(origin, 2, len(values) - horizon - gap) != origin for origin in origins) or origins != sorted(set(origins)):
        raise ValueError("invalid_origins")
    from statsforecast.models import AutoARIMA, AutoETS, AutoTheta, Naive
    import numpy as np
    models = {"auto_arima": lambda: AutoARIMA(season_length=season), "auto_ets": lambda: AutoETS(season_length=season), "auto_theta": lambda: AutoTheta(season_length=season), "native_naive_parity": Naive}
    if request["model"] not in models or (season > 1 and min(origins) < season * 2):
        raise ValueError("unsupported_model_or_season")
    # Every fold gets only its training prefix, then skips the declared gap.
    # No future actual is supplied to the model or its fitted residual scale.
    folds = [{"origin": origin, "values": models[request["model"]]().forecast(y=np.array(values[:origin], dtype=np.float64), h=horizon + gap)["mean"].tolist()[gap:]} for origin in origins]
    predicted = models[request["model"]]().forecast(y=np.array(values, dtype=np.float64), h=horizon + future_gap, level=[80, 95])
    future = {key: predicted[key].tolist()[future_gap:] for key in ["mean", "lo-80", "hi-80", "lo-95", "hi-95"]}
    print(json.dumps({**provenance, "folds": folds, "future": future}, allow_nan=False, separators=(",", ":")))

if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Source values and third-party diagnostic strings never become logs.
        sys.stderr.write("statistical_worker_failed\n")
        sys.exit(1)
