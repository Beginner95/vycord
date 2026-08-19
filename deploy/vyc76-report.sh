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
# С раздела 4.1 спеки к этому добавился watchdog самого SFU-процесса
# (internal/sfu/diagnostics): отдельная горутина с тикером на 20 мс, которая
# логирует `runtime stall detected` (уровень WARN, stdout → docker logs), если
# сама проснулась на 200+ мс позже, чем должна была. Последняя секция этого
# отчёта сопоставляет её с inbound-accel по времени (±5 с) — у watchdog нет и
# не может быть roomId/userId, пауза процесса глобальна.
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
\echo '=== trigger=spread — отдача идёт ВОЛНАМИ при нормальном среднем; ==='
\echo '=== именно это пропускал старый детектор и именно так выглядел больной трек ==='
SELECT timestamp,
       data->'extra'->>'selfUserId' AS publisher,
       data->'extra'->>'roomId'     AS room,
       COALESCE(data->'extra'->>'trigger','rate')                     AS trigger,
       round((data->'extra'->>'ppsNum')::numeric, 1)                  AS pps,
       round((data->'extra'->>'ppsMinNum')::numeric, 1)               AS pps_min,
       round((data->'extra'->>'ppsMaxNum')::numeric, 1)               AS pps_max,
       round((data->'extra'->>'ppsSpreadNum')::numeric, 2)            AS spread,
       round((data->'extra'->>'sendDelayMsPerPktNum')::numeric, 1)    AS send_delay_ms,
       round((data->'extra'->>'samplesDurationDriftNum')::numeric, 3) AS capture_drift_s,
       tags->>'path'     AS ice_path,
       tags->>'platform' AS platform
FROM issue_events_issueevent
WHERE tags->>'module' = 'vyc76' AND tags->>'kind' = 'uplink-pacing'
  AND timestamp > now() - interval '${HOURS} hours'
ORDER BY timestamp DESC LIMIT 60;

\echo ''
\echo '=== ПОКРЫТИЕ: кто вообще шлёт события инструментированной сборки ==='
\echo '=== ВАЖНО: паблишер, которого здесь нет, невидим — его uplink не измеряется ==='
\echo '=== release < 1.7.4 = старая сборка без инструментации отдачи (нужен F5 / рестарт) ==='
SELECT data->'extra'->>'selfUserId' AS "user",
       tags->>'platform' AS platform,
       tags->>'release'  AS release,
       count(*) AS events,
       count(*) FILTER (WHERE tags->>'kind' = 'uplink-pacing') AS uplink_events,
       max(timestamp) AS last_seen
FROM issue_events_issueevent
WHERE tags->>'module' = 'vyc76'
  AND timestamp > now() - interval '${HOURS} hours'
GROUP BY 1, 2, 3 ORDER BY 4 DESC;

\echo ''
\echo '=== ПЕРЕПИСЬ ICE-ПУТЕЙ: на чём сидят клиенты (ice-path-initial) ==='
\echo '=== tcp_relay=t у кого-то, кто ТАК И НЕ ушёл с него → убирать transport=tcp нельзя ==='
SELECT data->'extra'->>'path'       AS path,
       data->'extra'->>'isTcpRelay' AS tcp_relay,
       count(*)                     AS calls,
       count(DISTINCT data->'extra'->>'selfUserId') AS users
FROM issue_events_issueevent
WHERE tags->>'module' = 'vyc76' AND tags->>'kind' = 'ice-path-initial'
  AND timestamp > now() - interval '${HOURS} hours'
GROUP BY 1, 2 ORDER BY 3 DESC;

\echo ''
\echo '=== ПЕРЕКЛЮЧЕНИЯ ПУТИ В ЗВОНКЕ (ice-path-change) ==='
\echo '=== to_tcp_relay=t — предвестник всплеска; сверяй время с inbound-accel выше ==='
SELECT timestamp,
       data->'extra'->>'selfUserId'   AS "user",
       data->'extra'->>'from'         AS moved_from,
       data->'extra'->>'to'           AS moved_to,
       data->'extra'->>'toTcpRelay'   AS to_tcp_relay,
       data->'extra'->>'changeIndex'  AS change_no,
       tags->>'platform'              AS platform
FROM issue_events_issueevent
WHERE tags->>'module' = 'vyc76' AND tags->>'kind' = 'ice-path-change'
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

echo
echo "=== СОПОСТАВЛЕНИЕ (раздел 4.4): runtime stall рядом с inbound-accel ==="
echo "=== Строка рядом с моментом → пауза процесса SFU подтверждена как причина ==="
echo "=== Пусто при живых inbound-accel → процесс не вставал, смотреть раздел 4.2 (фанаут) ==="
echo "=== Оба лога в UTC (GlitchTip timestamp и docker logs у SFU) — приводить не нужно ==="

# Голые эпохи, без \pset border/pager — их же предстоит парсить в цикле ниже,
# а не читать глазами (человеко-читаемые метки уже есть в секции выше).
ACCEL_EPOCHS=$(ssh -o BatchMode=yes "$SSH_HOST" \
  "docker exec vycord-db sh -lc \"psql -U \\\$POSTGRES_USER -d glitchtip -tAc \
   \\\"SELECT extract(epoch FROM timestamp)::bigint FROM issue_events_issueevent \
      WHERE tags->>'module' = 'vyc76' AND tags->>'kind' = 'inbound-accel' \
        AND timestamp > now() - interval '${HOURS} hours' ORDER BY timestamp\\\"\"")

if [[ -z "$ACCEL_EPOCHS" ]]; then
  echo "(inbound-accel событий за последние ${HOURS}ч нет — сопоставлять нечего)"
else
  STALL_LOG=$(ssh -o BatchMode=yes "$SSH_HOST" \
    "docker logs vycord-sfu --since ${HOURS}h 2>&1 | grep 'runtime stall detected'" || true)

  if [[ -z "$STALL_LOG" ]]; then
    echo "(watchdog ни разу не сработал за последние ${HOURS}ч — процесс не вставал)"
  else
    while IFS= read -r accel_epoch; do
      [[ -z "$accel_epoch" ]] && continue
      accel_human=$(date -u -d "@${accel_epoch}" +"%Y-%m-%d %H:%M:%S UTC")
      window_start=$((accel_epoch - 5))
      window_end=$((accel_epoch + 5))

      matches=""
      while IFS= read -r log_line; do
        [[ -z "$log_line" ]] && continue
        log_ts=$(grep -oE 'time=[0-9TZ:.-]+' <<< "$log_line" | head -1 | sed 's/^time=//')
        [[ -z "$log_ts" ]] && continue
        log_epoch=$(date -u -d "$log_ts" +%s 2>/dev/null) || continue
        if (( log_epoch >= window_start && log_epoch <= window_end )); then
          matches+="$log_line"$'\n'
        fi
      done <<< "$STALL_LOG"

      if [[ -n "$matches" ]]; then
        echo "--- inbound-accel @ ${accel_human} — НАЙДЕН runtime stall в окне ±5с ---"
        printf '%s' "$matches"
      else
        echo "--- inbound-accel @ ${accel_human} — stall не найден в окне ±5с ---"
      fi
    done <<< "$ACCEL_EPOCHS"
  fi
fi
