// Package authtoken validates the JWT tokens issued by the API's auth
// use-case. It is shared by every service that needs to check a token
// against the common JWT_SECRET without a database round-trip (API
// middleware, SFU signaling).
package authtoken

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func parseClaims(secret, tokenString string) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, fmt.Errorf("invalid token: %w", err)
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}
	return claims, nil
}

func userIDFromClaims(claims jwt.MapClaims) (uuid.UUID, error) {
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

// ValidateToken parses tokenString, verifies its HMAC signature and standard
// claims (including exp) against secret, and returns the user ID from the
// user_id claim. Only HMAC signing methods are accepted — anything else,
// including alg=none, is rejected.
func ValidateToken(secret, tokenString string) (uuid.UUID, error) {
	claims, err := parseClaims(secret, tokenString)
	if err != nil {
		return uuid.Nil, err
	}
	return userIDFromClaims(claims)
}

// GenerateRoomToken signs a short-lived token scoped to a single SFU room.
// Used by the API to authorize a voice-channel connection without giving the
// SFU process direct database access — see
// docs/superpowers/specs/2026-08-04-private-channels-design.md.
func GenerateRoomToken(secret string, userID, roomID uuid.UUID, ttl time.Duration) (string, error) {
	claims := jwt.MapClaims{
		"user_id": userID.String(),
		"room_id": roomID.String(),
		"exp":     time.Now().Add(ttl).Unix(),
		"iat":     time.Now().Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ValidateRoomToken validates tokenString like ValidateToken, additionally
// requiring a room_id claim — tokens without one (e.g. the general-purpose
// login token) are rejected. Used by the SFU signaling handler.
func ValidateRoomToken(secret, tokenString string) (userID, roomID uuid.UUID, err error) {
	claims, err := parseClaims(secret, tokenString)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	userID, err = userIDFromClaims(claims)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	rawRoom, ok := claims["room_id"].(string)
	if !ok {
		return uuid.Nil, uuid.Nil, fmt.Errorf("missing or invalid room_id claim")
	}
	roomID, err = uuid.Parse(rawRoom)
	if err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("invalid room id in token")
	}
	return userID, roomID, nil
}
