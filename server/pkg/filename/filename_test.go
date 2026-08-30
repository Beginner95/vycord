package filename_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/vycord/server/pkg/filename"
)

func TestSanitize(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"обычное имя не трогаем", "report.pdf", "report.pdf"},
		{"кириллица сохраняется", "Отчёт за март.pdf", "Отчёт за март.pdf"},
		{"скобки и дефисы сохраняются", "photo (1) [final]-v2.jpg", "photo (1) [final]-v2.jpg"},
		{"разделители путей", "../../etc/passwd", ".._.._etc_passwd"},
		{"обратный слэш и двоеточие", `C:\Users\vaha\file.txt`, "C_Users_vaha_file.txt"},
		{"нулевой байт", "evil\x00.jpg", "evil_.jpg"},
		{"перевод строки не даёт подделать заголовок", "a\r\nContent-Length: 0.jpg", "a_Content-Length_ 0.jpg"},
		{"кавычки", `my "file".txt`, "my _file_.txt"},
		{"схлопывание подчёркиваний", "a///b", "a_b"},
		{"пустая строка", "", "file"},
		{"только точки", "...", "file"},
		{"только недопустимые символы", "///", "file"},
		{"зарезервированное windows-имя", "CON.txt", "_CON.txt"},
		{"зарезервированное без расширения", "nul", "_nul"},
		{"COM9 зарезервировано", "COM9.log", "_COM9.log"},
		{"COM10 не зарезервировано", "COM10.log", "COM10.log"},
		{"пробелы по краям срезаются", "  file.txt  ", "file.txt"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, filename.Sanitize(tt.in))
		})
	}
}

func TestSanitizeTruncatesToValidUTF8(t *testing.T) {
	// 200 кириллических рун — это 400 байт: обрезка обязана резать по границе
	// руны, иначе имя станет невалидным UTF-8 и сломает JSON и заголовок.
	in := strings.Repeat("я", 200) + ".jpg"

	got := filename.Sanitize(in)

	assert.LessOrEqual(t, len(got), 255)
	assert.True(t, utf8ValidString(got), "результат обязан быть валидным UTF-8")
	assert.NotEmpty(t, got)
}

func TestSanitizeReservedNameStillFitsLimit(t *testing.T) {
	// Префикс "_" добавляется после обрезки, поэтому имя, чей обрезанный
	// корень оказался зарезервированным, легко вылезает за 255 байт.
	in := "nul." + strings.Repeat("a", 300)

	got := filename.Sanitize(in)

	assert.LessOrEqual(t, len(got), 255)
	assert.True(t, strings.HasPrefix(got, "_nul."))
}

func utf8ValidString(s string) bool {
	for _, r := range s {
		if r == '\uFFFD' {
			return false
		}
	}
	return true
}
