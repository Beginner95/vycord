#!/usr/bin/env bash
# Certbot deploy-hook: делает Let's Encrypt-сертификат api-домена доступным
# coturn-контейнеру (тот работает от nobody и не может читать /etc/letsencrypt).
# deploy.sh устанавливает этот скрипт в /etc/letsencrypt/renewal-hooks/deploy/ —
# certbot запускает его после каждого продления; при первичном деплое deploy.sh
# запускает его один раз вручную ДО docker compose up (иначе coturn стартует
# без сертификатов и падает).
# Запускается от root (certbot работает от root).
set -euo pipefail

DOMAIN="api.vycord.webvaha.ru"
SRC="/etc/letsencrypt/live/${DOMAIN}"
DST="/var/lib/vycord/coturn-certs"
# coturn/coturn:4.7-alpine работает от nobody: uid 65534, gid 65533.
CONTAINER_UID=65534
CONTAINER_GID=65533

if [[ ! -r "${SRC}/fullchain.pem" || ! -r "${SRC}/privkey.pem" ]]; then
    echo "ERROR: нет сертификата в ${SRC} — сначала выпустите его certbot'ом" >&2
    exit 1
fi

mkdir -p "${DST}"
install -o "${CONTAINER_UID}" -g "${CONTAINER_GID}" -m 644 "${SRC}/fullchain.pem" "${DST}/fullchain.pem"
install -o "${CONTAINER_UID}" -g "${CONTAINER_GID}" -m 600 "${SRC}/privkey.pem"   "${DST}/privkey.pem"

# coturn не перечитывает сертификат на лету — нужен рестарт. При первичном
# деплое контейнера ещё нет — это не ошибка.
if docker ps --format '{{.Names}}' | grep -qx vycord-coturn; then
    docker restart vycord-coturn
fi
