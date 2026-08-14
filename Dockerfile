# ============================================================
# AI TRPG — 多阶段 Docker 构建
# ============================================================
#
# 构建前需要先把世界模型放进 assets/（229MB，在仓库之外，见 docs/deploy.md）：
#   mkdir assets
#   cp ../世界模型/v18_output/v18_all_master.jsonl assets/
#   cp ../世界模型/cthulhu_extracted/cthulhu_world_model.jsonl assets/
#
# Docker 的构建上下文取不到项目目录之外的文件，所以只能先搬进来。

# ── Stage 1: 构建前端 ──
FROM oven/bun:1.2 AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/bun.lock* frontend/package-lock.json* ./
RUN bun install

COPY frontend/ .
RUN bun run build

# ── Stage 2: 运行后端 ──
FROM oven/bun:1.2-slim

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --production || bun install

COPY src/ ./src/

# 世界模型。缺失时程序只 warn 不崩，但 KP 上下文、幻觉风险评分、
# 规则映射都会失效，等于少了一大半判断依据。
COPY assets/ ./assets/

# 前端构建产物 —— 由后端在同一端口托管，见 src/api/server.ts 的 serveStatic
COPY --from=frontend-build /app/frontend/dist/ ./frontend/dist/

ENV PORT=3099
ENV NODE_ENV=production
ENV FRONTEND_DIR=/app/frontend/dist
ENV WORLD_MODEL_PATH=/app/assets/v18_all_master.jsonl
ENV CTHULHU_MODEL_PATH=/app/assets/cthulhu_world_model.jsonl

# 会话存档与模组 JSON 落在这里；data/ 不入镜像，由卷提供
VOLUME [ "/app/data" ]

EXPOSE 3099

CMD ["bun", "src/api/server.ts"]
