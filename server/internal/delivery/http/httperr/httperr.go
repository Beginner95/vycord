// Package httperr — единый формат ошибок HTTP-API.
//
// Тело ответа: {"error": "<человекочитаемый текст>", "code": "<стабильный код>"}.
//
// Поле error сохранено ради обратной совместимости: клиенты, не знающие про
// code, продолжают показывать его как раньше. Поле code стабильно и не
// зависит от формулировки сообщения — по нему клиент выбирает перевод.
package httperr

import (
	"encoding/json"
	"net/http"
)

// Коды ошибок. Стабильны: менять значения нельзя — на них завязан клиент.
const (
	// Общие
	CodeInternalError = "internal_error"
	CodeForbidden     = "forbidden"
	CodeInvalidBody   = "invalid_request_body"

	// Идентификаторы в пути и параметрах
	CodeInvalidServerID  = "invalid_server_id"
	CodeInvalidChannelID = "invalid_channel_id"
	CodeInvalidMessageID = "invalid_message_id"
	CodeInvalidUserID    = "invalid_user_id"
	CodeInvalidRoleID    = "invalid_role_id"

	// Регистрация и вход
	CodeCredentialsRequired = "credentials_required"
	CodeSignupFieldsMissing = "signup_fields_missing"
	CodeInvalidUsername     = "invalid_username"
	CodeInvalidEmail        = "invalid_email"
	CodePasswordTooShort    = "password_too_short"
	CodeEmailTaken          = "email_taken"
	CodeUsernameTaken       = "username_taken"
	CodeInvalidCredentials  = "invalid_credentials"

	// OTP-коды на почту
	CodeOTPRequired         = "otp_code_required"
	CodeInvalidOTPFormat    = "invalid_otp_format"
	CodeOTPInvalid          = "invalid_otp"
	CodeOTPAttemptsExceeded = "otp_attempts_exceeded"
	CodeOTPCooldown         = "otp_cooldown"
	CodeOTPRateLimited      = "otp_rate_limited"
	CodeEmailNotVerified    = "email_not_verified"
	CodeMailSendFailed      = "mail_send_failed"

	// Аутентификация (middleware)
	CodeMissingAuthHeader = "missing_auth_header"
	CodeInvalidAuthHeader = "invalid_auth_header"
	CodeInvalidToken      = "invalid_or_expired_token"

	// Пользователи
	CodeUserNotFound        = "user_not_found"
	CodeSearchUsersFailed   = "search_users_failed"
	CodeLastVisitedFailed   = "update_last_visited_failed"
	CodeSearchQueryRequired = "search_query_required"

	// Аватары и иконки
	CodeAvatarTooLarge       = "avatar_file_too_large"
	CodeAvatarRequired       = "avatar_file_required"
	CodeAvatarReadFailed     = "avatar_read_failed"
	CodeAvatarUpdateFailed   = "avatar_update_failed"
	CodeIconTooLarge         = "icon_file_too_large"
	CodeIconRequired         = "icon_file_required"
	CodeIconReadFailed       = "icon_read_failed"
	CodeUnsupportedImageType = "unsupported_image_format"
	CodeInvalidImage         = "invalid_image_file"
	CodeInvalidImageSize     = "invalid_image_dimensions"

	// Стикеры
	CodeStickerTooLarge      = "sticker_file_too_large"
	CodeStickerImageRequired = "sticker_image_required"
	CodeStickerReadFailed    = "sticker_read_failed"
	CodeStickerNotFound      = "sticker_not_found"
	CodeStickerNameRequired  = "sticker_name_required"
	CodeStickerNameTooLong   = "sticker_name_too_long"
	CodeInvalidStickerID     = "invalid_sticker_id"

	// Серверы
	CodeServerNotFound     = "server_not_found"
	CodeServerNameRequired = "server_name_required"
	CodeServerNameTooLong  = "server_name_too_long"
	CodeServerNameTaken    = "server_name_taken"
	CodeGetServersFailed   = "get_servers_failed"
	CodeGetMembersFailed   = "get_members_failed"
	CodeSearchServersFail  = "search_servers_failed"

	// TURN
	CodeTurnCredentialsFailed = "turn_credentials_failed"

	// Каналы
	CodeChannelNotFound     = "channel_not_found"
	CodeChannelNameRequired = "channel_name_required"
	CodeChannelNameTooLong  = "channel_name_too_long"
	CodeLastChannel         = "cannot_delete_last_channel"

	CodeChannelForbidden = "channel_forbidden"
	CodeVoiceTokenFailed = "voice_token_failed"

	// Инвайты
	CodeInviteNotFound  = "invite_not_found"
	CodeInviteForbidden = "invite_forbidden"

	// Сообщения
	CodeMessageNotFound       = "message_not_found"
	CodeMessageEmpty          = "message_content_required"
	CodeStickerWithText       = "sticker_with_text"
	CodeSearchQueryLength     = "search_query_length"
	CodeInvalidMention        = "invalid_mention"
	CodeMentionEveryoneDenied = "mention_everyone_denied"

	// Роли
	CodeRoleNotFound       = "role_not_found"
	CodeInvalidPermissions = "invalid_permissions"
	CodeInvalidRoleName    = "invalid_role_name"

	// Вложения
	CodeAttachmentTooLarge        = "attachment_too_large"
	CodeAttachmentRequired        = "attachment_required"
	CodeAttachmentNotFound        = "attachment_not_found"
	CodeAttachmentAlreadyAttached = "attachment_already_attached"
	CodeStorageQuotaExceeded      = "storage_quota_exceeded"
	CodeAttachmentLinkExpired     = "attachment_link_expired"
	CodeInvalidAttachmentID       = "invalid_attachment_id"
)

// Write отправляет JSON-ответ об ошибке. Статус и текст передаются как есть.
func Write(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message, "code": code})
}
