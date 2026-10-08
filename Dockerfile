FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
COPY apps/backend ./apps/backend
COPY apps/dashboard/package.json ./apps/dashboard/package.json
COPY packages ./packages
COPY infra/cdk/package.json ./infra/cdk/package.json
COPY migrations ./migrations
RUN npm ci --omit=dev --workspace @syncguard/backend --workspace @syncguard/contracts --include-workspace-root=false
ENV NODE_ENV=production HOST=0.0.0.0
USER node
CMD ["./node_modules/.bin/tsx", "apps/backend/src/cli.ts", "api"]
