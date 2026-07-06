FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG GOOGLE_MAPS_BROWSER_KEY=""
ARG GOOGLE_MAPS_MAP_ID=""
ENV GOOGLE_MAPS_BROWSER_KEY=$GOOGLE_MAPS_BROWSER_KEY
ENV GOOGLE_MAPS_MAP_ID=$GOOGLE_MAPS_MAP_ID

RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV GEOCODER_MODE=google
ENV ALLOW_MOCK_GEOCODER=false

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.cjs"]
