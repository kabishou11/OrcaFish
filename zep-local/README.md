# zep-local

这是给当前项目 `OrcaFish` 准备的本地 `Zep Community Edition (Legacy)` Docker 启动目录。

## 目录内容

仓库里会提交这些安全文件：

- `docker-compose.yml`
- `docker-compose.ce.yaml`
- `.env.example`
- `zep.yaml`
- `README.md`

你本地自己创建但不要提交的文件：

- `.env`

## 快速启动

第一次部署按下面走：

```powershell
cd F:\1work\OrcFish\orcafish
Copy-Item zep-local\.env.example zep-local\.env
cd zep-local
docker compose up -d
```

查看日志：

```powershell
docker compose logs -f
```

停止：

```powershell
docker compose down
```

## 你需要改的只有一个地方

打开 `zep-local/.env`，把下面这个值换成你自己的兼容模型 Key：

```env
OPENAI_API_KEY=your_openai_compatible_key_here
```

如果你继续用 MiniMax，默认配置已经是：

```env
OPENAI_BASE_URL=https://api.minimaxi.com/v1
MODEL_NAME=MiniMax-M2.7
```

## 端口

- `8000` Zep
- `8003` Graphiti
- `5432` Postgres
- `7474` Neo4j HTTP
- `7687` Neo4j Bolt

## 和 OrcaFish 的连接方式

确保项目根目录 `.env` 中这些配置与本地服务一致：

```env
ZEP_BASE_URL=http://localhost:8000
GRAPHITI_BASE_URL=http://localhost:8003
ZEP_API_SECRET=change-me-zep-local-secret
```

说明：

- 这里的 `ZEP_API_SECRET` 只是示例值
- 第一次部署时，建议你把 `zep-local/zep.yaml` 和项目根目录 `.env` 里的这个值一起换成自己的本地 secret

## Python 版本说明

这个目录走的是 Docker 方案，容器本身不依赖宿主机 Python 版本。

但为了让整个 OrcaFish 项目部署步骤统一，仓库文档统一按 Python 3.13 编写。也就是：

- `zep-local` 用 Docker 跑
- `OrcaFish` 后端用 Python 3.13 跑

## 安全提醒

- 不要提交 `zep-local/.env`
- 不要把真实 API Key 写进 `README.md`、截图或录屏
- 如果你拿这套配置去公网环境，先把 `zep.yaml` 里的默认 secret 换掉
