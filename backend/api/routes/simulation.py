from __future__ import annotations
"""OrcaFish Simulation API Routes"""
import uuid
import os
import json
from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from backend.models.simulation import (
    SimulationCreateRequest, VariableInjection,
    AgentProfile, AgentStats, RoundSummary,
    SimulationRunState, InterviewRequest, BatchInterviewRequest,
    KGData, GraphNode, GraphEdge
)
from backend.simulation import (
    OntologyGenerator, GraphBuilder, OASISRunner, SimulationIPC, SimulationReportAgent
)
from backend.simulation.manager import SimulationManager
from backend.simulation.runner import SimulationRunner
from backend.llm.client import LLMClient
from backend.config import settings

router = APIRouter(prefix="/simulation", tags=["Simulation"])

# In-memory simulation run registry (replace with DB in production)
_run_registry: dict[str, dict] = {}

# Default scenarios
_DEFAULT_SCENARIOS = [
    {"id": "default", "name": "通用情景", "description": "基于通用议题的默认仿真配置"},
    {"id": "military", "name": "军事冲突", "description": "模拟军事冲突升级与各方反应"},
    {"id": "diplomatic", "name": "外交博弈", "description": "模拟多国外交斡旋与谈判过程"},
    {"id": "economic", "name": "经济制裁", "description": "模拟经济制裁影响与反制措施"},
]


# ── Scenarios ──────────────────────────────────────────────────────────────────

class Scenario(BaseModel):
    id: str
    name: str
    description: str


@router.get("/scenarios")
async def list_scenarios() -> dict:
    """List available simulation scenarios"""
    return {"scenarios": _DEFAULT_SCENARIOS}


# ── Runs ───────────────────────────────────────────────────────────────────────

@router.get("/runs")
async def list_runs() -> dict:
    """List all simulation runs"""
    return {"runs": list(_run_registry.values())}


@router.post("/runs")
async def create_run(req: SimulationCreateRequest) -> dict:
    """Create a new simulation run without starting it immediately"""
    run_id = f"run_{uuid.uuid4().hex[:12]}"
    sim_id = f"sim_{uuid.uuid4().hex[:12]}"

    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    os.makedirs(data_dir, exist_ok=True)
    sim_dir = os.path.join(data_dir, sim_id)
    os.makedirs(sim_dir, exist_ok=True)

    config_path = os.path.join(sim_dir, "simulation_config.json")
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump({
            "simulation_id": sim_id,
            "name": req.name,
            "seed_content": req.seed_content,
            "simulation_requirement": req.simulation_requirement,
            "time_config": {"total_rounds": req.max_rounds},
            "max_rounds": req.max_rounds,
            "enable_twitter": req.enable_twitter,
            "enable_reddit": req.enable_reddit,
        }, f, ensure_ascii=False, indent=2)

    # Register the run
    run = {
        "run_id": run_id,
        "simulation_id": sim_id,
        "status": "created",
        "rounds_completed": 0,
        "convergence_achieved": False,
        "scenario": req.name,
        "max_rounds": req.max_rounds,
        "created_at": datetime.utcnow().isoformat(),
        "final_states": [],
        "duration_ms": None,
        "seed_content": req.seed_content,
        "simulation_requirement": req.simulation_requirement,
    }
    _run_registry[run_id] = run

    return run


@router.delete("/runs/{run_id}")
async def delete_run(run_id: str) -> dict:
    """Delete a simulation run"""
    if run_id in _run_registry:
        del _run_registry[run_id]
    return {"status": "deleted", "run_id": run_id}


@router.get("/runs/{run_id}")
async def get_run(run_id: str) -> dict:
    """Get a specific simulation run"""
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")
    return _run_registry[run_id]


