package domain

import "errors"

// Доменные сентинел-ошибки. Хендлеры транслируют их в HTTP-статусы через errors.Is.
var (
	// ErrForbidden — пользователь не участник сервера (или не владелец, где это требуется), доступ запрещён.
	ErrForbidden = errors.New("access denied")
	// ErrChannelForbidden — пользователю запрещён доступ к приватному каналу
	// (не владелец канала/сервера, не администратор, не приглашён).
	ErrChannelForbidden = errors.New("channel access denied")
	// ErrChannelNotFound — канал с указанным ID не существует.
	ErrChannelNotFound = errors.New("channel not found")
	// ErrMessageNotFound — сообщение с указанным ID не существует или не принадлежит каналу из URL.
	ErrMessageNotFound = errors.New("message not found")
	// ErrInvalidMention — упомянутый через <@uuid> пользователь не состоит в сервере.
	ErrInvalidMention = errors.New("invalid mention")
	// ErrMentionForbidden — @everyone от пользователя без права MENTION_EVERYONE.
	ErrMentionForbidden = errors.New("mention not allowed")
	// ErrUnsupportedAvatarFormat — загружаемый файл не PNG, не JPEG и не GIF.
	ErrUnsupportedAvatarFormat = errors.New("unsupported image format")
	// ErrInvalidAvatarImage — файл не декодируется как валидное изображение.
	ErrInvalidAvatarImage = errors.New("invalid avatar image")
	// ErrInvalidAvatarDimensions — разрешение изображения вне допустимых границ.
	ErrInvalidAvatarDimensions = errors.New("invalid avatar dimensions")
	// ErrServerNotFound — сервер с указанным ID не существует.
	ErrServerNotFound = errors.New("server not found")
	// ErrLastChannel — попытка удалить единственный оставшийся канал сервера.
	ErrLastChannel = errors.New("cannot delete the last channel of a server")
	// ErrRoleNotFound — роль не существует или принадлежит другому серверу.
	ErrRoleNotFound = errors.New("role not found")
	// ErrInvalidPermissions — маска прав содержит неизвестные биты.
	ErrInvalidPermissions = errors.New("invalid permissions")
	// ErrInvalidRoleName — имя роли пустое или длиннее 100 символов.
	ErrInvalidRoleName = errors.New("invalid role name")
	// ErrServerNameTaken — сервер с таким именем уже существует (без учёта регистра).
	ErrServerNameTaken = errors.New("server with this name already exists")
	// ErrInviteNotFound — код инвайта не существует, отозван, истёк или
	// исчерпал лимит использований (умышленно один код на все причины —
	// не палим наружу, чем именно инвайт недействителен).
	ErrInviteNotFound = errors.New("invite not found")
	// ErrInviteForbidden — у пользователя нет прав создавать/отзывать инвайты сервера.
	ErrInviteForbidden = errors.New("invite access denied")
	// ErrStickerNotFound — стикер не существует или принадлежит другому серверу.
	ErrStickerNotFound = errors.New("sticker not found")
	// ErrStickerForbidden — у пользователя нет права управлять стикерами сервера.
	ErrStickerForbidden = errors.New("sticker access denied")
	// ErrStickerNameRequired — имя стикера пустое.
	ErrStickerNameRequired = errors.New("sticker name is required")
	// ErrStickerNameTooLong — имя стикера длиннее 100 символов.
	ErrStickerNameTooLong = errors.New("sticker name is too long")
	// ErrStickerImageRequired — при создании стикера не приложено изображение.
	ErrStickerImageRequired = errors.New("sticker image is required")

	// ErrEmailTaken — при регистрации email уже занят другим пользователем.
	ErrEmailTaken = errors.New("user with this email already exists")
	// ErrUsernameTaken — при регистрации username уже занят другим пользователем.
	ErrUsernameTaken = errors.New("user with this username already exists")
	// ErrInvalidCredentials — email не найден или пароль не совпадает при входе.
	ErrInvalidCredentials = errors.New("invalid email or password")
	// ErrRefreshTokenNotFound — refresh-токен с таким хэшем не найден в БД.
	ErrRefreshTokenNotFound = errors.New("refresh token not found")
	// ErrRefreshTokenInvalid — refresh-токен истёк или уже был использован
	// (ротация/reuse). Отдельная от ErrRefreshTokenNotFound ошибка нужна
	// только на уровне usecase-логики (reuse триггерит RevokeFamily) — по
	// HTTP обе маппятся в один и тот же 401 invalid_or_expired_token.
	ErrRefreshTokenInvalid = errors.New("refresh token invalid or expired")

	// ErrAttachmentTooLarge — файл больше, чем разрешает план пользователя.
	ErrAttachmentTooLarge = errors.New("attachment is too large")
	// ErrAttachmentRequired — в multipart-запросе нет поля file.
	ErrAttachmentRequired = errors.New("attachment file is required")
	// ErrAttachmentNotFound — вложения нет, либо оно чужое, либо из другого канала.
	ErrAttachmentNotFound = errors.New("attachment not found")
	// ErrAttachmentAlreadyAttached — вложение уже привязано к другому сообщению.
	ErrAttachmentAlreadyAttached = errors.New("attachment is already attached")
	// ErrStorageQuotaExceeded — превышен суммарный объём хранения по плану.
	// Сегодня не срабатывает: у плана free max_total_bytes = NULL.
	ErrStorageQuotaExceeded = errors.New("storage quota exceeded")
	// ErrStickerWithAttachments — стикер прислан вместе с вложениями. Стикер
	// самостоятелен: с ним не бывает ни текста, ни файлов.
	ErrStickerWithAttachments = errors.New("sticker message cannot contain attachments")

	// ErrOTPNotFound — репозиторный сентинел: живого кода нет. Наружу не
	// выходит, юзкейс переводит его в ErrOTPInvalid.
	ErrOTPNotFound = errors.New("otp code not found")
	// ErrOTPInvalid — единый ответ на все причины отказа при проверке кода:
	// пользователя нет, кода нет, код истёк, код уже погашен, код не совпал.
	// Умышленно один на всё — как ErrInviteNotFound выше, чтобы ответ не
	// подсказывал, в чём именно дело.
	ErrOTPInvalid = errors.New("invalid or expired code")
	// ErrOTPAttemptsExceeded — исчерпан лимит попыток, код сожжён целиком.
	// Отдельно от ErrOTPInvalid: клиенту надо сказать «запросите новый», а
	// не «попробуйте ещё раз».
	ErrOTPAttemptsExceeded = errors.New("too many invalid attempts")
	// ErrUsernameRequired — код верный, но email ещё не принадлежит
	// пользователю: identifier-first требует username, чтобы завершить
	// создание аккаунта. Не отказ (код не расходуется) — следующий шаг.
	ErrUsernameRequired = errors.New("username required to finish registration")
	// ErrEmailNotVerified — вход по паролю в аккаунт с неподтверждённой почтой.
	ErrEmailNotVerified = errors.New("email is not verified")
	// ErrMailSendFailed — письмо не ушло. Код при этом уже сохранён и
	// остаётся валидным: повторный запрос сработает.
	ErrMailSendFailed = errors.New("failed to send email")
	// ErrLastSeenBatchTooLarge — запрошено больше 200 user_ids за один вызов
	// GetLastSeenBatch.
	ErrLastSeenBatchTooLarge = errors.New("too many user ids in last seen batch")

	// ErrSelfFriendship — заявка в друзья самому себе.
	ErrSelfFriendship = errors.New("cannot befriend yourself")
	// ErrFriendRequestExists — заявка от этого пользователя уже висит.
	ErrFriendRequestExists = errors.New("friend request already exists")
	// ErrAlreadyFriends — пользователи уже друзья.
	ErrAlreadyFriends = errors.New("already friends")
	// ErrFriendshipNotFound — заявки или дружбы нет, либо она чужая.
	ErrFriendshipNotFound = errors.New("friendship not found")
	// ErrInteractionForbidden — взаимодействие запрещено блокировкой ЛИБО
	// настройкой приватности. Одна ошибка на две причины намеренно: если
	// различать их наружу, перебором заявок вычисляется, кто тебя
	// заблокировал, а кто просто закрыл приём.
	ErrInteractionForbidden = errors.New("interaction forbidden")
	// ErrInvalidPrivacyMode — неизвестное значение режима приватности.
	ErrInvalidPrivacyMode = errors.New("invalid privacy mode")
	// ErrUserNotFound — пользователь с указанным id/username не существует.
	// Отдельно от ErrInteractionForbidden: то, что юзернейма не существует,
	// не секрет (он же виден в /users поиске) — прятать тут нечего.
	ErrUserNotFound = errors.New("user not found")
)

var (
	// ErrMessageEmpty — сообщение пустое.
	ErrMessageEmpty = errors.New("message content is empty")
	// ErrCallMessageImmutable — попытка отредактировать или удалить
	// системную плашку звонка (kind='call') через API. UI не даёт на неё
	// кнопок, но это не защита от прямого запроса.
	ErrCallMessageImmutable = errors.New("call messages cannot be edited or deleted")
)
