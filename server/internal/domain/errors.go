package domain

import "errors"

// Доменные сентинел-ошибки. Хендлеры транслируют их в HTTP-статусы через errors.Is.
var (
	// ErrForbidden — пользователь не участник сервера, доступ запрещён.
	ErrForbidden = errors.New("access denied")
	// ErrChannelNotFound — канал с указанным ID не существует.
	ErrChannelNotFound = errors.New("channel not found")
)
