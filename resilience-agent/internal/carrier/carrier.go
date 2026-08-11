// Package carrier identifies Nigerian mobile carriers from phone number
// prefixes, using the NCC-assigned national destination code ranges.
package carrier

import "strings"

// Carrier describes the detected carrier for a phone number.
type Carrier struct {
	Phone   string `json:"phone"`
	Prefix  string `json:"prefix,omitempty"`
	Carrier string `json:"carrier"`
	Known   bool   `json:"known"`
}

// prefixTable maps NCC-assigned prefixes to carriers.
var prefixTable = map[string]string{
	// MTN Nigeria
	"07025": "MTN", "07026": "MTN", "0703": "MTN", "0704": "MTN", "0706": "MTN",
	"0803": "MTN", "0806": "MTN", "0810": "MTN", "0813": "MTN", "0814": "MTN",
	"0816": "MTN", "0903": "MTN", "0906": "MTN", "0913": "MTN", "0916": "MTN",
	// Airtel Nigeria
	"0701": "Airtel", "0708": "Airtel", "0802": "Airtel", "0808": "Airtel",
	"0812": "Airtel", "0901": "Airtel", "0902": "Airtel", "0904": "Airtel",
	"0907": "Airtel", "0912": "Airtel",
	// Globacom
	"0705": "Glo", "0805": "Glo", "0807": "Glo", "0811": "Glo", "0815": "Glo",
	"0905": "Glo", "0915": "Glo",
	// 9mobile
	"0809": "9mobile", "0817": "9mobile", "0818": "9mobile", "0908": "9mobile",
	"0909": "9mobile",
	// Smile / ntel / others (4G-only operators)
	"0702": "Smile", "07027": "Smile", "0707": "ZoomMobile",
	"0804": "ntel", "0819": "Starcomms",
}

// normalize converts +234 / 234 international formats to the local 0-prefix
// format and strips separators.
func normalize(phone string) string {
	p := strings.NewReplacer(" ", "", "-", "", "(", "", ")", "").Replace(strings.TrimSpace(phone))
	p = strings.TrimPrefix(p, "+")
	if strings.HasPrefix(p, "234") {
		p = "0" + p[3:]
	}
	return p
}

// Detect identifies the carrier for a Nigerian phone number. Longest prefix
// match wins so 5-digit codes (e.g. 07025) take precedence over 4-digit ones.
func Detect(phone string) Carrier {
	p := normalize(phone)
	c := Carrier{Phone: p, Carrier: "unknown"}
	for _, n := range []int{5, 4} {
		if len(p) >= n {
			if name, ok := prefixTable[p[:n]]; ok {
				c.Prefix = p[:n]
				c.Carrier = name
				c.Known = true
				return c
			}
		}
	}
	return c
}
