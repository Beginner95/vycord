package middleware

import (
	"net/http"
	"strings"
)

type CORSConfig struct {
	AllowedOrigins []string
	AllowedMethods []string
	AllowedHeaders []string
}

func DefaultCORS() *CORSConfig {
	return &CORSConfig{
		AllowedOrigins: []string{
			"http://localhost:3000",
			"http://localhost:5173",
			"http://localhost",
			"http://localhost:80",
			"http://192.168.1.109",
			"http://192.168.1.109:80",
			"https://192.168.1.109",
			"https://192.168.1.109:443",
		},
		AllowedMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Content-Type", "Authorization"},
	}
}

func (c *CORSConfig) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		// Check if origin is allowed
		allowed := false
		for _, o := range c.AllowedOrigins {
			if o == origin || o == "*" {
				allowed = true
				break
			}
		}

		if allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", strings.Join(c.AllowedMethods, ", "))
			w.Header().Set("Access-Control-Allow-Headers", strings.Join(c.AllowedHeaders, ", "))
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}

		// Handle preflight
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
