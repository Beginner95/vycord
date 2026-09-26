# Виртуальные фоны звонков (VYC-100) — деплой

## Куда грузить фоны

Каталог на сервере: **`/var/lib/vycord/backgrounds`** (root-владелец, как `/var/lib/vycord/uploads`).

Параметры:
- env API-сервиса: `BACKGROUNDS_DIR=/var/lib/vycord/backgrounds` — **в `.env.prod`** (сервер) и в `.env.prod.example` (репозиторий);
- `docker-compose.prod.yml`: bind-mount `- /var/lib/vycord/backgrounds:/var/lib/vycord/backgrounds` у сервиса `api` — чтобы файлы переживали пересоздание контейнера.

Раздаёт Go-хендлер: `GET /api/v1/backgrounds` (список, под авторизацией) и
`GET /backgrounds/{id}/file` (публично, для `<img src>`). Nginx менять не нужно —
`location /` на api-домене уже проксирует `/backgrounds/`.

## Как добавить/заменить фон

1. Положить файл в `/var/lib/vycord/backgrounds/<id>.jpg|jpeg|png|webp`
   (размер: 1920×1080 рекомендуется, идеал — «замыленные» по краям картинки,
   чтобы силуэт не терялся; тяжёлые PNG не нужны — 200–800 КБ JPEG достаточно).
2. Список сканирует каталог при каждом запросе — **рестарт не нужен**.
3. Удаление файла убирает фон из списка; у клиентов выбранный удалённый фон
   автоматически сбросится.

Замечание: имя файла до расширения становится id. Две картинки с одинаковым
id (например `alps.jpg` и `alps.png`) дадут дубль в списке — не кладите.

## Начальная загрузка (проделано 2026-09-26)

10 фонов загружены на `vycard_vps` в `/var/lib/vycord/backgrounds`
(README.txt рядом с файлами — список и атрибуция):

| id | Композиция |
|---|---|
| beach.jpg | Пальмы на пляже, о-в Кох Мак |
| city.jpg | Ночной Манхэттен, панорама |
| office.jpg | Интерьер домашнего офиса |
| mountains.jpg | Утреннее озеро Gangapurna |
| forest.jpg | Туманное зимнее утро в лесу |
| gradient.jpg | Синий геометрический градиент |
| coffee.jpg | Кофейня (Ньюарк) |
| space.jpg | Туманность Лагуна (ESO) |
| desert.jpg | Закат над дюнами Джайсалмера |
| waves.jpg | Волны на восходе, Сет |

Источники: файлы Wikimedia Commons (CC-BY/CC-BY-SA/PD), атрибуция — в
README.txt на сервере. После загрузки контейнер api пересоздан
(`docker compose -f docker-compose.prod.yml --env-file .env.prod up -d api`).

## Проверка

```bash
curl -sI https://api.vycord.webvaha.ru/backgrounds/beach/file   # 200 image/jpeg
curl -s  https://api.vycord.webvaha.ru/api/v1/backgrounds        # 401 без токена
```