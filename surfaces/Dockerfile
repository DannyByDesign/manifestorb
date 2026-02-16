FROM node:22-slim

WORKDIR /app

# Install dependencies first for better layer caching
COPY package.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN npm install --include=dev

# Copy runtime source
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "run", "start"]
