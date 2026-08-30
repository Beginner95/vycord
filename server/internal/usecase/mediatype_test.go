package usecase_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
)

// Сигнатуры настоящих контейнеров — по ним и определяется тип. Заголовка в
// 512 байт достаточно всем перечисленным форматам.
func mp4Header() []byte {
	h := make([]byte, 32)
	copy(h[4:], "ftypisom")
	return h
}

func webmHeader() []byte {
	return append([]byte{0x1A, 0x45, 0xDF, 0xA3}, make([]byte, 28)...)
}

// isoHeader — ISO BMFF с заданным major brand в байтах 8:12.
func isoHeader(brand string) []byte {
	h := make([]byte, 32)
	copy(h[4:], "ftyp")
	copy(h[8:], brand)
	return h
}

// riffHeader — RIFF-контейнер: form-тип лежит в байтах 8:12.
func riffHeader(form string) []byte {
	h := make([]byte, 32)
	copy(h, "RIFF")
	copy(h[8:], form)
	return h
}

func TestDetectKind(t *testing.T) {
	tests := []struct {
		name            string
		head            []byte
		fileName        string
		wantKind        domain.AttachmentKind
		wantContentType string
	}{
		{
			name:            "png по сигнатуре",
			head:            []byte("\x89PNG\r\n\x1a\n" + string(make([]byte, 24))),
			fileName:        "pic.png",
			wantKind:        domain.AttachmentKindImage,
			wantContentType: "image/png",
		},
		{
			name:            "jpeg по сигнатуре",
			head:            append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, make([]byte, 28)...),
			fileName:        "pic.jpg",
			wantKind:        domain.AttachmentKindImage,
			wantContentType: "image/jpeg",
		},
		{
			name:            "mp4 по ftyp",
			head:            mp4Header(),
			fileName:        "clip.mp4",
			wantKind:        domain.AttachmentKindVideo,
			wantContentType: "video/mp4",
		},
		{
			name:            "m4a — тот же ftyp, но по расширению это аудио",
			head:            mp4Header(),
			fileName:        "song.m4a",
			wantKind:        domain.AttachmentKindAudio,
			wantContentType: "audio/mp4",
		},
		{
			name:            "webm по EBML и расширению — видео",
			head:            webmHeader(),
			fileName:        "clip.webm",
			wantKind:        domain.AttachmentKindVideo,
			wantContentType: "video/webm",
		},
		{
			name:            "ogg по OggS",
			head:            append([]byte("OggS"), make([]byte, 28)...),
			fileName:        "sound.ogg",
			wantKind:        domain.AttachmentKindAudio,
			wantContentType: "audio/ogg",
		},
		{
			name:            "flac",
			head:            append([]byte("fLaC"), make([]byte, 28)...),
			fileName:        "sound.flac",
			wantKind:        domain.AttachmentKindAudio,
			wantContentType: "audio/flac",
		},
		{
			name:            "mp3 с ID3-тегом",
			head:            append([]byte("ID3\x03\x00"), make([]byte, 27)...),
			fileName:        "song.mp3",
			wantKind:        domain.AttachmentKindAudio,
			wantContentType: "audio/mpeg",
		},
		{
			name:            "webp по сигнатуре RIFF/WEBP",
			head:            riffHeader("WEBPVP8 "),
			fileName:        "pic.webp",
			wantKind:        domain.AttachmentKindImage,
			wantContentType: "image/webp",
		},
		{
			name:            "bmp по сигнатуре",
			head:            append([]byte("BM\x36\x00"), make([]byte, 28)...),
			fileName:        "pic.bmp",
			wantKind:        domain.AttachmentKindImage,
			wantContentType: "image/bmp",
		},
		{
			name:            "avif — картинка, а не mp4, несмотря на ftyp",
			head:            isoHeader("avif"),
			fileName:        "pic.avif",
			wantKind:        domain.AttachmentKindImage,
			wantContentType: "image/avif",
		},
		{
			name:            "heic с айфона — тоже картинка",
			head:            isoHeader("heic"),
			fileName:        "IMG_0001.heic",
			wantKind:        domain.AttachmentKindImage,
			wantContentType: "image/heic",
		},
		{
			name:            "mif1 — базовый бренд HEIF",
			head:            isoHeader("mif1"),
			fileName:        "IMG_0002.heic",
			wantKind:        domain.AttachmentKindImage,
			wantContentType: "image/heic",
		},
		{
			name:            "mov по ftyp и расширению",
			head:            isoHeader("qt  "),
			fileName:        "clip.mov",
			wantKind:        domain.AttachmentKindVideo,
			wantContentType: "video/quicktime",
		},
		{
			name:            "mkv — тот же EBML, что и webm, разводится расширением",
			head:            webmHeader(),
			fileName:        "movie.mkv",
			wantKind:        domain.AttachmentKindVideo,
			wantContentType: "video/x-matroska",
		},
		{
			name:            "wav по RIFF/WAVE",
			head:            riffHeader("WAVEfmt "),
			fileName:        "sound.wav",
			wantKind:        domain.AttachmentKindAudio,
			wantContentType: "audio/wave",
		},
		{
			name:            "avi по RIFF/AVI",
			head:            riffHeader("AVI LIST"),
			fileName:        "clip.avi",
			wantKind:        domain.AttachmentKindVideo,
			wantContentType: "video/avi",
		},
		{
			name:            "pdf — это файл, а не медиа",
			head:            append([]byte("%PDF-1.7"), make([]byte, 24)...),
			fileName:        "doc.pdf",
			wantKind:        domain.AttachmentKindFile,
			wantContentType: "application/pdf",
		},
		{
			name:            "исполняемый файл, переименованный в jpg, остаётся файлом",
			head:            append([]byte("MZ\x90\x00"), make([]byte, 28)...),
			fileName:        "totally-a-photo.jpg",
			wantKind:        domain.AttachmentKindFile,
			wantContentType: "application/octet-stream",
		},
		{
			name:            "пустой заголовок не паникует",
			head:            nil,
			fileName:        "empty.bin",
			wantKind:        domain.AttachmentKindFile,
			wantContentType: "application/octet-stream",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			kind, ct := usecase.DetectKind(tt.head, tt.fileName)
			assert.Equal(t, tt.wantKind, kind)
			assert.Equal(t, tt.wantContentType, ct)
		})
	}
}

func TestDetectKindIgnoresExtensionWhenContentSaysOtherwise(t *testing.T) {
	// Расширение уточняет тип только внутри уже опознанного контейнера
	// (mp4 → видео или аудио). Оно не может превратить произвольные байты
	// в картинку — иначе .exe с именем .jpg отрендерится как <img>.
	kind, ct := usecase.DetectKind(append([]byte("MZ\x90\x00"), make([]byte, 28)...), "x.png")

	assert.Equal(t, domain.AttachmentKindFile, kind)
	assert.Equal(t, "application/octet-stream", ct)
}
