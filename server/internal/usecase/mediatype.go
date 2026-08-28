package usecase

import (
	"bytes"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/vycord/server/internal/domain"
)

// sniffedKinds — типы, которые http.DetectContentType распознаёт сам.
//
// Контейнерных типов (mp4, webm, ogg, mpeg-с-ID3) здесь нет намеренно: до
// сниффера отрабатывает detectContainer, который разводит одинаковые
// контейнеры на аудио и видео по расширению. Дублирующие записи были бы
// недостижимы и создавали бы ложное впечатление, что тип решается здесь.
var sniffedKinds = map[string]domain.AttachmentKind{
	"image/png":  domain.AttachmentKindImage,
	"image/jpeg": domain.AttachmentKindImage,
	"image/gif":  domain.AttachmentKindImage,
	"image/webp": domain.AttachmentKindImage,
	"image/bmp":  domain.AttachmentKindImage,
	"audio/wave": domain.AttachmentKindAudio,
	"audio/aiff": domain.AttachmentKindAudio,
	"video/avi":  domain.AttachmentKindVideo,
}

// DetectKind определяет вид вложения и content-type ТОЛЬКО по содержимому
// файла. Заголовок Content-Type от клиента не участвует нигде.
//
// Расширение имени используется как уточнение внутри уже опознанного
// контейнера — mp4 бывает и видео (.mp4), и аудио (.m4a), webm тоже. Само по
// себе расширение никогда не повышает файл до медиа: переименованный в .jpg
// исполняемый файл остаётся kind=file и не попадёт в <img>.
func DetectKind(head []byte, name string) (domain.AttachmentKind, string) {
	// Пустой файл опознавать не по чему: http.DetectContentType на пустом
	// входе отдаёт text/plain, что здесь заведомо неверно.
	if len(head) == 0 {
		return domain.AttachmentKindFile, "application/octet-stream"
	}

	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(name), "."))

	// Контейнеры, которых stdlib не знает, разбираем сами.
	if kind, ct, ok := detectContainer(head, ext); ok {
		return kind, ct
	}

	sniffed := http.DetectContentType(head)
	// DetectContentType возвращает тип с параметрами ("text/plain; charset=utf-8").
	base := sniffed
	if i := strings.IndexByte(base, ';'); i >= 0 {
		base = strings.TrimSpace(base[:i])
	}

	if kind, ok := sniffedKinds[base]; ok {
		return kind, base
	}

	if base == "application/octet-stream" || base == "text/plain" {
		// Ничего не опознали — отдаём то, что вернул sniff, но видом file.
		if base == "text/plain" {
			return domain.AttachmentKindFile, sniffed
		}
		return domain.AttachmentKindFile, "application/octet-stream"
	}

	// Опознанный, но не медийный тип (pdf, zip, ...).
	return domain.AttachmentKindFile, base
}

// isoImageBrands — major brand'ы ISO BMFF, за которыми стоит картинка, а не
// видео. mif1 — базовый бренд HEIF, им подписаны в том числе снимки iOS.
var isoImageBrands = map[string]string{
	"avif": "image/avif",
	"avis": "image/avif",
	"heic": "image/heic",
	"heix": "image/heic",
	"mif1": "image/heic",
}

// detectContainer разбирает контейнеры, которые http.DetectContentType не
// распознаёт или распознаёт неоднозначно.
func detectContainer(head []byte, ext string) (domain.AttachmentKind, string, bool) {
	switch {
	case len(head) >= 12 && bytes.Equal(head[4:8], []byte("ftyp")):
		// ISO BMFF: не только mp4. В том же контейнере лежат AVIF и HEIC —
		// снятое айфоном приходит именно так. Без разбора major brand они
		// уезжали в video/mp4, и в ленте появлялся <video>, который не играет.
		if ct, ok := isoImageBrands[string(head[8:12])]; ok {
			return domain.AttachmentKindImage, ct, true
		}
		// Дорожку видео/аудио по заголовку не определить — разводим по
		// расширению, дефолт video.
		switch ext {
		case "m4a", "m4b":
			return domain.AttachmentKindAudio, "audio/mp4", true
		case "mov":
			return domain.AttachmentKindVideo, "video/quicktime", true
		default:
			return domain.AttachmentKindVideo, "video/mp4", true
		}
	case len(head) >= 4 && bytes.Equal(head[:4], []byte{0x1A, 0x45, 0xDF, 0xA3}):
		// EBML: webm и mkv. Аудио-webm существует, поэтому смотрим расширение.
		switch ext {
		case "weba":
			return domain.AttachmentKindAudio, "audio/webm", true
		case "mkv":
			return domain.AttachmentKindVideo, "video/x-matroska", true
		default:
			return domain.AttachmentKindVideo, "video/webm", true
		}
	case len(head) >= 4 && bytes.Equal(head[:4], []byte("OggS")):
		if ext == "ogv" {
			return domain.AttachmentKindVideo, "video/ogg", true
		}
		return domain.AttachmentKindAudio, "audio/ogg", true
	case len(head) >= 4 && bytes.Equal(head[:4], []byte("fLaC")):
		return domain.AttachmentKindAudio, "audio/flac", true
	case len(head) >= 3 && bytes.Equal(head[:3], []byte("ID3")):
		return domain.AttachmentKindAudio, "audio/mpeg", true
	case len(head) >= 2 && head[0] == 0xFF && head[1]&0xE0 == 0xE0 && ext == "mp3":
		// MPEG-фрейм без ID3-тега: сигнатура слишком общая, поэтому требуем
		// ещё и расширение .mp3.
		return domain.AttachmentKindAudio, "audio/mpeg", true
	}
	return "", "", false
}
