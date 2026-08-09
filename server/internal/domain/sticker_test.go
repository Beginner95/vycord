package domain

import "testing"

func TestStickerErrors(t *testing.T) {
	if ErrStickerNotFound == nil || ErrStickerForbidden == nil ||
		ErrStickerNameRequired == nil || ErrStickerNameTooLong == nil {
		t.Fatal("sticker sentinel errors must be defined")
	}
	if ErrStickerNotFound == ErrForbidden {
		t.Fatal("ErrStickerNotFound must differ from ErrForbidden")
	}
}