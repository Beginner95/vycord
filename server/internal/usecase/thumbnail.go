package usecase

import (
	"bytes"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"

	_ "golang.org/x/image/bmp"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

// maxThumbSide — по этой стороне ужимается миниатюра. 400 px хватает для
// ленты на HiDPI и даёт файл в десятки килобайт вместо десятков мегабайт.
const maxThumbSide = 400

// thumbQuality — качество JPEG миниатюры.
const thumbQuality = 82

// maxImagePixels — потолок на площадь картинки, которую мы готовы развернуть
// в память. Ограничение на размер файла тут не помогает: PNG со сплошной
// заливкой 20000×20000 весит единицы мегабайт, а в памяти занимает ~1.6 ГБ, и
// несколько параллельных загрузок кладут процесс целиком. 50 Мп — заведомо
// больше любой камеры и скриншота, но на два порядка меньше опасного.
const maxImagePixels = 50 * 1000 * 1000

// decodableImageTypes — типы картинок, для которых у нас есть декодер.
// Отличать их важно: провал AnalyzeImage на таком типе означает битый или
// непомерно большой файл, а на avif/heic — всего лишь отсутствие декодера.
var decodableImageTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/gif":  true,
	"image/webp": true,
	"image/bmp":  true,
}

// DecodableImage сообщает, умеет ли AnalyzeImage разбирать такой content-type.
func DecodableImage(contentType string) bool { return decodableImageTypes[contentType] }

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
//
// Декодеры подключены на png, jpeg, gif, webp и bmp. AVIF и HEIC декодера в
// экосистеме без cgo нет — для них вернётся false, и вызывающий оставит
// вложение картинкой без размеров и миниатюры (см. AttachmentUseCase.Upload):
// в ленте покажется оригинал.
//
// Слишком большие по площади картинки тоже дают false: развернуть их в память
// дороже, чем показать карточкой файла.
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

	// Сначала только заголовок: размеры известны до того, как под пиксели
	// выделена хоть одна страница памяти. recover() ниже ловит панику декодера,
	// но от OOM он не спасает — процесс убивают снаружи.
	cfg, _, err := image.DecodeConfig(r)
	if err != nil {
		return nil, false
	}
	if cfg.Width <= 0 || cfg.Height <= 0 ||
		int64(cfg.Width)*int64(cfg.Height) > maxImagePixels {
		return nil, false
	}

	// DecodeConfig прочитал заголовок — Decode должен начать с начала файла.
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
