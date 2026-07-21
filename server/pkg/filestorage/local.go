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

func (s *Local) Delete(_ context.Context, url string) error {
	key := strings.TrimPrefix(url, s.urlPrefix+"/")
	if key == url {
		return fmt.Errorf("url %q does not belong to this storage", url)
	}

	path := filepath.Join(s.rootDir, filepath.FromSlash(key))
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("delete file %s: %w", key, err)
	}
	return nil
}
