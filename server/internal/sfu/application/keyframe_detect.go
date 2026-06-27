package application

import (
	"github.com/pion/rtp"
	"github.com/pion/rtp/codecs"
	"github.com/pion/webrtc/v4"
)

// detectKeyframe inspects a single raw RTP packet (header + payload, exactly what
// TrackRemote.Read returns) from a publisher's video track and reports whether it
// carries the start of a video keyframe.
//
// This is diagnostic-only, best-effort, used solely for logging in forwardRTP. It
// exists to answer the question that matters most for the screen-share
// black-screen reports: does the publisher's encoder ever actually emit a fresh
// keyframe, and how long after a PLI request does it show up? Without this we are
// guessing from RTCP plumbing alone whether the request→keyframe path works at all.
//
// Unknown codecs, unparseable packets, or non-start fragments return false — false
// negatives are fine here (we only need to see keyframes that DO get through),
// false positives would be misleading so the parsing stays conservative.
func detectKeyframe(mimeType string, rtpPacket []byte) bool {
	var pkt rtp.Packet
	if err := pkt.Unmarshal(rtpPacket); err != nil {
		return false
	}
	payload := pkt.Payload
	if len(payload) == 0 {
		return false
	}

	switch mimeType {
	case webrtc.MimeTypeVP8:
		return vp8IsKeyframe(payload)
	case webrtc.MimeTypeH264:
		return h264HasKeyframeNALU(payload)
	default:
		return false
	}
}

// vp8IsKeyframe checks the VP8 payload descriptor + uncompressed data chunk.
// Only the start of partition 0 carries a meaningful key/inter-frame bit (P bit,
// bit 0 of the first byte after the descriptor) — 0 means key frame.
func vp8IsKeyframe(payload []byte) bool {
	var vp8 codecs.VP8Packet
	vp8Payload, err := vp8.Unmarshal(payload)
	if err != nil || len(vp8Payload) == 0 {
		return false
	}
	if vp8.S != 1 || vp8.PID != 0 {
		return false
	}
	return vp8Payload[0]&0x01 == 0
}

const (
	h264NALUTypeMask  = 0x1F
	h264NALUTypeIDR   = 5
	h264NALUTypeSTAPA = 24
	h264NALUTypeFUA   = 28
)

// h264HasKeyframeNALU checks whether the RTP payload carries (the start of) an
// IDR slice, handling the three packetization modes browsers actually send:
// single NALU, STAP-A aggregation, and FU-A fragmentation.
func h264HasKeyframeNALU(payload []byte) bool {
	if len(payload) == 0 {
		return false
	}
	naluType := payload[0] & h264NALUTypeMask

	switch naluType {
	case h264NALUTypeSTAPA:
		// header byte, then repeated [2-byte size][NALU...]; only the first
		// aggregated NALU's type is checked.
		if len(payload) < 4 {
			return false
		}
		return payload[3]&h264NALUTypeMask == h264NALUTypeIDR

	case h264NALUTypeFUA:
		// header byte, then FU header byte (S|E|R|Type). Only the start
		// fragment carries the original NALU type.
		if len(payload) < 2 {
			return false
		}
		isStart := payload[1]&0x80 != 0
		return isStart && payload[1]&h264NALUTypeMask == h264NALUTypeIDR

	default:
		return naluType == h264NALUTypeIDR
	}
}
