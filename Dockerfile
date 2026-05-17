# Must match the playwright npm package version in package.json.
# When bumping playwright, bump this tag too.
FROM mcr.microsoft.com/playwright:v1.60.0-noble

ENV HEADLESS=true

RUN mkdir -p /app && chown pwuser:pwuser /app
WORKDIR /app
USER pwuser

COPY --chown=pwuser:pwuser package.json package-lock.json ./
RUN npm ci

COPY --chown=pwuser:pwuser tsconfig.json ./
COPY --chown=pwuser:pwuser src/ ./src/

CMD ["./node_modules/.bin/tsx", "src/scheduler.ts"]
