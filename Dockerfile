# GoldDesk Mailroom Dockerfile — Node + PHP bridge for Czech Data Box / ISDS
FROM node:20-bookworm-slim AS build
WORKDIR /app

# System deps for Node build, PDF extraction and PHP CzechDataBox bridge.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 build-essential ca-certificates git unzip curl \
    php-cli php-xml php-soap php-curl php-mbstring php-zip \
    && rm -rf /var/lib/apt/lists/*

# Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY composer.json ./
RUN composer install --no-dev --prefer-dist --no-interaction --no-progress --optimize-autoloader

COPY . .
RUN npm run build

# ----- runtime -----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5000
ENV PHP_BINARY=php
ENV DATABOX_BRIDGE_PATH=/app/scripts/databox_bridge.php
ENV ISDS_CACHE_DIR=/tmp/GoldDeskDataBox

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    php-cli php-xml php-soap php-curl php-mbstring php-zip \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /tmp/GoldDeskDataBox

COPY --from=build /app/package.json /app/package-lock.json* ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/vendor ./vendor
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/composer.json ./composer.json

EXPOSE 5000
CMD ["node", "dist/index.cjs"]
