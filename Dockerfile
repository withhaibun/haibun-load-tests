FROM mcr.microsoft.com/playwright:v1.43.1-jammy

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

COPY . ./
COPY .dockerignore ./

CMD ["npm", "run", "local-client"]

