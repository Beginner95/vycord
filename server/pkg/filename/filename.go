// Package filename очищает пришедшее от пользователя имя файла так, чтобы его
// можно было и показать в интерфейсе, и отдать в Content-Disposition.
//
// Имя не участвует в формировании пути на диске (файл лежит под UUID), поэтому
// задача здесь не в защите файловой системы, а в том, чтобы имя не сломало
// HTTP-заголовок и не оказалось невалидным UTF-8.
package filename

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// maxBytes — предел длины имени. 255 байт — общий знаменатель файловых систем,
// в которые это имя в итоге сохранит пользователь.
const maxBytes = 255

// reserved — имена устройств Windows: файл с таким именем там не создать.
var reserved = map[string]bool{
	"con": true, "prn": true, "aux": true, "nul": true,
	"com1": true, "com2": true, "com3": true, "com4": true, "com5": true,
	"com6": true, "com7": true, "com8": true, "com9": true,
	"lpt1": true, "lpt2": true, "lpt3": true, "lpt4": true, "lpt5": true,
	"lpt6": true, "lpt7": true, "lpt8": true, "lpt9": true,
}

// Sanitize заменяет недопустимые символы на "_", схлопывает повторы, режет до
// 255 байт по границе руны и гарантирует непустой результат.
func Sanitize(name string) string {
	var b strings.Builder
	for _, r := range name {
		switch {
		case r == utf8.RuneError:
			// Битая последовательность в исходном имени: пропускаем, иначе
			// результат окажется невалидным UTF-8.
			continue
		case r == '/' || r == '\\':
			b.WriteRune('_')
		case r == '"' || r == '\'' || r == ';' || r == ':':
			// Иначе можно испортить Content-Disposition; двоеточие вдобавок
			// недопустимо в именах на Windows.
			b.WriteRune('_')
		case unicode.IsControl(r):
			b.WriteRune('_')
		default:
			b.WriteRune(r)
		}
	}

	out := b.String()

	// Схлопываем подряд идущие подчёркивания, чтобы "///" не превращалось в "___".
	for strings.Contains(out, "__") {
		out = strings.ReplaceAll(out, "__", "_")
	}

	out = strings.TrimSpace(out)
	out = truncateBytes(out, maxBytes)
	out = strings.TrimSpace(out)

	if isEmptyName(out) {
		return "file"
	}

	if reserved[strings.ToLower(stem(out))] {
		return "_" + out
	}

	return out
}

// truncateBytes режет строку до limit байт, не разрывая руну.
func truncateBytes(s string, limit int) string {
	if len(s) <= limit {
		return s
	}
	cut := s[:limit]
	for len(cut) > 0 && !utf8.ValidString(cut) {
		cut = cut[:len(cut)-1]
	}
	return cut
}

// isEmptyName — имя, из которого нечего показать: пусто, одни точки или одни
// подчёркивания после замен.
func isEmptyName(s string) bool {
	trimmed := strings.Trim(s, "._ ")
	return trimmed == ""
}

// stem — имя без последнего расширения.
func stem(s string) string {
	if i := strings.LastIndex(s, "."); i > 0 {
		return s[:i]
	}
	return s
}
