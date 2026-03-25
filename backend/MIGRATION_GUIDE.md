"""
OrcaFish 引擎迁移指南

由于文件操作权限限制，请手动执行以下命令完成迁移：

## 1. QueryEngine 迁移
```bash
# 复制所有文件
cp -r "F:\1work\OrcFish\BettaFish\QueryEngine"/* "F:\1work\OrcFish\orcafish\backend\engines\query\"

# 或使用 Python
python -c "
import shutil
from pathlib import Path
src = Path(r'F:\1work\OrcFish\BettaFish\QueryEngine')
dst = Path(r'F:\1work\OrcFish\orcafish\backend\engines\query')
for item in src.rglob('*.py'):
    rel = item.relative_to(src)
    target = dst / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(item, target)
    print(f'Copied: {rel}')
"
```

## 2. MediaEngine 迁移
```bash
cp -r "F:\1work\OrcFish\BettaFish\MediaEngine"/* "F:\1work\OrcFish\orcafish\backend\engines\media\"
```

## 3. InsightEngine 迁移
```bash
cp -r "F:\1work\OrcFish\BettaFish\InsightEngine"/* "F:\1work\OrcFish\orcafish\backend\engines\insight\"
```

## 4. 修改导入路径
迁移后需要修改以下导入：
- `from .utils.config import settings` → `from backend.config import settings`
- `from utils.retry_helper import` → `from backend.utils.retry_helper import`

## 5. 创建 API 端点
在 backend/api/ 下创建：
- routes/query.py
- routes/media.py
- routes/insight.py

## 6. 更新配置
确保 backend/config.py 包含所有引擎所需的配置项。
"""
