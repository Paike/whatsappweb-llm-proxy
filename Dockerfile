FROM zenika/alpine-chrome:with-puppeteer

ADD app /app
WORKDIR /app
USER root
COPY package*.json .
RUN npm install

ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]