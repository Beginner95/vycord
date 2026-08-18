#!/usr/bin/env bash
# Проверка TURN после деплоя: генерирует ephemeral-креды из TURN_SECRET
# (та же схема, что GET /api/v1/turn/credentials — см.
# server/internal/usecase/turn.go) и проверяет relay-аллокацию через
# turnutils_uclient на всех трёх транспортах.
#
#   ./deploy/check-turn.sh            — прогнать проверки (запускать НА сервере)
#   ./deploy/check-turn.sh --remote   — то же, но СНАРУЖИ (см. ниже)
#   ./deploy/check-turn.sh --print    — только вывести креды (для Trickle ICE)
#   ./deploy/check-turn.sh --remote --print — креды с прода, не заходя на него
#
# ── Про два режима ───────────────────────────────────────────────────────────
#
# Обычный режим запускается на самом сервере и доказывает, что coturn, секрет и
# сертификат исправны. Чего он НЕ доказывает — что порты видны снаружи: пакеты
# не покидают машину, поэтому фильтр у провайдера или закрытый порт он не
# заметит.
#
# --remote закрывает ровно этот пробел: креды забираются с прода по ssh, а сам
# turnutils_uclient запускается ЛОКАЛЬНО, так что трафик идёт через реальный
# интернет. Это единственный способ подтвердить внешнюю доступность, не открывая
# браузер (альтернатива — Trickle ICE вручную, см. README, раздел TURN).
#
# Проверка стала важнее с VYC-76: из TURN_URLS убран TCP-транспорт, и рабочий
# UDP-релей теперь единственный запасной путь. Если 3478/udp окажется недоступен
# снаружи, клиенты с симметричным NAT останутся вообще без релея.
#
# Требования для --remote: docker и ssh-доступ (по умолчанию хост vycard_vps —
# переопределяется через VYC_SSH_HOST, каталог проекта — через VYC_REMOTE_DIR).
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-.env.prod}"
IMAGE="coturn/coturn:4.7-alpine"
SSH_HOST="${VYC_SSH_HOST:-vycard_vps}"
REMOTE_DIR="${VYC_REMOTE_DIR:-/var/www/vycord}"

REMOTE=0
PRINT=0
for arg in "$@"; do
    case "$arg" in
        --remote) REMOTE=1 ;;
        --print)  PRINT=1 ;;
        -h|--help) sed -n '2,28p' "$0" | sed 's/^# \?//'; exit 0 ;;
        *) echo "ERROR: неизвестный аргумент: $arg (см. --help)" >&2; exit 1 ;;
    esac
done

command -v docker >/dev/null || { echo "ERROR: нужен docker" >&2; exit 1; }

# ── Получение секрета и списка URL ───────────────────────────────────────────
# Локально .env.prod нет и быть не должно, поэтому в --remote и секрет, и
# TURN_URLS читаются с сервера. Берём именно TURN_URLS с прода, а не из
# .env.prod.example: пример — документация и вполне может разойтись с боем
# (уже расходился), а проверять надо то, что реально раздаётся клиентам.
if (( REMOTE )); then
    echo "→ Забираю TURN_SECRET/TURN_URLS с ${SSH_HOST}:${REMOTE_DIR}/${ENV_FILE}" >&2
    remote_env=$(ssh -o BatchMode=yes "$SSH_HOST" \
        "grep -E '^(TURN_SECRET|TURN_URLS)=' ${REMOTE_DIR}/${ENV_FILE}") || {
        echo "ERROR: не удалось прочитать ${ENV_FILE} на ${SSH_HOST}" >&2; exit 1; }
    TURN_SECRET=$(grep -E '^TURN_SECRET=' <<<"$remote_env" | cut -d= -f2-)
    TURN_URLS=$(grep -E '^TURN_URLS=' <<<"$remote_env" | cut -d= -f2-)
else
    [[ -f "$ENV_FILE" ]] || {
        echo "ERROR: нет ${ENV_FILE}. Запускайте из корня проекта НА сервере," >&2
        echo "       либо используйте --remote для проверки снаружи." >&2
        exit 1; }
    TURN_SECRET=$(grep -E '^TURN_SECRET=' "$ENV_FILE" | cut -d= -f2-)
    TURN_URLS=$(grep -E '^TURN_URLS=' "$ENV_FILE" | cut -d= -f2-)
fi

