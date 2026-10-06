"""Batched Gym/TypeScript bridge. All observations are encoded in TypeScript."""
from __future__ import annotations
import json
import os
from pathlib import Path
import subprocess
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from gymnasium import spaces
from stable_baselines3.common.vec_env import VecEnv

ROOT = Path(__file__).resolve().parents[1]
ACTION_COUNT = 28
GLOBAL_SIZE = 530
CANDIDATE_SIZE = 32
OBSERVATION_SIZE = GLOBAL_SIZE + ACTION_COUNT * CANDIDATE_SIZE


class SkyloVecEnv(VecEnv):
    def __init__(self, n=64, namespace="train-v1", opponent="hard", teacher=False,
                 limit_episodes=None, round_reward=0.25, log_dir=None, potential_reward=0, discount=.997, teacher_weights=None, teacher_patience=None, teacher_scores=False):
        self.options = dict(n=n, namespace=namespace, opponent=opponent, teacher=teacher,
                            roundReward=round_reward)
        self.options.update(potentialReward=potential_reward,discount=discount)
        if teacher_weights is not None:self.options["teacherWeights"]=teacher_weights
        if teacher_patience is not None:self.options["teacherPatience"]=teacher_patience
        self.options["teacherScores"]=teacher_scores
        self.options["snapshotModels"] = [p for p in os.environ.get("SKYLO_SNAPSHOT_MODELS", "").split(";") if p]
        if limit_episodes is not None:
            self.options["limitEpisodes"] = limit_episodes
        self.n = n
        self.rows = None
        self.completions = []
        self.header = {}
        self.actions = None
        node = os.environ.get("SKYLO_NODE", "node")
        target = ROOT / "apps/backend/dist/game/ml/simulator.js"
        log_dir = Path(log_dir or os.environ.get("SKYLO_OUTPUT", "D:/AI/SkyloBot/runs"))
        log_dir.mkdir(parents=True, exist_ok=True)
        self.error_log = open(log_dir / f"simulator-{os.getpid()}-{id(self)}.log", "w", buffering=1)
        self.process = subprocess.Popen([node, str(target)], cwd=ROOT, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=self.error_log, bufsize=1024 * 1024)
        super().__init__(n, spaces.Box(-np.inf, np.inf, (OBSERVATION_SIZE,), np.float32),
                         spaces.Discrete(ACTION_COUNT))

    def _request(self, request):
        self.process.stdin.write((json.dumps(request, separators=(",", ":")) + "\n").encode())
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError(f"TypeScript simulator exited ({self.process.poll()}); see {self.error_log.name}")
        self.header = json.loads(line)
        if self.header["observationSize"] != OBSERVATION_SIZE:
            raise RuntimeError("Encoder version/shape mismatch")
        data = self.process.stdout.read(self.header["bytes"])
        if len(data) != self.header["bytes"]:
            raise RuntimeError("Truncated TypeScript simulator response")
        self.rows = np.frombuffer(data, dtype="<f4").reshape(self.n, self.header["width"])
        self.completions.extend(self.header["completions"])
        return self.rows[:, :OBSERVATION_SIZE].copy()

    @property
    def masks(self):
        return self.rows[:, OBSERVATION_SIZE:OBSERVATION_SIZE + ACTION_COUNT].astype(bool)

    @property
    def labels(self):
        return self.rows[:, OBSERVATION_SIZE+ACTION_COUNT+2].astype(np.int64)

    @property
    def teacher_scores(self):
        if not self.options["teacherScores"]:raise RuntimeError("Teacher scores not enabled")
        return self.rows[:,OBSERVATION_SIZE+ACTION_COUNT+3:].copy()

    def reset(self):
        self.completions.clear()
        return self._request(dict(command="reset", options=self.options))

    def update_snapshots(self, paths):
        self.options["snapshotModels"] = [str(p) for p in paths]
        self._request(dict(command="pool", paths=self.options["snapshotModels"]))

    def step_async(self, actions):
        self.actions = np.asarray(actions).reshape(-1).tolist()

    def step_wait(self):
        obs = self._request(dict(command="step", actions=self.actions))
        rewards, dones = self.rows[:, OBSERVATION_SIZE+ACTION_COUNT].copy(), self.rows[:, OBSERVATION_SIZE+ACTION_COUNT+1].astype(bool)
        infos = [{} for _ in range(self.n)]
        return obs, rewards, dones, infos

    def close(self):
        if self.process.poll() is None:
            try:
                self.process.stdin.write(b'{"command":"close"}\n')
                self.process.stdin.flush()
                self.process.stdin.close()
                self.process.wait(timeout=10)
            except (BrokenPipeError, subprocess.TimeoutExpired):
                self.process.terminate()
                self.process.wait(timeout=10)
        self.process.stdout.close()
        self.error_log.close()

    def get_attr(self, attr_name, indices=None):
        indices = self._get_indices(indices)
        if attr_name == "render_mode":
            return [None for _ in indices]
        if attr_name == "action_masks":
            return [self.masks[i] for i in indices]
        raise AttributeError(attr_name)

    def set_attr(self, attr_name, value, indices=None):
        raise AttributeError(attr_name)

    def env_method(self, method_name, *method_args, indices=None, **method_kwargs):
        if method_name == "action_masks":
            return [self.masks[i] for i in self._get_indices(indices)]
        raise AttributeError(method_name)

    def env_is_wrapped(self, wrapper_class, indices=None):
        return [False for _ in self._get_indices(indices)]


