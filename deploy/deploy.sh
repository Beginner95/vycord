#!/usr/bin/env bash
# Скрипт первичного деплоя Vycord на продакшен-сервер.
# Запускать из корня проекта.
set -euo pipefail

DOMAIN_API="api.vycord.webvaha.ru"
DOMAIN_FRONT="front.vycord.webvaha.ru"
NGINX_AVAIL="/etc/nginx/sites-available"
NGINX_ENABLED="/etc/nginx/sites-enabled"

echo "==> [1/5] Копируем nginx-конфиги..."
sudo cp deploy/nginx/${DOMAIN_API}.conf   ${NGINX_AVAIL}/${DOMAIN_API}
sudo cp deploy/nginx/${DOMAIN_FRONT}.conf ${NGINX_AVAIL}/${DOMAIN_FRONT}
sudo ln -sf ${NGINX_AVAIL}/${DOMAIN_API}   ${NGINX_ENABLED}/${DOMAIN_API}
sudo ln -sf ${NGINX_AVAIL}/${DOMAIN_FRONT} ${NGINX_ENABLED}/${DOMAIN_FRONT}

echo "==> [2/5] Временный HTTP-конфиг для certbot (если SSL ещё не выпущен)..."
# Certbot сам добавит SSL-блоки после выпуска сертификата.
# Если сертификаты уже есть — этот шаг пропустите.
sudo nginx -t && sudo systemctl reload nginx

echo "==> [3/5] Выпускаем SSL-сертификаты Let's Encrypt..."
sudo certbot --nginx -d ${DOMAIN_API} -d ${DOMAIN_FRONT} --non-interactive --agree-tos -m admin@webvaha.ru

echo "==> [4/5] Копируем конфиги nginx с SSL (certbot мог перезаписать — восстанавливаем наши)..."
sudo cp deploy/nginx/${DOMAIN_API}.conf   ${NGINX_AVAIL}/${DOMAIN_API}
sudo cp deploy/nginx/${DOMAIN_FRONT}.conf ${NGINX_AVAIL}/${DOMAIN_FRONT}
sudo nginx -t && sudo systemctl reload nginx

echo "==> [5/5] Запускаем Docker-контейнеры..."
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

echo ""
echo "Готово! Проверь:"
echo "  https://${DOMAIN_FRONT}"
echo "  https://${DOMAIN_API}/api/health"
