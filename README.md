# OrcaFish — 统一情报系统

> 融合**地缘情报监测**、**舆情分析**、**群体智能仿真**的统一情报系统

[![Python](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://www.python.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5+-3178C6.svg)](https://www.typescriptlang.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688.svg)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg)](https://react.dev/)

---

## 项目概述

OrcaFish 旨在构建一个多层次、多源融合的统一情报分析平台，系统分为三大核心模块：

| 模块 | 描述 |
|------|------|
| **情报监测 (Intelligence)** | 全球地缘信号的实时采集、汇聚与危机强度指数 (CII) 计算 |
| **舆情分析 (Analysis)** | 多源舆情聚合、情感分析、实体抽取、议题检测与综合报告生成 |
| **仿真预测 (Simulation)** | 基于 CAMEL-OASIS 的群体智能代理网络仿真，情景推演与预测 |

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend (React + Vite)             │
│   Dashboard │ Intelligence │ Analysis │ Simulation          │
└──────────────────────────┬──────────────────────────────────┘
                           │  REST API + WebSocket /ws
┌──────────────────────────▼──────────────────────────────────┐
│                     Backend (FastAPI)                       │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Intelligence │  │   Analysis    │  │   Simulation     │  │
│  │  Router       │  │   Router      │  │   Router          │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │            │
│  ┌──────▼─────────────────▼────────────────────▼─────────┐ │
│  │              LLM Client Layer                          │ │
│  │  QueryLLM (DeepSeek)  MediaLLM (Gemini)                │ │
│  │  InsightLLM (Kimi)    ReportLLM (Gemini)               │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              Intelligence Engine                        │  │
│  │  CII Engine │ Signal Aggregator │ World Monitor         │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              Simulation Engine                          │  │
│  │  GraphBuilder (Zep) │ OASISRunner │ ReportAgent         │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              Pipeline Orchestrator                      │  │
│  │  AcledCollector │ UcdpCollector │ etc.                  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                 ▼
    Acled API         Upstash Redis     Zep Cloud
    UCDP API          Tavily API        OASIS
    FlightRadar       BettaFish DB
```

---

## 目录结构

```
orcafish/
├── backend/
│   ├── __init__.py
│   ├── main.py                  # FastAPI 应用入口
│   ├── config.py                # Pydantic 配置管理
│   ├── api/
│   │   └── routes/
│   │       ├── intelligence.py   # CII / 信号路由
│   │       ├── analysis.py       # 舆情分析路由
│   │       ├── simulation.py     # 仿真路由
│   │       └── pipeline.py       # 流水线路由
│   ├── llm/                      # 多 Provider LLM 客户端
│   ├── intelligence/              # CII 计算 / 信号汇聚 / World Monitor
│   ├── analysis/                  # QueryAgent / MediaAgent / InsightAgent / ReportAgent
│   ├── simulation/               # OntologyGenerator / GraphBuilder / OASISRunner
│   ├── pipeline/                 # 数据采集器 / Orchestrator
│   └── models/                   # Pydantic 数据模型
├── frontend/
│   ├── src/
│   │   ├── App.tsx               # 路由与布局
│   │   ├── main.tsx              # React 入口
│   │   ├── index.css             # 全局样式 (CSS Variables, Dark Mode)
│   │   └── components/
│   │       ├── Dashboard/         # 首页仪表板
│   │       ├── Intelligence/      # 情报监测页面
│   │       ├── Analysis/          # 舆情分析页面
│   │       └── Simulation/        # 仿真预测页面
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── index.html
├── requirements.txt
└── .env.example
```

---

## 快速开始

更详细的部署、启动、排障说明见 [docs/DEPLOYMENT.md](F:/1work/OrcFish/orcafish/docs/DEPLOYMENT.md)。

### 1. 安装依赖

```bash
# 后端虚拟环境
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# 安装后端依赖
pip install -r requirements.txt

# 安装前端依赖
cd frontend
pnpm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 填入 API Keys
```

关键变量说明（今晚演示至少保证一组可用 LLM Key）：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `APP_HOST` | 后端监听地址 | `0.0.0.0` |
| `APP_PORT` | 后端监听端口 | `8080` |
| `MODELSCOPE_API_KEY` | ModelScope Token（当前默认 Provider） | — |
| `MINIMAX_API_KEY` | MiniMax API Key（可选） | — |
| `QUERY_LLM_API_KEY` | Query Agent API Key | — |
| `REPORT_LLM_API_KEY` | Report Agent API Key | — |
| `QUERY_LLM_PROVIDER` | Query Agent Provider，可设为 `modelscope`/`minimax` 等 | `modelscope` |
| `QUERY_LLM_REASONING_SPLIT` | 是否开启 reasoning_details 分离 | `false` |
| `ZEP_API_KEY` | Zep API Key（可选） | — |
| `ZEP_BASE_URL` | 本地 Zep CE 地址 | `http://localhost:8000` |
| `ZEP_API_SECRET` | 本地 Zep CE Secret（可选） | — |
| `CRAWL4AI_BASE_URL` | Crawl4AI 服务地址 | `http://localhost:11235` |
| `CRAWL4AI_TOKEN` | Crawl4AI Token（如启用鉴权） | — |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis URL（信号缓存） | — |
| `ACLED_ACCESS_TOKEN` | Acled 冲突数据 API Token | — |
| `UCDP_ACCESS_TOKEN` | UCDP 武装冲突数据 API Token | — |
| `TAVILY_API_KEY` | Tavily 搜索 API Key | — |
| `CII_THRESHOLD` | CII 触发告警阈值 | `65.0` |
| `SIMULATION_ROUNDS` | 仿真默认轮次 | `40` |

### 3. 启动后端

```bash
# 稳定启动方式（推荐）
python -m backend.main

# 或直接
uvicorn backend.main:app --reload --port 8080
```

### 4. 启动前端

```bash
cd frontend
pnpm dev
# 访问 http://localhost:3000
```

### 5. 可选本地依赖

- `Zep CE`：默认会尝试连接 `http://localhost:8000`，若 Docker 可用，后端启动时会尝试自动拉起本地 `zep/legacy/docker-compose.ce.yaml`
- `crawl4ai`：后端启动时会检查当前 `.venv` 是否已安装；若未安装，会尝试自动安装并在失败时降级
- 缺少以上依赖时，系统仍可进入前端并完成部分演示，但知识图谱与正文抓取会降级

### 6. MiniMax 可选模型

当前后端已支持把任意一个 Agent 切到 MiniMax 的 OpenAI 兼容接口。最小配置示例：

```env
MINIMAX_API_KEY=your-minimax-api-key

QUERY_LLM_PROVIDER=minimax
QUERY_LLM_API_KEY=${MINIMAX_API_KEY}
QUERY_LLM_BASE_URL=https://api.minimaxi.com/v1
QUERY_LLM_MODEL=MiniMax-M2.7
QUERY_LLM_REASONING_SPLIT=true
```

如果你希望 `Media / Insight / Report` 也切到 MiniMax，同样把对应的 `*_LLM_PROVIDER`、`*_LLM_API_KEY`、`*_LLM_BASE_URL`、`*_LLM_MODEL` 改掉即可。

说明：

- `*_REASONING_SPLIT=true` 时，客户端会透传 `extra_body={"reasoning_split": true}`
- 密钥不要写死进仓库，只放在 `.env` 或部署平台的 Secret 中
- 你刚才贴出来的那把 MiniMax Key 已经属于泄露态，建议交付后立刻轮换

## 今晚演示最短路径

1. 启动后端，确认 [http://localhost:8080/health](http://localhost:8080/health) 返回 `status=healthy`
2. 启动前端，打开 [http://localhost:3000](http://localhost:3000)
3. 首页从“全球观测 → 议题研判 → 未来推演 → 自动流程”进入
4. 在“议题研判”页输入一个议题，等待 HTML 报告生成
5. 点击“送入未来推演”，让分析结果预填到推演工作台
6. 在“未来推演”页先创建记录，再手动点击启动，最后查看图谱、行动流和报告

推荐演示议题：

- 台湾海峡局势升级后的舆论演化
- 南海擦枪走火与周边国家反应
- 中东局势升级下的全球能源与舆情链式影响

---

## 核心模块说明

### Intelligence — 情报监测

- **CII Engine**：计算国家危机强度指数，综合军事异常、冲突事件、社会动荡等多维信号
- **Signal Aggregator**：汇聚 Acled、UCDP、FlightRadar24、 VesselFinder 等多源信号，按国家聚类
- **World Monitor**：定时轮询外部数据源，检测信号汇聚，当 CII > 阈值且汇聚信号 >= 3 时触发告警

### Analysis — 舆情分析

- **QueryAgent**：使用 DeepSeek 搜索相关报道与文献
- **MediaAgent**：使用 Gemini 分析媒体内容情感与主题
- **InsightAgent**：使用 Kimi 生成深层洞察
- **ReportAgent**：使用 Gemini 生成 HTML 综合报告

### Simulation — 仿真预测

- **GraphBuilder**：使用 Zep Cloud 构建知识图谱ontology
- **OASISRunner**：基于 CAMEL-OASIS 运行群体智能代理仿真
- **SimulationIPC**：仿真进程间通信，支持"上帝模式"变量注入
- **ReportAgent**：基于仿真结果生成情景推演报告

### Pipeline — 数据流水线

- **Orchestrator**：统一调度多源数据采集任务（ACLED、UCDP、Tavily、BettaFish DB）
- **TriggerEngine**：基于信号汇聚条件触发舆情分析或仿真任务

---

## API 路由概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| WS | `/ws` | 实时事件流 |
| GET | `/api/intelligence/cii` | 获取所有国家 CII 指数 |
| GET | `/api/intelligence/cii/{iso}` | 获取指定国家 CII |
| GET | `/api/intelligence/signals` | 获取信号汇聚 |
| POST | `/api/intelligence/ingest` | 外部信号接入 |
| POST | `/api/analysis/trigger` | 发起舆情分析 |
| GET | `/api/analysis/{task_id}` | 查询分析状态 |
| GET | `/api/intelligence/world-monitor/status` | 世界监测器状态 |
| POST | `/api/analysis/trigger` | 发起议题研判 |
| GET | `/api/analysis/{task_id}` | 查询研判结果 |
| GET | `/api/simulation/runs` | 获取推演运行列表 |
| POST | `/api/simulation/runs` | 创建推演记录（不自动启动） |
| POST | `/api/simulation/runs/{run_id}/start` | 启动推演 |
| GET | `/api/simulation/runs/{run_id}/status` | 查询推演状态 |
| GET | `/api/simulation/runs/{run_id}/detail` | 获取推演详情与行动流 |
| GET | `/api/simulation/runs/{run_id}/graph` | 获取推演知识图谱 |
| GET | `/api/simulation/report/{run_id}` | 获取推演报告 HTML |
| GET | `/api/pipeline/` | 流水线状态 |

---

## 开发说明

### 代码规范

- **Python**: PEP 8，使用 `loguru` 记录日志
- **TypeScript**: 严格模式，禁止 `any` 逃逸
- **API**: RESTful，错误返回标准 HTTP 状态码

### 注意事项

- 首次运行建议至少配置 `MODELSCOPE_API_KEY` 与 `QUERY_LLM_API_KEY`
- 当前配置系统已兼容 `.env.example` 里的扁平变量名，不需要改成嵌套格式
- `Zep` 与 `crawl4ai` 已按本地集成思路接入，但缺失时会进入降级模式，不阻塞页面演示
- 推演链路已调整为“先创建，再启动”，更贴近 `MiroFish` 工作台操作方式
- “议题研判 → 送入未来推演” 是今晚最重要的主链，演示时优先走这条路径
- 前端 Vite 开发服务器已配置 API 和 WebSocket 代理到后端 `8080`

### 快速验证

```bash
# 后端接口烟雾测试
.venv\Scripts\python.exe tests\test_backend_smoke.py

# 前端生产构建检查
cd frontend
pnpm build
```

---

## License

MIT
