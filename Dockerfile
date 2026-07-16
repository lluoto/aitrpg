# ============================================================
# AI TRPG — 多阶段 Docker 构建
# ============================================================

# ── Stage 1: 构建前端 ──
FROM oven/bun:1.2 AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN bun install --frozen-lockfile --production || bun install

COPY frontend/ .
RUN bun run build

# ── Stage 2: 运行后端 ──
FROM oven/bun:1.2-slim

WORKDIR /app

# 复制后端源码
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production || bun install

COPY src/ ./src/
COPY data/ ./data/

# 复制前端构建产物到后端的静态目录
COPY --from=frontend-build /app/frontend/dist/ ./frontend/dist/

# 环境变量
ENV PORT=3099
ENV NODE_ENV=production

# 数据持久化目录
VOLUME [ "/app/data" ]

EXPOSE 3099

CMD ["bun", "src/api/server.ts"]