async def _run_simulation_bg(run_id: str, sim_id: str, req: SimulationCreateRequest):
    """Background simulation执行 — 启动 OASIS mock 循环，等待完成后写入 final_states"""
    import asyncio

    _run_registry[run_id]["status"] = "running"

    try:
        data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
        os.makedirs(data_dir, exist_ok=True)
        sim_dir = os.path.join(data_dir, sim_id)
        os.makedirs(sim_dir, exist_ok=True)

        # 写入配置文件（供 mock loop 读取 seed_content）
        config_path = os.path.join(sim_dir, "simulation_config.json")
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump({
                "simulation_id": sim_id,
                "seed_content": req.seed_content,
                "time_config": {"total_rounds": req.max_rounds},
            }, f, ensure_ascii=False)

        runner = OASISRunner(data_dir=data_dir)
        # 启动异步 mock 仿真（立即返回，后台跑）
        await runner.start(
            simulation_id=sim_id,
            sim_dir=sim_dir,
            max_rounds=req.max_rounds,
        )

        # 轮询等待仿真完成
        for _ in range(600):  # 最多等 5 分钟
            await asyncio.sleep(0.5)
            status = await runner.get_status(sim_id)
            # 实时更新 registry，前端能看到进度
            _run_registry[run_id]["rounds_completed"] = status.current_round
            _run_registry[run_id]["status"] = status.status
            if status.status in ("completed", "failed", "paused"):
                break

        # 仿真结束，加载 final_states（从 actions.jsonl 提取 agent 信息）
        final_states = []
        actions_file = os.path.join(sim_dir, "actions.jsonl")
        if os.path.exists(actions_file):
            seen_agents: dict[str, dict] = {}
            with open(actions_file, encoding='utf-8') as f:
                for line in f:
                    if line.strip():
                        try:
                            entry = json.loads(line)
                            agent_id = entry.get("agent_id", "")
                            if agent_id and agent_id not in seen_agents:
                                seen_agents[agent_id] = {
                                    "actions": 0,
                                    "belief_sum": 0.0,
                                    "influence_sum": 0.0,
                                }
                            if agent_id in seen_agents:
                                seen_agents[agent_id]["actions"] += 1
                                # 模拟信念漂移：不同平台/轮次有不同信念
                                base = hash(agent_id) % 100 / 100
                                seen_agents[agent_id]["belief_sum"] += 0.3 + base * 0.5
                                seen_agents[agent_id]["influence_sum"] += 0.2 + (seen_agents[agent_id]["actions"] / 50)
                        except Exception:
                            pass

            for aid, s in seen_agents.items():
                import random as _r
                belief = min(s["belief_sum"] / max(s["actions"], 1), 0.99)
                influence = min(s["influence_sum"] / max(s["actions"], 1), 0.99)
                # 在 [-1, 1] 范围内生成位置
                px = _r.uniform(-0.9, 0.9)
                py = _r.uniform(-0.9, 0.9)
                final_states.append({
                    "id": aid,
                    "position": [px, py],
                    "belief": round(belief, 4),
                    "influence": round(influence, 4),
                    "actions": s["actions"],
                })

        _run_registry[run_id]["final_states"] = final_states
        _run_registry[run_id]["convergence_achieved"] = (
            _run_registry[run_id]["status"] == "completed"
        )

    except Exception as e:
        _run_registry[run_id]["status"] = "failed"
        _run_registry[run_id]["error"] = str(e)


# ── Existing endpoints ────────────────────────────────────────────────────────

@router.post("/create")
async def create_simulation(req: SimulationCreateRequest) -> dict:
    """Create a new simulation project with Zep CE knowledge graph"""
    from backend.graph import GraphBuilder

    # 通过 Zep CE HTTP 接口创建图谱
    builder = GraphBuilder()  # 从 config 读取 zep_base_url / zep_api_secret
    graph_id = builder.create_graph(name=req.name)
    # 将 seed_content 分块写入
    chunks = [req.seed_content[i:i+500] for i in range(0, min(len(req.seed_content), 5000), 500)]
    builder.add_text_batch(graph_id, chunks)

    sim_id = f"sim_{uuid.uuid4().hex[:12]}"
    runner = OASISRunner()
    sim_id_out, sim_dir = runner.create_simulation({
        "simulation_id": sim_id,
        "project_id": graph_id,
        "graph_id": graph_id,
    })

    graph_info = builder.get_graph_info(graph_id)
    return {
        "project_id": graph_id,
        "simulation_id": sim_id_out,
        "graph_id": graph_id,
        "ontology": {},
        "entity_count": graph_info.node_count,
    }


@router.post("/{simulation_id}/start")
async def start_simulation(simulation_id: str) -> dict:
    """Start a simulation"""
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    sim_dir = os.path.join(data_dir, simulation_id)
    runner = OASISRunner(data_dir=data_dir)
    status = await runner.start(
        simulation_id=simulation_id,
        sim_dir=sim_dir,
        max_rounds=settings.simulation_rounds,
    )
    return {"simulation_id": simulation_id, "status": status.status}


