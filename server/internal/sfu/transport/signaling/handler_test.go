package signaling

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"

	"github.com/vycord/server/internal/sfu/application"
	sfuwebrtc "github.com/vycord/server/internal/sfu/infrastructure/webrtc"
)

const testSecret = "handler-test-secret"

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	pf, err := sfuwebrtc.NewPeerFactory([]string{}, "")
	if err != nil {
		t.Fatalf("NewPeerFactory: %v", err)
	}
	mgr := application.NewRoomManager(pf, log)
	t.Cleanup(mgr.Shutdown)
	srv := httptest.NewServer(NewHandler(mgr, log, testSecret))
	t.Cleanup(srv.Close)
	return srv
}

func signToken(t *testing.T, userID string, exp time.Time) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"exp":     exp.Unix(),
	})
	s, err := tok.SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return s
}

func signRoomToken(t *testing.T, userID, roomID string, exp time.Time) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"room_id": roomID,
		"exp":     exp.Unix(),
	})
	s, err := tok.SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("sign room token: %v", err)
	}
	return s
}

// dialStatus attempts a WebSocket handshake and returns the HTTP status of
// the response (101 on a successful upgrade).
func dialStatus(t *testing.T, srv *httptest.Server, query string) int {
	t.Helper()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?" + query
	conn, resp, err := websocket.DefaultDialer.Dial(url, nil)
	if err == nil {
		conn.Close()
	}
	if resp == nil {
		t.Fatalf("dial returned no HTTP response: %v", err)
	}
	return resp.StatusCode
}

func TestServeHTTPRejectsMissingToken(t *testing.T) {
	srv := newTestServer(t)
	if got := dialStatus(t, srv, "room_id="+uuid.NewString()+""); got != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", got)
	}
}

func TestServeHTTPRejectsMissingRoomID(t *testing.T) {
	srv := newTestServer(t)
	tok := signToken(t, uuid.NewString(), time.Now().Add(time.Hour))
	if got := dialStatus(t, srv, "token="+tok); got != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", got)
	}
}

func TestServeHTTPRejectsGarbageToken(t *testing.T) {
	srv := newTestServer(t)
	if got := dialStatus(t, srv, "room_id="+uuid.NewString()+"&token=garbage"); got != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", got)
	}
}

func TestServeHTTPRejectsExpiredToken(t *testing.T) {
	srv := newTestServer(t)
	tok := signToken(t, uuid.NewString(), time.Now().Add(-time.Hour))
	if got := dialStatus(t, srv, "room_id="+uuid.NewString()+"&token="+tok); got != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", got)
	}
}

func TestServeHTTPAcceptsValidTokenAndJoins(t *testing.T) {
	srv := newTestServer(t)
	roomID := uuid.NewString()
	tok := signRoomToken(t, uuid.NewString(), roomID, time.Now().Add(time.Hour))
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?room_id=" + roomID + "&token=" + tok

	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial with valid token: %v", err)
	}
	defer conn.Close()

	// The server pushes "joined" right after the join; an "offer" may arrive
	// around it, so read until "joined" shows up.
	if err := conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	for {
		var msg Message
		if err := conn.ReadJSON(&msg); err != nil {
			t.Fatalf("waiting for joined: %v", err)
		}
		if msg.Type == "joined" {
			return
		}
	}
}

func TestServeHTTPRejectsTokenWithoutRoomIDClaim(t *testing.T) {
	srv := newTestServer(t)
	tok := signToken(t, uuid.NewString(), time.Now().Add(time.Hour)) // no room_id claim
	if got := dialStatus(t, srv, "room_id="+uuid.NewString()+"&token="+tok); got != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", got)
	}
}

func TestServeHTTPRejectsMalformedRoomID(t *testing.T) {
	srv := newTestServer(t)
	tok := signRoomToken(t, uuid.NewString(), uuid.NewString(), time.Now().Add(time.Hour))
	if got := dialStatus(t, srv, "room_id=not-a-uuid&token="+tok); got != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", got)
	}
}

