"""
快速迁移脚本 - 在 PowerShell 中运行
"""
import shutil
from pathlib import Path

def copy_engine(src_name, dst_name):
    src = Path(rf"F:\1work\OrcFish\BettaFish\{src_name}")
    dst = Path(rf"F:\1work\OrcFish\orcafish\backend\engines\{dst_name}")

    dst.mkdir(parents=True, exist_ok=True)

    count = 0
    for item in src.rglob("*.py"):
        rel = item.relative_to(src)
        target = dst / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, target)
        print(f"✓ {dst_name}/{rel}")
        count += 1

    print(f"✅ {src_name} → {dst_name}: {count} files\n")

if __name__ == "__main__":
    print("🚀 开始迁移引擎...\n")
    copy_engine("QueryEngine", "query")
    copy_engine("MediaEngine", "media")
    copy_engine("InsightEngine", "insight")
    print("✨ 迁移完成！")
