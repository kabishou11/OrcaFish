from __future__ import annotations
"""OrcaFish OASIS Runner — manages agent-based social simulation"""
import os
import asyncio
import json
import subprocess
import uuid
import random
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, ClassVar, Dict, List, Optional, Tuple
from backend.simulation.config import sim_config
from backend.simulation.ipc import SimulationIPC

_CREATE_TASK = asyncio.create_task

SCENARIO_STOPWORDS = {
    "当前", "局势", "情况", "发展", "相关", "影响", "未来", "预测", "推演", "研判",
    "风险", "事件", "行动", "平台", "工作台", "报告", "内容", "趋势", "变化", "小时",
    "小时内", "内的", "以及", "结合", "以下", "请基于", "构建", "关键", "参与方", "关系图谱",
}

TWITTER_ROLE_LIBRARY = [
    ("信息广场角色 1", "外交追踪员", "审慎观察"),
    ("信息广场角色 2", "政策解读员", "快速放大"),
    ("信息广场角色 3", "风险预警员", "偏谨慎"),
    ("信息广场角色 4", "地区记者", "现场更新"),
    ("信息广场角色 5", "市场观察员", "关注波动"),
    ("信息广场角色 6", "军事动态观察员", "持续升温"),
    ("信息广场角色 7", "舆情追踪员", "情绪放大"),
    ("信息广场角色 8", "国际评论员", "平衡分析"),
]

REDDIT_ROLE_LIBRARY = [
    ("话题社区角色 1", "版主", "维持讨论"),
    ("话题社区角色 2", "深度评论者", "长文分析"),
    ("话题社区角色 3", "消息搬运者", "快速转述"),
    ("话题社区角色 4", "怀疑派用户", "质疑论证"),
    ("话题社区角色 5", "地区观察者", "补充背景"),
    ("话题社区角色 6", "风险爱好者", "聚焦最坏路径"),
]


def _extract_scenario_terms(seed_topic: str, requirement: str) -> List[str]:
    text = f"{seed_topic}\n{requirement}".strip()
    chinese_terms = re.findall(r"[\u4e00-\u9fff]{2,8}", text)
    english_terms = re.findall(r"\b[A-Za-z][A-Za-z0-9\-]{2,20}\b", text)
    ordered: List[str] = []
    for term in chinese_terms + english_terms:
        cleaned = term.strip()
        if not cleaned or cleaned in SCENARIO_STOPWORDS:
            continue
        if cleaned not in ordered:
            ordered.append(cleaned)
    fallback_terms = ["地区安全", "外交斡旋", "军事动态", "舆论走向", "供应链风险", "政策回应"]
    return (ordered[:8] or fallback_terms)[:8]


def _build_agent_profiles(enable_twitter: bool, enable_reddit: bool) -> Dict[str, Dict[str, str]]:
    profiles: Dict[str, Dict[str, str]] = {}
    if enable_twitter:
        for index, (display_name, role, stance) in enumerate(TWITTER_ROLE_LIBRARY):
            profiles[f"agent_tw_{index}"] = {
                "display_name": display_name,
                "role": role,
                "stance": stance,
                "platform": "twitter",
            }
    if enable_reddit:
        for index, (display_name, role, stance) in enumerate(REDDIT_ROLE_LIBRARY):
            profiles[f"agent_rd_{index}"] = {
                "display_name": display_name,
                "role": role,
                "stance": stance,
                "platform": "reddit",
            }
    return profiles


def _build_action_content(
    rng: random.Random,
    profile: Dict[str, str],
    action_type: str,
    scenario_terms: List[str],
    round_num: int,
) -> str:
    topic = rng.choice(scenario_terms)
    supporting = rng.choice(scenario_terms)
    stance = profile["stance"]
    role = profile["role"]
    if action_type in {"CREATE_POST", "REPLY", "COMMENT"}:
        templates = [
            f"{role}判断 {topic} 在第{round_num}轮继续发酵，{supporting} 将成为下一阶段的连锁变量。",
            f"围绕 {topic} 的讨论明显升温，{role} 更关注 {supporting} 对地区稳定的外溢影响。",
            f"{role}提示：若 {topic} 持续升级，接下来最值得盯的是 {supporting} 的同步变化。",
        ]
        return rng.choice(templates)
    if action_type in {"RETWEET", "REPOST", "SHARE"}:
        return f"转发并放大：{topic} 的最新动向已牵动 {supporting}，当前立场偏向“{stance}”。"
    if action_type in {"LIKE_POST", "UPVOTE"}:
        return f"认同该判断：{topic} 与 {supporting} 的耦合正在增强。"
    if action_type in {"DOWNVOTE"}:
        return f"质疑该判断：目前 {topic} 的证据链还不足以支持 {supporting} 必然升级。"
    if action_type in {"FOLLOW"}:
        return f"开始持续关注 {topic}，以便追踪 {supporting} 的后续变化。"
    return f"{role}继续围绕 {topic} 跟踪 {supporting} 的演化。"


