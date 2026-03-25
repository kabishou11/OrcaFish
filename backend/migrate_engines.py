#!/usr/bin/env python3
"""
Migration script to copy BettaFish engines to OrcaFish backend
Run: python migrate_engines.py
"""
import os
import shutil
from pathlib import Path

SOURCE_BASE = Path(r"F:\1work\OrcFish\BettaFish")
TARGET_BASE = Path(r"F:\1work\OrcFish\orcafish\backend\engines")

ENGINES = {
    "query": "QueryEngine",
    "media": "MediaEngine",
    "insight": "InsightEngine"
}

def migrate_engine(target_name, source_name):
    source = SOURCE_BASE / source_name
    target = TARGET_BASE / target_name

    if not source.exists():
        print(f"❌ Source not found: {source}")
        return False

    target.mkdir(parents=True, exist_ok=True)

    # Copy all Python files and directories
    for item in source.rglob("*.py"):
        rel_path = item.relative_to(source)
        dest = target / rel_path
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, dest)
        print(f"✓ {rel_path}")

    return True

def main():
    print("🚀 Starting engine migration...\n")

    for target_name, source_name in ENGINES.items():
        print(f"\n📦 Migrating {source_name} → engines/{target_name}/")
        if migrate_engine(target_name, source_name):
            print(f"✅ {target_name} engine migrated")
        else:
            print(f"❌ {target_name} engine failed")

    print("\n✨ Migration complete!")

if __name__ == "__main__":
    main()
