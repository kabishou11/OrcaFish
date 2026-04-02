from __future__ import annotations
"""OrcaFish Simulation Runner - Execute simulations, parse actions, support interview"""

import os
import sys
import json
import time
import asyncio
import threading
import subprocess
import signal
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

from backend.simulation.config import sim_config
import logging

logger = logging.getLogger('orcafish.simulation_runner')

IS_WINDOWS = sys.platform == 'win32'
# ── Enums ──────────────────────────────────────────────────────────────────────

class RunnerStatus(str, Enum):
    IDLE = 'idle'
    STARTING = 'starting'
    RUNNING = 'running'
    PAUSED = 'paused'
    STOPPING = 'stopping'
    STOPPED = 'stopped'
    COMPLETED = 'completed'
    FAILED = 'failed'

# ── Dataclasses ────────────────────────────────────────────────────────────────

@dataclass
class AgentAction:
    """Agent action record parsed from actions.jsonl"""
    round_num: int
    timestamp: str
    platform: str  # twitter / reddit
    agent_id: int
    agent_name: str
    action_type: str
    action_args: Dict[str, Any] = field(default_factory=dict)
    result: Optional[str] = None
    success: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return {
            'round_num': self.round_num,
            'timestamp': self.timestamp,
            'platform': self.platform,
            'agent_id': self.agent_id,
            'agent_name': self.agent_name,
            'action_type': self.action_type,
            'action_args': self.action_args,
            'result': self.result,
            'success': self.success,
        }
@dataclass
class SimulationRunState:
    """Live simulation run state"""
    simulation_id: str
    runner_status: RunnerStatus = RunnerStatus.IDLE

    current_round: int = 0
    total_rounds: int = 0
    simulated_hours: int = 0
    total_simulation_hours: int = 0

    twitter_current_round: int = 0
    reddit_current_round: int = 0
    twitter_simulated_hours: int = 0
    reddit_simulated_hours: int = 0

    twitter_running: bool = False
    reddit_running: bool = False
    twitter_actions_count: int = 0
    reddit_actions_count: int = 0
    twitter_completed: bool = False
    reddit_completed: bool = False

    recent_actions: List[AgentAction] = field(default_factory=list)
    max_recent_actions: int = 50

    started_at: Optional[str] = None
    updated_at: str = field(default_factory=lambda: datetime.now().isoformat())
    completed_at: Optional[str] = None

    error: Optional[str] = None
    process_pid: Optional[int] = None

    def add_action(self, action: AgentAction):
        self.recent_actions.insert(0, action)
        if len(self.recent_actions) > self.max_recent_actions:
            self.recent_actions = self.recent_actions[:self.max_recent_actions]
        if action.platform == 'twitter':
            self.twitter_actions_count += 1
        else:
            self.reddit_actions_count += 1
        self.updated_at = datetime.now().isoformat()

    def to_dict(self) -> Dict[str, Any]:
        return {
            'simulation_id': self.simulation_id,
            'runner_status': self.runner_status.value,
            'current_round': self.current_round,
            'total_rounds': self.total_rounds,
            'simulated_hours': self.simulated_hours,
            'total_simulation_hours': self.total_simulation_hours,
            'progress_percent': round(self.current_round / max(self.total_rounds, 1) * 100, 1),
            'twitter_current_round': self.twitter_current_round,
            'reddit_current_round': self.reddit_current_round,
            'twitter_simulated_hours': self.twitter_simulated_hours,
            'reddit_simulated_hours': self.reddit_simulated_hours,
            'twitter_running': self.twitter_running,
            'reddit_running': self.reddit_running,
            'twitter_completed': self.twitter_completed,
            'reddit_completed': self.reddit_completed,
            'twitter_actions_count': self.twitter_actions_count,
            'reddit_actions_count': self.reddit_actions_count,
            'total_actions_count': self.twitter_actions_count + self.reddit_actions_count,
            'started_at': self.started_at,
            'updated_at': self.updated_at,
            'completed_at': self.completed_at,
            'error': self.error,
            'process_pid': self.process_pid,
        }
