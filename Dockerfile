# syntax=docker/dockerfile:1.12

FROM node:26.8.1-alpine3.24@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3 AS dependencies
WORKDIR /app
RUN addgroup -S -g 10001 firebase && \
    adduser -S -D -H -u 10001 -G firebase firebase
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts

FROM dependencies AS test
COPY . .
RUN npm run lint && \
    npm run typecheck && \
    npm run coverage && \
    npm run build

FROM dependencies AS auth-emulator
COPY firebase.json .firebaserc ./
USER 10001:10001
EXPOSE 9099
CMD ["./node_modules/.bin/firebase", "emulators:start", "--only", "auth", "--project", "demo-meu-processo"]

FROM dependencies AS build
ARG VITE_FIREBASE_BROWSER_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_FIREBASE_AUTH_EMULATOR_URL
ENV VITE_FIREBASE_BROWSER_KEY=$VITE_FIREBASE_BROWSER_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID \
    VITE_FIREBASE_AUTH_EMULATOR_URL=$VITE_FIREBASE_AUTH_EMULATOR_URL
COPY . .
RUN npm run build

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --ignore-scripts

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:774b7d020b24214835769e24c3544835526cd0288f0b094eae48e8b2c2429a79 AS production
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app

COPY --from=production-dependencies --chown=65532:65532 /app/package.json ./package.json
COPY --from=production-dependencies --chown=65532:65532 /app/node_modules ./node_modules
COPY --from=build --chown=65532:65532 /app/dist ./dist

USER 65532:65532
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["dist/api/main.js"]

FROM mcr.microsoft.com/playwright:v1.62.0-noble@sha256:baed2032d533817f3dbe6425de795788430ba345e819a1201337009ba17c9d07 AS renderer-filesystem
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force && \
    rm -rf /usr/lib/node_modules/npm
RUN rm -rf /root/.npm
COPY --from=build --chown=1001:1001 /app/dist/api ./dist/api

# Rebase the sanitized filesystem into a clean final layer so credentials left
# in deleted upstream cache layers cannot be recovered from the published image.
FROM scratch AS renderer
# hadolint ignore=DL3067
COPY --from=renderer-filesystem / /
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NODE_ENV=production \
    PORT=8080 \
    HOME=/tmp
WORKDIR /app

USER 1001:1001
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/api/renderer-main.js"]
