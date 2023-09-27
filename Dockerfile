# syntax = docker/dockerfile:1

# Adjust BUN_VERSION as desired
ARG BUN_VERSION=1.0.3
FROM oven/bun:${BUN_VERSION}-alpine as base

LABEL fly_launch_runtime="Bun/Prisma"

# Bun/Prisma app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"


# Throw-away build stage to reduce size of final image
FROM base as build

COPY . .
RUN bun install

# Start the server by default, this can be overwritten at runtime
CMD bun crawl
