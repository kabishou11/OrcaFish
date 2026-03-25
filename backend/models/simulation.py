"""OrcaFish Simulation Models"""
from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class Project(BaseModel):
    project_id: str
    name: str
    status: str = "created"
    seed_content: str = ""
    simulation_requirement: str = ""
    ontology: dict = {}
    graph_id: str = ""
    created_at: datetime = datetime.utcnow()


class Simulation(BaseModel):
    simulation_id: str
    project_id: str
    graph_id: str = ""
    status: str = "created"
    current_round: int = 0
    total_rounds: int = 40
    entities_count: int = 0
    profiles_count: int = 0
    platform: str = "both"
    created_at: datetime = datetime.utcnow()


class AgentAction(BaseModel):
    round_num: int
    timestamp: str
    platform: str
    agent_id: int
    agent_name: str
    action_type: str
    action_args: dict = {}
    result: str = ""
    success: bool = True


class PredictionReport(BaseModel):
    report_id: str
    simulation_id: str
    status: str = "pending"
    markdown_content: str = ""
    outline: dict = {}
    created_at: datetime = datetime.utcnow()
    completed_at: Optional[datetime] = None


class SimulationCreateRequest(BaseModel):
    name: str
    seed_content: str
    simulation_requirement: str = "预测该事件未来72小时内的局势演化"
    max_rounds: int = 40
    enable_twitter: bool = True
    enable_reddit: bool = True


class VariableInjection(BaseModel):
    simulation_id: str
    variable: str
    value: str
    description: str = ""
