FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=builder /app/dist ./dist
COPY server ./server
EXPOSE 3000
CMD ["node", "server/index.mjs"]
