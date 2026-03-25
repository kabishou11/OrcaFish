"""Action Logger - Log simulation actions"""
import json
import os
from typing import Dict, Any
from datetime import datetime


class ActionLogger:
    """Log agent actions to file"""

    def __init__(self, log_file: str):
        self.log_file = log_file
        os.makedirs(os.path.dirname(log_file), exist_ok=True)

    def log_action(self, action: Dict[str, Any]):
        """Log a single action"""
        action["timestamp"] = datetime.now().isoformat()
        with open(self.log_file, 'a', encoding='utf-8') as f:
            f.write(json.dumps(action, ensure_ascii=False) + '\n')

    def read_actions(self) -> list:
        """Read all logged actions"""
        if not os.path.exists(self.log_file):
            return []

        actions = []
        with open(self.log_file, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    actions.append(json.loads(line))
        return actions