class ParallelSkyloVecEnv(SkyloVecEnv):
    """Independent real-engine processes; threads only overlap blocking pipe IO.

    Each worker owns a distinct seed namespace and keeps its local paired seats.
    Evaluation uses the single-process adapter so its indices stay contiguous.
    """
    def __init__(self, n=64, workers=4, namespace="train-v2", **options):
        if workers<1 or n%workers or (n//workers)%2:
            raise ValueError("Each worker requires an even number of environments")
        if options.get("limit_episodes") is not None:
            raise ValueError("Use single-process SkyloVecEnv for bounded evaluation")
        self.n=n
        self.executor=ThreadPoolExecutor(max_workers=workers)
        self.children=[SkyloVecEnv(n//workers,f"{namespace}:worker{i}",**options) for i in range(workers)]
        self.options={**self.children[0].options,"n":n,"namespace":namespace,"workers":workers}
        self.completions=[]
        self.header={}
        self.actions=None
        VecEnv.__init__(self,n,spaces.Box(-np.inf,np.inf,(OBSERVATION_SIZE,),np.float32),spaces.Discrete(ACTION_COUNT))

    def _collect_completions(self):
        for worker,child in enumerate(self.children):
            self.completions.extend({**record,"worker":worker} for record in child.completions)
            child.completions.clear()
        self.header=self.children[0].header

    @property
    def masks(self):
        return np.concatenate([child.masks for child in self.children])

    @property
    def labels(self):
        return np.concatenate([child.labels for child in self.children])

    @property
    def teacher_scores(self):
        return np.concatenate([child.teacher_scores for child in self.children])

    def reset(self):
        self.completions.clear()
        observations=list(self.executor.map(lambda child:child.reset(),self.children))
        self._collect_completions()
        return np.concatenate(observations)

    def step_wait(self):
        chunks=np.split(np.asarray(self.actions),len(self.children))
        results=list(self.executor.map(lambda item:item[0].step(item[1]),zip(self.children,chunks)))
        self._collect_completions()
        observations,rewards,dones,infos=zip(*results)
        return np.concatenate(observations),np.concatenate(rewards),np.concatenate(dones),sum(infos,[])

    def update_snapshots(self,paths):
        paths=[str(p) for p in paths]
        list(self.executor.map(lambda child:child.update_snapshots(paths),self.children))
        self.options["snapshotModels"]=paths

    def close(self):
        list(self.executor.map(lambda child:child.close(),self.children))
        self.executor.shutdown(wait=True)
