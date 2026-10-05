FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --legacy-peer-deps --no-audit --no-fund

COPY . .

RUN npm run lint && npm run build

CMD ["node", "-e", "setInterval(() => {}, 2147483647)"]
