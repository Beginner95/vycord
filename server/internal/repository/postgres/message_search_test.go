package postgres

import "testing"

func TestEscapeLike(t *testing.T) {
	cases := []struct{ in, want string }{
		{"100%", `100\%`},
		{"a_b", `a\_b`},
		{`back\slash`, `back\\slash`},
		{"обычный текст", "обычный текст"},
		{`%_\`, `\%\_\\`},
	}
	for _, c := range cases {
		if got := escapeLike(c.in); got != c.want {
			t.Errorf("escapeLike(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
