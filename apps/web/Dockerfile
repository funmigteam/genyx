FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm install
COPY apps/web apps/web
WORKDIR /app/apps/web
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NODE_OPTIONS=--max-old-space-size=512
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "start"]
