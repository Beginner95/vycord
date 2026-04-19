# ── Stage 1: Build ──────────────────────────────────────────────
FROM node:23-alpine AS build

WORKDIR /app

# Skip downloading the Electron binary — not needed for web build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

COPY package*.json ./
RUN npm ci

COPY . .

# Build args let you override API/WS endpoints at build time:
#   docker build --build-arg VITE_API_URL=https://api.example.com ...
ARG VITE_API_URL=http://localhost:8080
ARG VITE_WS_URL=ws://localhost:8080
ARG VITE_SFU_URL=ws://localhost:8081
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_SFU_URL=$VITE_SFU_URL

RUN npm run build:vite

# ── Stage 2: Serve ───────────────────────────────────────────────
FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
