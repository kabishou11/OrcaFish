# OrcaFish

> 面向地缘风险与舆情推演的统一工作台，主链路为 `全球观测 -> 议题研判 -> 未来预测 -> 自动流程`

[![Python](https://img.shields.io/badge/Python-3.13-blue.svg)](https://www.python.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5+-3178C6.svg)](https://www.typescriptlang.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688.svg)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg)](https://react.dev/)

---

## 1. 项目定位

OrcaFish 不是单点页面集合，而是一条可连续演示、可连续操作的风险工作流：

- `全球观测`：持续接收热点国家、新闻摘要、Agent 观察焦点与风险排行
- `议题研判`：多代理并行生成搜索流、媒体流、洞察流与综合结论
- `未来预测`：把议题或国家观察包送入预测工作台，生成关系图谱、行动流与预测报告
- `自动流程`：把观测、研判、预测串成一条统一编排链路

当前版本已经吸收并融合了你提供的几个项目方向，尤其参考了：

- `F:\1work\OrcFish\MiroFish`
- `F:\3work\1风险预测\MiroFish`
- `F:\1work\OrcFish\BettaFish`
- `F:\1work\OrcFish\worldmonitor`
- 本地 `zep-local / graphiti`

---

## 2. 当前能力

### 2.1 全球观测

- 使用平面世界地图，不再依赖 3D 旋转地球
- 可持续轮询实时新闻、信号、Agent 焦点
- 内置多国家 fallback 数据，即使外部抓取受限也能保持页面连续刷新
- 国家工作台支持一键送去议题研判或未来预测

### 2.2 议题研判

- 多代理并行：搜索、媒体、洞察、报告编排
- 支持分段输出，不再等整份报告一次性返回
- 结果流支持 Markdown 渲染
- 已补充阶段事件、监控底稿接入、降级态提示和质量状态
- 已接入公开来源摘录、监控新闻摘要、阶段时间线和来源数统计
- 降级收口时仍会保留真实来源摘录与监控摘要，便于继续观察或送入未来预测

### 2.3 未来预测

- `graph / split / workbench` 三种工作台模式
- 先创建预测记录，再按需启动、暂停和继续推演
- 关系图谱支持关系线、关系说明、节点检查器、关系检查器
- 支持关系过滤与“仅当前路径”
- 图谱优先读取本地 `zep-local / graphiti` 内容，远端不可用时回退本地快照与动作层补图
- 报告抽屉与运行详情可联动查看图谱、行动流、时间线和代理体统计
- 预测记录会在本地持久化，服务重启后仍可恢复历史 run 与图谱元数据

### 2.4 自动流程

- 观测 -> 研判 -> 预测 的链路已打通
- 首页、全球观测、议题研判都可以把上下文包直接送入未来预测

---

## 3. 技术架构

```text
Frontend (React + Vite)
  ├─ Dashboard
  ├─ Intelligence
  ├─ Analysis
  ├─ Simulation
  └─ Pipeline

Backend (FastAPI)
  ├─ /api/intelligence
  ├─ /api/analysis
  ├─ /api/simulation
  ├─ /api/pipeline
  ├─ LLM Client (MiniMax / ModelScope / OpenAI-compatible)
  ├─ Signal Aggregator / CII Engine
  ├─ GraphBuilder / SnapshotStore / OASISRunner
  └─ Report Agents

Optional local services
  ├─ Zep CE        http://localhost:8000
  ├─ Graphiti      http://localhost:8003
  └─ Crawl4AI      http://localhost:11235
```

---

## 4. 目录结构

```text
orcafish/
├─ backend/
│  ├─ main.py
│  ├─ config.py
│  ├─ api/routes/
│  │  ├─ intelligence.py
│  │  ├─ analysis.py
│  │  ├─ simulation.py
│  │  └─ pipeline.py
│  ├─ graph/
│  │  ├─ graph_builder.py
│  │  └─ snapshot_store.py
│  ├─ intelligence/
│  ├─ analysis/
│  ├─ simulation/
│  ├─ llm/
│  └─ models/
├─ frontend/
│  ├─ package.json
│  ├─ vite.config.ts
│  └─ src/
│     ├─ App.tsx
│     ├─ stores/
│     └─ components/
├─ tests/
│  └─ test_backend_smoke.py
├─ docs/
│  └─ DEPLOYMENT.md
├─ zep-local/
│  ├─ docker-compose.yml
│  ├─ docker-compose.ce.yaml
│  ├─ .env.example
│  ├─ zep.yaml
│  └─ README.md
├─ .env.example
└─ README.md
```

---

## 5. 环境要求

### 5.1 必需

- Windows 10/11、Linux 或 macOS
- Python `3.13`
- Node.js `18+`
- `pnpm`

### 5.2 推荐

- 项目内虚拟环境 `.venv`
- Docker Desktop 或你自己的本地 `zep-local`
- 一组可用的 LLM Key

### 5.3 可选外部能力

- `MiniMax`
- `ModelScope`
- `Zep CE + Graphiti`
- `crawl4ai`
- `Upstash Redis`

---

## 6. 安装步骤

### 6.1 克隆并进入项目

```powershell
cd F:\1work\OrcFish
git clone <your-repo-url> orcafish
cd orcafish
```

### 6.2 创建后端虚拟环境

```powershell
py -3.13 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### 6.3 安装前端依赖

```powershell
cd frontend
pnpm install
cd ..
```

---

## 7. 环境变量配置

### 7.1 从模板复制

```powershell
Copy-Item .env.example .env
```

### 7.2 仓库默认值与常用演示配置

仓库里的 `.env.example` 默认使用 `ModelScope`。
如果你今晚要演示更强推理链路，常见做法是把 `Query / Media / Insight / Report` 四路切到 `MiniMax`，并保留 `ModelScope` 作为回退。

下面是一套常用演示配置骨架，注意不要把真实密钥提交进仓库。

```env
APP_HOST=0.0.0.0
APP_PORT=8080

MINIMAX_API_KEY=your-minimax-api-key
MODELSCOPE_API_KEY=your-modelscope-api-key

QUERY_LLM_PROVIDER=minimax
QUERY_LLM_API_KEY=${MINIMAX_API_KEY}
QUERY_LLM_BASE_URL=https://api.minimaxi.com/v1
QUERY_LLM_MODEL=MiniMax-M2.7
QUERY_LLM_REASONING_SPLIT=true

MEDIA_LLM_PROVIDER=minimax
MEDIA_LLM_API_KEY=${MINIMAX_API_KEY}
MEDIA_LLM_BASE_URL=https://api.minimaxi.com/v1
MEDIA_LLM_MODEL=MiniMax-M2.7
MEDIA_LLM_REASONING_SPLIT=true

INSIGHT_LLM_PROVIDER=minimax
INSIGHT_LLM_API_KEY=${MINIMAX_API_KEY}
INSIGHT_LLM_BASE_URL=https://api.minimaxi.com/v1
INSIGHT_LLM_MODEL=MiniMax-M2.7
INSIGHT_LLM_REASONING_SPLIT=true

REPORT_LLM_PROVIDER=minimax
REPORT_LLM_API_KEY=${MINIMAX_API_KEY}
REPORT_LLM_BASE_URL=https://api.minimaxi.com/v1
REPORT_LLM_MODEL=MiniMax-M2.7
REPORT_LLM_REASONING_SPLIT=true

FALLBACK_LLM_PROVIDER=modelscope
FALLBACK_LLM_API_KEY=${MODELSCOPE_API_KEY}
FALLBACK_LLM_BASE_URL=https://api-inference.modelscope.cn/v1
FALLBACK_LLM_MODEL=Qwen/Qwen3.5-32B-Instruct
```

说明：

- 当前代码支持扁平变量名，不需要写成嵌套配置
- `*_REASONING_SPLIT=true` 会透传 `extra_body={"reasoning_split": true}`
- 如果某个代理不想用 MiniMax，可以单独切回 ModelScope

### 7.3 图谱相关变量

```env
ZEP_BASE_URL=http://localhost:8000
GRAPHITI_BASE_URL=http://localhost:8003
ZEP_API_SECRET=
```

### 7.4 Crawl4AI 可选配置

```env
CRAWL4AI_BASE_URL=http://localhost:11235
CRAWL4AI_TOKEN=
```

---

## 8. 本地依赖服务

### 8.1 方案 A：使用仓库内的 `zep-local`

仓库现在自带一个可直接启动的本地目录：

- `zep-local/`

适合第一次部署的人直接照着跑，不用再去翻外部仓库结构。

启动前只需要做两件事：

1. 复制模板：`Copy-Item zep-local/.env.example zep-local/.env`
2. 把 `zep-local/.env` 里的 `OPENAI_API_KEY` 改成你自己的兼容模型 Key

然后进入目录启动：

```powershell
cd zep-local
docker compose up -d
```

默认端口：

- `8000` Zep CE
- `8003` Graphiti
- `5432` Postgres
- `7474` Neo4j HTTP
- `7687` Neo4j Bolt

说明：

- `zep-local/.env` 是本地私密文件，不要提交进仓库
- `zep-local/zep.yaml` 当前是示例配置，第一次部署时请把 `api_secret` 换成你自己的本地 secret
- 记得把项目根目录 `.env` 里的 `ZEP_API_SECRET` 改成同一个值

### 8.2 方案 B：直接复用你现成的 `zep-local`

如果你已经有另一套长期运行的本地 `zep-local`，也可以不使用仓库里的这一份。

你只需要确认：

1. `ZEP_BASE_URL=http://localhost:8000`
2. `GRAPHITI_BASE_URL=http://localhost:8003`
3. `ZEP_API_SECRET` 与本地配置一致

### 8.3 方案 C：使用历史 `zep` 参考编排

`backend/main.py` 默认会优先尝试这一路径：

- `zep-local/docker-compose.ce.yaml`
- 若不存在，再回退 `zep/legacy/docker-compose.ce.yaml`

第一次按下面做即可复刻：

1. 复制本地服务环境文件：`Copy-Item zep-local\.env.example zep-local\.env`
2. 打开 `zep-local/zep.yaml`，确认或改掉 `api_secret`
3. 把项目根目录 `.env` 中的 `ZEP_API_SECRET` 改成同一个值
4. 在项目根目录执行：`docker compose -f zep-local/docker-compose.ce.yaml up -d`

这套默认会拉起：

- `zep`
- `graphiti`
- `postgres`
- `neo4j`

如果你的仓库里暂时没有 `zep-local/`，再使用旧的 `zep/legacy/` 路径。

### 8.4 本地服务健康检查

```powershell
Test-NetConnection localhost -Port 8000
Test-NetConnection localhost -Port 8003
Invoke-WebRequest http://localhost:8003/healthcheck
```

---

## 9. 启动方式

### 9.1 启动后端

推荐稳定方式：

```powershell
cd F:\1work\OrcFish\orcafish
.venv\Scripts\python.exe -m backend.main
```

如需热重载：

```powershell
.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8080
```

启动后检查：

```powershell
Invoke-WebRequest http://localhost:8080/health
```

### 9.2 启动前端

```powershell
cd F:\1work\OrcFish\orcafish\frontend
pnpm dev
```

默认访问地址通常为：

- [http://localhost:3000](http://localhost:3000)

如果 Vite 输出了别的地址，以终端输出为准。

### 9.3 前后端同时启动的推荐顺序

1. 先启动 `zep-local / graphiti`
2. 再启动后端
3. 最后启动前端

---

## 10. 首次联调检查清单

### 10.1 后端健康检查

```powershell
Invoke-WebRequest http://localhost:8080/health
```

期望：

- `status=healthy`
- 如果本地图谱服务已接入，相关健康信息应显示运行中

### 10.2 后端烟雾测试

```powershell
cd F:\1work\OrcFish\orcafish
.venv\Scripts\python.exe -m pytest tests\test_backend_smoke.py
```

成功标志：

- `12 passed` 或更高

### 10.3 前端构建检查

```powershell
cd F:\1work\OrcFish\orcafish\frontend
pnpm build
```

说明：

- 当前大图相关 chunk 仍偏大
- 这不影响今晚演示与部署

---

## 11. 推荐演示路径

### 11.1 最短闭环

1. 打开首页 `预测总览`
2. 进入 `全球观测`
3. 选择一个国家或热点事件
4. 点 `送去议题研判`
5. 在 `议题研判` 看四段结果逐步到达
6. 点 `送入未来预测`
7. 在 `未来预测` 先创建记录，再启动预测
8. 展示图谱、行动流、预测详情与报告

### 11.2 推荐演示议题

- `台海局势升级后的舆论演化`
- `中东局势升级下的全球能源与舆情链式影响`
- `南海争端升温后的区域安全与传播路径`

---

## 12. 生产或演示部署建议

### 12.1 单机演示部署

这是今晚最稳的方案。

同一台机器上运行：

- `zep-local / graphiti`
- `backend.main`
- `frontend` 开发服务或构建产物预览

建议端口：

- 前端：`3000`
- 后端：`8080`
- Zep：`8000`
- Graphiti：`8003`

### 12.2 前后端分离部署

如果你要拆开部署：

- 前端打包后放静态站点或 Nginx
- 后端独立运行 FastAPI
- 前端通过反向代理或环境变量把 `/api` 指到后端
- `zep-local / graphiti` 仍建议与后端处于同一内网

### 12.3 Windows 演示环境建议

建议开三个窗口：

1. `zep-local`
2. `backend.main`
3. `frontend pnpm dev`

如果你要更稳一点，可以考虑用：

- NSSM
- PM2
- Task Scheduler

把后端和前端挂成长期进程。

---

## 13. 关键接口

### 13.1 全球观测

- `GET /api/intelligence/cii`
- `GET /api/intelligence/signals`
- `GET /api/intelligence/news`
- `GET /api/intelligence/focal-points`
- `GET /api/intelligence/country-context/{iso}`

### 13.2 议题研判

- `POST /api/analysis/trigger`
- `GET /api/analysis/{task_id}`

### 13.3 未来预测

- `GET /api/simulation/runs`
- `POST /api/simulation/runs`
- `POST /api/simulation/runs/{run_id}/start`
- `POST /api/simulation/runs/{run_id}/stop`
- `GET /api/simulation/runs/{run_id}/status`
- `GET /api/simulation/runs/{run_id}/detail`
- `GET /api/simulation/runs/{run_id}/profiles`
- `GET /api/simulation/runs/{run_id}/actions`
- `GET /api/simulation/runs/{run_id}/timeline`
- `GET /api/simulation/runs/{run_id}/agent-stats`
- `GET /api/simulation/runs/{run_id}/graph`
- `GET /api/simulation/report/{run_id}`

---

## 14. 常见问题

### 14.1 前端 `pnpm dev` 报 `spawn EPERM`

这通常不是项目代码错误，而是当前环境对 `esbuild` 子进程有限制。

可尝试：

1. 提权启动终端
2. 使用本机正常 PowerShell 或 CMD
3. 先执行 `pnpm build`，确认代码本身无误

### 14.2 外部新闻抓取失败

如果你看到类似：

- `WinError 10013`
- `Connection error`

说明当前环境限制了对外访问。

这时系统仍会：

- 使用 fallback 新闻
- 使用 fallback 信号
- 使用本地监控底稿

所以主链仍可演示，但“完全真实外部数据”会受限。

### 14.3 MiniMax 连不上

先检查：

1. `MINIMAX_API_KEY` 是否有效
2. `*_LLM_BASE_URL` 是否为 `https://api.minimaxi.com/v1`
3. 本机是否能正常出网

### 14.4 图谱有节点但关系很少

优先检查：

1. `zep-local / graphiti` 是否真的有数据
2. `GRAPHITI_BASE_URL` 是否可达
3. 当前预测记录是否已启动并生成 `actions.jsonl`

说明：

- 当前图谱策略是“远端图优先 + 本地快照兜底 + 动作层补图”
- 远端不可用时仍能出图，但语义厚度会比完整图服务弱

### 14.5 议题研判能跑，但质量一般

这通常不是页面本身的问题，而是素材不足或外部调用受限。

建议检查：

1. 当前 query 是否过大或过泛
2. 外部 LLM 是否可连通
3. 当前是否落入 `degraded` 降级底稿模式

---

## 15. 开发与回归

### 15.1 常用命令

```powershell
# 后端烟雾
cd F:\1work\OrcFish\orcafish
.venv\Scripts\python.exe -m pytest tests\test_backend_smoke.py

# 前端构建
cd frontend
pnpm build

# 前端开发
pnpm dev
```

### 15.2 推荐回归顺序

1. 跑后端烟雾测试
2. 跑前端构建
3. 人工走查三页：
   - `全球观测`
   - `议题研判`
   - `未来预测`
4. 重点确认“送去研判”“送入未来预测”链路没断

---

## 16. 补充说明

- 详细部署补充仍保留在 [docs/DEPLOYMENT.md](F:/1work/OrcFish/orcafish/docs/DEPLOYMENT.md)
- 本地 Zep CE / Graphiti 的一步一步启动说明见 [zep-local/README.md](F:/1work/OrcFish/orcafish/zep-local/README.md)
- 但本 README 现在已经包含完整安装、启动、部署、联调、排障主信息
- 如果你今晚直接交付，优先按本 README 的“单机演示部署”执行即可

