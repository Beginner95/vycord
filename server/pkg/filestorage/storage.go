// Package filestorage abstracts where uploaded files (avatars today, other
// attachments later) are physically stored, so the backend can move from
// local disk to an object store without touching callers.
package filestorage

import (
	"context"
	"errors"
	"io"
)

// ErrNotFound — файла с таким ключом в хранилище нет.
var ErrNotFound = errors.New("file not found in storage")

// Storage адресует файлы ключом: Save сохраняет файл под key и возвращает
// URL, по которому его отдаёт клиентам, а Open читает содержимое обратно по
// тому же key. Delete дополнительно принимает URL, который вернул Save, —
// ради обратной совместимости с вызывающим кодом (аватары, иконки,
// стикеры), который знает только URL, а не ключ.
//
// key is always constructed by the caller from trusted, server-generated
// values (e.g. a user ID + random suffix) — implementations do not sanitize
// it against path traversal.
type Storage interface {
	// Save reads all of r and stores it under key, returning the URL clients
	// can use to fetch the file.
	Save(ctx context.Context, key string, r io.Reader, contentType string) (url string, err error)
	// Delete удаляет файл, сохранённый ранее под url, который вернул Save,
	// либо под голым ключом (так адресуются вложения). Удаление
	// несуществующего файла ошибкой не считается.
	Delete(ctx context.Context, url string) error
	// Open отдаёт содержимое файла по ключу. Возвращает ReadSeekCloser, а не
	// ReadCloser, потому что http.ServeContent без Seek не умеет Range —
	// без него не перемотать видео и аудио. Если файла нет — ErrNotFound.
	Open(ctx context.Context, key string) (io.ReadSeekCloser, error)
}
