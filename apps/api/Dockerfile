FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm install
COPY apps/api apps/api
WORKDIR /app/apps/api
RUN npx prisma generate && npm run build
EXPOSE 3001
CMD ["npm", "run", "start"]
