FROM node:20-alpine
WORKDIR /app/api
COPY deploy/api/package.json .
RUN npm install --production
COPY deploy/api/server.js .
COPY deploy/web /app/web
EXPOSE 3000
CMD ["node", "server.js"]
