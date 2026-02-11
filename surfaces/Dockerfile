FROM oven/bun:1.3.9

WORKDIR /app

# Install dependencies first for better layer caching
COPY package.json bun.lock ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN bun install --frozen-lockfile

# Copy runtime source
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
