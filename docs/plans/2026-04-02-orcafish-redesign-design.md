# OrcaFish 重构设计文档

日期：2026-04-02

## 1. 目标

本次重构不是局部修补，而是把 OrcaFish 从暗色监控台重做为一个明亮、舒适、具有未来预判气质的统一预测平台。

本轮目标包括：

1. 全站从暗色风格切换为明亮的“晨雾科技感”视觉体系。
2. 界面展示文案全部中文化，但不修改路由路径、接口字段和内部代码符号名。
3. 统一产品心智，从分散功能页改为一条清晰主线：观测 → 研判 → 推演 → 编排。
4. 本地源码部署并接入 Zep 与 Crawl4AI，不使用 Docker，统一适配到项目根目录 `.venv`。
5. 吸收 `worldmonitor`、`BettaFish`、`MiroFish`、`last30days-skill` 四份母体项目的长处，重组为一个统一产品，而不是简单拼接。

## 2. 产品主线

OrcaFish 的信息架构调整为：

- 预测总览
- 全球观测
- 议题研判
- 未来推演
- 自动流程

这五个页面形成一条完整产品主线：

- 预测总览：先看今天值得关注什么
- 全球观测：看世界正在发生什么
- 议题研判：把一个主题讲清楚
- 未来推演：基于输入内容做情景推演
- 自动流程：展示系统如何自动从观测推进到推演

## 3. 视觉方向

本次视觉方向采用“晨雾科技感”为主，吸收少量“星图预见感”元素。

### 视觉关键词

- 浅色
- 留白
- 云雾蓝
- 柔和渐变
- 轻玻璃感
- 星图 / 轨迹 / 趋势
- 未来预判

### 视觉原则

1. 背景使用浅雾灰蓝和柔和渐变，不再使用暗色底。
2. 卡片统一为浅色面板、轻边框、软阴影、大圆角。
3. 主色采用蓝色，辅以紫色表达未来感。
4. 图表、报告、图谱容器全面适配亮色主题。
5. 核心未来感集中在图谱、推演、轨迹和趋势表达中，而不是全站使用重装饰。

## 4. 中文命名规范

界面展示文案统一中文化。

### 导航命名

- Dashboard → 预测总览
- Intelligence → 全球观测
- Analysis → 议题研判
- Simulation → 未来推演
- Pipeline → 自动流程

### 常见展示映射

- LIVE → 实时
- OFFLINE → 离线 / 连接断开
- Knowledge Graph → 关系图谱
- Platform Status → 平台态势
- Action Stream → 行动流
- Legend → 图例
- Agent → 代理体
- Executive Summary → 执行摘要
- Background → 背景
- Analysis → 分析
- Prediction → 预测
- Recommendations → 建议

## 5. 五个页面的重构定位

### 5.1 预测总览

定位为产品首页，像“今天值得关注什么”的未来态势首页。

重点模块：
- 今日总体态势
- 未来 72 小时预判摘要
- 活跃信号 / 推演进行中 / 自动流程 / 系统状态
- 重点地区
- 最近推演流程
- 快捷入口

主要参考：
- `F:/1work/OrcFish/worldmonitor`
- `F:/1work/OrcFish/last30days-skill`

### 5.2 全球观测

定位为全球风险观测页面，负责展示哪里在升温、为什么升温。

重点模块：
- 全球态势主视图
- 重点关注地区
- 信号汇聚
- 地区详情

主要参考：
- `F:/1work/OrcFish/worldmonitor`

### 5.3 议题研判

定位为研究工作台，围绕一个议题完成抓取、分析、成稿。

重点模块：
- 输入议题
- 推荐议题
- 处理中状态
- 分析结果
- 研判报告

主要参考：
- `F:/1work/OrcFish/BettaFish`
- `F:/1work/OrcFish/last30days-skill`

### 5.4 未来推演

定位为平台最具特色的核心页面，负责未来情景推演。

重点模块：
- 推演输入与控制
- 关系图谱
- 平台态势 / 进度
- 行动流
- 推演结论与预测报告

主要参考：
- `F:/1work/OrcFish/MiroFish`

### 5.5 自动流程

定位为系统自动编排总线，展示信号发现、研判、推演如何自动推进。

重点模块：
- 三阶段流程图
- 运行中的流程
- 实时事件流

主要参考：
- `F:/1work/OrcFish/worldmonitor`
- `F:/1work/OrcFish/BettaFish`
- `F:/1work/OrcFish/MiroFish`

## 6. 前端设计实施范围

### 关键底座文件

- `frontend/src/index.css`
- `frontend/src/App.tsx`

### 关键页面文件

