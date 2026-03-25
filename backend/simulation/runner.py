"""Simulation Runner - Execute simulations"""
import os
import subprocess
from typing import Dict, Any, Optional
from dataclasses import dataclass
from enum import Enum


class RunnerStatus(str, Enum):
    IDLE = "idle"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class RunnerState:
    status: RunnerStatus = RunnerStatus.IDLE
    current_round: int = 0
    total_rounds: int = 0
    process_id: Optional[int] = None


class SimulationRunner:
    """Execute simulation scripts"""

    def __init__(self, data_dir: str = "data/simulations"):
        self.data_dir = data_dir
        self._processes: Dict[str, subprocess.Popen] = {}

    def start_twitter(self, simulation_id: str, config_path: str, max_rounds: int = None) -> RunnerState:
        script_path = os.path.join(os.path.dirname(__file__), "platforms", "twitter.py")
        cmd = ["python", script_path, "--config", config_path]
        if max_rounds:
            cmd.extend(["--max-rounds", str(max_rounds)])

        proc = subprocess.Popen(cmd)
        self._processes[f"{simulation_id}_twitter"] = proc

        return RunnerState(status=RunnerStatus.RUNNING, process_id=proc.pid)

    def start_reddit(self, simulation_id: str, config_path: str, max_rounds: int = None) -> RunnerState:
        script_path = os.path.join(os.path.dirname(__file__), "platforms", "reddit.py")
        cmd = ["python", script_path, "--config", config_path]
        if max_rounds:
            cmd.extend(["--max-rounds", str(max_rounds)])

        proc = subprocess.Popen(cmd)
        self._processes[f"{simulation_id}_reddit"] = proc

        return RunnerState(status=RunnerStatus.RUNNING, process_id=proc.pid)

    def get_status(self, simulation_id: str, platform: str = "twitter") -> RunnerState:
        key = f"{simulation_id}_{platform}"
        if key not in self._processes:
            return RunnerState(status=RunnerStatus.IDLE)

        proc = self._processes[key]
        if proc.poll() is None:
            return RunnerState(status=RunnerStatus.RUNNING, process_id=proc.pid)
        else:
            return RunnerState(status=RunnerStatus.COMPLETED if proc.returncode == 0 else RunnerStatus.FAILED)
