FROM node:24-alpine
RUN apk add --no-cache sqlite mariadb-client mariadb-connector-c python3
WORKDIR /test
CMD ["sleep", "infinity"]
