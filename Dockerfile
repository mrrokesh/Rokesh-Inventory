FROM node:22-alpine
WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd backend && npm ci
RUN cd frontend && npm ci

COPY backend ./backend
COPY frontend ./frontend
RUN cd frontend && npm run build

WORKDIR /app/backend
ENV NODE_ENV=production
EXPOSE 4000
CMD ["npx", "tsx", "src/server.ts"]
