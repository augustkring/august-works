"""Fixed registered binary ITT diagnostics from anonymous sufficient counts."""
import contextlib
import importlib.metadata
import json
import logging
import math
import os
import platform
import sys
import warnings
from pathlib import Path


def arm(value):
    if type(value) is not dict or set(value) != {"units", "successes"}:
        raise ValueError("invalid_arm")
    units, successes = value["units"], value["successes"]
    if type(units) is not int or type(successes) is not int or not 8 <= units <= 3992 or not 0 <= successes <= units:
        raise ValueError("invalid_counts")
    return units, successes


def main():
    raw = sys.stdin.buffer.read(4097)
    if len(raw) > 4096:
        raise ValueError("input_limit")
    request = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite")))
    if type(request) is not dict:
        raise ValueError("invalid_request")
    pinned = json.loads(Path(__file__).with_name("dowhy-dependencies.json").read_text())
    dependencies = {item["name"]: importlib.metadata.version(item["name"]) for item in pinned["packages"]}
    if platform.python_version() != pinned["python"] or any(dependencies[item["name"]] != item["version"] for item in pinned["packages"]):
        raise ValueError("runtime_version_drift")
    provenance = {"provider": "dowhy", "version": "0.14", "python": platform.python_version()}
    if request == {"operation": "health"}:
        print(json.dumps({**provenance, "dependencies": dependencies, "environmentNames": sorted(os.environ), "networkProxyDisabled": os.environ.get("NO_PROXY", "") == "" and os.environ.get("no_proxy", "") == ""}, allow_nan=False))
        return
    if set(request) != {"operation", "control", "treatment"} or request["operation"] != "registered_binary_itt":
        raise ValueError("unsupported_analysis")
    cn, cs = arm(request["control"])
    tn, ts = arm(request["treatment"])
    if cn + tn > 4000:
        raise ValueError("sample_limit")
    logging.disable(logging.CRITICAL)
    warnings.filterwarnings("ignore")
    # The expansion represents sufficient counts, not recovered individual rows.
    # Fixed graph/method/seed; no tenant graph, prose, identity or executable input.
    with open(os.devnull, "w") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        import networkx as nx
        import numpy as np
        import pandas as pd
        from dowhy import CausalModel
        data = pd.DataFrame({"assignment": [0] * cn + [1] * tn, "outcome": [1] * cs + [0] * (cn - cs) + [1] * ts + [0] * (tn - ts)})
        model = CausalModel(data, treatment="assignment", outcome="outcome", graph=nx.DiGraph([("assignment", "outcome")]))
        identified = model.identify_effect(proceed_when_unidentifiable=False)
        if identified.estimands["backdoor"] is None or identified.get_backdoor_variables():
            raise ValueError("not_identified")
        estimate = model.estimate_effect(identified, method_name="backdoor.linear_regression", confidence_intervals=False)
        refutations = []
        for method, params in [("random_common_cause", {}), ("placebo_treatment_refuter", {"placebo_type": "permute"}), ("data_subset_refuter", {"subset_fraction": 0.8})]:
            result = model.refute_estimate(identified, estimate, method_name=method, num_simulations=16, random_state=np.random.RandomState(1729), n_jobs=1, show_progress_bar=False, **params)
            effect = float(result.new_effect)
            p = float(result.refutation_result["p_value"])
            # Degenerate all-constant fixtures produce NaN p-values in DoWhy.
            # Preserve unknown diagnostics; never convert these into passes.
            p = p if math.isfinite(p) and 0 <= p <= 1 else None
            refutations.append({"method": method, "effect": effect, "pValue": p, "status": "unknown" if p is None else "failed" if p < 0.05 else "passed"})
        value = float(estimate.value)
    print(json.dumps({**provenance, "method": "backdoor.linear_regression", "identification": "identified_under_registered_randomization", "adjustmentSet": [], "effect": value, "representation": "anonymous_binary_sufficient_counts", "simulations": 16, "seed": 1729, "refutations": refutations, "sensitivity": "unknown", "uncertainty": "native_registered_interval_required"}, allow_nan=False, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.stderr.write("causal_worker_failed\n")
        sys.exit(1)
