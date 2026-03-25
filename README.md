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

### 1. 克隆与依赖安装

```bash
# 创建虚拟环境
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# 安装后端依赖
cd orcafish
pip install -r requirements.txt

# 安装前端依赖
cd frontend
npm install
```

### 2. 配置环境变量

```bash
cp orcafish/.env.example orcafish/.env
# 编辑 .env 填入 API Keys
```

关键变量说明：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `APP_HOST` | 后端监听地址 | `0.0.0.0` |
| `APP_PORT` | 后端监听端口 | `8080` |
| `QUERY_LLM_API_KEY` | DeepSeek API Key | — |
| `QUERY_LLM_BASE_URL` | DeepSeek API Base URL | `https://api.deepseek.com/v1` |
| `REPORT_LLM_API_KEY` | Gemini API Key | — |
| `REPORT_LLM_BASE_URL` | Gemini API Base URL | `https://generativelanguage.googleapis.com/v1beta` |
| `ZEP_API_KEY` | Zep Cloud Knowledge Graph | — |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis URL（信号缓存） | — |
| `ACLED_ACCESS_TOKEN` | Acled 冲突数据 API Token | — |
| `UCDP_ACCESS_TOKEN` | UCDP 武装冲突数据 API Token | — |
| `TAVILY_API_KEY` | Tavily 搜索 API Key | — |
| `CII_THRESHOLD` | CII 触发告警阈值 | `65.0` |
| `SIMULATION_ROUNDS` | 仿真默认轮次 | `40` |

### 3. 启动后端

```bash
cd orcafish
python -m backend.main
# 或直接
uvicorn backend.main:app --reload --port 8080
```

### 4. 启动前端

```bash
cd frontend
npm run dev
# 访问 http://localhost:3000
```

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
| POST | `/api/simulation/create` | 创建仿真项目 |
| POST | `/api/simulation/{id}/start` | 启动仿真 |
| POST | `/api/simulation/{id}/inject` | 变量注入 |
| GET | `/api/pipeline/` | 流水线状态 |

---

## 开发说明

### 代码规范

- **Python**: PEP 8，使用 `loguru` 记录日志
- **TypeScript**: 严格模式，禁止 `any` 逃逸
- **API**: RESTful，错误返回标准 HTTP 状态码

### 注意事项

- 首次运行需配置至少一个 LLM API Key（`QUERY_LLM_API_KEY` 最低限度可用）
- World Monitor 需要配置 `UPSTASH_REDIS_REST_URL/TOKEN` 以启用信号缓存
- 仿真模块依赖 CAMEL-OASIS，需确认 `camel-ai[oasis]` 安装完整
- 前端 Vite 开发服务器已配置 API 和 WebSocket 代理到后端 8080 端口

---

## License

MIT
