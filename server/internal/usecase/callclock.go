package usecase

import "time"

// Clock — источник времени и таймеров CallUseCase; в тестах подменяется
// фейком, чтобы 45 с дозвона и 20 с grace проверялись без ожидания.
type Clock interface {
	Now() time.Time
	AfterFunc(d time.Duration, f func()) Stopper
}

// Stopper — то, что умеет *time.Timer.
type Stopper interface {
	Stop() bool
}

type realClock struct{}

// RealClock — системные часы.
func RealClock() Clock { return realClock{} }

func (realClock) Now() time.Time { return time.Now().UTC() }

func (realClock) AfterFunc(d time.Duration, f func()) Stopper { return time.AfterFunc(d, f) }
