FROM node:22-alpine
WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd backend && npm ci --include=dev
RUN cd frontend && npm ci --include=dev

COPY backend ./backend
COPY frontend ./frontend
COPY docs ./docs
RUN cd frontend && npm run build

WORKDIR /app/backend
ENV NODE_ENV=production
EXPOSE 4000
CMD ["npx", "tsx", "src/server.ts"]
