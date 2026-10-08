FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps ./apps
COPY packages ./packages
COPY infra/cdk/package.json ./infra/cdk/package.json
COPY tsconfig.base.json ./
RUN npm ci
RUN npm run build -w @syncguard/dashboard
FROM nginx:alpine
COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
