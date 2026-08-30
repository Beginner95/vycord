package main

import (
	"net/http"
	"path"
	"strings"
)

// publicUploadPrefixes — то, что исторически раздаётся статикой и публично по
// замыслу: аватары, иконки серверов, стикеры. Вложения сюда НЕ входят: доступ
// к ним даёт только подписанная ссылка (см. pkg/attachlink), а FileServer к
// тому же поставил бы Content-Type по расширению из пользовательского имени
// файла — загруженный .html исполнился бы на домене API.
var publicUploadPrefixes = []string{"avatars/", "server-icons/", "stickers/"}

// newUploadsHandler отдаёт файлы из uploadDir, но только из публичных
// подкаталогов. Список белый, а не чёрный: новый приватный подкаталог не
// должен утечь просто потому, что про него забыли.
//
// Путь приходит уже без префикса "/uploads/" (см. http.StripPrefix у вызова).
func newUploadsHandler(uploadDir string) http.Handler {
	fileServer := http.FileServer(http.Dir(uploadDir))

	return http.StripPrefix("/uploads/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "" || strings.HasSuffix(r.URL.Path, "/") {
			http.NotFound(w, r)
			return
		}
		if !isPublicUploadPath(r.URL.Path) {
			http.NotFound(w, r)
			return
		}
		fileServer.ServeHTTP(w, r)
	}))
}

// isPublicUploadPath отвечает, лежит ли путь в публичном подкаталоге.
//
// Путь сначала нормализуется ровно так же, как это делает http.FileServer:
// иначе "avatars/../attachments/x" прошло бы проверку, а отдался бы файл
// вложения. ServeMux обычно чистит путь и сам, но полагаться на вызывающего
// в проверке доступа нельзя.
func isPublicUploadPath(p string) bool {
	p = strings.TrimPrefix(path.Clean("/"+strings.TrimLeft(p, "/")), "/")
	for _, prefix := range publicUploadPrefixes {
		if strings.HasPrefix(p, prefix) {
			return true
		}
	}
	return false
}
