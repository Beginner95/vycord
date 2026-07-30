package domain

import "errors"

// Доменные сентинел-ошибки. Хендлеры транслируют их в HTTP-статусы через errors.Is.
var (
	// ErrForbidden — пользователь не участник сервера (или не владелец, где это требуется), доступ запрещён.
	ErrForbidden = errors.New("access denied")
	// ErrChannelNotFound — канал с указанным ID не существует.
	ErrChannelNotFound = errors.New("channel not found")
	// ErrMessageNotFound — сообщение с указанным ID не существует или не принадлежит каналу из URL.
	ErrMessageNotFound = errors.New("message not found")
	// ErrInvalidMention — упомянутый через <@uuid> пользователь не состоит в сервере.
	ErrInvalidMention = errors.New("invalid mention")
	// ErrMentionForbidden — @everyone от пользователя без права MENTION_EVERYONE.
	ErrMentionForbidden = errors.New("mention not allowed")
	// ErrUnsupportedAvatarFormat — загружаемый файл не PNG и не JPEG.
	ErrUnsupportedAvatarFormat = errors.New("unsupported avatar format")
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
)
