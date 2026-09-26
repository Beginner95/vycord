// Package phonecrypto — шифрование номеров телефонов (VYC-97).
//
// Номер в открытом виде не хранится нигде: в users лежат только
// phone_index (детерминированный HMAC-SHA256-ключ — по нему идёт поиск и
// проверка уникальности) и phone_cipher (AES-256-GCM со случайным nonce —
// расшифровать можно только с ключом). Ключ — PHONE_ENC_KEY из окружения,
// ровно 32 байта, один на все номера (это секрет, не хранить в коде/БД).
package phonecrypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"
)

// ErrInvalidPhone — строка не является нормализуемым телефонным номером.
var ErrInvalidPhone = errors.New("invalid phone number")

// indexPrefix отделяет телефонные индексы от любых других HMAC-сущностей в
// будущем: один ключ на два разных применения — дыра в конструкциях HMAC.
const indexPrefix = "phone:"

var phoneRe = regexp.MustCompile(`^\+[0-9]{10,14}$`)

// Normalize приводит номер к каноничной форме E.164-фрагмента "+7XXXXXXXXXX":
// убирает пробелы/тире/скобки, заменяет ведущую 8 на +7, оставляет только
// допустимые символы. Итог обязан быть `+` + 10..14 цифр.
func Normalize(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", ErrInvalidPhone
	}
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9', r == '+':
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '(' || r == ')':
			// разделители пропускаем
		default:
			return "", ErrInvalidPhone
		}
	}
	s = b.String()
	if strings.HasPrefix(s, "8") {
		s = "+7" + s[1:]
	}
	if !phoneRe.MatchString(s) {
		return "", ErrInvalidPhone
	}
	return s, nil
}

// Index — детерминированный поисковый ключ номера: hex(HMAC-SHA256(key,
// "phone:"+normalized)). Тот же ввод → то же значение, поэтому колонка
// users.phone_index может быть UNIQUE и по ней работает равенство в WHERE.
func Index(key []byte, normalized string) (string, error) {
	if len(key) != 32 {
		return "", errors.New("phone key must be 32 bytes")
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(indexPrefix + normalized))
	return hex.EncodeToString(mac.Sum(nil)), nil
}

// Encrypt шифрует нормализованный номер AES-256-GCM и возвращает
// base64(nonce || ciphertext). Nonce случайный на каждое шифрование —
// одинаковые номера неразличимы по шифротексту.
func Encrypt(key []byte, plain string) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(plain), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// Decrypt расшифровывает значение, сохранённое Encrypt. Неверный ключ или
// повреждённые данные дают ошибку (GCM-тег).
func Decrypt(key []byte, blob string) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	raw, err := base64.StdEncoding.DecodeString(blob)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("cipher blob too short")
	}
	nonce, ct := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

// Mask прячет номер для показа: первые 6 символов (+7 + 4 цифры), затем
// " ••• •• " и последние 2 цифры.
func Mask(normalized string) string {
	if len(normalized) < 8 {
		return normalized
	}
	return normalized[:6] + " ••• •• " + normalized[len(normalized)-2:]
}
