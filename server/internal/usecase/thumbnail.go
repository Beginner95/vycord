package usecase

import (
	"bytes"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"

	"golang.org/x/image/draw"
)

// maxThumbSide — по этой стороне ужимается миниатюра. 400 px хватает для
// ленты на HiDPI и даёт файл в десятки килобайт вместо десятков мегабайт.
const maxThumbSide = 400

// thumbQuality — качество JPEG миниатюры.
const thumbQuality = 82

// ImageMeta — то, что удалось узнать о картинке. Thumb == nil означает, что
// миниатюра не нужна: оригинал и так мелкий.
type ImageMeta struct {
	Width, Height    int
	Thumb            []byte
	ThumbExt         string
	ThumbContentType string
}

// AnalyzeImage читает картинку целиком, отдаёт её размеры и, если она крупная,
// миниатюру. Второе значение false означает, что это не декодируемая нами
// картинка — вызывающий обязан понизить вложение до kind=file, а не отвергать
// запрос: политика одна и та же для всего, что не удалось опознать как медиа.
//
// Читатель перематывается в начало: этот же файл потом уходит в хранилище.
// WebP и AVIF stdlib не декодирует — для них вернётся false, и вложение
// останется картинкой только если тип уже определён по сигнатуре, но без
// миниатюры (см. вызывающий код в AttachmentUseCase.Upload).
func AnalyzeImage(r io.ReadSeeker) (meta *ImageMeta, ok bool) {
	defer func() {
		// Декодеры картинок — известный источник паник на битых данных.
		// Падать из-за чужого файла нельзя.
		if rec := recover(); rec != nil {
			meta, ok = nil, false
		}
		_, _ = r.Seek(0, io.SeekStart)
	}()

	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return nil, false
	}

	img, _, err := image.Decode(r)
	if err != nil {
		return nil, false
	}

	b := img.Bounds()
	meta = &ImageMeta{Width: b.Dx(), Height: b.Dy()}

	longest := b.Dx()
	if b.Dy() > longest {
		longest = b.Dy()
	}
	if longest <= maxThumbSide {
		return meta, true
	}

	scale := float64(maxThumbSide) / float64(longest)
	tw := int(float64(b.Dx()) * scale)
	th := int(float64(b.Dy()) * scale)
	if tw < 1 {
		tw = 1
	}
	if th < 1 {
		th = 1
	}

	dst := image.NewRGBA(image.Rect(0, 0, tw, th))
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, b, draw.Over, nil)

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: thumbQuality}); err != nil {
		// Размеры уже известны и полезны сами по себе — отдаём их без миниатюры.
		return meta, true
	}

	meta.Thumb = buf.Bytes()
	meta.ThumbExt = "jpg"
	meta.ThumbContentType = "image/jpeg"
	return meta, true
}