// The same room id in a different case is the same room: the comparison is on
// parsed UUIDs, not on the raw query-string bytes.
func TestServeHTTPAcceptsDifferentlyCasedRoomID(t *testing.T) {
	srv := newTestServer(t)
	roomID := uuid.NewString()
	tok := signRoomToken(t, uuid.NewString(), roomID, time.Now().Add(time.Hour))
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?room_id=" + strings.ToUpper(roomID) + "&token=" + tok

	conn, resp, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial with upper-cased room id: %v (status %v)", err, resp.StatusCode)
	}
	defer conn.Close()
}

func TestServeHTTPRejectsMismatchedRoomID(t *testing.T) {
	srv := newTestServer(t)
	tokenRoomID := uuid.NewString()
	otherRoomID := uuid.NewString()
	tok := signRoomToken(t, uuid.NewString(), tokenRoomID, time.Now().Add(time.Hour))
	if got := dialStatus(t, srv, "room_id="+otherRoomID+"&token="+tok); got != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", got)
	}
}

// TestRequestICERestartProducesOfferWithFreshICECredentials is the end-to-end
// proof of the client-side trigger from VYC-78 step 1: a client that sees its
// media path die asks the SFU to re-gather ICE over the still-live signaling
// socket, instead of dropping the call and rejoining the room.
//
// The client here is a real pion PeerConnection so the exchange is genuine: it
// answers the SFU's initial offer (bringing the server PC to stable, the only
// state a restart can be created from), then sends request_ice_restart and
// checks the next offer carries different ICE credentials. Same credentials
// would mean the client's ICE agent keeps probing the pair that already failed.
func TestRequestICERestartProducesOfferWithFreshICECredentials(t *testing.T) {
	srv := newTestServer(t)
	roomID := uuid.NewString()
	tok := signRoomToken(t, uuid.NewString(), roomID, time.Now().Add(time.Hour))
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?room_id=" + roomID + "&token=" + tok

	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	pf, err := sfuwebrtc.NewPeerFactory([]string{}, "")
	if err != nil {
		t.Fatalf("NewPeerFactory: %v", err)
	}
	clientPC, err := pf.NewPeerConnection()
	if err != nil {
		t.Fatalf("client NewPeerConnection: %v", err)
	}
	defer clientPC.Close()

	if err := conn.SetReadDeadline(time.Now().Add(10 * time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}

	firstUfrag := ""
	restartRequested := false
	for {
		var msg Message
		if err := conn.ReadJSON(&msg); err != nil {
			t.Fatalf("read: %v (first_ufrag=%q restart_requested=%v)", err, firstUfrag, restartRequested)
		}
		if msg.Type != "offer" {
			continue
		}

		var offer OfferPayload
		if err := json.Unmarshal(msg.Payload, &offer); err != nil {
			t.Fatalf("unmarshal offer: %v", err)
		}
		ufrag := iceUfragOf(t, offer.SDP)

		if restartRequested {
			if ufrag == firstUfrag {
				// An ordinary renegotiation can still arrive after the request;
				// keep reading until the restart offer shows up.
				continue
			}
			return // the restart offer arrived
		}

		firstUfrag = ufrag
		answerOffer(t, clientPC, conn, offer)

		if err := conn.WriteJSON(Message{Type: "request_ice_restart", Payload: MustMarshal(struct{}{})}); err != nil {
			t.Fatalf("write request_ice_restart: %v", err)
		}
		restartRequested = true
	}
}

// answerOffer makes clientPC answer the SFU's offer over the signaling socket,
// which is what drives the server PeerConnection to a stable signaling state.
func answerOffer(t *testing.T, clientPC *webrtc.PeerConnection, conn *websocket.Conn, offer OfferPayload) {
	t.Helper()
	if err := clientPC.SetRemoteDescription(webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer,
		SDP:  offer.SDP,
	}); err != nil {
		t.Fatalf("client SetRemoteDescription: %v", err)
	}
	ans, err := clientPC.CreateAnswer(nil)
	if err != nil {
		t.Fatalf("client CreateAnswer: %v", err)
	}
	if err := clientPC.SetLocalDescription(ans); err != nil {
		t.Fatalf("client SetLocalDescription: %v", err)
	}
	if err := conn.WriteJSON(Message{
		Type:    "answer",
		Payload: MustMarshal(AnswerPayload{Type: "answer", SDP: clientPC.LocalDescription().SDP}),
	}); err != nil {
		t.Fatalf("write answer: %v", err)
	}
}

