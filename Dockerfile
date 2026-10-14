# Runs the test suite. The JXA/osascript end-to-end tests need macOS and are
# skipped in Linux containers; run `npm test` on a Mac for the full suite.
FROM node:24-slim
WORKDIR /app
COPY . .
CMD ["sh", "-c", "npm install && npm test"]
