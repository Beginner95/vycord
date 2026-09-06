-- +migrate Up
-- VYC-90: граф друзей. Дружба симметрична и хранится ОДНОЙ строкой на пару;
-- направление (кто попросил) нужно только до принятия. Блокировка
-- направленная и живёт отдельной таблицей: «А заблокировал Б» и «Б
-- заблокировал А» — независимые факты, в одной строке они затирали бы
-- друг друга.
CREATE TABLE friendships (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at  TIMESTAMPTZ,
    CHECK (requester_id <> addressee_id),
    -- Страховка от рассинхрона: «принято, но неизвестно когда» и «не
    -- принято, но есть дата принятия» физически не запишутся.
    CHECK ((status = 'accepted') = (accepted_at IS NOT NULL))
);

-- Одна связь на пару в ЛЮБОМ направлении: встречная заявка не создаёт
-- вторую строку. Проверено на PG 16.13.
CREATE UNIQUE INDEX uq_friendships_pair
    ON friendships (LEAST(requester_id, addressee_id),
                    GREATEST(requester_id, addressee_id));

CREATE INDEX idx_friendships_requester ON friendships (requester_id, status);
CREATE INDEX idx_friendships_addressee ON friendships (addressee_id, status);

CREATE TABLE user_blocks (
    blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);
-- Обратный индекс: проверка «а не заблокировали ли МЕНЯ» идёт по второй
-- колонке первичного ключа, которой префикс PK не помогает.
CREATE INDEX idx_user_blocks_blocked ON user_blocks (blocked_id);

-- Приватность плоскими колонками — тот же паттерн, что servers.is_private
-- (014) и users.show_last_seen (023). Таблицы настроек в проекте нет.
ALTER TABLE users
    ADD COLUMN allow_friend_requests TEXT NOT NULL DEFAULT 'everyone'
        CHECK (allow_friend_requests IN ('everyone', 'mutual_servers', 'none')),
    ADD COLUMN allow_dm_from TEXT NOT NULL DEFAULT 'friends'
        CHECK (allow_dm_from IN ('everyone', 'mutual_servers', 'friends'));
