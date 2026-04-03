# OrcaFish 部署与启动文档

## 1. 目标

这份文档面向今晚交付场景，覆盖：

- 本地开发启动
- 演示环境启动
- MiniMax / ModelScope 模型切换
- `zep` / `crawl4ai` 的可选接入
- 快速排障与验证

## 2. 环境要求

### 后端

- Windows 10/11 或 Linux / macOS
- Python 3.11+
- 建议使用项目内 `.venv`

### 前端

- Node.js 18+
- `pnpm`

### 可选依赖

- Docker Desktop：用于本地启动 `zep`
- 外部 API Key：ModelScope 或 MiniMax

## 3. 目录说明

- 后端入口：[backend/main.py](F:/1work/OrcFish/orcafish/backend/main.py)
- 配置入口：[backend/config.py](F:/1work/OrcFish/orcafish/backend/config.py)
- LLM 客户端：[backend/llm/client.py](F:/1work/OrcFish/orcafish/backend/llm/client.py)
- 前端入口：[frontend/src/App.tsx](F:/1work/OrcFish/orcafish/frontend/src/App.tsx)
- 环境变量模板：[.env.example](F:/1work/OrcFish/orcafish/.env.example)
- 后端烟雾测试：[tests/test_backend_smoke.py](F:/1work/OrcFish/orcafish/tests/test_backend_smoke.py)

## 4. 首次安装

### 4.1 后端依赖

```powershell
cd F:\1work\OrcFish\orcafish
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 4.2 前端依赖

```powershell
cd F:\1work\OrcFish\orcafish\frontend
pnpm install
```

## 5. 环境变量配置

从模板复制：

```powershell
cd F:\1work\OrcFish\orcafish
Copy-Item .env.example .env
```

当前配置系统已经支持扁平变量名，例如：

- `QUERY_LLM_PROVIDER`
- `QUERY_LLM_API_KEY`
- `QUERY_LLM_BASE_URL`
- `QUERY_LLM_MODEL`
- `QUERY_LLM_REASONING_SPLIT`

不需要改成嵌套格式。

## 6. 模型配置

### 6.1 默认方案：ModelScope

```env
MODELSCOPE_API_KEY=your-modelscope-api-key

QUERY_LLM_PROVIDER=modelscope
QUERY_LLM_API_KEY=your-modelscope-api-key
QUERY_LLM_BASE_URL=https://api-inference.modelscope.cn/v1
QUERY_LLM_MODEL=Qwen/Qwen3.5-35B-A3B
QUERY_LLM_REASONING_SPLIT=false
```

### 6.2 可选方案：MiniMax

MiniMax 已按 OpenAI 兼容方式接入，推荐模型 `MiniMax-M2.7`。

```env
MINIMAX_API_KEY=your-minimax-api-key

QUERY_LLM_PROVIDER=minimax
QUERY_LLM_API_KEY=your-minimax-api-key
QUERY_LLM_BASE_URL=https://api.minimaxi.com/v1
QUERY_LLM_MODEL=MiniMax-M2.7
QUERY_LLM_REASONING_SPLIT=true
```

如果你要把其他 Agent 也切到 MiniMax：

- `MEDIA_LLM_PROVIDER=minimax`
- `MEDIA_LLM_API_KEY=...`
- `MEDIA_LLM_BASE_URL=https://api.minimaxi.com/v1`
- `MEDIA_LLM_MODEL=MiniMax-M2.7`

同理可作用于：

- `INSIGHT_LLM_*`
- `REPORT_LLM_*`

### 6.3 reasoning_split 说明

当 `*_LLM_REASONING_SPLIT=true` 时，后端客户端会自动向 OpenAI 兼容接口透传：

```python
extra_body={"reasoning_split": True}
```

这对 MiniMax 的思考内容分离场景是兼容的。

## 7. 可选服务

### 7.1 Zep

