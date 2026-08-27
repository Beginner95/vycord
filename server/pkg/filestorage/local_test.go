package filestorage_test

import (
	"context"
	"io"
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

func TestLocal_OpenReturnsSavedContent(t *testing.T) {
	dir := t.TempDir()
	storage, err := filestorage.NewLocal(dir, "/uploads")
	require.NoError(t, err)

	_, err = storage.Save(context.Background(), "attachments/c1/abc.bin", strings.NewReader("hello-bytes"), "application/octet-stream")
	require.NoError(t, err)

	f, err := storage.Open(context.Background(), "attachments/c1/abc.bin")
	require.NoError(t, err)
	defer f.Close()

	data, err := io.ReadAll(f)
	require.NoError(t, err)
	assert.Equal(t, "hello-bytes", string(data))
}

func TestLocal_OpenIsSeekable(t *testing.T) {
	// Без Seek не работает http.ServeContent, а значит нет Range-запросов и
	// перемотки видео.
	dir := t.TempDir()
	storage, err := filestorage.NewLocal(dir, "/uploads")
	require.NoError(t, err)

	_, err = storage.Save(context.Background(), "a.bin", strings.NewReader("0123456789"), "application/octet-stream")
	require.NoError(t, err)

	f, err := storage.Open(context.Background(), "a.bin")
	require.NoError(t, err)
	defer f.Close()

	_, err = f.Seek(5, io.SeekStart)
	require.NoError(t, err)

	rest, err := io.ReadAll(f)
	require.NoError(t, err)
	assert.Equal(t, "56789", string(rest))
}

func TestLocal_OpenMissingKeyReturnsErrNotFound(t *testing.T) {
	dir := t.TempDir()
	storage, err := filestorage.NewLocal(dir, "/uploads")
	require.NoError(t, err)

	_, err = storage.Open(context.Background(), "nope.bin")

	assert.ErrorIs(t, err, filestorage.ErrNotFound)
}

func TestLocal_OpenDirectoryIsNotFound(t *testing.T) {
	// Save создаёт промежуточные каталоги, поэтому ключ может указать на
	// каталог. os.Open такой ключ открывает без ошибки — ловим это сами.
	dir := t.TempDir()
	storage, err := filestorage.NewLocal(dir, "/uploads")
	require.NoError(t, err)

	_, err = storage.Save(context.Background(), "attachments/c1/a.bin", strings.NewReader("x"), "application/octet-stream")
	require.NoError(t, err)

	_, err = storage.Open(context.Background(), "attachments/c1")

	assert.ErrorIs(t, err, filestorage.ErrNotFound)
}

func TestLocal_DeleteAcceptsBareKey(t *testing.T) {
	// Вложения адресуются ключом: в БД хранится storage_key, а не URL.
	dir := t.TempDir()
	storage, err := filestorage.NewLocal(dir, "/uploads")
	require.NoError(t, err)

	_, err = storage.Save(context.Background(), "attachments/c1/a.bin", strings.NewReader("x"), "application/octet-stream")
	require.NoError(t, err)

	require.NoError(t, storage.Delete(context.Background(), "attachments/c1/a.bin"))

	_, err = os.Stat(filepath.Join(dir, "attachments", "c1", "a.bin"))
	assert.True(t, os.IsNotExist(err))
}

func TestLocal_DeleteStillAcceptsURL(t *testing.T) {
	dir := t.TempDir()
	storage, err := filestorage.NewLocal(dir, "/uploads")
	require.NoError(t, err)

	url, err := storage.Save(context.Background(), "avatars/u1/a.jpg", strings.NewReader("x"), "image/jpeg")
	require.NoError(t, err)

	require.NoError(t, storage.Delete(context.Background(), url))

	_, err = os.Stat(filepath.Join(dir, "avatars", "u1", "a.jpg"))
	assert.True(t, os.IsNotExist(err))
}

func TestLocal_SaveCreatesRootDirIfMissing(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "nested", "uploads")
	_, err := filestorage.NewLocal(dir, "/uploads")
	require.NoError(t, err)

	info, err := os.Stat(dir)
	require.NoError(t, err)
	assert.True(t, info.IsDir())
}
