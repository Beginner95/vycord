package usecase_test

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/vycord/server/internal/usecase"
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
