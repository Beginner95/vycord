package filestorage_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/pkg/filestorage"
)

func TestLocal_SaveThenDelete(t *testing.T) {
	dir := t.TempDir()
	storage, err := filestorage.NewLocal(dir, "/uploads")
	require.NoError(t, err)

	url, err := storage.Save(context.Background(), "avatars/u1/abc.jpg", strings.NewReader("fake-jpeg-bytes"), "image/jpeg")
	require.NoError(t, err)
	assert.Equal(t, "/uploads/avatars/u1/abc.jpg", url)

	data, err := os.ReadFile(filepath.Join(dir, "avatars", "u1", "abc.jpg"))
	require.NoError(t, err)
	assert.Equal(t, "fake-jpeg-bytes", string(data))

	err = storage.Delete(context.Background(), url)
	require.NoError(t, err)

	_, err = os.Stat(filepath.Join(dir, "avatars", "u1", "abc.jpg"))
	assert.True(t, os.IsNotExist(err))
}

func TestLocal_DeleteNonexistentKeyIsNotAnError(t *testing.T) {
	dir := t.TempDir()
	storage, err := filestorage.NewLocal(dir, "/uploads")
	require.NoError(t, err)

	err = storage.Delete(context.Background(), "/uploads/avatars/missing.jpg")
	assert.NoError(t, err)
}

func TestLocal_SaveCreatesRootDirIfMissing(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "nested", "uploads")
	_, err := filestorage.NewLocal(dir, "/uploads")
	require.NoError(t, err)

	info, err := os.Stat(dir)
	require.NoError(t, err)
	assert.True(t, info.IsDir())
}
