#!/usr/bin/env bash
# Проверка TURN после деплоя: генерирует ephemeral-креды из TURN_SECRET
# (та же схема, что GET /api/v1/turn/credentials — см.
# server/internal/usecase/turn.go) и проверяет relay-аллокацию через
# turnutils_uclient на всех трёх транспортах.
#
#   ./deploy/check-turn.sh          — прогнать проверки
#   ./deploy/check-turn.sh --print  — только вывести креды (для Trickle ICE)
#
# ВАЖНО: скрипт работает с самого сервера — он доказывает, что coturn, секрет
# и TLS исправны, но НЕ внешнюю доступность портов. Внешнюю доступность
# проверяйте через Trickle ICE (см. README, раздел TURN).
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-.env.prod}"
IMAGE="coturn/coturn:4.7-alpine"

[[ -f "$ENV_FILE" ]] || { echo "ERROR: нет ${ENV_FILE} — запускайте из корня проекта" >&2; exit 1; }

TURN_SECRET=$(grep -E '^TURN_SECRET=' "$ENV_FILE" | cut -d= -f2-)
TURN_URLS=$(grep -E '^TURN_URLS=' "$ENV_FILE" | cut -d= -f2-)
[[ -n "$TURN_SECRET" ]] || { echo "ERROR: TURN_SECRET пуст в ${ENV_FILE}" >&2; exit 1; }
[[ -n "$TURN_URLS" ]] || { echo "ERROR: TURN_URLS пуст в ${ENV_FILE}" >&2; exit 1; }

# Хост — из первого URL: "turn:host:3478?transport=udp" -> "host".
HOST=$(printf '%s' "$TURN_URLS" | cut -d, -f1 | sed -E 's#^turns?:##; s#:[0-9]+.*$##')

# Ephemeral-креды (coturn REST API): username="<expiry>:<id>",
# password=base64(HMAC-SHA1(secret, username)).
EXPIRY=$(( $(date +%s) + 600 ))
USERNAME="${EXPIRY}:healthcheck"
PASSWORD=$(printf '%s' "$USERNAME" | openssl dgst -sha1 -hmac "$TURN_SECRET" -binary | base64)

if [[ "${1:-}" == "--print" ]]; then
    echo "URLs:       ${TURN_URLS}"
    echo "Username:   ${USERNAME}"
    echo "Credential: ${PASSWORD}"
    echo ""
    echo "Вставьте в https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/"
    echo "и проверьте, что появляется кандидат типа relay."
    exit 0
fi

FAILED=0

# check <имя> <флаги-транспорта> <порт> <подсказка-при-провале>
# -y: echo через relay — проверяется реальная аллокация и проброс данных,
# а не просто открытый порт. Успех = получены эхо-ответы (tot_recv_msgs>0).
check() {
    local name=$1 flags=$2 port=$3 hint=$4 out
    # --entrypoint обязателен: docker-entrypoint.sh образа coturn парсит
    # аргументы своим getopts и часть съедает (например -e и хост) — без него
    # uclient молча откатывается на сервер по умолчанию 127.0.0.1.
    if out=$(timeout 30 docker run --rm --network host --entrypoint turnutils_uclient "$IMAGE" \
            ${flags} -p "$port" -u "$USERNAME" -w "$PASSWORD" \
            -y -n 5 "$HOST" 2>&1) \
        && grep -qE 'tot_recv_msgs=[1-9]' <<<"$out"; then
        echo "OK   ${name}"
    else
        echo "FAIL ${name} — ${hint}"
        tail -5 <<<"$out" | sed 's/^/     /'
        FAILED=1
    fi
}

check "3478/udp" ""      3478 "порт закрыт (ufw allow 3478/udp) или TURN_SECRET не совпадает с coturn"
check "3478/tcp" "-t"    3478 "порт закрыт (ufw allow 3478/tcp) или TURN_SECRET не совпадает с coturn"
# -S без -t у turnutils_uclient означает DTLS-по-UDP (сервер запущен с --no-dtls
# и такой листенер не поднят) — для turns:5349 нужна именно TLS-по-TCP: "-t -S".
check "5349/tls" "-t -S" 5349 "порт закрыт (ufw allow 5349/tcp) или coturn не прочитал сертификат"

exit "$FAILED"