@router.post("/{simulation_id}/inject")
async def inject_variable(
    simulation_id: str,
    req: VariableInjection,
) -> dict:
    """God-mode variable injection into simulation"""
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    sim_dir = os.path.join(data_dir, simulation_id)
    ipc = SimulationIPC(sim_dir)
    result = await ipc.interview_all_agents(
        simulation_id=simulation_id,
        prompt=f"【系统外部事件注入】{req.description}，变量: {req.variable}={req.value}",
    )
    return {"result": result}


@router.get("/{simulation_id}/status")
async def get_status(simulation_id: str) -> dict:
    """Get simulation status"""
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    runner = OASISRunner(data_dir=data_dir)
    status = await runner.get_status(simulation_id)
    return {
        "simulation_id": simulation_id,
        "status": status.status,
        "current_round": status.current_round,
        "total_rounds": status.total_rounds,
        "recent_actions": status.recent_actions,
    }


# ── MiroFish Integration ──────────────────────────────────────────────────────

@router.get("/runs/{run_id}/detail")
async def get_run_detail(run_id: str) -> dict:
    """Get detailed simulation run information including actions"""
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")

    run = _run_registry[run_id]
    sim_id = run.get("simulation_id")

    # Load action details
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    actions_file = os.path.join(data_dir, sim_id, "actions.jsonl")

    actions = []
    if os.path.exists(actions_file):
        with open(actions_file, encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    actions.append(json.loads(line))

    return {
        **run,
        "all_actions": actions[-100:],  # Last 100 — key matches SimulationStreamPanel expectation
    }


@router.post("/runs/{run_id}/start")
async def start_run(run_id: str) -> dict:
    """Start a created simulation run"""
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")

    run = _run_registry[run_id]
    if run["status"] not in {"created", "paused", "failed"}:
        raise HTTPException(status_code=400, detail="Run already started")

    run["status"] = "running"
    req = SimulationCreateRequest(
        name=run.get("scenario", "仿真推演"),
        seed_content=run.get("seed_content", ""),
        simulation_requirement=run.get("simulation_requirement", ""),
        max_rounds=run.get("max_rounds", settings.simulation_rounds),
    )
    import asyncio
    asyncio.create_task(_run_simulation_bg(run_id, run["simulation_id"], req))
    return run


@router.post("/runs/{run_id}/stop")
async def stop_run(run_id: str) -> dict:
    """Stop a running simulation run"""
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")

    run = _run_registry[run_id]
    sim_id = run.get("simulation_id")
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    runner = OASISRunner(data_dir=data_dir)
    await runner.stop(sim_id)
    run["status"] = "paused"
    return run


@router.get("/runs/{run_id}/status")
async def get_run_status(run_id: str) -> dict:
    """
    Get simulation run status — 格式与前端 SimRunStatus 接口对齐。
    返回 twitter/reddit 各自轮次和动作计数，前端 SimulationStreamPanel 轮询此接口。
    """
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")

    run = _run_registry[run_id]
    sim_id = run.get("simulation_id")
    if run.get("status") == "created":
        return {
            "simulation_id": sim_id,
            "status": "created",
            "current_round": 0,
            "total_rounds": run.get("max_rounds", settings.simulation_rounds),
            "twitter_current_round": 0,
            "reddit_current_round": 0,
            "twitter_actions_count": 0,
            "reddit_actions_count": 0,
            "twitter_completed": False,
            "reddit_completed": False,
            "recent_actions": [],
            "is_mock": True,
        }

    # 从 OASISRunner 获取实时轮次
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    runner = OASISRunner(data_dir=data_dir)
    oasis_status = await runner.get_status(sim_id)

    # 更新 registry 中的进度
    _run_registry[run_id]["rounds_completed"] = oasis_status.current_round
    _run_registry[run_id]["status"] = oasis_status.status

    # Read actions.jsonl for per-platform stats and recent_actions
    actions_file = os.path.join(data_dir, sim_id, "actions.jsonl")
    tw_actions = 0
    rd_actions = 0
    tw_max_round = 0
    rd_max_round = 0
    recent_actions = []

    if os.path.exists(actions_file):
        with open(actions_file, encoding='utf-8') as f:
            lines = f.readlines()
        for line in lines:
            if line.strip():
                try:
                    a = json.loads(line)
                    if a.get("platform") == "twitter":
                        tw_actions += 1
                        tw_max_round = max(tw_max_round, a.get("round_num", 0))
                    else:
                        rd_actions += 1
                        rd_max_round = max(rd_max_round, a.get("round_num", 0))
                except Exception:
                    pass
        # Extract meaningful recent_actions from last 20 lines of actions.jsonl
        for line in lines[-20:]:
            if line.strip():
                try:
                    a = json.loads(line)
                    desc = ""
                    args = a.get("action_args", {})
                    if args.get("content"):
                        desc = str(args["content"])[:80]
                    elif args.get("text"):
                        desc = str(args["text"])[:80]
                    elif args.get("target_user"):
                        desc = f"@{args['target_user']}"
                    elif args.get("post_id"):
                        desc = f"[post {args['post_id']}]"
                    if desc:
                        recent_actions.append({
                            "description": desc,
                            "agent": a.get("agent_name", a.get("agent_id", "")),
                            "platform": a.get("platform", ""),
                            "action_type": a.get("action_type", ""),
                        })
                except Exception:
                    pass

    total = oasis_status.total_rounds
    tw_completed = tw_max_round >= total
    rd_completed = rd_max_round >= total

    return {
        "simulation_id": sim_id,
        "status": oasis_status.status,
        "current_round": oasis_status.current_round,
        "total_rounds": total,
        "twitter_current_round": tw_max_round,
        "reddit_current_round": rd_max_round,
        "twitter_actions_count": tw_actions,
        "reddit_actions_count": rd_actions,
        "twitter_completed": tw_completed,
        "reddit_completed": rd_completed,
        "recent_actions": recent_actions if recent_actions else oasis_status.recent_actions,
        "is_mock": getattr(oasis_status, "is_mock", False),
    }


# ── Profiles ─────────────────────────────────────────────────────────────────

@router.get("/runs/{run_id}/profiles")
async def get_run_profiles(run_id: str) -> dict:
    """Get agent profiles for a simulation run"""
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")

    run = _run_registry[run_id]
    sim_id = run.get("simulation_id")
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    actions_file = os.path.join(data_dir, sim_id, "actions.jsonl")

    profiles: list[dict] = []
    seen = set()

    if os.path.exists(actions_file):
        with open(actions_file, encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    try:
                        a = json.loads(line)
                        aid = a.get("agent_id", "")
                        if aid and aid not in seen:
                            seen.add(aid)
                            profiles.append({
                                "agent_id": aid,
                                "name": a.get("agent_name", f"Agent_{aid[:6]}"),
                                "platform": a.get("platform", "twitter"),
                                "bio": f"Simulation agent for {run.get('scenario', 'scenario')}",
                                "followers": 100 + len(seen) * 23,
                                "following": 50 + len(seen) * 7,
                                "posts_count": sum(1 for p in seen),
                                "credibility_score": round(0.4 + len(seen) * 0.05, 3),
                                "influence_score": round(0.3 + len(seen) * 0.07, 3),
                                "stance": ["support", "oppose", "neutral"][len(seen) % 3],
                                "round_joined": a.get("round_num", 1),
                            })
                    except Exception:
                        pass

    return {"run_id": run_id, "profiles": profiles, "count": len(profiles)}


# ── Actions (paginated) ──────────────────────────────────────────────────────

@router.get("/runs/{run_id}/actions")
async def get_run_actions(
    run_id: str,
    platform: str | None = None,
    agent_id: str | None = None,
    round_num: int | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """Get paginated action list with filters"""
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")

    run = _run_registry[run_id]
    sim_id = run.get("simulation_id")
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    actions_file = os.path.join(data_dir, sim_id, "actions.jsonl")

    all_actions: list[dict] = []
    if os.path.exists(actions_file):
        with open(actions_file, encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    try:
                        all_actions.append(json.loads(line))
                    except Exception:
                        pass

    # Apply filters
    if platform:
        all_actions = [a for a in all_actions if a.get("platform") == platform]
    if agent_id:
        all_actions = [a for a in all_actions if a.get("agent_id") == agent_id]
    if round_num is not None:
        all_actions = [a for a in all_actions if a.get("round_num") == round_num]

    total = len(all_actions)
    page = all_actions[offset:offset + limit]

    return {
        "run_id": run_id,
        "actions": page,
        "total": total,
        "limit": limit,
        "offset": offset,
        "platform": platform or "all",
    }


# ── Timeline ─────────────────────────────────────────────────────────────────

@router.get("/runs/{run_id}/timeline")
async def get_run_timeline(run_id: str) -> dict:
    """Get round-by-round timeline summary"""
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")

    run = _run_registry[run_id]
    sim_id = run.get("simulation_id")
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    actions_file = os.path.join(data_dir, sim_id, "actions.jsonl")

    rounds: dict[int, dict] = {}
    if os.path.exists(actions_file):
        with open(actions_file, encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    try:
                        a = json.loads(line)
                        rnum = a.get("round_num", 0)
                        plat = a.get("platform", "twitter")
                        key = (rnum, plat)
                        if key not in rounds:
                            rounds[key] = {
                                "round_num": rnum,
                                "platform": plat,
                                "active_agents": set(),
                                "total_actions": 0,
                                "action_types": {},
                                "key_events": [],
                            }
                        rd = rounds[key]
                        rd["active_agents"].add(a.get("agent_id", ""))
                        rd["total_actions"] += 1
                        at = a.get("action_type", "unknown")
                        rd["action_types"][at] = rd["action_types"].get(at, 0) + 1
                        if at in ("post", "tweet") and len(rd["key_events"]) < 3:
                            content = str(a.get("action_args", {}).get("content", ""))[:100]
                            if content:
                                rd["key_events"].append(content)
                    except Exception:
                        pass

    summaries = []
    for (rnum, plat), rd in sorted(rounds.items()):
        dominant = max(rd["action_types"], key=rd["action_types"].get) if rd["action_types"] else ""
        summaries.append(RoundSummary(
            round_num=rnum,
            platform=plat,
            active_agents=len(rd["active_agents"]),
            total_actions=rd["total_actions"],
            dominant_action_type=dominant,
            avg_sentiment=0.5,
            key_events=rd["key_events"],
        ).model_dump())

    return {"run_id": run_id, "timeline": summaries, "count": len(summaries)}


# ── Agent Stats ───────────────────────────────────────────────────────────────

@router.get("/runs/{run_id}/agent-stats")
async def get_run_agent_stats(run_id: str) -> dict:
    """Get per-agent statistics"""
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")

    run = _run_registry[run_id]
    sim_id = run.get("simulation_id")
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    actions_file = os.path.join(data_dir, sim_id, "actions.jsonl")

    stats: dict[str, dict] = {}
    if os.path.exists(actions_file):
        with open(actions_file, encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    try:
                        a = json.loads(line)
                        aid = a.get("agent_id", "")
                        if not aid:
                            continue
                        if aid not in stats:
                            stats[aid] = {
                                "agent_id": aid,
                                "agent_name": a.get("agent_name", f"Agent_{aid[:6]}"),
                                "platform": a.get("platform", "twitter"),
                                "total_actions": 0,
                                "actions_by_type": {},
                                "sentiment_sum": 0.0,
                                "sentiment_count": 0,
                            }
                        s = stats[aid]
                        s["total_actions"] += 1
                        at = a.get("action_type", "unknown")
                        s["actions_by_type"][at] = s["actions_by_type"].get(at, 0) + 1
                        sent = a.get("action_args", {}).get("sentiment", 0.5)
                        s["sentiment_sum"] += float(sent)
                        s["sentiment_count"] += 1
                    except Exception:
                        pass

    result = []
    for aid, s in stats.items():
        final_state = next(
            (fs for fs in run.get("final_states", []) if fs.get("id") == aid),
            None
        )
        belief = final_state.get("belief", 0.5) if final_state else 0.5
        result.append(AgentStats(
            agent_id=aid,
            agent_name=s["agent_name"],
            platform=s["platform"],
            total_actions=s["total_actions"],
            actions_by_type=s["actions_by_type"],
            avg_sentiment=round(s["sentiment_sum"] / s["sentiment_count"], 4) if s["sentiment_count"] else 0.5,
            engagement_rate=round(s["total_actions"] * 0.12, 4),
            influence_score=round(0.2 + s["total_actions"] * 0.03, 4),
            belief_drift=round(abs(belief - 0.5) * 0.5, 4),
            final_belief=round(belief, 4),
        ).model_dump())

    return {"run_id": run_id, "stats": result, "count": len(result)}


# ── Interview ────────────────────────────────────────────────────────────────

@router.post("/runs/{run_id}/interview")
async def interview_agent(run_id: str, req: InterviewRequest) -> dict:
    """Interview a single agent via SimulationRunner (IPC or LLM)"""
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")
    run = _run_registry[run_id]
    sim_id = run.get("simulation_id")
    try:
        aid = req.agent_id
        result = SimulationRunner.interview_agent(
            simulation_id=sim_id,
            agent_id=int(aid) if str(aid).isdigit() else aid,
            prompt=req.question,
            platform=req.platform if req.platform not in ("both", None, "") else None,
        )
        return {
            "run_id": run_id,
            "agent_id": req.agent_id,
            "platform": req.platform,
            "question": req.question,
            "response": result.get("result") or result.get("error") or "",
            "success": result.get("success", False),
            "timestamp": datetime.utcnow().isoformat(),
        }
    except Exception as e:
        return {
            "run_id": run_id,
            "agent_id": req.agent_id,
            "platform": req.platform,
            "question": req.question,
            "response": f"[Interview error: {e}]",
            "success": False,
            "timestamp": datetime.utcnow().isoformat(),
        }
@router.post("/runs/{run_id}/interviews")
async def batch_interview(run_id: str, req: BatchInterviewRequest) -> dict:
    """Batch interview multiple agents via SimulationRunner"""
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")
    run = _run_registry[run_id]
    sim_id = run.get("simulation_id")
    interviews = [{"agent_id": aid, "prompt": req.question} for aid in req.agent_ids]
    try:
        result = SimulationRunner.interview_agents_batch(
            simulation_id=sim_id,
            interviews=interviews,
            platform=req.platform if req.platform not in ("both", None, "") else None,
        )
        return {
            "run_id": run_id,
            "responses": result.get("responses", []),
            "count": result.get("interviews_count", len(interviews)),
            "success": result.get("success", False),
        }
    except Exception as e:
        return {"run_id": run_id, "responses": [], "count": 0, "error": str(e)}

# ── Knowledge Graph ───────────────────────────────────────────────────────────

@router.get("/runs/{run_id}/graph")
async def get_run_graph(run_id: str) -> dict:
    """Get knowledge graph data for a run (nodes + edges)"""
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")

    run = _run_registry[run_id]
    sim_id = run.get("simulation_id")
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    actions_file = os.path.join(data_dir, sim_id, "actions.jsonl")

    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []
    seen_nodes: set[str] = set()
    agent_positions: dict[str, tuple[float, float]] = {}

    # Build from final_states (agent nodes)
    for fs in run.get("final_states", []):
        nid = fs.get("id", "")
        if nid and nid not in seen_nodes:
            seen_nodes.add(nid)
            pos = fs.get("position", [0, 0])
            agent_positions[nid] = (float(pos[0]) if len(pos) > 0 else 0.0,
                                    float(pos[1]) if len(pos) > 1 else 0.0)
            belief = fs.get("belief", 0.5)
            nodes.append(GraphNode(
                id=nid,
                name=nid[:12],
                type="Agent",
                properties={"belief": belief, "influence": fs.get("influence", 0.5)},
            ))

    # Build edges from action relationships
    if os.path.exists(actions_file):
        mentions: dict[tuple[str, str], int] = {}
        with open(actions_file, encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    try:
                        a = json.loads(line)
                        src = a.get("agent_id", "")
                        target = a.get("action_args", {}).get("target_user", "")
                        if src and target and src != target:
                            key = (src, target)
                            mentions[key] = mentions.get(key, 0) + 1
                    except Exception:
                        pass

        for (src, target), count in mentions.items():
            if src not in seen_nodes:
                seen_nodes.add(src)
                nodes.append(GraphNode(id=src, name=src[:12], type="Agent", properties={}))
            if target not in seen_nodes:
                seen_nodes.add(target)
                nodes.append(GraphNode(id=target, name=target[:12], type="Agent", properties={}))
            edges.append(GraphEdge(
                source=src, target=target,
                type="mentions",
                weight=min(count / 10.0, 1.0),
                label=f"@{target[:8]}" if len(target) > 8 else f"@{target}",
            ))

    # Connect similar-belief agents
    agents = [(n.id, n.properties.get("belief", 0.5)) for n in nodes if n.type == "Agent"]
    for i, (aid1, b1) in enumerate(agents):
        for aid2, b2 in agents[i + 1:]:
            if abs(b1 - b2) < 0.2:
                edges.append(GraphEdge(
                    source=aid1, target=aid2,
                    type="belief_similarity",
                    weight=round(1.0 - abs(b1 - b2), 3),
                    label=f"相似度 {int((1 - abs(b1 - b2)) * 100)}%",
                ))

    return KGData(nodes=nodes, edges=edges).model_dump()


# ── Prepare ──────────────────────────────────────────────────────────────────

@router.post("/prepare")
async def prepare_run(req: SimulationCreateRequest) -> dict:
    """Prepare a simulation configuration without starting it"""
    sim_id = f"sim_{uuid.uuid4().hex[:12]}"
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    sim_dir = os.path.join(data_dir, sim_id)
    os.makedirs(sim_dir, exist_ok=True)

    config_path = os.path.join(sim_dir, "simulation_config.json")
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump({
            "simulation_id": sim_id,
            "name": req.name,
            "seed_content": req.seed_content,
            "simulation_requirement": req.simulation_requirement,
            "max_rounds": req.max_rounds,
            "enable_twitter": req.enable_twitter,
            "enable_reddit": req.enable_reddit,
        }, f, ensure_ascii=False)

    return {
        "simulation_id": sim_id,
        "config_path": config_path,
        "status": "ready",
    }


# ── Report ───────────────────────────────────────────────────────────────────

@router.get("/report/{run_id}")
async def get_simulation_report(run_id: str) -> dict:
    """
    Generate and return HTML report for a simulation run.
    Frontend ReportViewer expects { html_content: string }.
    """
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")

    run = _run_registry[run_id]
    sim_id = run.get("simulation_id", "")
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    actions_file = os.path.join(data_dir, sim_id, "actions.jsonl")

    # Collect stats from actions.jsonl
    tw_count = rd_count = tw_max = rd_max = 0
    action_types: dict[str, int] = {}
    agents: list[str] = []
    seen_agents = set()
    recent_events: list[str] = []

    if os.path.exists(actions_file):
        with open(actions_file, encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    try:
                        a = json.loads(line)
                        plat = a.get("platform", "twitter")
                        rnum = a.get("round_num", 0)
                        at = a.get("action_type", "unknown")
                        action_types[at] = action_types.get(at, 0) + 1
                        if plat == "twitter":
                            tw_count += 1
                            tw_max = max(tw_max, rnum)
                        else:
                            rd_count += 1
                            rd_max = max(rd_max, rnum)
                        aid = a.get("agent_id", "")
                        if aid and aid not in seen_agents:
                            seen_agents.add(aid)
                            agents.append(aid)
                        content = str(a.get("action_args", {}).get("content", ""))[:120]
                        if content and len(recent_events) < 8:
                            recent_events.append(content)
                    except Exception:
                        pass

    total_actions = tw_count + rd_count
    seed = run.get("scenario", "仿真议题")
    status = run.get("status", "unknown")
    final_states = run.get("final_states", [])

    # Compute high-risk agents
    high_risk = [fs for fs in final_states if fs.get("belief", 0) > 0.65]
    low_risk = [fs for fs in final_states if fs.get("belief", 0) < 0.35]

    # Build HTML report
    html_content = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  body {{ font-family: 'IBM Plex Sans', -apple-system, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #1a2332; line-height: 1.7; }}
  h1 {{ color: #1e40af; border-bottom: 2px solid #2563eb; padding-bottom: 8px; font-size: 1.6rem; }}
  h2 {{ color: #1e3a8a; margin-top: 2em; font-size: 1.2rem; }}
  .meta {{ color: #64748b; font-size: 0.85rem; margin-bottom: 2em; }}
  .stats {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 1.5em 0; }}
  .stat {{ background: #f0f4f8; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; text-align: center; }}
  .stat-val {{ font-size: 1.8rem; font-weight: 700; color: #2563eb; }}
  .stat-lbl {{ font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }}
  .event {{ background: #fff; border-left: 3px solid #2563eb; padding: 8px 14px; margin: 6px 0; border-radius: 0 4px 4px 0; font-size: 0.88rem; color: #334155; }}
  .high {{ color: #dc2626; font-weight: 600; }} .low {{ color: #16a34a; font-weight: 600; }}
  .section {{ margin: 1.5em 0; }}
  table {{ width: 100%; border-collapse: collapse; margin: 1em 0; }}
  th {{ background: #f0f4f8; padding: 8px 12px; text-align: left; font-size: 0.8rem; color: #64748b; border-bottom: 1px solid #e2e8f0; }}
  td {{ padding: 8px 12px; font-size: 0.85rem; border-bottom: 1px solid #f1f5f9; }}
  .badge {{ display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.72rem; font-weight: 600; }}
  .badge-done {{ background: #dcfce7; color: #16a34a; }} .badge-fail {{ background: #fee2e2; color: #dc2626; }}
  .badge-run {{ background: #dbeafe; color: #2563eb; }}
</style>
</head>
<body>
<h1>推演报告：{seed}</h1>
<div class="meta">
  运行 ID: <code>{run_id}</code> ·
  状态: <span class="badge {'badge-done' if status == 'completed' else 'badge-fail' if status == 'failed' else 'badge-run'}">{status}</span> ·
  生成时间: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}
</div>

<h2>执行摘要</h2>
<p>本推演基于议题"<strong>{seed}</strong>"，在 OASIS 双平台（Info Plaza / Topic Community）上运行了 <strong>{tw_max}/{rd_max}</strong> 轮，共产生 <strong>{total_actions}</strong> 个动作事件，参与代理体 <strong>{len(agents)}</strong> 个。</p>
<p>系统{"已达成均衡收敛" if run.get("convergence_achieved") else "未达收敛条件"}，高风险代理体 {len(high_risk)} 个，低风险代理体 {len(low_risk)} 个。</p>

<div class="stats">
  <div class="stat"><div class="stat-val">{len(agents)}</div><div class="stat-lbl">代理体</div></div>
  <div class="stat"><div class="stat-val">{total_actions}</div><div class="stat-lbl">总动作</div></div>
  <div class="stat"><div class="stat-val">{tw_count}</div><div class="stat-lbl">Info Plaza</div></div>
  <div class="stat"><div class="stat-val">{rd_count}</div><div class="stat-lbl">Topic Comm.</div></div>
</div>

<h2>背景</h2>
<p>OASIS 仿真引擎通过多代理体社交网络模拟，对议题在双平台上的演化进行推演。Info Plaza（类 Twitter）模拟公共广场的舆论扩散，Topic Community（类 Reddit）模拟社区内的深度讨论。两平台并行运行，代理体跨越平台进行交互。</p>

<h2>行为分析</h2>
<p>各类型动作分布：</p>
<table>
<tr><th>动作类型</th><th>次数</th><th>占比</th></tr>
{"".join(f"<tr><td>{at}</td><td>{cnt}</td><td>{cnt * 100 / max(total_actions, 1):.1f}%</td></tr>" for at, cnt in sorted(action_types.items(), key=lambda x: -x[1]))}
</table>

<h2>重点事件</h2>
{"".join(f"<div class='event'>📌 {ev}</div>" for ev in recent_events)}

<h2>预测</h2>
<p>基于当前仿真结果：</p>
<ul>
  <li>高风险代理体（信念值 &gt; 0.65）数量为 <span class="high">{len(high_risk)}</span>，建议重点关注其影响力扩散路径</li>
  <li>低风险代理体（信念值 &lt; 0.35）数量为 <span class="low">{len(low_risk)}</span>，可能在后续演化中改变立场</li>
  <li>整体系统{"已收敛" if run.get("convergence_achieved") else "仍处于动态演化中"}，未来趋势相对{"确定" if run.get("convergence_achieved") else "不确定"}</li>
</ul>

<h2>建议</h2>
<ol>
  <li>持续监控高风险代理体的行动模式，特别是在关键决策节点</li>
  <li>利用低风险代理体作为意见领袖的潜在候选人进行引导</li>
  <li>在 Info Plaza 与 Topic Community 之间建立信息桥接，促进理性讨论</li>
  <li>定期重新运行仿真，跟踪议题演化最新态势</li>
</ol>

<div class="meta" style="margin-top:3em; border-top:1px solid #e2e8f0; padding-top:1em;">
  本报告由 OrcaFish 未来推演引擎自动生成 · {total_actions} 个动作事件 · {len(agents)} 个代理体 · {tw_max + rd_max} 轮仿真
</div>
</body>
</html>"""

    return {"html_content": html_content, "run_id": run_id, "status": status}