// iceUfragOf extracts the session-level ICE username fragment — the fingerprint
// that distinguishes an ICE restart from an ordinary renegotiation.
func iceUfragOf(t *testing.T, sdp string) string {
	t.Helper()
	for _, line := range strings.Split(sdp, "\n") {
		line = strings.TrimSpace(line)
		if after, ok := strings.CutPrefix(line, "a=ice-ufrag:"); ok {
			return after
		}
	}
	t.Fatalf("no a=ice-ufrag in SDP:\n%s", sdp)
	return ""
}

// TestWatchShareUnknownTargetDoesNotCrashConnection: sending watch_share for a
// user who isn't in the room (typo, race with them leaving) must be a no-op —
// the connection must stay open and usable afterwards.
// readUntil reads messages until one of the given types shows up, and fails
// the test if any of failOn arrives first — used throughout the resume tests
// below to assert not just "the right message eventually arrives" but "the
// wrong one never does".
func readUntil(t *testing.T, conn *websocket.Conn, want string, failOn ...string) Message {
	t.Helper()
	for {
		var msg Message
		if err := conn.ReadJSON(&msg); err != nil {
			t.Fatalf("waiting for %q: %v", want, err)
		}
		if msg.Type == want {
			return msg
		}
		for _, bad := range failOn {
			if msg.Type == bad {
				t.Fatalf("got %q while waiting for %q", bad, want)
			}
		}
	}
}

// TestResumeReattachesOverNewWebSocket is the end-to-end proof of VYC-78 step 3:
// a client whose WebSocket dies gets a "resumed" reply on reconnect (instead of
// being treated as a brand new joiner) when it presents the resume_token that
// came with "joined".
func TestResumeReattachesOverNewWebSocket(t *testing.T) {
	srv := newTestServer(t)
	roomID := uuid.NewString()
	tok := signRoomToken(t, uuid.NewString(), roomID, time.Now().Add(time.Hour))
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?room_id=" + roomID + "&token=" + tok

	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	if err := conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}

	joined := readUntil(t, conn, "joined")
	var joinedPayload JoinedPayload
	if err := json.Unmarshal(joined.Payload, &joinedPayload); err != nil {
		t.Fatalf("unmarshal joined: %v", err)
	}
	if joinedPayload.ResumeToken == "" {
		t.Fatal("joined payload carried no resume_token")
	}

	conn.Close() // simulate the WS dying; the server must start grace, not Leave

	// Give the server's readPump/defer chain time to notice and start grace.
	time.Sleep(200 * time.Millisecond)

	resumeConn, _, err := websocket.DefaultDialer.Dial(url+"&resume_token="+joinedPayload.ResumeToken, nil)
	if err != nil {
		t.Fatalf("dial for resume: %v", err)
	}
	defer resumeConn.Close()
	if err := resumeConn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}

	readUntil(t, resumeConn, "resumed", "joined")
}

