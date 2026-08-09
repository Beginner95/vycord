package usecase

import (
	"bytes"
	"image"
	"image/color"
	"image/gif"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/domain"
)

func fakeGIFBytes(width, height int) []byte {
	img := image.NewPaletted(image.Rect(0, 0, width, height), color.Palette{
		color.RGBA{R: 200, G: 100, B: 50, A: 255},
	})
	var buf bytes.Buffer
	_ = gif.Encode(&buf, img, nil)
	return buf.Bytes()
}

func TestValidateImage_GIF(t *testing.T) {
	ext, contentType, err := validateImage(fakeGIFBytes(64, 64))
	require.NoError(t, err)
	assert.Equal(t, "gif", ext)
	assert.Equal(t, "image/gif", contentType)
}

func TestValidateImage_Unsupported(t *testing.T) {
	_, _, err := validateImage([]byte("not an image at all"))
	require.ErrorIs(t, err, domain.ErrUnsupportedAvatarFormat)
}