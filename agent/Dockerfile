FROM node:24-alpine
WORKDIR /app
COPY *.mjs schema.json ./
USER root
EXPOSE 3001
CMD ["node", "index.mjs"]
