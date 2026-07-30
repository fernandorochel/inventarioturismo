FROM node:20-alpine
WORKDIR /app/api
COPY api/package.json .
RUN npm install --production
COPY api/server.js .
COPY web /app/web
EXPOSE 3000
CMD ["node", "server.js"]
