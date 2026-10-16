
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# Lo script "prepare" di shared richiede i sorgenti: si installa senza script e si compila dopo.
RUN npm ci --ignore-scripts
COPY packages packages
COPY apps apps
RUN npm run build

FROM node:22-alpine AS server
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --ignore-scripts -w @trainfinder/server -w @trainfinder/shared && npm cache clean --force
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/server/dist apps/server/dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV PORT=8080 DATA_DIR=/app/data
EXPOSE 8080
CMD ["node", "apps/server/dist/index.js"]

FROM nginx:1.27-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
