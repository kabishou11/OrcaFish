"""OrcaFish Simulation IPC — file-based IPC between API and simulation subprocess"""
import os
import json
import uuid
import asyncio
from typing import Any, Optional
from backend.simulation.config import sim_config


class SimulationIPC:
    """
    Inter-Process Communication between API and simulation subprocess.
    Uses JSON file polling (from MiroFish simulation_ipc.py).

    Flow:
    1. API writes command to sim_xxx/ipc_commands/{uuid}.json
    2. Simulation reads command, executes, writes response to ipc_responses/{uuid}.json
    3. API polls for response
    """

    def __init__(self, sim_dir: str = ""):
        self.sim_dir = sim_dir
        if sim_dir:
            self._ensure_dirs()

    def _ensure_dirs(self):
        os.makedirs(os.path.join(self.sim_dir, "ipc_commands"), exist_ok=True)
        os.makedirs(os.path.join(self.sim_dir, "ipc_responses"), exist_ok=True)

    def set_sim_dir(self, sim_dir: str):
        self.sim_dir = sim_dir
        self._ensure_dirs()

    async def send_command(
        self,
        command_type: str,
        params: dict,
        timeout: float = 60.0,
    ) -> dict:
        """
        Send command to simulation subprocess and wait for response.
        """
        if not self.sim_dir:
            return {"error": "No simulation directory set"}

        cmd_id = uuid.uuid4().hex
        cmd_path = os.path.join(self.sim_dir, "ipc_commands", f"{cmd_id}.json")
        resp_path = os.path.join(self.sim_dir, "ipc_responses", f"{cmd_id}.json")

        # Write command
        cmd = {
            "type": command_type,
            "id": cmd_id,
            "params": params,
        }
        with open(cmd_path, "w", encoding="utf-8") as f:
            json.dump(cmd, f)

        # Poll for response
        elapsed = 0.0
        poll_interval = sim_config.IPC_POLL_INTERVAL
        while elapsed < timeout:
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
            if os.path.exists(resp_path):
                try:
                    with open(resp_path, encoding="utf-8") as f:
                        result = json.load(f)
                    # Cleanup
                    os.remove(cmd_path)
                    os.remove(resp_path)
                    return result
                except Exception:
                    pass

        # Timeout — cleanup
        if os.path.exists(cmd_path):
            os.remove(cmd_path)
        return {"error": "IPC timeout"}

    async def interview_all_agents(
        self,
        simulation_id: str,
        prompt: str,
        platform: str = "both",
    ) -> dict:
        """
        Broadcast a message to all agents (used for variable injection).
        Corresponds to MiroFish POST /api/simulation/interview/all
        """
        return await self.send_command(
            "BATCH_INTERVIEW",
            params={
                "simulation_id": simulation_id,
                "prompt": prompt,
                "platform": platform,
                "agent_ids": "all",
            },
        )

    async def interview_agent(
        self,
        agent_id: int,
        prompt: str,
        platform: str = "twitter",
    ) -> dict:
        """Interview a single agent"""
        return await self.send_command(
            "INTERVIEW",
            params={
                "agent_id": agent_id,
                "prompt": prompt,
                "platform": platform,
            },
        )
