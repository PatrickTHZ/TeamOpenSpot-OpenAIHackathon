FROM node:24-alpine

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=optional

COPY backend/tsconfig.json backend/tsconfig.node.json ./
COPY backend/src ./src
COPY shared /shared

ENV HOST=0.0.0.0
ENV PORT=5072
ENV OPENAI_MODEL=gpt-5
ENV OPENAI_TIMEOUT_MS=2500
ENV OPENAI_ENABLE_VISION=false
ENV MAX_REQUEST_BYTES=3500000
ENV EVIDENCE_STORAGE_ENABLED=false
ENV EVIDENCE_STORAGE_DIR=/data/evidence
ENV EVIDENCE_STORE_RAW_TEXT=false

EXPOSE 5072

CMD ["npm", "run", "start:selfhost"]
