package usecase_test

import (
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/mock"
	"github.com/vycord/server/internal/domain"
)

type MockOTPRepository struct{ mock.Mock }

func (m *MockOTPRepository) Create(c *domain.OTPCode) error {
	return m.Called(c).Error(0)
}

func (m *MockOTPRepository) GetActive(userID uuid.UUID, p domain.OTPPurpose) (*domain.OTPCode, error) {
	args := m.Called(userID, p)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.OTPCode), args.Error(1)
}

func (m *MockOTPRepository) IncrementAttempts(id uuid.UUID) (int, error) {
	args := m.Called(id)
	return args.Int(0), args.Error(1)
}

func (m *MockOTPRepository) Consume(id uuid.UUID, at time.Time) error {
	return m.Called(id, at).Error(0)
}

func (m *MockOTPRepository) InvalidateActive(userID uuid.UUID, p domain.OTPPurpose) error {
	return m.Called(userID, p).Error(0)
}

func (m *MockOTPRepository) CountIssuedSince(userID uuid.UUID, p domain.OTPPurpose, since time.Time) (int, error) {
	args := m.Called(userID, p, since)
	return args.Int(0), args.Error(1)
}

func (m *MockOTPRepository) LastIssuedAt(userID uuid.UUID, p domain.OTPPurpose) (*time.Time, error) {
	args := m.Called(userID, p)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*time.Time), args.Error(1)
}

func (m *MockOTPRepository) DeleteExpiredBefore(t time.Time) (int64, error) {
	args := m.Called(t)
	return args.Get(0).(int64), args.Error(1)
}

// MockMailer запоминает последнее письмо: тесты проверяют и факт отправки,
// и что в теле оказался именно тот код, который ушёл в БД.
type MockMailer struct {
	mock.Mock
	Sent []domain.MailMessage
}

func (m *MockMailer) Send(msg domain.MailMessage) error {
	m.Sent = append(m.Sent, msg)
	return m.Called(msg).Error(0)
}
