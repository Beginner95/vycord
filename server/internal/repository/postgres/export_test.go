package postgres

import "github.com/jackc/pgx/v5/pgxpool"

// GuestRepositoryForTest exposes the concrete guest repository to the external
// integration tests while domain.GuestRepository is still being filled in
// (Tasks 5–6 of the guest-call-link Plan 2).
type GuestRepositoryForTest = guestRepository

func NewGuestRepositoryForTest(db *pgxpool.Pool) *GuestRepositoryForTest {
	return newGuestRepository(db)
}
