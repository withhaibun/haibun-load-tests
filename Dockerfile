FROM mcr.microsoft.com/playwright:v1.39.0-jammy

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

COPY . ./
COPY .dockerignore ./

CMD ["npm", "run", "local-client"]

