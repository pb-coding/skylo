"""Audit a frozen deployment-runtime test, with paired seed uncertainty."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np


def verify(report, manifest, model_path, bootstrap_samples=20000):
    records=report["records"]
    games=len(records)
    assert games>=2000 and games%2==0 and report["games"]==games, "Need at least 1000 paired seeds"
    assert [r["index"] for r in records]==list(range(games)), "Missing or duplicate games"
    assert report["namespace"].startswith("final-test-"), "Test namespace must be reserved"
    assert manifest["sha256"]==report["modelSha256"]==hashlib.sha256(Path(model_path).read_bytes()).hexdigest(), "Artifact hash changed"
    assert manifest["ruleVersion"]==report["ruleVersion"]=="skylo-2-positive-penalty"
    assert report["coreSha256"]==manifest["coreSha256"] and report["hardBotSha256"]==manifest["hardBotSha256"], "Baseline source changed"
    for i,record in enumerate(records):
        assert record["seat"]==i%2 and record["seed"]==f'{report["namespace"]}:{i//2}'
        assert record["endReason"]=="point-limit", "A safety-limited match cannot establish strength"
        assert max(record["score"],record["otherScore"])>=100
        assert record["win"]==(record["score"]<record["otherScore"])
        assert record["draw"]==(record["score"]==record["otherScore"])
    wins=np.array([r["win"] for r in records],dtype=np.float64)
    pairs=wins.reshape(-1,2).mean(axis=1)
    rng=np.random.default_rng(917260)
    samples=[]
    for start in range(0,bootstrap_samples,100):
        samples.extend(rng.choice(pairs,(min(100,bootstrap_samples-start),len(pairs)),replace=True).mean(axis=1).tolist())
    lower=float(np.quantile(samples,.05))
    rate=float(wins.mean())
    return dict(games=games,seed_pairs=games//2,wins=int(wins.sum()),draws=sum(r["draw"] for r in records),
                win_rate=rate,paired_bootstrap_lower_95_one_sided=lower,bootstrap_samples=bootstrap_samples,
                gate_passed=rate>.70 and lower>.70,model_sha256=manifest["sha256"],
                namespace=report["namespace"],natural_matches=games,
                seat_win_rates=[float(wins[seat::2].mean()) for seat in (0,1)],latency_ms=report["latencyMs"])


if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--report",required=True);p.add_argument("--manifest",required=True);p.add_argument("--output",required=True)
    args=p.parse_args()
    manifest_path=Path(args.manifest)
    manifest=json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    report=json.loads(Path(args.report).read_text())
    result=verify(report,manifest,manifest_path.parent/manifest["model"])
    Path(args.output).write_text(json.dumps(result,indent=2))
    print(json.dumps(result))
    raise SystemExit(0 if result["gate_passed"] else 2)