- 默认地址：`http://localhost:8000`
- 配置项：
  - `ZEP_BASE_URL`
  - `ZEP_API_SECRET`

后端启动时会优先尝试访问本地 `zep`。
如果 Docker 可用，会尝试拉起仓库中的 `zep/legacy/docker-compose.ce.yaml`。
如果 Docker 不可用，后端会进入降级模式，不阻塞主页面启动。

### 7.2 Crawl4AI

- 默认地址：`http://localhost:11235`
- 配置项：
  - `CRAWL4AI_BASE_URL`
  - `CRAWL4AI_TOKEN`

后端启动时会检查 `.venv` 中是否已安装 `crawl4ai`，若缺失会尝试自动安装。
若自动安装失败，系统会继续启动，但正文抓取能力可能降级。

## 8. 启动方式

### 8.1 后端

推荐稳定启动：

```powershell
cd F:\1work\OrcFish\orcafish
.venv\Scripts\python.exe -m backend.main
```

需要热重载时再显式使用：

```powershell
cd F:\1work\OrcFish\orcafish
.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --port 8080
```

说明：

- 直接 `python -m backend.main` 已被调整为默认 `reload=False`
- 这是为了避免受限环境下热重载进程导致启动失败

### 8.2 前端

```powershell
cd F:\1work\OrcFish\orcafish\frontend
pnpm dev
```

默认地址：

- 前端：[http://localhost:3000](http://localhost:3000)
- 后端：[http://localhost:8080](http://localhost:8080)

## 9. 今晚演示主链

建议按这个顺序讲：

1. 打开首页“预测总览”
2. 进入“全球观测”，说明哪里在升温
3. 进入“议题研判”，输入一个议题
4. 等待 HTML 报告生成
5. 点击“送入未来推演”
6. 在“未来推演”先创建记录，再手动启动
7. 展示图谱、行动流和报告
8. 回到“自动流程”说明整条链路是如何被编排的

推荐议题：

- 台湾海峡局势升级后的舆论演化
- 南海擦枪走火与周边国家反应
- 中东局势升级下的全球能源与舆情链式影响

## 10. 验证命令

### 10.1 后端烟雾测试

```powershell
cd F:\1work\OrcFish\orcafish
.venv\Scripts\python.exe tests\test_backend_smoke.py
```

成功标志：

- 输出 `backend-smoke-ok`

### 10.2 前端构建检查

```powershell
cd F:\1work\OrcFish\orcafish\frontend
pnpm build
```

说明：

- 当前仍会有 Vite 的大 chunk 告警
- 这不阻塞今晚演示

## 11. 常见问题

### 11.1 改了 `.env` 但模型没切换

确认是否使用了以下扁平变量名：

- `QUERY_LLM_PROVIDER`
- `QUERY_LLM_API_KEY`
- `QUERY_LLM_BASE_URL`
- `QUERY_LLM_MODEL`

当前配置类已兼容这些字段。

### 11.2 后端启动很慢

常见原因：

- 启动时检查 `crawl4ai`
- 启动时检查 `zep`
- Docker 未启动导致 `zep` 检查等待

如果只是今晚演示，可以先接受降级模式，不影响主页面起起来。

### 11.3 `python -m backend.main` 启不来

优先检查：

- `.venv` 是否存在
- `pip install -r requirements.txt` 是否完成
- `.env` 中 API Key 是否为空

### 11.4 前端 `pnpm dev` 报 `spawn EPERM`

这通常是本地环境权限或沙箱限制导致，不代表项目代码有语法问题。
此时至少先执行：

```powershell
cd F:\1work\OrcFish\orcafish\frontend
pnpm build
```

如果构建通过，说明前端代码本身是可编译的。

## 12. 安全说明

- 不要把任何 API Key 写进仓库
- 只把密钥放进 `.env`、CI Secret 或部署平台 Secret
- 你刚才在对话里贴出来的 MiniMax Key 已视为泄露，建议交付后立即轮换
