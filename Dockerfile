FROM node:20-alpine AS build
WORKDIR /app

ENV npm_config_audit=false \
    npm_config_fund=false \
    npm_config_update_notifier=false

COPY package.json ./
RUN npm install --include=dev --registry=https://registry.npmjs.org/

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache ffmpeg python3 py3-pip yt-dlp \
  && addgroup -S fmcord \
  && adduser -S -G fmcord fmcord

ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./package.json

USER fmcord
CMD ["node", "dist/index.js"]
