// Package authtoken validates the JWT tokens issued by the API's auth
// use-case. It is shared by every service that needs to check a token
// against the common JWT_SECRET without a database round-trip (API
// middleware, SFU signaling).
package authtoken

import (
	"fmt"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// ValidateToken parses tokenString, verifies its HMAC signature and standard
// claims (including exp) against secret, and returns the user ID from the
// user_id claim. Only HMAC signing methods are accepted — anything else,
// including alg=none, is rejected.
func ValidateToken(secret, tokenString string) (uuid.UUID, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid token: %w", err)
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return uuid.Nil, fmt.Errorf("invalid token claims")
	}

	rawID, ok := claims["user_id"].(string)
	if !ok {
		return uuid.Nil, fmt.Errorf("missing or invalid user_id claim")
	}
	userID, err := uuid.Parse(rawID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid user id in token")
	}
	return userID, nil
}
