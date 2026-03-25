"""Config Generator - Generate simulation configuration"""
from typing import Dict, Any, List
from dataclasses import dataclass, asdict
import json


@dataclass
class TimeConfig:
    total_simulation_hours: int = 72
    minutes_per_round: int = 60
    agents_per_hour_min: int = 5
    agents_per_hour_max: int = 20
    peak_hours: List[int] = None
    off_peak_hours: List[int] = None

    def __post_init__(self):
        if self.peak_hours is None:
            self.peak_hours = [19, 20, 21, 22]
        if self.off_peak_hours is None:
            self.off_peak_hours = [0, 1, 2, 3, 4, 5]


@dataclass
class SimulationConfig:
    simulation_id: str
    project_id: str
    graph_id: str
    time_config: TimeConfig
    agent_configs: List[Dict[str, Any]]
    event_config: Dict[str, Any]

    def to_json(self) -> str:
        data = {
            "simulation_id": self.simulation_id,
            "project_id": self.project_id,
            "graph_id": self.graph_id,
            "time_config": asdict(self.time_config),
            "agent_configs": self.agent_configs,
            "event_config": self.event_config
        }
        return json.dumps(data, ensure_ascii=False, indent=2)


class SimulationConfigGenerator:
    """Generate simulation configuration"""

    def generate_config(self, simulation_id: str, project_id: str, graph_id: str,
                       entities: List[Dict], requirement: str) -> SimulationConfig:
        time_config = TimeConfig()

        agent_configs = []
        for i, entity in enumerate(entities):
            agent_configs.append({
                "agent_id": i,
                "entity_name": entity.get("name", f"Agent {i}"),
                "activity_level": 0.5,
                "active_hours": list(range(9, 23))
            })

        event_config = {
            "initial_posts": [],
            "hot_topics": []
        }

        return SimulationConfig(
            simulation_id=simulation_id,
            project_id=project_id,
            graph_id=graph_id,
            time_config=time_config,
            agent_configs=agent_configs,
            event_config=event_config
        )
