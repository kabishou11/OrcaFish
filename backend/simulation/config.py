"""OrcaFish Simulation Config — mirrors MiroFish backend/app/config.py"""
import os


class SimulationConfig:
    # LLM for simulation
    API_KEY: str = os.getenv("ZEP_API_KEY", "")
    BASE_URL: str = "https://api.dashscope.com"
    MODEL_NAME: str = "qwen-plus"

    # Paths
    UPLOAD_DIR: str = os.path.join(os.path.dirname(__file__), "..", "..", "data", "uploads")
    PROFILE_DIR: str = os.path.join(os.path.dirname(__file__), "..", "..", "data", "profiles")
    SIM_DIR: str = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")

    # OASIS Platform Actions
    TWITTER_ACTIONS = [
        "CREATE_POST", "LIKE_POST", "REPOST", "FOLLOW",
        "QUOTE_POST", "DO_NOTHING"
    ]
    REDDIT_ACTIONS = [
        "CREATE_POST", "CREATE_COMMENT", "LIKE_POST", "LIKE_COMMENT",
        "SEARCH_POSTS", "TREND", "DO_NOTHING"
    ]

    # Simulation defaults
    DEFAULT_SIMULATION_ROUNDS: int = 40
    DEFAULT_SIMULATION_HOURS: int = 72
    PARALLEL_PROFILE_COUNT: int = 10

    # IPC
    IPC_POLL_INTERVAL: float = 0.5
    IPC_TIMEOUT: float = 60.0


sim_config = SimulationConfig()