@dataclass
class SimulationStatus:
    status: str = "idle"  # idle/starting/running/paused/completed/failed
    current_round: int = 0
    total_rounds: int = 40
    recent_actions: List[Dict[str, Any]] = field(default_factory=list)
    pid: Optional[int] = None
    is_mock: bool = True  # 标识是否为 mock 模式


class OASISRunner:
    """
    Manages OASIS simulation subprocess lifecycle.
    Ported from MiroFish/backend/scripts/run_parallel_simulation.py

    OASIS (Open Agent Social Interaction Simulations) from camel-ai
    simulates Twitter/Reddit agents interacting on a topic.
    """

    _shared_sim_states: ClassVar[Dict[str, Dict[str, Any]]] = {}
    # 惰性初始化：每个 simulation_id 对应一把锁，保护 start() 的状态机检查
    _sim_locks: ClassVar[Dict[str, asyncio.Lock]] = {}

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(
            os.path.dirname(__file__), "..", "..", "data", "simulations"
        )
        os.makedirs(self.data_dir, exist_ok=True)
        # 保存每个仿真的运行状态和背景任务
        self._sim_states = self._shared_sim_states

    def create_simulation(self, config: dict) -> Tuple[str, str]:
        """
        Create a new simulation instance.

        Args:
            config: simulation config dict with:
                - project_id, graph_id, simulation_id
                - profiles (agent profiles list)
                - simulation_config (time/event/agent settings)

        Returns:
            (simulation_id, working_directory)
        """
        sim_id = config.get("simulation_id", f"sim_{uuid.uuid4().hex[:12]}")
        sim_dir = os.path.join(self.data_dir, sim_id)
        os.makedirs(sim_dir, exist_ok=True)

        # Save config
        config_path = os.path.join(sim_dir, "simulation_config.json")
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)

        return sim_id, sim_dir

    async def start(
        self,
        simulation_id: str,
        sim_dir: str,
        max_rounds: int = 40,
        enable_twitter: bool = True,
        enable_reddit: bool = True,
    ) -> SimulationStatus:
        """
        Start simulation — 基于议题与角色模板生成可轮询的未来路径事件流。

        当前仍不是外部多智能体真实对战，而是规则驱动的预演引擎：
        它会结合议题种子、预测要求、平台角色和轮次推进生成更贴题的行动流，
        写入 actions.jsonl 后由前端实时轮询展示。
        """
        total_rounds = max_rounds
        # Load config for agent profiles
        config_path = os.path.join(sim_dir, "simulation_config.json")
        seed_topic = ""
        simulation_requirement = ""
        if os.path.exists(config_path):
            with open(config_path, encoding="utf-8") as f:
                cfg = json.load(f)
                total_rounds = cfg.get("time_config", {}).get("total_rounds", max_rounds)
                seed_topic = cfg.get("seed_content", "")
                simulation_requirement = cfg.get("simulation_requirement", "")

        agent_profiles = _build_agent_profiles(enable_twitter, enable_reddit)
        twitter_agents = [agent_id for agent_id, profile in agent_profiles.items() if profile["platform"] == "twitter"]
        reddit_agents = [agent_id for agent_id, profile in agent_profiles.items() if profile["platform"] == "reddit"]

        action_types_twitter = ["CREATE_POST", "RETWEET", "LIKE_POST", "REPLY", "FOLLOW"]
        action_types_reddit = ["CREATE_POST", "UPVOTE", "DOWNVOTE", "COMMENT", "REPLY"]
        scenario_terms = _extract_scenario_terms(seed_topic, simulation_requirement)
        rng = random.Random(f"{simulation_id}|{seed_topic}|{simulation_requirement}")

        actions_path = os.path.join(sim_dir, "actions.jsonl")
        if simulation_id not in OASISRunner._sim_locks:
            OASISRunner._sim_locks[simulation_id] = asyncio.Lock()
        sim_lock = OASISRunner._sim_locks[simulation_id]

        async def _mock_simulation_loop():
            """后台规则预演循环"""
            try:
                for round_num in range(1, total_rounds + 1):
                    state = self._sim_states.get(simulation_id)
                    if not state or state.get("status") != "running":
                        break

                    num_actions = rng.randint(4, 8)
                    for _ in range(num_actions):
                        state = self._sim_states.get(simulation_id)
                        if not state or state.get("status") != "running":
                            break

                        is_twitter = rng.random() > 0.4
                        if is_twitter and twitter_agents:
                            agent_id = rng.choice(twitter_agents)
                            action_type = rng.choice(action_types_twitter)
                            platform = "twitter"
                            profile = agent_profiles[agent_id]
                        elif reddit_agents:
                            agent_id = rng.choice(reddit_agents)
                            action_type = rng.choice(action_types_reddit)
                            platform = "reddit"
                            profile = agent_profiles[agent_id]
                        else:
                            continue

                        topic = rng.choice(scenario_terms)
                        signal = rng.choice(scenario_terms)
                        content = _build_action_content(rng, profile, action_type, scenario_terms, round_num)

                        action = {
                            "id": f"act_{simulation_id}_{round_num}_{uuid.uuid4().hex[:8]}",
                            "agent_id": agent_id,
                            "agent_name": profile["display_name"],
                            "action_type": action_type,
                            "platform": platform,
                            "action_args": {
                                "content": content,
                                "topic": topic,
                                "signal": signal,
                                "role": profile["role"],
                                "stance": profile["stance"],
                            },
                            "round_num": round_num,
                            "timestamp": datetime.now(UTC).isoformat().replace('+00:00', 'Z'),
                        }

                        async with state["lock"]:
                            latest_state = self._sim_states.get(simulation_id)
                            if not latest_state or latest_state.get("status") != "running":
                                break

                            # 追加写入 actions.jsonl
                            with open(actions_path, "a", encoding="utf-8") as f:
                                f.write(json.dumps(action, ensure_ascii=False) + "\n")

                            # 更新内存中的状态
                            latest_state["current_round"] = round_num
                            latest_state["recent_actions"].append(action)

                    await asyncio.sleep(rng.uniform(0.3, 0.8))
            except asyncio.CancelledError:
                async with sim_lock:
                    latest_state = self._sim_states.get(simulation_id)
                    if latest_state is not None:
                        latest_state["task"] = None
                raise
            except Exception:
                async with sim_lock:
                    latest_state = self._sim_states.get(simulation_id)
                    if latest_state is not None:
                        latest_state["task"] = None
                        if latest_state.get("status") == "running":
                            latest_state["status"] = "failed"
                raise
            else:
                async with sim_lock:
                    latest_state = self._sim_states.get(simulation_id)
                    if latest_state is not None:
                        latest_state["task"] = None
                        if latest_state.get("status") == "running":
                            # 正常走完所有轮次
                            latest_state["status"] = "completed"
                            latest_state["current_round"] = total_rounds

        # 原子化执行幂等检查、状态初始化和 task 创建
        async with sim_lock:
            existing = self._sim_states.get(simulation_id)
            if existing is not None and existing.get("status") == "running":
                return SimulationStatus(
                    status=existing.get("status", "running"),
                    current_round=existing.get("current_round", 0),
                    total_rounds=existing.get("total_rounds", total_rounds),
                    is_mock=True,
                )

            if existing is None or existing.get("status") in ("idle", "completed", "failed", "paused"):
                with open(actions_path, "w", encoding="utf-8") as f:
                    pass

            state = {
                "status": "running",
                "current_round": 0,
                "total_rounds": total_rounds,
                "recent_actions": [],
                "lock": asyncio.Lock(),
                "task": None,
            }
            task = _CREATE_TASK(_mock_simulation_loop())
            state["task"] = task
            self._sim_states[simulation_id] = state

        status = SimulationStatus(
            status="running",
            current_round=0,
            total_rounds=total_rounds,
            is_mock=True,
        )
        return status

    async def get_status(self, simulation_id: str) -> SimulationStatus:
        """Poll simulation status — 从内存状态或 actions.jsonl 读取"""
        sim_dir = os.path.join(self.data_dir, simulation_id)
        actions_path = os.path.join(sim_dir, "actions.jsonl")
        config_path = os.path.join(sim_dir, "simulation_config.json")
        configured_total_rounds = 40

        if os.path.exists(config_path):
            try:
                with open(config_path, encoding="utf-8") as f:
                    cfg = json.load(f)
                configured_total_rounds = cfg.get("time_config", {}).get("total_rounds", cfg.get("max_rounds", 40))
            except Exception:
                configured_total_rounds = 40

        # 优先从内存状态读取（仿真进行中）
        if simulation_id in self._sim_states:
            state = self._sim_states[simulation_id]
            status = SimulationStatus(
                status=state["status"],
                current_round=state["current_round"],
                total_rounds=state.get("total_rounds", configured_total_rounds),
                recent_actions=state["recent_actions"][-5:] if state["recent_actions"] else [],
                is_mock=True,
            )
            return status

        # 仿真已结束或未找到，从 actions.jsonl 重建状态
        status = SimulationStatus(status="unknown", total_rounds=configured_total_rounds, is_mock=True)
        if os.path.exists(actions_path):
            try:
                with open(actions_path, encoding="utf-8") as f:
                    lines = f.readlines()
                if lines:
                    actions = [json.loads(l) for l in lines]
                    status.current_round = max((a.get("round_num", 0) for a in actions), default=0)
                    status.total_rounds = configured_total_rounds
                    status.recent_actions = actions[-5:]
                    status.status = "completed" if status.current_round >= status.total_rounds else "running"
            except Exception:
                pass

        return status

    async def stop(self, simulation_id: str) -> bool:
        """Stop simulation — 标记状态为 paused 并取消后台任务"""
        state = self._sim_states.get(simulation_id)
        if not state:
            return True

        async with state["lock"]:
            latest_state = self._sim_states.get(simulation_id)
            if latest_state:
                latest_state["status"] = "paused"
            task = latest_state.get("task") if latest_state else None

        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        latest_state = self._sim_states.get(simulation_id)
        if latest_state:
            latest_state["task"] = None
        return True

