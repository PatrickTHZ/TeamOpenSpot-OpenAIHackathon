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

EXPOSE 5072

CMD ["npm", "run", "start:selfhost"]