- `frontend/src/components/Dashboard/index.tsx`
- `frontend/src/components/Intelligence/IntelligencePage.tsx`
- `frontend/src/components/Analysis/AnalysisPage.tsx`
- `frontend/src/components/Simulation/SimulationPage.tsx`
- `frontend/src/components/Pipeline/PipelinePage.tsx`

### 前端改造原则

1. 先统一 token，再逐页吸收母体项目结构。
2. 中文化只改展示层，不动路由和内部字段名。
3. 页面不是简单翻译，而是重新梳理信息层级。
4. 保持统一风格，避免出现“多个项目拼贴感”。

## 7. 本地源码接入设计

### 7.1 总体原则

Zep 与 Crawl4AI 都采用本地源码部署，不使用 Docker，统一接入项目根 `.venv`。

路径基线：
- 项目根目录：`F:/1work/OrcFish/orcafish`
- Python 环境：`F:/1work/OrcFish/orcafish/.venv`

OrcaFish 只做业务编排，不复刻第三方能力。

### 7.2 Zep 接入设计

目标：把现有偏 Cloud / 临时兼容的图谱逻辑收敛成统一本地图谱接入层。

设计要求：
1. 使用 `F:/1work/OrcFish/orcafish/zep` 源码本地部署。
2. OrcaFish 内部仅保留一个统一图谱入口：`backend/graph/graph_builder.py`
3. 其它调用点只调用统一图谱入口，不各自维护图谱逻辑。

需要统一的调用点：
- `backend/simulation/graph_builder.py`
- `backend/api/routes/simulation.py`
- `backend/pipeline/orchestrator.py`

### 7.3 Crawl4AI 接入设计

目标：让议题研判从搜索结果提升到“正文抓取 + 清洗后分析”。

设计要求：
1. 使用 `F:/1work/OrcFish/orcafish/crawl4ai` 源码本地部署。
2. 所有依赖统一安装到项目根 `.venv`。
3. OrcaFish 增加统一抓取适配层，不让多个 agent 分散直连。

建议接入点：
- `backend/analysis/agents/query.py`
- `backend/analysis/agents/media.py`
- `backend/analysis/agents/insight.py`

建议调用顺序：
搜索结果 → Crawl4AI 抓正文 → 清洗文本 → LLM 研判。

### 7.4 配置方向

配置应以本地服务优先为默认语义。

关键配置：
- `zep_base_url`
- `zep_api_secret`
- `crawl4ai_base_url`
- `crawl4ai_token`

Cloud key 只保留回退能力，不作为主路径。

## 8. 旧兼容补丁回看原则

此前有一部分修改是在错误 Python 环境下完成，需要回看。

重点文件：
- `backend/models/intelligence.py`
- `backend/models/pipeline.py`
- `backend/graph/graph_builder.py`
- `backend/simulation/graph_builder.py`
- `backend/api/routes/intelligence.py`
- `backend/api/routes/simulation.py`
- `backend/pipeline/orchestrator.py`
- `backend/simulation/runner.py`
- `backend/simulation/manager.py`

回看原则：
1. Python 3.13 本身已支持的语法，不再为了 3.8 保留额外兼容心态。
2. 保留真实业务逻辑，删除错误运行环境带来的临时回退。
3. 图谱接入逻辑不要继续 patch，要整体收敛到统一适配层。

## 9. 推荐实施顺序

### 阶段 1：统一设计底座
- 重写 `index.css`
- 重做 `App.tsx`
- 统一导航命名和全站 token

### 阶段 2：逐页重构
- 预测总览 / 全球观测：优先参考 worldmonitor
- 议题研判：优先参考 BettaFish + last30days-skill
- 未来推演：优先参考 MiroFish
- 自动流程：整合三个子系统能力

### 阶段 3：接入本地源码能力
- 在 `.venv` 中启动 Zep
- 在 `.venv` 中启动 Crawl4AI
- OrcaFish 统一适配并接入

### 阶段 4：清理旧兼容层
- 回看 3.8 环境下产生的兼容性修改
- 清理不必要回退逻辑

### 阶段 5：端到端联调
- 全球观测 → 议题研判 → 未来推演 → 自动流程
- 全链路验证

## 10. 验收标准

### 视觉验收
- 不再是暗色调
- 整体明亮、舒适、统一
- 有未来预测气质
- 不像多个项目拼贴

### 文案验收
- 展示层无英文残留
- 命名统一
- 标题、状态、按钮语气统一

### 结构验收
- 产品主线清晰：观测 → 研判 → 推演 → 编排
- 每页定位清楚
- 母体项目优势被保留且统一

### 技术验收
- Zep 本地源码可运行
- Crawl4AI 本地源码可运行
- `.venv` 成为唯一 Python 基线
- 前端构建通过
- 后端主要路由可用

### 业务验收
- 能从观测进入研判
- 能从研判进入推演
- 能在自动流程中看到状态推进
- 推演结果与报告可展示
