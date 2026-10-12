# Hosted build: a production bundle served by `vite preview`, which also runs
# the keyless provider proxies under server/providers/. Keys are optional; set
# them as environment variables on the host only if you accept that every
# visitor spends their quota (see SECURITY.md and docs/HOSTING.md).
FROM node:24.14.0-bookworm-slim

ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000

WORKDIR /app

COPY package.json package-lock.json ./
# Dev dependencies are needed at runtime: `vite preview` serves the app.
RUN npm ci --include=dev --no-audit --no-fund

COPY . .
RUN npm run build && chown -R node:node /app

USER node
EXPOSE 10000

# Render publishes the service hostname as RENDER_EXTERNAL_HOSTNAME. The Host
# allowlist must name it, plus any custom domain listed in GEV_ALLOWED_HOSTS.
CMD ["sh", "-c", "GEV_ALLOWED_HOSTS=\"${RENDER_EXTERNAL_HOSTNAME},${GEV_ALLOWED_HOSTS}\" exec npx vite preview --host 0.0.0.0 --port \"${PORT}\" --strictPort"]
