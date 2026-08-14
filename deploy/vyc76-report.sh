#!/usr/bin/env bash
#
# VYC-76 — читает диагностические события «ускорения речи» из GlitchTip.
#
# Клиент (client/src/services/groupCall.ts) шлёт в GlitchTip два вида событий
# с тегом module=vyc76:
#
#   kind=inbound-accel   — слушатель зафиксировал, что NetEq сжимает время
#                          воспроизведения, т.е. чей-то голос ускорился.
#                          extra.peerUserId — ЧЕЙ именно голос.
#   kind=uplink-pacing   — публикующий зафиксировал аномалию собственной
#                          отдачи: провал/выброс packets-per-second, рост
#                          задержки в пейсере, отставание захвата.
#
# Сопоставление этих двух и есть эксперимент. Если у паблишера Y в тот же
# момент есть uplink-pacing, а слушатели жалуются на peerUserId=Y — всплеск
# рождается ДО SFU (транспорт/захват на машине Y). Если же у Y отдача ровная,
# а слушатели одновременно видят ускорение — всплеск рождается в SFU.
#
# Использование:
#   deploy/vyc76-report.sh [часов]     # по умолчанию 24
#
set -euo pipefail

SSH_HOST="${VYC_SSH_HOST:-vycard_vps}"
HOURS="${1:-24}"

if ! [[ "$HOURS" =~ ^[0-9]+$ ]]; then
  echo "Ошибка: аргумент должен быть числом часов, получено: $HOURS" >&2
  exit 1
fi

# Запрос собирается локально и передаётся по stdin, чтобы не воевать с
# экранированием кавычек через два слоя (ssh + docker exec sh -lc).
SQL=$(cat <<SQL_END
\pset pager off
\pset border 2

\echo '=== Сводка событий VYC-76 за последние ${HOURS} ч ==='
SELECT tags->>'kind' AS kind,
       count(*) AS events,
       count(DISTINCT data->'extra'->>'selfUserId') AS users,
       min(timestamp) AS first_seen,
       max(timestamp) AS last_seen
FROM issue_events_issueevent
WHERE tags->>'module' = 'vyc76'
  AND timestamp > now() - interval '${HOURS} hours'
GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '=== Кто слышит ускорение и ЧЕЙ голос ускорен (inbound-accel) ==='
SELECT timestamp,
       data->'extra'->>'selfUserId'  AS listener,
       data->'extra'->>'peerUserId'  AS speaker,
       data->'extra'->>'roomId'      AS room,
       round((data->'extra'->>'accelPctNum')::numeric, 2)     AS accel_pct,
       round((data->'extra'->>'ppsNum')::numeric, 1)          AS pps,
       round((data->'extra'->>'jitterBufferMsNum')::numeric,0) AS jbuf_ms,
       data->'extra'->>'concealedDelta' AS concealed,
       tags->>'platform' AS platform
FROM issue_events_issueevent
WHERE tags->>'module' = 'vyc76' AND tags->>'kind' = 'inbound-accel'
  AND timestamp > now() - interval '${HOURS} hours'
ORDER BY timestamp DESC LIMIT 60;

\echo ''
\echo '=== Аномалии отдачи у публикующих (uplink-pacing) ==='
\echo '=== path вида relay/tcp или relay/tls подтверждает гипотезу TURN-over-TCP ==='
SELECT timestamp,
       data->'extra'->>'selfUserId' AS publisher,
       data->'extra'->>'roomId'     AS room,
       round((data->'extra'->>'ppsNum')::numeric, 1)                  AS pps,
       round((data->'extra'->>'sendDelayMsPerPktNum')::numeric, 1)    AS send_delay_ms,
       round((data->'extra'->>'samplesDurationDriftNum')::numeric, 3) AS capture_drift_s,
       tags->>'path'     AS ice_path,
       tags->>'platform' AS platform
FROM issue_events_issueevent
WHERE tags->>'module' = 'vyc76' AND tags->>'kind' = 'uplink-pacing'
  AND timestamp > now() - interval '${HOURS} hours'
ORDER BY timestamp DESC LIMIT 60;

\echo ''
\echo '=== СВЕДЕНИЕ: жалоба слушателя рядом с аномалией у названного паблишера ==='
\echo '=== Строки здесь = всплеск возник ДО SFU. Пусто при живых жалобах = SFU.  ==='
SELECT a.timestamp AS accel_at,
       a.data->'extra'->>'selfUserId' AS listener,
       a.data->'extra'->>'peerUserId' AS speaker,
       round((a.data->'extra'->>'accelPctNum')::numeric, 2) AS accel_pct,
       u.timestamp AS uplink_at,
       round((u.data->'extra'->>'ppsNum')::numeric, 1) AS speaker_pps,
       u.tags->>'path' AS speaker_ice_path
FROM issue_events_issueevent a
JOIN issue_events_issueevent u
  ON u.tags->>'module' = 'vyc76'
 AND u.tags->>'kind'   = 'uplink-pacing'
 AND u.data->'extra'->>'selfUserId' = a.data->'extra'->>'peerUserId'
 AND u.timestamp BETWEEN a.timestamp - interval '30 seconds'
                     AND a.timestamp + interval '30 seconds'
WHERE a.tags->>'module' = 'vyc76' AND a.tags->>'kind' = 'inbound-accel'
  AND a.timestamp > now() - interval '${HOURS} hours'
ORDER BY a.timestamp DESC LIMIT 40;
SQL_END
)

echo "$SQL" | ssh -o BatchMode=yes "$SSH_HOST" \
  'cat > /tmp/vyc76.sql \
   && docker cp /tmp/vyc76.sql vycord-db:/tmp/vyc76.sql >/dev/null \
   && docker exec vycord-db sh -lc "psql -U \$POSTGRES_USER -d glitchtip -f /tmp/vyc76.sql" \
   && docker exec vycord-db rm -f /tmp/vyc76.sql && rm -f /tmp/vyc76.sql'

echo
echo "=== Сторона SFU: накопленные потери в очередях подписчиков ==="
echo "=== Ненулевой рост здесь — всплеск формируется в SFU, а не до него ==="
ssh -o BatchMode=yes "$SSH_HOST" \
  "docker logs vycord-sfu --since ${HOURS}h 2>&1 \
   | grep -E 'RTP forwarding milestone|track read error' \
   | grep -v 'subscriber_drops=0' | tail -30" \
  || echo "(записей с ненулевыми потерями нет)"
