"""Per-phase imitation agreement on separately collected public observations.
Agreement includes randomly broken teacher ties and is not a strength metric.
"""
import argparse,json
from pathlib import Path
import numpy as np
import torch
from sb3_contrib import MaskablePPO

torch.set_num_threads(4)
p=argparse.ArgumentParser();p.add_argument('--checkpoint',required=True);p.add_argument('--data',required=True)
p.add_argument('--output',required=True);args=p.parse_args()
data=np.load(args.data);model=MaskablePPO.load(args.checkpoint,device='cpu')
actions=[]
for start in range(0,len(data['labels']),1024):
    selected,_=model.predict(data['observations'][start:start+1024].astype(np.float32),
                             action_masks=data['masks'][start:start+1024].astype(bool),deterministic=True)
    actions.append(selected)
actions=np.concatenate(actions);phases=data['observations'][:,500:506].argmax(axis=1)
names=['initial-reveal','pickup','placement','reveal','new-round','ended']
report=dict(checkpoint=args.checkpoint,data=args.data,phases={})
for phase,name in enumerate(names):
    select=phases==phase
    if not select.any():continue
    report['phases'][name]=dict(samples=int(select.sum()),agreement=float(np.mean(actions[select]==data['labels'][select])),
                               chosen={str(int(a)):int(n) for a,n in zip(*np.unique(actions[select],return_counts=True))})
    if 'teacher_scores' in data:
        scores=np.where(data['masks'][select],data['teacher_scores'][select].astype(np.float32),-np.inf)
        regret=scores.max(axis=1)-scores[np.arange(select.sum()),actions[select]]
        report['phases'][name].update(mean_teacher_regret=float(regret.mean()),teacher_regret_p95=float(np.quantile(regret,.95)),
                                      within_score_tie=float(np.mean(regret<.02)),regret_above_1=float(np.mean(regret>1)))
Path(args.output).write_text(json.dumps(report,indent=2));print(json.dumps(report))
