"""OrcaFish Simulation Models"""
from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional


class Project(BaseModel):
    project_id: str
    name: str
    status: str = "created"
    seed_content: str = ""
    simulation_requirement: str = ""
    ontology: dict = Field(default_factory=dict)
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
    action_args: dict = Field(default_factory=dict)
    result: str = ""
    success: bool = True


class PredictionReport(BaseModel):
    report_id: str
    simulation_id: str
    status: str = "pending"
    markdown_content: str = ""
    outline: dict = Field(default_factory=dict)
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


# ── Extended models for full simulation API ──────────────────────────────────

class AgentProfile(BaseModel):
    """Agent profile from simulation"""
    agent_id: str
    name: str
    platform: str
    bio: str = ""
    followers: int = 0
    following: int = 0
    posts_count: int = 0
    credibility_score: float = 0.5
    influence_score: float = 0.5
    stance: str = "neutral"
    round_joined: int = 0


class AgentStats(BaseModel):
    """Per-agent statistics"""
    agent_id: str
    agent_name: str
    platform: str
    total_actions: int = 0
    actions_by_type: dict = Field(default_factory=dict)
    avg_sentiment: float = 0.0
    engagement_rate: float = 0.0
    influence_score: float = 0.0
    belief_drift: float = 0.0
    final_belief: float = 0.5


class RoundSummary(BaseModel):
    """Summary of a single simulation round"""
    round_num: int
    platform: str
    active_agents: int = 0
    total_actions: int = 0
    dominant_action_type: str = ""
    avg_sentiment: float = 0.0
    key_events: list[str] = Field(default_factory=list)


class SimulationRunState(BaseModel):
    """Complete run state with timeline and stats"""
    run_id: str
    simulation_id: str
    status: str
    current_round: int
    total_rounds: int
    twitter_current_round: int = 0
    reddit_current_round: int = 0
    twitter_completed: bool = False
    reddit_completed: bool = False
    twitter_actions_count: int = 0
    reddit_actions_count: int = 0
    agent_count: int = 0
    convergence_achieved: bool = False
    final_states: list = Field(default_factory=list)


class InterviewRequest(BaseModel):
    agent_id: str
    platform: str = "both"
    question: str = ""


class BatchInterviewRequest(BaseModel):
    agent_ids: list[str] = Field(default_factory=list)
    platform: str = "both"
    question: str = ""


class GraphNode(BaseModel):
    id: str
    name: str
    type: str  # Agent | Entity | Event | Location | Concept
    properties: dict = Field(default_factory=dict)


class GraphEdge(BaseModel):
    source: str
    target: str
    type: str  # follows | mentions | retweets | believes | influences
    weight: float = 1.0
    label: str = ""


class KGData(BaseModel):
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
