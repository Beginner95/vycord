package filestorage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Local stores files on the local filesystem under rootDir and serves them
// back under urlPrefix (see cmd/api's "GET /uploads/" static route).
type Local struct {
	rootDir   string
	urlPrefix string
}

// NewLocal returns a Local storage rooted at rootDir, creating the directory
// if it does not exist yet. Saved files are addressable at
// urlPrefix + "/" + key.
func NewLocal(rootDir, urlPrefix string) (*Local, error) {
	if err := os.MkdirAll(rootDir, 0o755); err != nil {
		return nil, fmt.Errorf("create upload dir: %w", err)
	}
	return &Local{
		rootDir:   rootDir,
		urlPrefix: strings.TrimSuffix(urlPrefix, "/"),
	}, nil
}

func (s *Local) Save(_ context.Context, key string, r io.Reader, _ string) (string, error) {
	path := filepath.Join(s.rootDir, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", fmt.Errorf("create dir for %s: %w", key, err)
	}

	f, err := os.Create(path)
	if err != nil {
		return "", fmt.Errorf("create file %s: %w", key, err)
	}
	defer f.Close()

	if _, err := io.Copy(f, r); err != nil {
		return "", fmt.Errorf("write file %s: %w", key, err)
	}

	return s.urlPrefix + "/" + key, nil
}

func (s *Local) Open(_ context.Context, key string) (io.ReadSeekCloser, error) {
	path := filepath.Join(s.rootDir, filepath.FromSlash(key))

	f, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil, fmt.Errorf("open %s: %w", key, ErrNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("open file %s: %w", key, err)
	}

	// os.Open на директории не возвращает ошибку вовсе: без этой проверки
	// наружу ушёл бы «успешный» ReadSeekCloser, у которого падает первый же
	// Read — далеко от причины. Save создаёт промежуточные каталоги, так что
	// ключ вполне может указать на каталог.
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		f.Close()
		return nil, fmt.Errorf("open %s: %w", key, ErrNotFound)
	}

	return f, nil
}

// Delete принимает и URL, который вернул Save (так удаляются аватары, иконки
// и стикеры), и голый ключ (так адресуются вложения: в БД лежит storage_key,
// а не URL). Удаление несуществующего файла ошибкой не считается.
func (s *Local) Delete(_ context.Context, urlOrKey string) error {
	key := strings.TrimPrefix(urlOrKey, s.urlPrefix+"/")

	path := filepath.Join(s.rootDir, filepath.FromSlash(key))
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("delete file %s: %w", key, err)
	}
	return nil
}
