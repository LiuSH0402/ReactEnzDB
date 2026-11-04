ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS builder

WORKDIR /app/nextjs_site/Nicktio-nextjs-pro-main/package

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .

ARG NEXT_PUBLIC_SITE_URL=http://127.0.0.1
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM ${NODE_IMAGE} AS runner

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/reactenzdb-python \
    && /opt/reactenzdb-python/bin/pip install --no-cache-dir "rdkit>=2025.3,<2027"

WORKDIR /app/nextjs_site/Nicktio-nextjs-pro-main/package

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV REACTENZDB_PYTHON=/opt/reactenzdb-python/bin/python
ENV REACTENZDB_ANALYTICS_DB=/app/runtime/reactenzdb_analytics.sqlite

COPY --from=builder --chown=node:node /app/nextjs_site/Nicktio-nextjs-pro-main/package/.next/standalone ./
COPY --from=builder --chown=node:node /app/nextjs_site/Nicktio-nextjs-pro-main/package/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/nextjs_site/Nicktio-nextjs-pro-main/package/public ./public
COPY --from=builder --chown=node:node /app/nextjs_site/Nicktio-nextjs-pro-main/package/scripts/reaction_smiles_search.py ./scripts/reaction_smiles_search.py
COPY --from=builder --chown=node:node /app/nextjs_site/Nicktio-nextjs-pro-main/package/scripts/retrosynthesis_mapping.py ./scripts/retrosynthesis_mapping.py
COPY --from=builder --chown=node:node /app/nextjs_site/Nicktio-nextjs-pro-main/package/scripts/sqlite_fts_search.py ./scripts/sqlite_fts_search.py

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]
