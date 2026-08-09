package domain

import "errors"

// Доменные сентинел-ошибки. Хендлеры транслируют их в HTTP-статусы через errors.Is.
var (
	// ErrForbidden — пользователь не участник сервера (или не владелец, где это требуется), доступ запрещён.
	ErrForbidden = errors.New("access denied")
	// ErrChannelForbidden — пользователю запрещён доступ к приватному каналу
	// (не владелец канала/сервера, не администратор, не приглашён).
	ErrChannelForbidden = errors.New("channel access denied")
	// ErrChannelNotVoice — попытка получить voice-токен для текстового канала.
	ErrChannelNotVoice = errors.New("channel is not a voice channel")
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
)

var (
	// ErrMessageEmpty — сообщение пустое.
	ErrMessageEmpty = errors.New("message content is empty")
)
