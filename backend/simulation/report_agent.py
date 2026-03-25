"""OrcaFish Simulation ReportAgent — ReAct pattern prediction from simulation"""
import os
import json
from datetime import datetime
from typing import Optional
from backend.llm.client import LLMClient
from backend.simulation.oasis_runner import OASISRunner
from backend.simulation.ipc import SimulationIPC


class SimulationReportAgent:
    """
    Generates prediction reports from simulation results.
    Uses ReAct pattern with graph memory tools.
    Ported from MiroFish/backend/app/services/report_agent.py
    """

    PLANNING_PROMPT = """你是一个情景推演报告撰写专家。
基于以下仿真结果，撰写一份预测性分析报告。

仿真主题：{requirement}
仿真轮数：{rounds}
总行动数：{action_count}

仿真中的关键行动轨迹：
{action_summary}

请设计报告结构，包括：
1. 情景概述
2. 三种可能演化路径（乐观/中性/悲观）
3. 早期预警指标
4. 建议的应对策略

以JSON格式输出章节结构："""

    REPORT_PROMPT = """基于以下仿真行动数据，撰写完整的情景推演报告。

仿真主题：{requirement}
关键实体：{entities}
行动轨迹：{actions}

请撰写一份3000-5000字的情景推演报告，包含：
- 执行摘要
- 情景A（大概率路径）：详细描述和概率评估
- 情景B（次大概率路径）：详细描述和概率评估
- 情景C（黑天鹅路径）：详细描述和概率评估
- 早期预警信号
- 决策建议

使用Markdown格式输出："""

    def __init__(self, llm_client: LLMClient):
        self.llm = llm_client
        self._runner = OASISRunner()
        self._ipc = SimulationIPC()

    async def generate(
        self,
        simulation_id: str,
        simulation_requirement: str = "",
        sim_dir: str = "",
    ) -> dict:
        """
        Generate prediction report from simulation results.

        Returns:
            dict with "report_id", "markdown_content", "outline"
        """
        from backend.models.simulation import PredictionReport

        report_id = f"pred_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"

        # Load simulation action logs
        actions = []
        if sim_dir:
            actions_path = os.path.join(sim_dir, "actions.jsonl")
            if os.path.exists(actions_path):
                with open(actions_path, encoding="utf-8") as f:
                    for line in f:
                        try:
                            actions.append(json.loads(line))
                        except Exception:
                            pass

        # Get entity list
        entities = []
        config_path = os.path.join(sim_dir, "simulation_config.json") if sim_dir else ""
        if config_path and os.path.exists(config_path):
            with open(config_path, encoding="utf-8") as f:
                cfg = json.load(f)
                entities = [
                    a.get("entity_name", "")
                    for a in cfg.get("agent_configs", [])
                    if a.get("entity_name")
                ]

        action_summary = "\n".join(
            f"- Round {a.get('round_num', '?')}: {a.get('agent_name', 'Agent')} "
            f"{a.get('action_type', '')}"
            for a in actions[:20]
        ) if actions else "（仿真数据收集不足）"

        # Generate report
        report_content = await self.llm.invoke(
            system_prompt="你是一个专业的情景推演和预测分析专家。",
            user_prompt=self.REPORT_PROMPT.format(
                requirement=simulation_requirement,
                entities=", ".join(entities[:10]),
                actions=action_summary or "无",
            ),
            max_tokens=8192,
        )

        return {
            "report_id": report_id,
            "simulation_id": simulation_id,
            "status": "completed",
            "markdown_content": report_content,
            "created_at": datetime.utcnow().isoformat(),
        }
