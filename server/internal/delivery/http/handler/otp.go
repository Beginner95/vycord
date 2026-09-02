package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"

	"github.com/vycord/server/internal/delivery/http/httperr"
	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/domain"
)

// otpCodeRegex — ровно 4 десятичные цифры. Проверка формата до похода в
// юзкейс экономит запрос к БД на заведомо мусорном вводе и не тратит попытку.
var otpCodeRegex = regexp.MustCompile(`^[0-9]{4}$`)

type OTPHandler struct {
	otpUseCase domain.OTPUseCase
	log        *slog.Logger
}

func NewOTPHandler(otpUseCase domain.OTPUseCase, log *slog.Logger) *OTPHandler {
	return &OTPHandler{otpUseCase: otpUseCase, log: log}
}

type otpRequestBody struct {
	Email string `json:"email"`
}

type otpVerifyBody struct {
	Email    string `json:"email"`
	Code     string `json:"code"`
	Username string `json:"username"`
}

// RequestCode выпускает и отправляет код. Ответ ВСЕГДА одинаковый —
// 202 otp_sent — вне зависимости от того, существует ли email: это и есть
// смысл identifier-first, ответ API не должен палить существование аккаунта.
func (h *OTPHandler) RequestCode(w http.ResponseWriter, r *http.Request) {
	var req otpRequestBody
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
		return
	}
	if !emailRegex.MatchString(req.Email) {
		httperr.Write(w, http.StatusBadRequest, httperr.CodeInvalidEmail, "invalid email format")
		return
	}

	if err := h.otpUseCase.RequestCode(req.Email); err != nil {
		h.writeOTPError(w, r, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{"status": "otp_sent"})
}

// Verify проверяет код. Три исхода: токены (вход или только что созданный
// аккаунт), {"status":"username_required"} (email новый, нужен ещё один
// вызов с тем же code и заполненным username), либо ошибка.
func (h *OTPHandler) Verify(w http.ResponseWriter, r *http.Request) {
	var req otpVerifyBody
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
		return
	}
	if req.Code == "" {
		httperr.Write(w, http.StatusBadRequest, httperr.CodeOTPRequired, "code is required")
		return
	}
	if !otpCodeRegex.MatchString(req.Code) {
		httperr.Write(w, http.StatusBadRequest, httperr.CodeInvalidOTPFormat, "code must be 4 digits")
		return
	}
	if req.Username != "" && !usernameRegex.MatchString(req.Username) {
		httperr.Write(w, http.StatusBadRequest, httperr.CodeInvalidUsername, "username must be 3-30 characters, alphanumeric, underscore or hyphen only")
		return
	}

	user, accessToken, refreshToken, err := h.otpUseCase.VerifyCode(req.Email, req.Code, req.Username)
	if err != nil {
		if errors.Is(err, domain.ErrUsernameRequired) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]string{"status": "username_required"})
			return
		}
		h.writeOTPError(w, r, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"user":          user,
	})
}

// writeOTPError переводит доменные ошибки в HTTP. Порядок веток важен:
// OTPAttemptError оборачивает ErrOTPInvalid, поэтому проверяется раньше.
func (h *OTPHandler) writeOTPError(w http.ResponseWriter, r *http.Request, err error) {
	var throttled *domain.OTPThrottledError
	if errors.As(err, &throttled) {
		writeOTPThrottled(w, throttled)
		return
	}

	var attemptErr *domain.OTPAttemptError
	if errors.As(err, &attemptErr) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":         "invalid or expired code",
			"code":          httperr.CodeOTPInvalid,
			"attempts_left": attemptErr.AttemptsLeft,
		})
		return
	}

	switch {
	case errors.Is(err, domain.ErrOTPAttemptsExceeded):
		httperr.Write(w, http.StatusUnauthorized, httperr.CodeOTPAttemptsExceeded, "too many invalid attempts, request a new code")
	case errors.Is(err, domain.ErrOTPInvalid):
		httperr.Write(w, http.StatusUnauthorized, httperr.CodeOTPInvalid, "invalid or expired code")
	case errors.Is(err, domain.ErrUsernameTaken):
		httperr.Write(w, http.StatusConflict, httperr.CodeUsernameTaken, "username is taken")
	case errors.Is(err, domain.ErrMailSendFailed):
		httperr.Write(w, http.StatusBadGateway, httperr.CodeMailSendFailed, "failed to send the code, try again")
	default:
		// Сам код в лог не попадает — только идентификатор запроса.
		h.log.Error("otp request failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		httperr.Write(w, http.StatusInternalServerError, httperr.CodeInternalError, "internal error")
	}
}

// writeOTPThrottled — единственное место, формирующее ответ на отказ по
// лимиту OTP.
func writeOTPThrottled(w http.ResponseWriter, throttled *domain.OTPThrottledError) {
	w.Header().Set("Retry-After", strconv.Itoa(int(throttled.RetryAfter.Seconds())))
	code := httperr.CodeOTPCooldown
	if throttled.Hourly {
		code = httperr.CodeOTPRateLimited
	}
	httperr.Write(w, http.StatusTooManyRequests, code, "too many requests, try again later")
}
