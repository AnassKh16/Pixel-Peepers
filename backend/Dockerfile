FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=optional
COPY src ./src
COPY test ./test
COPY scripts ./scripts
COPY test-support ./test-support
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