// TestResumedPayloadReflectsRoomChangesMissedDuringGrace is the fix for a gap
// a code review caught: while a participant's session sits dead in grace,
// participant_joined/participant_left broadcasts for OTHER participants are
// sent to that dead session and silently lost — nothing queues them for
// later. ResumedPayload must carry a fresh snapshot taken AT RESUME TIME (not
// whatever was true when the dead connection last saw the room), so someone
// who left during the grace window is correctly reflected as gone, not
// resurrected as a stale "existing peer".
func TestResumedPayloadReflectsRoomChangesMissedDuringGrace(t *testing.T) {
	srv := newTestServer(t)
	roomID := uuid.NewString()

	aliceTok := signRoomToken(t, uuid.NewString(), roomID, time.Now().Add(time.Hour))
	aliceURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?room_id=" + roomID + "&token=" + aliceTok
	aliceConn, _, err := websocket.DefaultDialer.Dial(aliceURL, nil)
	if err != nil {
		t.Fatalf("alice dial: %v", err)
	}
	if err := aliceConn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	joined := readUntil(t, aliceConn, "joined")
	var joinedPayload JoinedPayload
	if err := json.Unmarshal(joined.Payload, &joinedPayload); err != nil {
		t.Fatalf("unmarshal joined: %v", err)
	}

	bobUserID := uuid.NewString()
	bobTok := signRoomToken(t, bobUserID, roomID, time.Now().Add(time.Hour))
	bobURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?room_id=" + roomID + "&token=" + bobTok
	bobConn, _, err := websocket.DefaultDialer.Dial(bobURL, nil)
	if err != nil {
		t.Fatalf("bob dial: %v", err)
	}
	if err := bobConn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	readUntil(t, bobConn, "joined")
	// Alice's dead session would have received this too, had it been alive —
	// this is the broadcast the resume snapshot has to make up for.
	readUntil(t, aliceConn, "participant_joined")

	aliceConn.Close() // alice's WS dies; she enters grace
	time.Sleep(200 * time.Millisecond)

	// Bob leaves WHILE alice is in grace — her dead session cannot receive
	// this broadcast either. An explicit "leave" (not just closing the socket)
	// removes bob immediately rather than starting a grace window of his own —
	// see the intentional-leave path in routeMessage — so ExistingParticipants
	// reflects his departure right away instead of up to graceTimeout later.
	if err := bobConn.WriteJSON(Message{Type: "leave", Payload: MustMarshal(struct{}{})}); err != nil {
		t.Fatalf("write leave: %v", err)
	}
	bobConn.Close()
	time.Sleep(200 * time.Millisecond)

	// Carol joins WHILE alice is still in grace — same blind spot, opposite
	// direction: an arrival, not a departure.
	carolUserID := uuid.NewString()
	carolTok := signRoomToken(t, carolUserID, roomID, time.Now().Add(time.Hour))
	carolURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?room_id=" + roomID + "&token=" + carolTok
	carolConn, _, err := websocket.DefaultDialer.Dial(carolURL, nil)
	if err != nil {
		t.Fatalf("carol dial: %v", err)
	}
	defer carolConn.Close()
	if err := carolConn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	readUntil(t, carolConn, "joined")

	aliceResumeConn, _, err := websocket.DefaultDialer.Dial(aliceURL+"&resume_token="+joinedPayload.ResumeToken, nil)
	if err != nil {
		t.Fatalf("alice resume dial: %v", err)
	}
	defer aliceResumeConn.Close()
	if err := aliceResumeConn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}

	resumed := readUntil(t, aliceResumeConn, "resumed", "joined")
	var resumedPayload ResumedPayload
	if err := json.Unmarshal(resumed.Payload, &resumedPayload); err != nil {
		t.Fatalf("unmarshal resumed: %v", err)
	}

	for _, uid := range resumedPayload.ExistingPeers {
		if uid == bobUserID {
			t.Fatalf("resumed payload still listed bob as an existing peer, but bob left during alice's grace window: %v", resumedPayload.ExistingPeers)
		}
	}
	found := false
	for _, uid := range resumedPayload.ExistingPeers {
		if uid == carolUserID {
			found = true
		}
	}
	if !found {
		t.Fatalf("resumed payload did not list carol, who joined during alice's grace window: %v", resumedPayload.ExistingPeers)
	}
}

// TestResumeWithInvalidTokenFallsBackToFreshJoin: a missing, garbage, or
// already-consumed resume_token must not break the connection — the server
// falls back to the ordinary join flow, exactly as if resume_token had never
// been sent (spec: "токен не предъявлен или недействителен → работает
// нынешнее вытеснение stale-сессии, эта логика не меняется").
func TestResumeWithInvalidTokenFallsBackToFreshJoin(t *testing.T) {
	srv := newTestServer(t)
	roomID := uuid.NewString()
	tok := signRoomToken(t, uuid.NewString(), roomID, time.Now().Add(time.Hour))
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?room_id=" + roomID +
		"&token=" + tok + "&resume_token=not-a-real-token"

	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	if err := conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}

	readUntil(t, conn, "joined", "resumed")
}