class SimulationRunner:
    """
    OrcaFish Simulation Runner.

    Responsibilities:
    1. Launch simulation subprocess (twitter / reddit / parallel)
    2. Parse actions.jsonl files to build AgentAction records
    3. Provide real-time state via _monitor_simulation() background thread
    4. Support LLM-based interview of agents

    Data layout:
      data/simulations/{simulation_id}/
        simulation_config.json
        run_state.json
        actions.jsonl          # legacy unified (OASISRunner mock)
        twitter/actions.jsonl  # Twitter platform actions
        reddit/actions.jsonl   # Reddit platform actions
        simulation.log
    """

    RUN_STATE_DIR = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', '..', 'data', 'simulations'
    )

    SCRIPTS_DIR = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), 'platforms'
    )

    # In-memory registries
    _run_states: Dict[str, SimulationRunState] = {}
    _processes: Dict[str, subprocess.Popen] = {}
    _monitor_threads: Dict[str, threading.Thread] = {}
    _log_files: Dict[str, Any] = {}

    # ── State persistence ──────────────────────────────────────────────────────

    @classmethod
    def get_run_state(cls, simulation_id: str) -> Optional[SimulationRunState]:
        if simulation_id in cls._run_states:
            return cls._run_states[simulation_id]
        state = cls._load_run_state(simulation_id)
        if state:
            cls._run_states[simulation_id] = state
        return state

    @classmethod
    def _load_run_state(cls, simulation_id: str) -> Optional[SimulationRunState]:
        state_file = os.path.join(cls.RUN_STATE_DIR, simulation_id, 'run_state.json')
        if not os.path.exists(state_file):
            return None
        try:
            with open(state_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            state = SimulationRunState(
                simulation_id=simulation_id,
                runner_status=RunnerStatus(data.get('runner_status', 'idle')),
                current_round=data.get('current_round', 0),
                total_rounds=data.get('total_rounds', 0),
                simulated_hours=data.get('simulated_hours', 0),
                total_simulation_hours=data.get('total_simulation_hours', 0),
                twitter_current_round=data.get('twitter_current_round', 0),
                reddit_current_round=data.get('reddit_current_round', 0),
                twitter_simulated_hours=data.get('twitter_simulated_hours', 0),
                reddit_simulated_hours=data.get('reddit_simulated_hours', 0),
                twitter_running=data.get('twitter_running', False),
                reddit_running=data.get('reddit_running', False),
                twitter_completed=data.get('twitter_completed', False),
                reddit_completed=data.get('reddit_completed', False),
                twitter_actions_count=data.get('twitter_actions_count', 0),
                reddit_actions_count=data.get('reddit_actions_count', 0),
                started_at=data.get('started_at'),
                updated_at=data.get('updated_at', datetime.now().isoformat()),
                completed_at=data.get('completed_at'),
                error=data.get('error'),
                process_pid=data.get('process_pid'),
            )
            for a in data.get('recent_actions', []):
                state.recent_actions.append(AgentAction(
                    round_num=a.get('round_num', 0),
                    timestamp=a.get('timestamp', ''),
                    platform=a.get('platform', ''),
                    agent_id=a.get('agent_id', 0),
                    agent_name=a.get('agent_name', ''),
                    action_type=a.get('action_type', ''),
                    action_args=a.get('action_args', {}),
                    result=a.get('result'),
                    success=a.get('success', True),
                ))
            return state
        except Exception as e:
            logger.error(f'Failed to load run state: {e}')
            return None

    @classmethod
    def _save_run_state(cls, state: SimulationRunState):
        sim_dir = os.path.join(cls.RUN_STATE_DIR, state.simulation_id)
        os.makedirs(sim_dir, exist_ok=True)
        state_file = os.path.join(sim_dir, 'run_state.json')
        data = state.to_dict()
        data['recent_actions'] = [a.to_dict() for a in state.recent_actions]
        with open(state_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        cls._run_states[state.simulation_id] = state
    # ── Simulation lifecycle ───────────────────────────────────────────────────

    @classmethod
    def start_simulation(
        cls,
        simulation_id: str,
        platform: str = 'parallel',  # twitter / reddit / parallel
        max_rounds: int = None,
    ) -> SimulationRunState:
        """Launch simulation subprocess."""
        existing = cls.get_run_state(simulation_id)
        if existing and existing.runner_status in [RunnerStatus.RUNNING, RunnerStatus.STARTING]:
            raise ValueError(f'Simulation already running: {simulation_id}')

        sim_dir = os.path.join(cls.RUN_STATE_DIR, simulation_id)
        config_path = os.path.join(sim_dir, 'simulation_config.json')

        if not os.path.exists(config_path):
            raise ValueError(f'Config not found: {config_path}, call /prepare first')

        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)

        time_config = config.get('time_config', {})
        total_hours = time_config.get('total_simulation_hours', 72)
        minutes_per_round = time_config.get('minutes_per_round', 30)
        total_rounds = int(total_hours * 60 / minutes_per_round)

        if max_rounds is not None and max_rounds > 0:
            total_rounds = min(total_rounds, max_rounds)

        state = SimulationRunState(
            simulation_id=simulation_id,
            runner_status=RunnerStatus.STARTING,
            total_rounds=total_rounds,
            total_simulation_hours=total_hours,
            started_at=datetime.now().isoformat(),
        )

        if platform == 'twitter':
            script_name = 'twitter.py'
            state.twitter_running = True
        elif platform == 'reddit':
            script_name = 'reddit.py'
            state.reddit_running = True
        else:
            script_name = 'parallel.py'
            state.twitter_running = True
            state.reddit_running = True

        script_path = os.path.join(cls.SCRIPTS_DIR, script_name)

        # Create twitter/reddit subdirs for platform action logs
        twitter_dir = os.path.join(sim_dir, 'twitter')
        reddit_dir = os.path.join(sim_dir, 'reddit')
        os.makedirs(twitter_dir, exist_ok=True)
        os.makedirs(reddit_dir, exist_ok=True)

        cls._save_run_state(state)

        try:
            cmd = [sys.executable, script_path, '--config', config_path]
            if max_rounds is not None and max_rounds > 0:
                cmd.extend(['--max-rounds', str(max_rounds)])

            main_log_path = os.path.join(sim_dir, 'simulation.log')
            main_log_file = open(main_log_path, 'w', encoding='utf-8')

            env = os.environ.copy()
            env['PYTHONUTF8'] = '1'
            env['PYTHONIOENCODING'] = 'utf-8'

            process = subprocess.Popen(
                cmd,
                cwd=sim_dir,
                stdout=main_log_file,
                stderr=subprocess.STDOUT,
                text=True,
                encoding='utf-8',
                bufsize=1,
                env=env,
                start_new_session=True,
            )

            cls._log_files[simulation_id] = main_log_file
            state.process_pid = process.pid
            state.runner_status = RunnerStatus.RUNNING
            cls._processes[simulation_id] = process
            cls._save_run_state(state)

            # Start monitor thread
            monitor_thread = threading.Thread(
                target=cls._monitor_simulation,
                args=(simulation_id,),
                daemon=True,
            )
            monitor_thread.start()
            cls._monitor_threads[simulation_id] = monitor_thread

            logger.info(f'Simulation started: {simulation_id}, pid={process.pid}, platform={platform}')

        except Exception as e:
            state.runner_status = RunnerStatus.FAILED
            state.error = str(e)
            cls._save_run_state(state)
            raise

        return state

    @classmethod
    def stop_simulation(cls, simulation_id):
        state = cls.get_run_state(simulation_id)
        if not state: raise ValueError()
        if state.runner_status not in [RunnerStatus.RUNNING, RunnerStatus.PAUSED]: raise ValueError()
        state.runner_status = RunnerStatus.STOPPING
        cls._save_run_state(state)
        process = cls._processes.get(simulation_id)
        if process and process.poll() is None:
            try: cls._terminate_process(process, simulation_id)
            except ProcessLookupError: pass
            except Exception as e: logger.error(str(e))
        state.runner_status = RunnerStatus.STOPPED
        state.twitter_running = state.reddit_running = False
        state.completed_at = datetime.now().isoformat()
        cls._save_run_state(state)
        return state

    @classmethod
    def _monitor_simulation(cls, simulation_id: str):
        sim_dir = os.path.join(cls.RUN_STATE_DIR, simulation_id)
        tw_log = os.path.join(sim_dir, chr(116)+chr(119)+chr(105)+chr(116)+chr(116)+chr(101)+chr(114), chr(97)+chr(99)+chr(116)+chr(105)+chr(111)+chr(110)+chr(115)+chr(46)+chr(106)+chr(115)+chr(111)+chr(110)+chr(108))
        rd_log = os.path.join(sim_dir, chr(114)+chr(101)+chr(100)+chr(100)+chr(105)+chr(116), chr(97)+chr(99)+chr(116)+chr(105)+chr(111)+chr(110)+chr(115)+chr(46)+chr(106)+chr(115)+chr(111)+chr(110)+chr(108))
        legacy_log = os.path.join(sim_dir, chr(97)+chr(99)+chr(116)+chr(105)+chr(111)+chr(110)+chr(115)+chr(46)+chr(106)+chr(115)+chr(111)+chr(110)+chr(108))
        process = cls._processes.get(simulation_id)
        state = cls.get_run_state(simulation_id)
        if not process or not state: return
        tw_pos = rd_pos = 0
        try:
            while process.poll() is None:
                if os.path.exists(tw_log): tw_pos = cls._read_action_log(tw_log, tw_pos, state, chr(116)+chr(119)+chr(105)+chr(116)+chr(116)+chr(101)+chr(114))
                if os.path.exists(rd_log): rd_pos = cls._read_action_log(rd_log, rd_pos, state, chr(114)+chr(101)+chr(100)+chr(100)+chr(105)+chr(116))
                if not os.path.exists(tw_log) and not os.path.exists(rd_log) and os.path.exists(legacy_log):
                    cls._read_action_log(legacy_log, 0, state, chr(97)+chr(117)+chr(116)+chr(111))
                cls._save_run_state(state)
                time.sleep(2)
            if os.path.exists(tw_log): cls._read_action_log(tw_log, tw_pos, state, chr(116)+chr(119)+chr(105)+chr(116)+chr(116)+chr(101)+chr(114))
            if os.path.exists(rd_log): cls._read_action_log(rd_log, rd_pos, state, chr(114)+chr(101)+chr(100)+chr(100)+chr(105)+chr(116))
            if not os.path.exists(tw_log) and not os.path.exists(rd_log) and os.path.exists(legacy_log):
                cls._read_action_log(legacy_log, 0, state, chr(97)+chr(117)+chr(116)+chr(111))
            ec = process.returncode
            if ec == 0: state.runner_status = RunnerStatus.COMPLETED; state.completed_at = datetime.now().isoformat()
            else:
                state.runner_status = RunnerStatus.FAILED
                try: tail = open(os.path.join(sim_dir, chr(115)+chr(105)+chr(109)+chr(117)+chr(108)+chr(97)+chr(116)+chr(105)+chr(111)+chr(110)+chr(46)+chr(108)+chr(111)+chr(103)), encoding=chr(117)+chr(116)+chr(102)+chr(45)+chr(56)).read()[-2000:]
                except Exception: tail = chr(0)*0
                state.error = str(ec) + chr(58) + tail
            state.twitter_running = state.reddit_running = False
            cls._save_run_state(state)
        except Exception as e:
            logger.error(str(e)); state.runner_status = RunnerStatus.FAILED; state.error = str(e)
            cls._save_run_state(state)
        finally:
            cls._processes.pop(simulation_id, None)
            fh = cls._log_files.pop(simulation_id, None)
            if fh:
                try: fh.close()
                except Exception: pass

    @classmethod
    def _read_action_log(cls, log_path: str, position: int, state, platform: str) -> int:
        if not os.path.exists(log_path): return position
        try:
            with open(log_path, encoding="utf-8") as f:
                f.seek(position)
                for line in f:
                    line = line.strip()
                    if not line: continue
                    try:
                        data = json.loads(line)
                        if "event_type" in data:
                            et = data["event_type"]
                            if et == "simulation_end":
                                if platform in ("twitter", "auto"): state.twitter_completed = True; state.twitter_running = False
                                if platform in ("reddit", "auto"): state.reddit_completed = True; state.reddit_running = False
                            elif et == "round_end":
                                rn = data.get("round", 0); sh = data.get("simulated_hours", 0)
                                if platform in ("twitter", "auto"):
                                    if rn > state.twitter_current_round: state.twitter_current_round = rn
                                    state.twitter_simulated_hours = sh
                                elif platform == "reddit":
                                    if rn > state.reddit_current_round: state.reddit_current_round = rn
                                    state.reddit_simulated_hours = sh
                                if rn > state.current_round: state.current_round = rn
                                state.simulated_hours = max(state.twitter_simulated_hours, state.reddit_simulated_hours)
                            continue
                        if "agent_id" not in data: continue
                        rp = data.get("platform") or platform
                        action = AgentAction(
                            round_num=data.get("round", 0),
                            timestamp=data.get("timestamp", datetime.now().isoformat()),
                            platform=rp, agent_id=data.get("agent_id", 0),
                            agent_name=data.get("agent_name", ""),
                            action_type=data.get("action_type", ""),
                            action_args=data.get("action_args", {}),
                            result=data.get("result"), success=data.get("success", True),
                        )
                        state.add_action(action)
                        if action.round_num > state.current_round: state.current_round = action.round_num
                    except json.JSONDecodeError: pass
                return f.tell()
        except Exception as e:
            logger.warning(f"Read log {log_path}: {e}")
            return position

    @classmethod
    def _terminate_process(cls, process, simulation_id: str, timeout: int = 10):
        if IS_WINDOWS:
            try:
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T"], capture_output=True, timeout=5)
                try: process.wait(timeout=timeout)
                except subprocess.TimeoutExpired:
                    subprocess.run(["taskkill", "/F", "/PID", str(process.pid), "/T"], capture_output=True, timeout=5)
                    process.wait(timeout=5)
            except Exception as e:
                logger.warning(f"taskkill failed: {e}")
                process.terminate()
                try: process.wait(timeout=5)
                except Exception: process.kill()
        else:
            pgid = os.getpgid(process.pid)
            os.killpg(pgid, signal.SIGTERM)
            try: process.wait(timeout=timeout)
            except Exception: os.killpg(pgid, signal.SIGKILL); process.wait(timeout=5)
    # ── Action reading ─────────────────────────────────────────────────────────

    @classmethod
    def _read_actions_from_file(
        cls,
        file_path: str,
        default_platform: Optional[str] = None,
        platform_filter: Optional[str] = None,
        agent_id: Optional[int] = None,
        round_num: Optional[int] = None,
    ) -> List[AgentAction]:
        if not os.path.exists(file_path):
            return []
        actions = []
        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    if 'event_type' in data:
                        continue
                    if 'agent_id' not in data:
                        continue
                    record_platform = data.get('platform') or default_platform or ''
                    if platform_filter and record_platform != platform_filter:
                        continue
                    if agent_id is not None and data.get('agent_id') != agent_id:
                        continue
                    if round_num is not None and data.get('round') != round_num:
                        continue
                    actions.append(AgentAction(
                        round_num=data.get('round', 0),
                        timestamp=data.get('timestamp', ''),
                        platform=record_platform,
                        agent_id=data.get('agent_id', 0),
                        agent_name=data.get('agent_name', ''),
                        action_type=data.get('action_type', ''),
                        action_args=data.get('action_args', {}),
                        result=data.get('result'),
                        success=data.get('success', True),
                    ))
                except json.JSONDecodeError:
                    continue
        return actions

    @classmethod
    def get_all_actions(
        cls,
        simulation_id: str,
        platform: Optional[str] = None,
        agent_id: Optional[int] = None,
        round_num: Optional[int] = None,
    ) -> List[AgentAction]:
        """Read all actions from all platform logs, sorted by timestamp descending."""
        sim_dir = os.path.join(cls.RUN_STATE_DIR, simulation_id)
        actions: List[AgentAction] = []

        twitter_log = os.path.join(sim_dir, 'twitter', 'actions.jsonl')
        reddit_log = os.path.join(sim_dir, 'reddit', 'actions.jsonl')
        legacy_log = os.path.join(sim_dir, 'actions.jsonl')

        if not platform or platform == 'twitter':
            actions.extend(cls._read_actions_from_file(
                twitter_log, default_platform='twitter',
                platform_filter=platform, agent_id=agent_id, round_num=round_num,
            ))
        if not platform or platform == 'reddit':
            actions.extend(cls._read_actions_from_file(
                reddit_log, default_platform='reddit',
                platform_filter=platform, agent_id=agent_id, round_num=round_num,
            ))

        if not actions:
            actions = cls._read_actions_from_file(
                legacy_log, default_platform=None,
                platform_filter=platform, agent_id=agent_id, round_num=round_num,
            )

        actions.sort(key=lambda x: x.timestamp, reverse=True)
        return actions

    @classmethod
    def get_actions(
        cls,
        simulation_id: str,
        limit: int = 100,
        offset: int = 0,
        platform: Optional[str] = None,
        agent_id: Optional[int] = None,
        round_num: Optional[int] = None,
    ) -> List[AgentAction]:
        """Paginated action list."""
        all_actions = cls.get_all_actions(
            simulation_id=simulation_id,
            platform=platform,
            agent_id=agent_id,
            round_num=round_num,
        )
        return all_actions[offset:offset + limit]
    # ── Timeline ───────────────────────────────────────────────────────────────

    @classmethod
    def get_timeline(
        cls,
        simulation_id: str,
        start_round: int = 0,
        end_round: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Round-by-round timeline summary."""
        actions = cls.get_actions(simulation_id, limit=10000)

        rounds: Dict[int, Dict[str, Any]] = {}
        for action in actions:
            rn = action.round_num
            if rn < start_round:
                continue
            if end_round is not None and rn > end_round:
                continue
            if rn not in rounds:
                rounds[rn] = {
                    'round_num': rn,
                    'twitter_actions': 0,
                    'reddit_actions': 0,
                    'active_agents': set(),
                    'action_types': {},
                    'first_action_time': action.timestamp,
                    'last_action_time': action.timestamp,
                }
            r = rounds[rn]
            if action.platform == 'twitter':
                r['twitter_actions'] += 1
            else:
                r['reddit_actions'] += 1
            r['active_agents'].add(action.agent_id)
            at = action.action_type
            r['action_types'][at] = r['action_types'].get(at, 0) + 1
            r['last_action_time'] = action.timestamp

        result = []
        for rn in sorted(rounds.keys()):
            r = rounds[rn]
            result.append({
                'round_num': rn,
                'twitter_actions': r['twitter_actions'],
                'reddit_actions': r['reddit_actions'],
                'total_actions': r['twitter_actions'] + r['reddit_actions'],
                'active_agents_count': len(r['active_agents']),
                'active_agents': list(r['active_agents']),
                'action_types': r['action_types'],
                'first_action_time': r['first_action_time'],
                'last_action_time': r['last_action_time'],
            })
        return result

    # ── Agent stats ────────────────────────────────────────────────────────────

    @classmethod
    def get_agent_stats(cls, simulation_id: str) -> List[Dict[str, Any]]:
        """Per-agent statistics."""
        actions = cls.get_actions(simulation_id, limit=10000)

        agent_stats: Dict[int, Dict[str, Any]] = {}
        for action in actions:
            aid = action.agent_id
            if aid not in agent_stats:
                agent_stats[aid] = {
                    'agent_id': aid,
                    'agent_name': action.agent_name,
                    'total_actions': 0,
                    'twitter_actions': 0,
                    'reddit_actions': 0,
                    'action_types': {},
                    'first_action_time': action.timestamp,
                    'last_action_time': action.timestamp,
                }
            stats = agent_stats[aid]
            stats['total_actions'] += 1
            if action.platform == 'twitter':
                stats['twitter_actions'] += 1
            else:
                stats['reddit_actions'] += 1
            at = action.action_type
            stats['action_types'][at] = stats['action_types'].get(at, 0) + 1
            stats['last_action_time'] = action.timestamp

        result = sorted(agent_stats.values(), key=lambda x: x['total_actions'], reverse=True)
        return result
    # ── Interview ─────────────────────────────────────────────────────────────

    @classmethod
    def interview_agent(
        cls,
        simulation_id: str,
        agent_id: int,
        prompt: str,
        platform: Optional[str] = None,
        timeout: float = 60.0,
    ) -> Dict[str, Any]:
        sim_dir = os.path.join(cls.RUN_STATE_DIR, simulation_id)
        if not os.path.exists(sim_dir):
            raise ValueError(f"Simulation not found: {simulation_id}")
        try:
            from backend.simulation.ipc import SimulationIPC
            ipc = SimulationIPC(sim_dir)
            result = asyncio.run(ipc.send_command(
                "INTERVIEW",
                params={"agent_id": agent_id, "prompt": prompt, "platform": platform},
                timeout=timeout,
            ))
            if result and "error" not in result:
                return {"success": True, "agent_id": agent_id, "result": result, "timestamp": datetime.now().isoformat()}
        except Exception as ipc_err:
            logger.warning(f"IPC interview failed: {ipc_err}")
        try:
            from backend.llm.client import LLMClient
            from backend.config import settings
            all_actions = cls.get_all_actions(simulation_id, agent_id=agent_id)
            recent = all_actions[:10]
            ctx_lines = [
                f"[{a.platform}] round {a.round_num}: {a.agent_name} {a.action_type}"
                for a in recent
            ]
            context = "\n".join(ctx_lines) if ctx_lines else "(no actions)"
            llm = LLMClient(
                api_key=settings.insight_llm.api_key,
                base_url=settings.insight_llm.base_url,
                model=settings.insight_llm.model,
                provider=settings.insight_llm.provider,
            )
            system_prompt = "You are an agent in a social media simulation. Answer the question as your character would."
            user_prompt = f"Recent actions:\n{context}\n\nQuestion: {prompt}"

            response = asyncio.run(llm.agenerate(
                system_prompt=system_prompt,
            ))
            return {
                "success": True,
                "agent_id": agent_id,
                "prompt": prompt,
                "result": response if isinstance(response, str) else str(response),
                "timestamp": datetime.now().isoformat(),
            }
        except Exception as llm_err:
            logger.error(f"LLM interview failed: {llm_err}")
            return {
                "success": False,
                "agent_id": agent_id,
                "prompt": prompt,
                "error": str(llm_err),
                "timestamp": datetime.now().isoformat(),
            }

    @classmethod
    def interview_agents_batch(
        cls,
        simulation_id: str,
        interviews: List[Dict[str, Any]],
        platform: Optional[str] = None,
        timeout: float = 120.0,
    ) -> Dict[str, Any]:
        sim_dir = os.path.join(cls.RUN_STATE_DIR, simulation_id)
        if not os.path.exists(sim_dir):
            raise ValueError(f"Simulation not found: {simulation_id}")
        try:
            from backend.simulation.ipc import SimulationIPC
            ipc = SimulationIPC(sim_dir)
            result = asyncio.run(ipc.send_command(
                "BATCH_INTERVIEW",
                params={"interviews": interviews, "platform": platform},
                timeout=timeout,
            ))
            if result and "error" not in result:
                return {"success": True, "count": len(interviews), "result": result, "timestamp": datetime.now().isoformat()}
        except Exception as ipc_err:
            logger.warning(f"IPC batch interview failed: {ipc_err}")
        responses = []
        for item in interviews:
            aid = item.get("agent_id")
            p = item.get("prompt", "")
            resp = cls.interview_agent(simulation_id, aid, p, platform, timeout=timeout)
            responses.append({"agent_id": aid, "response": resp})
        return {
            "success": True,
            "interviews_count": len(interviews),
            "responses": responses,
            "timestamp": datetime.now().isoformat(),
        }

    # ── Helpers ────────────────────────────────────────────────────────────────

    @classmethod
    def get_running_simulations(cls) -> List[str]:
        return [sim_id for sim_id, proc in cls._processes.items() if proc.poll() is None]

    @classmethod
    def cleanup_all_simulations(cls):
        for sim_id, proc in list(cls._processes.items()):
            try:
                if proc.poll() is None:
                    cls._terminate_process(proc, sim_id, timeout=5)
            except Exception as e:
                logger.error(f"Cleanup failed for {sim_id}: {e}")
        cls._processes.clear()
        for sim_id, fh in list(cls._log_files.items()):
            try: fh.close()
            except Exception: pass
        cls._log_files.clear()