package usecase_test

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/vycord/server/internal/usecase"
	"golang.org/x/image/bmp"
)

func pngBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			img.Set(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: 128, A: 255})
		}
	}
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, img))
	return buf.Bytes()
}

func TestAnalyzeImageReturnsDimensions(t *testing.T) {
	meta, ok := usecase.AnalyzeImage(bytes.NewReader(pngBytes(t, 800, 600)))

	require.True(t, ok)
	assert.Equal(t, 800, meta.Width)
	assert.Equal(t, 600, meta.Height)
}

func TestAnalyzeImageMakesThumbnailForLargeImage(t *testing.T) {
	meta, ok := usecase.AnalyzeImage(bytes.NewReader(pngBytes(t, 1200, 600)))

	require.True(t, ok)
	require.NotNil(t, meta.Thumb, "для большой картинки миниатюра обязательна")
	assert.Equal(t, "jpg", meta.ThumbExt)
	assert.Equal(t, "image/jpeg", meta.ThumbContentType)

	cfg, err := jpeg.DecodeConfig(bytes.NewReader(meta.Thumb))
	require.NoError(t, err)
	// Большая сторона ужата до 400, пропорции сохранены.
	assert.Equal(t, 400, cfg.Width)
	assert.Equal(t, 200, cfg.Height)
}

func TestAnalyzeImageSkipsThumbnailForSmallImage(t *testing.T) {
	// Уменьшать нечего: миниатюра была бы больше оригинала по накладным расходам.
	meta, ok := usecase.AnalyzeImage(bytes.NewReader(pngBytes(t, 320, 240)))

	require.True(t, ok)
	assert.Nil(t, meta.Thumb)
	assert.Equal(t, 320, meta.Width)
}

func TestAnalyzeImageRejectsNonImage(t *testing.T) {
	// Не ошибка запроса: вызывающий понизит вложение до kind=file.
	_, ok := usecase.AnalyzeImage(bytes.NewReader([]byte("this is definitely not an image")))

	assert.False(t, ok)
}

func TestAnalyzeImageRejectsTruncatedImage(t *testing.T) {
	full := pngBytes(t, 800, 600)

	_, ok := usecase.AnalyzeImage(bytes.NewReader(full[:len(full)/3]))

	assert.False(t, ok)
}

func TestAnalyzeImageRewindsReader(t *testing.T) {
	// После анализа вызывающий сохраняет тот же файл в хранилище, поэтому
	// позиция обязана вернуться в начало.
	data := pngBytes(t, 500, 500)
	r := bytes.NewReader(data)

	_, ok := usecase.AnalyzeImage(r)
	require.True(t, ok)

	rest := make([]byte, 8)
	n, err := r.Read(rest)
	require.NoError(t, err)
	assert.Equal(t, data[:n], rest[:n], "чтение обязано начаться с начала файла")
}

// largeValidPNG собирает НАСТОЯЩУЮ картинку заданных размеров — с корректными
// данными пикселей, которая честно декодируется.
//
// Это принципиально для теста на потолок площади. Заголовок-обманка (IHDR с
// огромными размерами и без данных) не годится: декодер валится на обрыве
// потока раньше, чем дело дошло бы до потолка, и такой тест остаётся зелёным
// даже если защиту убрать. С настоящей картинкой тест падает ровно тогда,
// когда убирают защиту, — и только тогда.
//
// Оттенки серого и сплошная заливка выбраны ради стоимости: 8000×8000 занимает
// 64 МБ в памяти против 256 МБ у RGBA, а сжимается в единицы килобайт.
func largeValidPNG(t *testing.T, w, h int) []byte {
	t.Helper()

	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, image.NewGray(image.Rect(0, 0, w, h))))
	return buf.Bytes()
}

func TestAnalyzeImageRejectsOversizedImage(t *testing.T) {
	// 8000×8000 — это 64 Мп при потолке в 50 Мп. Картинка настоящая и
	// декодируется, поэтому без потолка AnalyzeImage вернул бы ok=true.
	//
	// Отказ обязан случиться на заголовке, до выделения памяти под пиксели:
	// иначе несколько параллельных загрузок кладут процесс, а recover() тут
	// не поможет — OOM он не ловит.
	_, ok := usecase.AnalyzeImage(bytes.NewReader(largeValidPNG(t, 8000, 8000)))

	assert.False(t, ok)
}

func TestAnalyzeImageAcceptsImageUnderPixelLimit(t *testing.T) {
	// Проверяем, что предел не задевает нормальные картинки: отказ должен
	// приходить именно от размеров, а не от того, что после DecodeConfig
	// забыли перемотать ридер.
	meta, ok := usecase.AnalyzeImage(bytes.NewReader(pngBytes(t, 900, 700)))

	require.True(t, ok)
	assert.Equal(t, 900, meta.Width)
	assert.Equal(t, 700, meta.Height)
}

func TestAnalyzeImageDecodesBMP(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 640, 480))
	var buf bytes.Buffer
	require.NoError(t, bmp.Encode(&buf, img))

	meta, ok := usecase.AnalyzeImage(bytes.NewReader(buf.Bytes()))

	require.True(t, ok, "bmp объявлен поддерживаемым форматом — он обязан декодироваться")
	assert.Equal(t, 640, meta.Width)
	assert.Equal(t, 480, meta.Height)
}

func TestAnalyzeImageDecodesWebP(t *testing.T) {
	// Минимальный настоящий 1×1 WebP: генератора в x/image нет, только декодер.
	data, err := base64.StdEncoding.DecodeString(
		"UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAQAcJaQAA3AA/v3AgAA=")
	require.NoError(t, err)

	meta, ok := usecase.AnalyzeImage(bytes.NewReader(data))

	require.True(t, ok, "webp объявлен поддерживаемым форматом — он обязан декодироваться")
	assert.Equal(t, 1, meta.Width)
	assert.Nil(t, meta.Thumb)
}

func TestDecodableImageCoversDeclaredFormats(t *testing.T) {
	// Разделение важно для Upload: провал декодирования png означает битый
	// файл (понижаем до kind=file), а провал на avif — лишь отсутствие
	// декодера (вложение остаётся картинкой без миниатюры).
	for _, ct := range []string{"image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"} {
		assert.True(t, usecase.DecodableImage(ct), ct)
	}
	for _, ct := range []string{"image/avif", "image/heic"} {
		assert.False(t, usecase.DecodableImage(ct), ct)
	}
}
