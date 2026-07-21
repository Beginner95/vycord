// Package filestorage abstracts where uploaded files (avatars today, other
// attachments later) are physically stored, so the backend can move from
// local disk to an object store without touching callers.
package filestorage

import (
	"context"
	"io"
)

// Storage saves and deletes files by an opaque URL. Save assigns the file a
// URL derived from key; Delete removes whatever Save previously returned —
// callers never need to know the underlying key format.
//
// key is always constructed by the caller from trusted, server-generated
// values (e.g. a user ID + random suffix) — implementations do not sanitize
// it against path traversal.
type Storage interface {
	// Save reads all of r and stores it under key, returning the URL clients
	// can use to fetch the file.
	Save(ctx context.Context, key string, r io.Reader, contentType string) (url string, err error)
	// Delete removes the file previously saved at url. Deleting a URL that
	// does not exist is not an error.
	Delete(ctx context.Context, url string) error
}
