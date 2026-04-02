from __future__ import annotations
"""OrcaFish OASIS Runner — manages agent-based social simulation"""
import os
import asyncio
import json
import subprocess
import uuid
import random
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from backend.simulation.config import sim_config
from backend.simulation.ipc import SimulationIPC


@dataclass
class SimulationStatus:
    status: str = "idle"  # idle/starting/running/paused/completed/failed
    current_round: int = 0
    total_rounds: int = 40
    recent_actions: list[dict] = field(default_factory=list)
    pid: Optional[int] = None
    is_mock: bool = True  # 标识是否为 mock 模式


class OASISRunner:
    """
    Manages OASIS simulation subprocess lifecycle.
    Ported from MiroFish/backend/scripts/run_parallel_simulation.py

    OASIS (Open Agent Social Interaction Simulations) from camel-ai
    simulates Twitter/Reddit agents interacting on a topic.
    """

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(
            os.path.dirname(__file__), "..", "..", "data", "simulations"
        )
        os.makedirs(self.data_dir, exist_ok=True)
        # 保存每个仿真的运行状态和背景任务
        self._sim_states: dict[str, dict] = {}

    def create_simulation(self, config: dict) -> tuple[str, str]:
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
        Start OASIS simulation — real async mock loop.

        生成模拟的 Twitter/Reddit 代理动作，写入 actions.jsonl，
        轮次逐步推进，前端轮询可实时看到进度。
        """
        total_rounds = max_rounds
        # Load config for agent profiles
        config_path = os.path.join(sim_dir, "simulation_config.json")
        seed_topic = ""
        if os.path.exists(config_path):
            with open(config_path, encoding="utf-8") as f:
                cfg = json.load(f)
                total_rounds = cfg.get("time_config", {}).get("total_rounds", max_rounds)
                seed_topic = cfg.get("seed_content", "")

        # 生成模拟代理池（Twitter + Reddit 各若干个）
        twitter_agents = [
            f"agent_tw_{i}" for i in range(8)
        ]
        reddit_agents = [
            f"agent_rd_{i}" for i in range(6)
        ]

        action_types_twitter = ["CREATE_POST", "RETWEET", "LIKE_POST", "REPLY", "FOLLOW"]
        action_types_reddit = ["CREATE_POST", "UPVOTE", "DOWNVOTE", "COMMENT", "REPLY"]
        topics = [
            seed_topic or "全球局势",
            "外交斡旋", "经济制裁", "军事动态", "舆论走向",
            "国际合作", "地区安全", "人道危机",
        ]

        actions_path = os.path.join(sim_dir, "actions.jsonl")
        # 初始化/清空 actions 文件
        with open(actions_path, "w", encoding="utf-8") as f:
            pass

        async def _mock_simulation_loop():
            """后台异步仿真循环"""
            for round_num in range(1, total_rounds + 1):
                # 模拟每轮 3-8 个动作
                num_actions = random.randint(3, 8)
                for _ in range(num_actions):
                    is_twitter = random.random() > 0.4
                    if is_twitter and twitter_agents:
                        agent_id = random.choice(twitter_agents)
                        action_type = random.choice(action_types_twitter)
                        platform = "twitter"
                        agent_name = f"@{agent_id.replace('agent_tw_', 'TW')}"
                        content = f"观点{random.randint(10,99)}：{random.choice(topics)} #{random.choice(topics)}"
                    elif reddit_agents:
                        agent_id = random.choice(reddit_agents)
                        action_type = random.choice(action_types_reddit)
                        platform = "reddit"
                        agent_name = f"u/{agent_id.replace('agent_rd_', 'RD')}"
                        content = f"讨论帖{random.randint(100,999)}：{random.choice(topics)}"
                    else:
                        continue

                    action = {
                        "id": f"act_{simulation_id}_{round_num}_{uuid.uuid4().hex[:8]}",
                        "agent_id": agent_id,
                        "agent_name": agent_name,
                        "action_type": action_type,
                        "platform": platform,
                        "action_args": {"content": content, "topic": random.choice(topics)},
                        "round_num": round_num,
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                    }

                    # 追加写入 actions.jsonl
                    with open(actions_path, "a", encoding="utf-8") as f:
                        f.write(json.dumps(action, ensure_ascii=False) + "\n")

                    # 更新内存中的状态
                    if simulation_id in self._sim_states:
                        self._sim_states[simulation_id]["current_round"] = round_num
                        self._sim_states[simulation_id]["recent_actions"].append(action)

                # 模拟网络延迟，每轮间隔 0.3-0.8 秒
                await asyncio.sleep(random.uniform(0.3, 0.8))

            # 仿真完成
            if simulation_id in self._sim_states:
                self._sim_states[simulation_id]["status"] = "completed"
                self._sim_states[simulation_id]["current_round"] = total_rounds

        # 初始化仿真状态
        self._sim_states[simulation_id] = {
            "status": "running",
            "current_round": 0,
            "total_rounds": total_rounds,
            "recent_actions": [],
        }

        # 启动后台任务（不阻塞）
        asyncio.create_task(_mock_simulation_loop())

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

        # 优先从内存状态读取（仿真进行中）
        if simulation_id in self._sim_states:
            state = self._sim_states[simulation_id]
            status = SimulationStatus(
                status=state["status"],
                current_round=state["current_round"],
                total_rounds=state["total_rounds"],
                recent_actions=state["recent_actions"][-5:] if state["recent_actions"] else [],
                is_mock=True,
            )
            return status

        # 仿真已结束或未找到，从 actions.jsonl 重建状态
        status = SimulationStatus(status="unknown", is_mock=True)
        if os.path.exists(actions_path):
            try:
                with open(actions_path, encoding="utf-8") as f:
                    lines = f.readlines()
                if lines:
                    actions = [json.loads(l) for l in lines]
                    status.current_round = max((a.get("round_num", 0) for a in actions), default=0)
                    status.total_rounds = max((a.get("round_num", 0) for a in actions), default=40)
                    status.recent_actions = actions[-5:]
                    status.status = "completed" if status.current_round >= status.total_rounds else "running"
            except Exception:
                pass

        return status

    async def stop(self, simulation_id: str) -> bool:
        """Stop simulation — 标记状态为 paused"""
        if simulation_id in self._sim_states:
            self._sim_states[simulation_id]["status"] = "paused"
        return True

