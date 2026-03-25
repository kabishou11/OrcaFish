"""OrcaFish Simulation API Routes"""
import uuid
import os
import json
from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from backend.models.simulation import SimulationCreateRequest, VariableInjection
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
    """Create and start a new simulation run"""
    run_id = f"run_{uuid.uuid4().hex[:12]}"
    sim_id = f"sim_{uuid.uuid4().hex[:12]}"

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
    }
    _run_registry[run_id] = run

    # Start simulation in background
    import asyncio
    asyncio.create_task(_run_simulation_bg(run_id, sim_id, req))

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
            seen_agents = set()
            with open(actions_file, encoding='utf-8') as f:
                for line in f:
                    if line.strip():
                        try:
                            entry = json.loads(line)
                            agent_id = entry.get("agent_id", "")
                            if agent_id and agent_id not in seen_agents:
                                seen_agents.add(agent_id)
                                import random as _r
                                final_states.append({
                                    "id": agent_id,
                                    "position": [_r.uniform(-1, 1), _r.uniform(-1, 1)],
                                    "belief": _r.uniform(0.2, 0.85),
                                    "influence": _r.uniform(0.1, 0.9),
                                })
                        except Exception:
                            pass
        _run_registry[run_id]["final_states"] = final_states[:10]
        _run_registry[run_id]["convergence_achieved"] = (
            _run_registry[run_id]["status"] == "completed"
        )

    except Exception as e:
        _run_registry[run_id]["status"] = "failed"
        _run_registry[run_id]["error"] = str(e)


# ── Existing endpoints ────────────────────────────────────────────────────────

@router.post("/create")
async def create_simulation(req: SimulationCreateRequest) -> dict:
    """Create a new simulation project with knowledge graph"""
    llm = LLMClient(
        api_key=settings.insight_llm.api_key,
        base_url=settings.insight_llm.base_url,
        model=settings.insight_llm.model,
        provider=settings.insight_llm.provider,
    )

    builder = GraphBuilder(zep_api_key=settings.zep_api_key)
    builder.set_llm(llm)

    result = await builder.build(
        seed_content=req.seed_content,
        project_name=req.name,
        simulation_requirement=req.simulation_requirement,
    )

    sim_id = f"sim_{uuid.uuid4().hex[:12]}"
    runner = OASISRunner()
    sim_id_out, sim_dir = runner.create_simulation({
        "simulation_id": sim_id,
        "project_id": result.project_id,
        "graph_id": result.graph_id,
    })

    return {
        "project_id": result.project_id,
        "simulation_id": sim_id_out,
        "graph_id": result.graph_id,
        "ontology": result.ontology,
        "entity_count": result.entity_count,
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
    if run["status"] != "created":
        raise HTTPException(status_code=400, detail="Run already started")

    run["status"] = "running"
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
