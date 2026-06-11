# Letwrites marketing site — static files served by nginx on Cloud Run.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html onboard.html paid-onboard.html terms.html privacy.html favicon.png favicon-32.png apple-touch-icon.png dashboard.png dashboard-tamper.png /usr/share/nginx/html/
EXPOSE 8080
