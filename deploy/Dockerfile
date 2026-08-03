# MikeFiles Drive web (files.osmike.com) — Docker image for the 242 host.
# Multi-stage: build the Vite SPA, then serve dist/ with the Express BFF.
# server.js reads process.env.PORT (default 8075). Shared Caddy on 242 fronts
# this container for TLS at files.osmike.com.

FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY server.js ./
COPY --from=build /app/dist ./dist
EXPOSE 8075
CMD ["node", "server.js"]
