FROM node:20-alpine
WORKDIR /app/api
COPY api/package.json .
RUN npm install --production
ARG APP_BUILD_VERSION=dev
ENV APP_BUILD_VERSION=$APP_BUILD_VERSION
COPY api/server.js api/report-exporter.js ./
COPY web /app/web
EXPOSE 80
CMD ["node", "server.js"]
