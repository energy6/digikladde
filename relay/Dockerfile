FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY dist ./dist
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "dist/server.cjs"]
