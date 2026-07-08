# TURN TLS (turns:5349) + проверка после деплоя — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Клиенты в сетях, где режется UDP и plain-TCP, подключаются к звонкам через `turns:` (TLS, порт 5349); после деплоя работоспособность TURN проверяется скриптом.

**Architecture:** Только конфигурация и bash — Go-код и клиент не меняются (TURN-URL-ы приходят клиенту из env `TURN_URLS` через `GET /api/v1/turn/credentials`). coturn получает TLS-listener 5349; Let's Encrypt-сертификат api-домена доставляется certbot deploy-хуком в отдельную папку с рестартом контейнера. Скрипт проверки генерирует ephemeral-креды той же HMAC-схемой, что и API, и проверяет relay-аллокацию через `turnutils_uclient`.

**Tech Stack:** docker compose, coturn 4.7 (alpine), bash, openssl, certbot renewal-hooks.

**Spec:** `docs/superpowers/specs/2026-07-07-turn-tls-verify-design.md`

## Global Constraints

- Домен TURN: `api.vycord.webvaha.ru` (тот же, что API; отдельный поддомен не заводим).
- TLS-порт: `5349` (не 443 — 443 занят nginx).
- Образ: `coturn/coturn:4.7-alpine`; контейнер работает от `nobody` — **uid 65534, gid 65533** (проверено `docker run --rm coturn/coturn:4.7-alpine id`).
- Папка сертификатов на хосте: `/var/lib/vycord/coturn-certs`, в контейнере: `/certs` (read-only).
- Схема кредов (как в `server/internal/usecase/turn.go`): `username="<unix-expiry>:<id>"`, `password=base64(HMAC-SHA1(TURN_SECRET, username))`.
- Тест-вектор HMAC (из `server/internal/usecase/turn_test.go:34-41`): секрет `test-turn-secret`, username `1751900000:3f2504e0-4f89-11d3-9a0c-0305e82c3301` → `O/hYcWB4DjZmYK/zIXHr2z8rhN0=`.
- Все комментарии в конфигах/скриптах — в стиле существующих файлов (docker-compose.prod.yml — английский; deploy/*.sh — русский).
- В рабочем дереве уже есть незакоммиченная правка `.env.prod.example` (плейсхолдер `TURN_SECRET=CHANGE_ME_RANDOM_TURN_SECRET`) — она уходит в коммит Задачи 1, отдельно ничего делать не надо.
- Локально файла `.env.prod` нет (проверено) — шаг верификации Задачи 1 создаёт и удаляет его.
- `shellcheck` локально не установлен — синтаксис проверяем `bash -n`.

---

### Task 1: coturn TLS в docker-compose.prod.yml + TURN_URLS

**Files:**
- Modify: `docker-compose.prod.yml:72-104` (сервис coturn)
- Modify: `.env.prod.example` (TURN_URLS + комментарий про порты)

**Interfaces:**
- Produces: coturn читает `/certs/fullchain.pem` и `/certs/privkey.pem` из хостовой папки `/var/lib/vycord/coturn-certs` — её наполняет хук из Задачи 2. TLS-listener на 5349/tcp — его проверяет скрипт из Задачи 3.

- [ ] **Step 1: Обновить сервис coturn в `docker-compose.prod.yml`**

Заменить блок `command:` и добавить `volumes:`. Итоговый вид сервиса (меняются: комментарий про фаервол, строки `--no-tls`/`--no-dtls` → TLS-блок, новый `volumes:`):

```yaml
  coturn:
    image: coturn/coturn:4.7-alpine
    container_name: vycord-coturn
    # Host networking for the same reason as the SFU: TURN relays UDP and
    # allocates relay ports dynamically; bridge NAT breaks candidate addresses.
    # Firewall must allow 3478/udp, 3478/tcp, 5349/tcp (TLS) and the relay
    # range 49160-49360/udp.
    network_mode: host
    command:
      - --listening-port=3478
      - --min-port=49160
      - --max-port=49360
      - --fingerprint
      # Ephemeral credentials (TURN REST API): username="<expiry>:<user-id>",
      # password=base64(HMAC-SHA1(secret, username)). The API server issues
      # them at GET /api/v1/turn/credentials using the same TURN_SECRET.
      - --use-auth-secret
      - --static-auth-secret=${TURN_SECRET}
      - --realm=vycord
      - --no-cli
      # TLS (turns:5349) for networks that block UDP and plain TCP. Certs are
      # copied into /var/lib/vycord/coturn-certs by deploy/coturn-cert-hook.sh
      # (a certbot deploy-hook installed by deploy/deploy.sh) which also
      # restarts this container on every renewal.
      - --tls-listening-port=5349
      - --cert=/certs/fullchain.pem
      - --pkey=/certs/privkey.pem
      - --no-tlsv1
      - --no-tlsv1_1
      # turns effectively always runs over TCP; DTLS stays off.
      - --no-dtls
      - --log-file=stdout
      # Abuse protection: never relay into local/private networks (the API and
      # DB listen on 127.0.0.1). If this server's own interface has a private
      # IP (cloud NAT), additionally allow it with --allowed-peer-ip=<that IP>.
      - --no-multicast-peers
      - --denied-peer-ip=127.0.0.0-127.255.255.255
      - --denied-peer-ip=10.0.0.0-10.255.255.255
      - --denied-peer-ip=172.16.0.0-172.31.255.255
      - --denied-peer-ip=192.168.0.0-192.168.255.255
      - --denied-peer-ip=169.254.0.0-169.254.255.255
      - --denied-peer-ip=100.64.0.0-100.127.255.255
    volumes:
      - /var/lib/vycord/coturn-certs:/certs:ro
    restart: unless-stopped
```

Строка `- --no-tls` удаляется.

- [ ] **Step 2: Обновить `.env.prod.example`**

Заменить строку `TURN_URLS=...` и комментарий над ней:

```bash
# Comma-separated URLs handed out to clients. The hostname must resolve to this
# server; open 3478/udp + 3478/tcp, 5349/tcp (TLS) and the relay range
# 49160-49360/udp. Order: udp, tcp, tls — ICE tries all in parallel.
TURN_URLS=turn:api.vycord.webvaha.ru:3478?transport=udp,turn:api.vycord.webvaha.ru:3478?transport=tcp,turns:api.vycord.webvaha.ru:5349?transport=tcp
```

- [ ] **Step 3: Проверить compose-конфиг**

`.env.prod` локально нет — временно создаём из примера (сервисы api/sfu ссылаются на него через `env_file`):

```bash
cd /www/my/vycord
test ! -f .env.prod && cp .env.prod.example .env.prod
docker compose -f docker-compose.prod.yml --env-file .env.prod config >/dev/null && echo CONFIG_OK
rm .env.prod
```

Expected: `CONFIG_OK` (и никаких warning про coturn).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.prod.yml .env.prod.example
git commit -m "VYC-23 coturn: TLS-листенер turns:5349 + turns-URL в TURN_URLS"
```

---

### Task 2: certbot deploy-hook + шаг в deploy.sh

**Files:**
- Create: `deploy/coturn-cert-hook.sh`
- Modify: `deploy/deploy.sh` (новый шаг 5, перенумерация в [x/6])

**Interfaces:**
- Produces: наполненная `/var/lib/vycord/coturn-certs/` (файлы `fullchain.pem` 644 и `privkey.pem` 600, владелец 65534:65533) — её монтирует coturn из Задачи 1. Хук идемпотентен и безопасен до первого `docker compose up` (контейнера ещё нет — не ошибка).

- [ ] **Step 1: Создать `deploy/coturn-cert-hook.sh`**

```bash
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
```

- [ ] **Step 2: Проверить синтаксис**

```bash
bash -n deploy/coturn-cert-hook.sh && echo SYNTAX_OK
```

Expected: `SYNTAX_OK`

- [ ] **Step 3: Добавить шаг в `deploy/deploy.sh`**

Полный новый текст файла (изменения: нумерация [x/5]→[x/6], переменная `CERTBOT_HOOKS`, новый шаг 5, в финальной подсказке — check-turn.sh):

```bash
#!/usr/bin/env bash
# Скрипт первичного деплоя Vycord на продакшен-сервер.
# Запускать из корня проекта.
set -euo pipefail

DOMAIN_API="api.vycord.webvaha.ru"
DOMAIN_FRONT="front.vycord.webvaha.ru"
NGINX_AVAIL="/etc/nginx/sites-available"
NGINX_ENABLED="/etc/nginx/sites-enabled"
CERTBOT_HOOKS="/etc/letsencrypt/renewal-hooks/deploy"

echo "==> [1/6] Копируем nginx-конфиги..."
sudo cp deploy/nginx/${DOMAIN_API}.conf   ${NGINX_AVAIL}/${DOMAIN_API}
sudo cp deploy/nginx/${DOMAIN_FRONT}.conf ${NGINX_AVAIL}/${DOMAIN_FRONT}
sudo ln -sf ${NGINX_AVAIL}/${DOMAIN_API}   ${NGINX_ENABLED}/${DOMAIN_API}
sudo ln -sf ${NGINX_AVAIL}/${DOMAIN_FRONT} ${NGINX_ENABLED}/${DOMAIN_FRONT}

echo "==> [2/6] Временный HTTP-конфиг для certbot (если SSL ещё не выпущен)..."
# Certbot сам добавит SSL-блоки после выпуска сертификата.
# Если сертификаты уже есть — этот шаг пропустите.
sudo nginx -t && sudo systemctl reload nginx

echo "==> [3/6] Выпускаем SSL-сертификаты Let's Encrypt..."
sudo certbot --nginx -d ${DOMAIN_API} -d ${DOMAIN_FRONT} --non-interactive --agree-tos -m admin@webvaha.ru

echo "==> [4/6] Копируем конфиги nginx с SSL (certbot мог перезаписать — восстанавливаем наши)..."
sudo cp deploy/nginx/${DOMAIN_API}.conf   ${NGINX_AVAIL}/${DOMAIN_API}
sudo cp deploy/nginx/${DOMAIN_FRONT}.conf ${NGINX_AVAIL}/${DOMAIN_FRONT}
sudo nginx -t && sudo systemctl reload nginx

echo "==> [5/6] TURN: ставим certbot-хук и копируем сертификат для coturn..."
# Хук копирует серт api-домена в /var/lib/vycord/coturn-certs и рестартует
# coturn при каждом продлении; здесь запускаем его один раз ДО compose up,
# иначе coturn стартует без сертификатов.
sudo install -m 755 deploy/coturn-cert-hook.sh ${CERTBOT_HOOKS}/coturn-cert-hook.sh
sudo ${CERTBOT_HOOKS}/coturn-cert-hook.sh

echo "==> [6/6] Запускаем Docker-контейнеры..."
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

echo ""
echo "Готово! Проверь:"
echo "  https://${DOMAIN_FRONT}"
echo "  https://${DOMAIN_API}/api/health"
echo "  ./deploy/check-turn.sh   # TURN: relay-аллокация по udp/tcp/tls"
```

- [ ] **Step 4: Проверить синтаксис**

```bash
bash -n deploy/deploy.sh && echo SYNTAX_OK
```

Expected: `SYNTAX_OK`

- [ ] **Step 5: Commit**

```bash
git add deploy/coturn-cert-hook.sh deploy/deploy.sh
git commit -m "VYC-23 certbot-хук доставки сертификата в coturn + шаг в deploy.sh"
```

---

### Task 3: deploy/check-turn.sh + локальная интеграционная проверка

**Files:**
- Create: `deploy/check-turn.sh`

**Interfaces:**
- Consumes: `.env.prod` на сервере (`TURN_SECRET`, `TURN_URLS` — формат из Задачи 1); порты 3478/5349 из конфигурации coturn Задачи 1.
- Produces: exit 0 + `OK` по трём транспортам / exit 1 + `FAIL` с подсказкой; `--print` выводит креды для ручной проверки (используется в доке Задачи 4).

- [ ] **Step 1: Сначала проверить схему HMAC по тест-вектору из Go-теста**

Это «падающий тест» для генерации кредов — команда обязана дать эталон из `turn_test.go` ещё до написания скрипта:

```bash
printf '%s' "1751900000:3f2504e0-4f89-11d3-9a0c-0305e82c3301" \
  | openssl dgst -sha1 -hmac "test-turn-secret" -binary | base64
```

Expected: `O/hYcWB4DjZmYK/zIXHr2z8rhN0=`

- [ ] **Step 2: Создать `deploy/check-turn.sh`**

```bash
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
    if out=$(timeout 30 docker run --rm --network host "$IMAGE" \
            turnutils_uclient ${flags} -p "$port" -u "$USERNAME" -w "$PASSWORD" \
            -y -n 5 "$HOST" 2>&1) \
        && grep -qE 'tot_recv_msgs=[1-9]' <<<"$out"; then
        echo "OK   ${name}"
    else
        echo "FAIL ${name} — ${hint}"
        tail -5 <<<"$out" | sed 's/^/     /'
        FAILED=1
    fi
}

check "3478/udp" ""   3478 "порт закрыт (ufw allow 3478/udp) или TURN_SECRET не совпадает с coturn"
check "3478/tcp" "-t" 3478 "порт закрыт (ufw allow 3478/tcp) или TURN_SECRET не совпадает с coturn"
check "5349/tls" "-S" 5349 "порт закрыт (ufw allow 5349/tcp) или coturn не прочитал сертификат"

exit "$FAILED"
```

```bash
chmod +x deploy/check-turn.sh
bash -n deploy/check-turn.sh && echo SYNTAX_OK
```

Expected: `SYNTAX_OK`

- [ ] **Step 3: Интеграционный тест — поднять coturn локально и прогнать скрипт**

Всё во временной папке скретчпада; порты 3478/5349/49160-49180 должны быть свободны локально.

```bash
T=/tmp/claude-1000/-www-my-vycord/ca923c57-42fe-4cb2-b50c-922e27437e52/scratchpad/turn-test
mkdir -p "$T/certs"

# Самоподписанный серт (turnutils_uclient не проверяет цепочку)
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=localhost" \
  -keyout "$T/certs/privkey.pem" -out "$T/certs/fullchain.pem"
chmod 644 "$T/certs/"*.pem

# Локальный coturn с той же конфигурацией, что в проде (узкий relay-диапазон)
docker run --rm -d --name turn-test --network host \
  -v "$T/certs:/certs:ro" coturn/coturn:4.7-alpine \
  --listening-port=3478 --tls-listening-port=5349 \
  --min-port=49160 --max-port=49180 --fingerprint \
  --use-auth-secret --static-auth-secret=test-turn-secret \
  --realm=vycord --no-cli --no-dtls \
  --cert=/certs/fullchain.pem --pkey=/certs/privkey.pem --log-file=stdout
sleep 2

# env-файл для скрипта
printf 'TURN_SECRET=test-turn-secret\nTURN_URLS=turn:127.0.0.1:3478?transport=udp\n' > "$T/env"

ENV_FILE="$T/env" ./deploy/check-turn.sh; echo "exit=$?"
```

Expected:

```
OK   3478/udp
OK   3478/tcp
OK   5349/tls
exit=0
```

Если какой-то транспорт дал FAIL — смотреть `docker logs turn-test` и вывод под FAIL-строкой; если coturn отвечает, но критерий `tot_recv_msgs=` не совпал с фактическим форматом вывода `turnutils_uclient`, скорректировать grep по фактическому выводу (критерий по смыслу: эхо-сообщения через relay получены).

- [ ] **Step 4: Негативный тест — неверный секрет даёт FAIL и exit 1**

```bash
printf 'TURN_SECRET=wrong-secret\nTURN_URLS=turn:127.0.0.1:3478?transport=udp\n' > "$T/env.bad"
ENV_FILE="$T/env.bad" ./deploy/check-turn.sh; echo "exit=$?"
```

Expected: три строки `FAIL ...` и `exit=1`.

- [ ] **Step 5: Проверить --print и убрать локальный coturn**

```bash
ENV_FILE="$T/env" ./deploy/check-turn.sh --print
docker rm -f turn-test
rm -rf "$T"
```

Expected: URLs/Username/Credential + ссылка на Trickle ICE; контейнер удалён.

- [ ] **Step 6: Commit**

```bash
git add deploy/check-turn.sh
git commit -m "VYC-23 check-turn.sh: проверка relay-аллокации по udp/tcp/tls после деплоя"
```

---

### Task 4: Раздел «TURN» в README

**Files:**
- Modify: `README.md` (новый раздел в конце файла, после таблицы Current Status)

**Interfaces:**
- Consumes: `deploy/check-turn.sh` и его флаг `--print` (Задача 3), порты из Задачи 1.

- [ ] **Step 1: Добавить раздел в конец `README.md`**

````markdown
## TURN (prod)

Голос и видео у клиентов за симметричным NAT или VPN работают только через
TURN-релей (coturn, поднимается в `docker-compose.prod.yml`). Креденшелы
ephemeral — их выдаёт API: `GET /api/v1/turn/credentials`.

### Порты (фаервол)

| Порт | Назначение |
|---|---|
| 3478/udp | TURN, основной транспорт |
| 3478/tcp | TURN по TCP — когда UDP заблокирован |
| 5349/tcp | TURN по TLS (`turns:`) — жёсткие фаерволы, где режется и plain-TCP |
| 49160–49360/udp | relay-диапазон |

```bash
sudo ufw allow 3478/udp && sudo ufw allow 3478/tcp
sudo ufw allow 5349/tcp
sudo ufw allow 49160:49360/udp
```

### Проверка после деплоя

```bash
./deploy/check-turn.sh          # ждём OK по 3478/udp, 3478/tcp, 5349/tls
./deploy/check-turn.sh --print  # креды для ручной проверки
```

Скрипт гоняет проверку с самого сервера: он доказывает, что coturn, секрет и
TLS исправны, но **не** внешнюю доступность портов. Внешняя проверка: открыть
[Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)
из другой сети, добавить `turns:api.vycord.webvaha.ru:5349?transport=tcp` с
кредами из `--print` и убедиться, что появляется кандидат типа `relay`.

### Сертификат

coturn использует Let's Encrypt-сертификат api-домена: certbot deploy-hook
(`deploy/coturn-cert-hook.sh`, устанавливается `deploy.sh`) копирует его в
`/var/lib/vycord/coturn-certs/` и рестартует контейнер при каждом продлении.
Продление рвёт активные relay-аллокации (~раз в 60 дней, ночью) — ICE у
клиентов переустанавливается сам.
````

Внимание: вложенные ```bash-блоки внутри цитируемого раздела выше — часть добавляемого текста.

- [ ] **Step 2: Проверить рендер**

```bash
grep -n "## TURN (prod)" README.md && echo SECTION_OK
```

Expected: номер строки + `SECTION_OK`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "VYC-23 README: раздел TURN — порты, check-turn.sh, ручная проверка"
```

---

## Критерии приёмки (на проде, вне этого плана)

1. `./deploy/check-turn.sh` — `OK` по всем трём транспортам.
2. Trickle ICE из внешней сети с `turns:`-URL даёт relay-кандидат.
3. Звонок между двумя клиентами продолжает работать.
