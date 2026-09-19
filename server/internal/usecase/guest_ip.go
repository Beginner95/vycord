package usecase

import (
	"crypto/hmac"
	"crypto/sha256"
	"net"
)

// guestIPHash — HMAC-SHA256(key, ip) для бана гостя по адресу в пределах
// звонка. IP в открытом виде нигде не хранится. IPv6 сводится к /64: у
// одного абонента обычно целая подсеть, и бан по полному адресу обходился бы
// сменой суффикса. IPv4-mapped IPv6 считается IPv4.
func guestIPHash(key []byte, ip string) []byte {
	data := []byte(ip)
	if parsed := net.ParseIP(ip); parsed != nil {
		if v4 := parsed.To4(); v4 != nil {
			data = v4
		} else {
			data = parsed.Mask(net.CIDRMask(64, 128))
		}
	}
	mac := hmac.New(sha256.New, key)
	mac.Write(data)
	return mac.Sum(nil)
}
