package httperr

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestWrite_IncludesBothErrorAndCode(t *testing.T) {
	rec := httptest.NewRecorder()

	Write(rec, http.StatusForbidden, CodeForbidden, "access denied")

	assert.Equal(t, http.StatusForbidden, rec.Code)
	assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))

	var body map[string]string
	assert.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))

	// Поле error обязано сохранить прежний формат — от этого зависит
	// обратная совместимость со старыми клиентами.
	assert.Equal(t, "access denied", body["error"])
	assert.Equal(t, "forbidden", body["code"])
}

func TestWrite_PreservesArbitraryStatus(t *testing.T) {
	rec := httptest.NewRecorder()

	Write(rec, http.StatusRequestEntityTooLarge, CodeAvatarTooLarge, "avatar file is too large")

	assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)

	var body map[string]string
	assert.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "avatar_file_too_large", body["code"])
}
