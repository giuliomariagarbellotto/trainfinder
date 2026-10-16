FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# Lo script postinstall compila shared, che qui non e' ancora copiato: si compila dopo con npm run build.
RUN npm ci --ignore-scripts
COPY packages packages
COPY apps apps
RUN npm run build

# Un solo container: il server Node pubblica API, WebSocket e frontend.
FROM node:22-alpine AS app
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --ignore-scripts -w @trainfinder/server -w @trainfinder/shared && npm cache clean --force
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV PORT=8080 DATA_DIR=/app/data WEB_DIR=/app/apps/web/dist
EXPOSE 8080
CMD ["node", "apps/server/dist/index.js"]