[[ -n "$TURN_SECRET" ]] || { echo "ERROR: TURN_SECRET пуст" >&2; exit 1; }
[[ -n "$TURN_URLS" ]] || { echo "ERROR: TURN_URLS пуст" >&2; exit 1; }

# Хост — из первого URL: "turn:host:3478?transport=udp" -> "host".
HOST=$(printf '%s' "$TURN_URLS" | cut -d, -f1 | sed -E 's#^turns?:##; s#:[0-9]+.*$##')

# Ephemeral-креды (coturn REST API): username="<expiry>:<id>",
# password=base64(HMAC-SHA1(secret, username)).
EXPIRY=$(( $(date +%s) + 600 ))
USERNAME="${EXPIRY}:healthcheck"
PASSWORD=$(printf '%s' "$USERNAME" | openssl dgst -sha1 -hmac "$TURN_SECRET" -binary | base64)

if (( PRINT )); then
    echo "URLs:       ${TURN_URLS}"
    echo "Username:   ${USERNAME}"
    echo "Credential: ${PASSWORD}"
    echo ""
    echo "Вставьте в https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/"
    echo "и проверьте, что появляется кандидат типа relay."
    exit 0
fi

FAILED=0

# Какие транспорты реально раздаются клиентам. Провал на транспорте, которого в
# TURN_URLS нет, не должен ронять проверку: coturn слушает 3478/tcp и 5349/tls
# и после VYC-76 (см. шапку) — намеренно, чтобы откат стоил одной строки, но
# клиенты их не получают, так что их доступность ни на что не влияет.
has_transport() {
    case "$1" in
        udp) grep -qE '(^|,)turn:[^,]*transport=udp'  <<<"$TURN_URLS" ;;
        tcp) grep -qE '(^|,)turn:[^,]*transport=tcp'  <<<"$TURN_URLS" ;;
        tls) grep -qE '(^|,)turns:'                   <<<"$TURN_URLS" ;;
    esac
}

# check <имя> <флаги-транспорта> <порт> <ключ-транспорта> <подсказка-при-провале>
# -y: echo через relay — проверяется реальная аллокация и проброс данных,
# а не просто открытый порт. Успех = получены эхо-ответы (tot_recv_msgs>0).
check() {
    local name=$1 flags=$2 port=$3 key=$4 hint=$5 out required=0 tag=""
    if has_transport "$key"; then required=1; else tag=" (не в TURN_URLS, справочно)"; fi
    # --entrypoint обязателен: docker-entrypoint.sh образа coturn парсит
    # аргументы своим getopts и часть съедает (например -e и хост) — без него
    # uclient молча откатывается на сервер по умолчанию 127.0.0.1 и проверка
    # "проходит", ничего не проверив.
    if out=$(timeout 30 docker run --rm --network host --entrypoint turnutils_uclient "$IMAGE" \
            ${flags} -p "$port" -u "$USERNAME" -w "$PASSWORD" \
            -y -n 5 "$HOST" 2>&1) \
        && grep -qE 'tot_recv_msgs=[1-9]' <<<"$out"; then
        echo "OK   ${name}${tag}"
        # RTT/джиттер осмысленны только снаружи: на самом сервере трафик не
        # выходит за петлю и цифры всегда околонулевые.
        if (( REMOTE )); then
            grep -E 'Average round trip delay|Total lost packets' <<<"$out" \
                | sed -E 's/^.*INFO: /     /'
        fi
    else
        echo "FAIL ${name}${tag} — ${hint}"
        tail -5 <<<"$out" | sed 's/^/     /'
        (( required )) && FAILED=1
    fi
    return 0
}

if (( REMOTE )); then
    echo "→ Проверка СНАРУЖИ: turnutils_uclient идёт до ${HOST} через интернет"
else
    echo "→ Проверка С СЕРВЕРА: внешнюю доступность портов НЕ проверяет (нужен --remote)"
fi

check "3478/udp" ""      3478 udp "порт закрыт (ufw allow 3478/udp), фильтр по пути или TURN_SECRET не совпадает с coturn"
check "3478/tcp" "-t"    3478 tcp "порт закрыт (ufw allow 3478/tcp) или TURN_SECRET не совпадает с coturn"
# -S без -t у turnutils_uclient означает DTLS-по-UDP (сервер запущен с --no-dtls
# и такой листенер не поднят) — для turns:5349 нужна именно TLS-по-TCP: "-t -S".
check "5349/tls" "-t -S" 5349 tls "порт закрыт (ufw allow 5349/tcp) или coturn не прочитал сертификат"

exit "$FAILED"
