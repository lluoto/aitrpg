# 部署

日期：2026-08-13
形态：**单容器**。后端在同一端口托管前端构建产物，一个镜像、一个端口。

---

## 一、为什么是单容器

按可用性、迁移性、性能三条衡量，迁移性是决定项：

- **迁移性**：一个镜像一个端口，构建期不必把 API 地址烘进前端，也不需要配 CORS。换地方 `docker run` 就跑。前后端分开要两次发布、两处配置。
- **可用性**：一个故障域，运维面最小。分层的好处是 API 挂了前端还能出错误页，当前阶段不值这个复杂度。
- **性能**：产物很小（JS 123KB / gzip 43KB，CSS 29KB / gzip 5KB），CDN 边际收益有限。真实延迟在 LLM 那一侧（实测叙事回合 2–5 秒），不在静态资源。

静态托管在 `src/api/server.ts` 的 `serveStatic()`：

- 带内容哈希的资源（`index-XXXX.js`）发 `immutable, max-age=31536000`；`index.html` 发 `no-cache`，否则用户会一直拿到旧页面、里面引用着已不存在的资源名。
- API 路由优先匹配，静态兜底，接口不会被遮住。
- 带扩展名的路径未命中直接 404，**不回退 index.html**。回退会让前端拿到一份 HTML 却按 js/wav 去解析，报出来的错和真实原因毫无关系——预制语音那边踩过：vite dev 对缺失的 `.mp3` 回 200 + HTML。
- 没有构建产物时回落到服务端内置的调试页，本地开发不受影响。

---

## 二、构建前必须先放世界模型

229MB，在仓库之外（`../世界模型/`），Docker 构建上下文取不到项目目录以外的文件，所以只能先搬进来：

```bash
mkdir -p assets
cp ../世界模型/v18_output/v18_all_master.jsonl assets/
cp ../世界模型/cthulhu_extracted/cthulhu_world_model.jsonl assets/
```

`assets/` 已在 `.gitignore` —— 它是数据不是源码。

容器里的路径由环境变量指定，代码不必改：

| 变量 | 镜像内默认值 |
|---|---|
| `WORLD_MODEL_PATH` | `/app/assets/v18_all_master.jsonl` |
| `CTHULHU_MODEL_PATH` | `/app/assets/cthulhu_world_model.jsonl` |
| `FRONTEND_DIR` | `/app/frontend/dist` |

这三处此前散在 6 处 / 4 个文件里硬编码。`WORLD_MODEL_PATH` 与 `CTHULHU_MODEL_PATH`
两处已收口到 `world-model-loader.ts` 的常量；`FRONTEND_DIR` 收口在
`src/api/server.ts:597`，不在 `world-model-loader.ts`——三个变量不是同一处收口的。

**缺失时不会崩**，只 warn。但 KP 上下文注入、幻觉风险评分、规则映射都会失效，等于少了大半判断依据。

**加载是懒的**：服务启动只需两三秒，模型在第一次建会话时才读（实测 1.6 秒读完 383688 条）。所以容器就绪探针不必等模型。

---

## 三、跑起来

```bash
docker compose up -d --build
```

LLM 凭据从宿主环境传入，不烘进镜像：

```bash
export LLM_API_KEY=...
export LLM_BASE_URL=...
export LLM_MODEL=...
```

缺凭据服务照常起，但叙事会退化成本地兜底的短句（实测：技能检定、掷骰、加载模组本来就不经 LLM，这些不受影响）。

`data/`（会话存档、模组 JSON、SQLite）挂在具名卷 `trpg_data`，不入镜像。

---

## 四、已知缺口

**音频在 Linux 容器里没有。** `frontend/public/{bgm,voice}/*.wav` 都是生成物、不入库，`.dockerignore` 也排除了它们。

- 环境音：`scripts/gen-bgm.ts` 是纯 TS 合成，容器里能跑，但目前没接进构建流程。
- 预制语音：`scripts/gen-speech.ts` 走 **Windows SAPI**，Linux 下跑不了。当初就标注过它是"本机可验证的实现，不是生产选型"——这一点现在到账了。要么在 Windows 上预先生成后随镜像带走，要么换一个跨平台的合成后端。

两者缺失都只是静默不放，不影响叙事流程。

**`docker build` 未经实跑验证。** 本机没有安装 Docker，上面的 Dockerfile 与 compose 是照着已验证的本地行为写的（静态托管、环境变量路径都在本地实测通过），但构建本身没跑过。首次部署时要留意：`bun install` 的 lockfile 兼容性、前端构建阶段的依赖完整性。

---

## 五、启动时间

| 阶段 | 耗时 |
|---|---|
| 服务就绪 | 2–3 秒 |
| 首次建会话（含读 229MB 世界模型 + LLM 开场白） | 约 11 秒 |
| 之后每次建会话 | 由 LLM 决定，模型已常驻 |
