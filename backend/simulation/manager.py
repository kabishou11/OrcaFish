"""Simulation Manager - Core simulation lifecycle management"""
import os
import json
import uuid
from typing import Dict, Any, List, Optional
from dataclasses import dataclass
from datetime import datetime
from enum import Enum


class SimulationStatus(str, Enum):
    CREATED = "created"
    PREPARING = "preparing"
    READY = "ready"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class SimulationState:
    simulation_id: str
    project_id: str
    graph_id: str
    status: SimulationStatus = SimulationStatus.CREATED
    entities_count: int = 0
    profiles_count: int = 0
    created_at: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "simulation_id": self.simulation_id,
            "project_id": self.project_id,
            "graph_id": self.graph_id,
            "status": self.status.value,
            "entities_count": self.entities_count,
            "profiles_count": self.profiles_count,
            "created_at": self.created_at,
        }


class SimulationManager:
    """Manages simulation lifecycle"""

    def __init__(self, data_dir: str = "data/simulations"):
        self.data_dir = data_dir
        os.makedirs(data_dir, exist_ok=True)
        self._simulations: Dict[str, SimulationState] = {}

    def create_simulation(self, project_id: str, graph_id: str) -> SimulationState:
        simulation_id = f"sim_{uuid.uuid4().hex[:12]}"
        state = SimulationState(
            simulation_id=simulation_id,
            project_id=project_id,
            graph_id=graph_id,
            status=SimulationStatus.CREATED,
            created_at=datetime.now().isoformat()
        )
        self._save_state(state)
        return state

    def get_simulation(self, simulation_id: str) -> Optional[SimulationState]:
        if simulation_id in self._simulations:
            return self._simulations[simulation_id]
        return self._load_state(simulation_id)

    def _save_state(self, state: SimulationState):
        sim_dir = os.path.join(self.data_dir, state.simulation_id)
        os.makedirs(sim_dir, exist_ok=True)
        with open(os.path.join(sim_dir, "state.json"), 'w') as f:
            json.dump(state.to_dict(), f, indent=2)
        self._simulations[state.simulation_id] = state

    def _load_state(self, simulation_id: str) -> Optional[SimulationState]:
        state_file = os.path.join(self.data_dir, simulation_id, "state.json")
        if not os.path.exists(state_file):
            return None
        with open(state_file) as f:
            data = json.load(f)
        state = SimulationState(
            simulation_id=data["simulation_id"],
            project_id=data["project_id"],
            graph_id=data["graph_id"],
            status=SimulationStatus(data["status"]),
            entities_count=data.get("entities_count", 0),
            profiles_count=data.get("profiles_count", 0),
            created_at=data.get("created_at", "")
        )
        self._simulations[simulation_id] = state
        return state
