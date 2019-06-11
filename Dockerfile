FROM node:8.16

WORKDIR /app

COPY dist .

RUN yarn global add sequelize-cli pm2

RUN yarn --production install

CMD ["./docker-entry.sh"]

EXPOSE  6201
