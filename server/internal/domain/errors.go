package domain

import "errors"

// Доменные сентинел-ошибки. Хендлеры транслируют их в HTTP-статусы через errors.Is.
var (
	// ErrForbidden — пользователь не участник сервера (или не владелец, где это требуется), доступ запрещён.
	ErrForbidden = errors.New("access denied")
	// ErrChannelForbidden — пользователю запрещён доступ к приватному каналу
	// (не владелец канала/сервера, не администратор, не приглашён).
	ErrChannelForbidden = errors.New("channel access denied")
	// ErrChannelNotPrivate — попытка пригласить/удалить участника канала,
	// который не приватный (channel_members не используется, пока канал публичный).
	ErrChannelNotPrivate = errors.New("channel is not private")
	// ErrChannelNotVoice — попытка получить voice-токен для текстового канала.
	ErrChannelNotVoice = errors.New("channel is not a voice channel")
	// ErrTargetNotServerMember — пользователь, которого пытаются добавить в
	// приватный канал, не состоит в сервере этого канала.
	ErrTargetNotServerMember = errors.New("target user is not a member of this server")
	// ErrCannotRemoveChannelOwner — попытка убрать владельца канала из
	// channel_members: он не может потерять доступ к собственному каналу.
	ErrCannotRemoveChannelOwner = errors.New("cannot remove the channel owner from channel members")
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
	// ErrInvalidRoleName — имя роли пустое или длиннее 100 символов.
	ErrInvalidRoleName = errors.New("invalid role name")
	// ErrServerNameTaken — сервер с таким именем уже существует (без учёта регистра).
	ErrServerNameTaken = errors.New("server with this name already exists")

	// ErrEmailTaken — при регистрации email уже занят другим пользователем.
	ErrEmailTaken = errors.New("user with this email already exists")
	// ErrUsernameTaken — при регистрации username уже занят другим пользователем.
	ErrUsernameTaken = errors.New("user with this username already exists")
	// ErrInvalidCredentials — email не найден или пароль не совпадает при входе.
	ErrInvalidCredentials = errors.New("invalid email or password")
)
