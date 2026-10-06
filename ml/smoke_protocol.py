"""Standard-library protocol check, including deterministic replay of batches."""
import json
import os
from pathlib import Path
import struct
import subprocess
import time

ROOT=Path(__file__).resolve().parents[1]
NODE=os.environ.get("SKYLO_NODE","node")


def run():
    process=subprocess.Popen([NODE,str(ROOT/"apps/backend/dist/game/ml/simulator.js")],
                             stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    def request(data):
        process.stdin.write((json.dumps(data)+"\n").encode());process.stdin.flush()
        line=process.stdout.readline()
        if not line: raise RuntimeError(process.stderr.read().decode())
        header=json.loads(line);payload=process.stdout.read(header["bytes"])
        assert len(payload)==header["bytes"]
        values=struct.unpack("<"+"f"*(len(payload)//4),payload)
        return header,values,payload
    results=[];completions=[];started=time.time()
    try:
        header,values,payload=request(dict(command="reset",options=dict(n=8,namespace="protocol-smoke",teacher=True)))
        for _ in range(1000):
            results.append(payload)
            labels=[int(values[(i+1)*header["width"]-1]) for i in range(header["n"])]
            for i,label in enumerate(labels): assert values[i*header["width"]+header["observationSize"]+label]==1
            header,values,payload=request(dict(command="step",actions=labels))
            completions.extend(header["completions"])
        return results,completions,time.time()-started
    finally:
        process.stdin.write(b'{"command":"close"}\n');process.stdin.flush();process.stdin.close();process.wait(timeout=10)
        assert process.returncode==0


if __name__=="__main__":
    first,games,elapsed=run();second,games2,_=run()
    assert first==second and games==games2
    assert games and all(g['endReason']=='point-limit' for g in games)
    print(json.dumps(dict(steps=8000,completed_games=len(games),elapsed=elapsed,
                          samples_per_second=8000/elapsed,deterministic=True)))
