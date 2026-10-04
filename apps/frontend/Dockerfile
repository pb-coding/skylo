# syntax=docker/dockerfile:1
FROM node:24.21.0-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci
COPY . .
RUN rm -f .env .env.production && VITE_BACKEND_URL= VITE_ENVIRONMENT=production npm run build

FROM nginx:1.30-alpine
COPY --from=build --chmod=755 /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -Y off -q -O /dev/null http://127.0.0.1/ || exit 1
