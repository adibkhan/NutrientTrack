FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
# nginx builds an ETag from a file's mtime and size, and Vite stamps every file with the build time, so each deploy would change
# the ETag of the 35 MB of branded packs (and of the browsers' cached Range requests) without changing a byte. Give each file in
# data/branded-v1 an mtime derived from its content instead: identical bytes, identical ETag across deploys; changed bytes, new ETag.
RUN node -e "const fs=require('fs'),c=require('crypto'),d='dist/data/branded-v1/';for(const n of fs.readdirSync(d)){const h=c.createHash('sha256').update(fs.readFileSync(d+n)).digest().readUInt32BE(0);const t=new Date(946684800000+(h%86400000)*1000);fs.utimesSync(d+n,t,t)}"

FROM nginx:stable-alpine

ENV PORT=8080
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist/ /usr/share/nginx/html/
EXPOSE 8080
