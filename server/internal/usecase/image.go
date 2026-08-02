package usecase

import (
	"bytes"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"net/http"

	"github.com/vycord/server/internal/domain"
)

const (
	minImageDimension = 32
	maxImageDimension = 4096
)

// validateImage проверяет, что data — валидный PNG или JPEG разумного
// разрешения, и возвращает расширение файла и определённый content-type
// для сохранения в файловое хранилище. Используется и для аватара
// пользователя (UpdateAvatar), и для иконки сервера (UpdateServerIcon).
func validateImage(data []byte) (ext, contentType string, err error) {
	contentType = http.DetectContentType(data)
	switch contentType {
	case "image/png":
		ext = "png"
	case "image/jpeg":
		ext = "jpg"
	default:
		return "", "", domain.ErrUnsupportedAvatarFormat
	}

	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return "", "", fmt.Errorf("%w: %v", domain.ErrInvalidAvatarImage, err)
	}
	if cfg.Width < minImageDimension || cfg.Height < minImageDimension ||
		cfg.Width > maxImageDimension || cfg.Height > maxImageDimension {
		return "", "", domain.ErrInvalidAvatarDimensions
	}

	return ext, contentType, nil
}
