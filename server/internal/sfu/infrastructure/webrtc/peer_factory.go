package sfuwebrtc

import (
	"fmt"

	"github.com/pion/interceptor"
	"github.com/pion/webrtc/v4"
)

// PeerFactory creates configured pion PeerConnections.
// A single factory instance is shared across all rooms because the API object
// (and its MediaEngine) is safe for concurrent use.
type PeerFactory struct {
	api *webrtc.API
	cfg webrtc.Configuration
}

// NewPeerFactory creates a PeerFactory.
// iceURLs: STUN/TURN server URLs for ICE.
// publicIP: if non-empty, pion announces this IP as a host candidate so that
// clients can reach the SFU when it runs behind Docker NAT or any 1:1 NAT.
// Set via the SFU_PUBLIC_IP environment variable.
func NewPeerFactory(iceURLs []string, publicIP string) (*PeerFactory, error) {
	m := &webrtc.MediaEngine{}
	if err := m.RegisterDefaultCodecs(); err != nil {
		return nil, fmt.Errorf("register codecs: %w", err)
	}

	i := &interceptor.Registry{}
	// RegisterDefaultInterceptors wires NACK, RTCP Reports, and TWCC automatically.
	if err := webrtc.RegisterDefaultInterceptors(m, i); err != nil {
		return nil, fmt.Errorf("register interceptors: %w", err)
	}

	se := webrtc.SettingEngine{}
	if publicIP != "" {
		// Map the internal IP to the public IP so ICE host candidates advertise
		// the reachable address instead of the Docker-internal one.
		se.SetNAT1To1IPs([]string{publicIP}, webrtc.ICECandidateTypeHost)
	}

	api := webrtc.NewAPI(
		webrtc.WithMediaEngine(m),
		webrtc.WithInterceptorRegistry(i),
		webrtc.WithSettingEngine(se),
	)

	servers := make([]webrtc.ICEServer, 0, len(iceURLs))
	for _, u := range iceURLs {
		servers = append(servers, webrtc.ICEServer{URLs: []string{u}})
	}

	return &PeerFactory{
		api: api,
		cfg: webrtc.Configuration{ICEServers: servers},
	}, nil
}

func (f *PeerFactory) NewPeerConnection() (*webrtc.PeerConnection, error) {
	pc, err := f.api.NewPeerConnection(f.cfg)
	if err != nil {
		return nil, fmt.Errorf("new peer connection: %w", err)
	}
	return pc, nil
}