// TestResumeDoesNotBroadcastParticipantJoined: resuming is not rejoining —
// nobody else in the room ever saw the participant leave, so nobody should see
// them "join" a second time (nor, along the way, see participant_left for the
// grace window that never expired).
func TestResumeDoesNotBroadcastParticipantJoined(t *testing.T) {
	srv := newTestServer(t)
	roomID := uuid.NewString()

	bobTok := signRoomToken(t, uuid.NewString(), roomID, time.Now().Add(time.Hour))
	bobURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?room_id=" + roomID + "&token=" + bobTok
	bobConn, _, err := websocket.DefaultDialer.Dial(bobURL, nil)
	if err != nil {
		t.Fatalf("bob dial: %v", err)
	}
	defer bobConn.Close()
	if err := bobConn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	readUntil(t, bobConn, "joined")

	aliceTok := signRoomToken(t, uuid.NewString(), roomID, time.Now().Add(time.Hour))
	aliceURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?room_id=" + roomID + "&token=" + aliceTok
	aliceConn, _, err := websocket.DefaultDialer.Dial(aliceURL, nil)
	if err != nil {
		t.Fatalf("alice dial: %v", err)
	}
	if err := aliceConn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	joined := readUntil(t, aliceConn, "joined")
	var joinedPayload JoinedPayload
	if err := json.Unmarshal(joined.Payload, &joinedPayload); err != nil {
		t.Fatalf("unmarshal joined: %v", err)
	}

	// Bob observes alice's first, genuine join.
	readUntil(t, bobConn, "participant_joined")

	aliceConn.Close()
	time.Sleep(200 * time.Millisecond)

	aliceResumeConn, _, err := websocket.DefaultDialer.Dial(aliceURL+"&resume_token="+joinedPayload.ResumeToken, nil)
	if err != nil {
		t.Fatalf("alice resume dial: %v", err)
	}
	defer aliceResumeConn.Close()
	if err := aliceResumeConn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	readUntil(t, aliceResumeConn, "resumed")

	// Bob must see neither participant_left (grace never expired) nor a second
	// participant_joined (alice never really left) for the whole resume cycle.
	// request_keyframe is a harmless liveness probe used elsewhere in this file
	// to prove a connection is still open and responsive after the thing under
	// test — reused here the same way.
	if err := aliceResumeConn.WriteJSON(Message{Type: "request_keyframe", Payload: MustMarshal(struct{}{})}); err != nil {
		t.Fatalf("write request_keyframe: %v", err)
	}
	if err := bobConn.SetReadDeadline(time.Now().Add(500 * time.Millisecond)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	for {
		var msg Message
		err := bobConn.ReadJSON(&msg)
		if err != nil {
			return // deadline hit with nothing unwanted seen — success
		}
		if msg.Type == "participant_left" || msg.Type == "participant_joined" {
			t.Fatalf("bob observed %q during a resume cycle that never actually left the room", msg.Type)
		}
	}
}

func TestWatchShareUnknownTargetDoesNotCrashConnection(t *testing.T) {
	srv := newTestServer(t)
	roomID := uuid.NewString()
	tok := signRoomToken(t, uuid.NewString(), roomID, time.Now().Add(time.Hour))
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?room_id=" + roomID + "&token=" + tok

	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	if err := conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	for {
		var msg Message
		if err := conn.ReadJSON(&msg); err != nil {
			t.Fatalf("waiting for joined: %v", err)
		}
		if msg.Type == "joined" {
			break
		}
	}

	if err := conn.WriteJSON(Message{
		Type:    "watch_share",
		Payload: MustMarshal(WatchSharePayload{TargetUserID: "does-not-exist"}),
	}); err != nil {
		t.Fatalf("write watch_share: %v", err)
	}

	// The connection must still be alive — request_keyframe is a harmless,
	// pre-existing message type we can use as a liveness probe.
	if err := conn.WriteJSON(Message{Type: "request_keyframe", Payload: MustMarshal(struct{}{})}); err != nil {
		t.Fatalf("connection died after unknown watch_share target: %v", err)
	}
}
