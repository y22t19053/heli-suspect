FROM node:20-alpine

WORKDIR /app

# 只装运行依赖，避免把测试/Playwright 带进镜像
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY shared ./shared
COPY public ./public
COPY singleplayer.html ./
COPY favicon.svg manifest.json ./

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "server.js"]
