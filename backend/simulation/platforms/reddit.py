"""Reddit simulation script - minimal implementation"""
import argparse
import asyncio
import json
import os
import sys


async def run_reddit_simulation(config_path: str, max_rounds: int = None):
    """Run Reddit simulation"""
    with open(config_path) as f:
        config = json.load(f)

    simulation_id = config.get("simulation_id", "unknown")
    print(f"Reddit simulation started: {simulation_id}")

    # Minimal simulation loop
    time_config = config.get("time_config", {})
    total_rounds = time_config.get("total_simulation_hours", 72)
    if max_rounds:
        total_rounds = min(total_rounds, max_rounds)

    for round_num in range(total_rounds):
        await asyncio.sleep(0.1)  # Simulate work
        if round_num % 10 == 0:
            print(f"Round {round_num}/{total_rounds}")

    print("Reddit simulation completed")


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--max-rounds", type=int, default=None)
    args = parser.parse_args()

    await run_reddit_simulation(args.config, args.max_rounds)


if __name__ == "__main__":
    asyncio.run(main())
