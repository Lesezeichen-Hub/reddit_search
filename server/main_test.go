package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// fakeReddit simuliert Token- und API-Endpunkte (Mock-Daten, keine echten Reddit-Abrufe).
func fakeReddit(t *testing.T, handler http.HandlerFunc) (*adapter, *int32) {
	t.Helper()
	var tokenCalls int32
	auth := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&tokenCalls, 1)
		user, pass, ok := r.BasicAuth()
		if !ok || user != "id" || pass != "secret" || r.FormValue("grant_type") != "client_credentials" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"invalid"}`))
			return
		}
		_, _ = w.Write([]byte(`{"access_token":"tok","expires_in":3600}`))
	}))
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "bearer tok" || r.Header.Get("User-Agent") == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		handler(w, r)
	}))
	t.Cleanup(auth.Close)
	t.Cleanup(api.Close)
	a := newAdapter(config{ClientID: "id", ClientSecret: "secret", UserAgent: "test:ri:1.0 (by /u/test)", AuthURL: auth.URL, APIURL: api.URL})
	a.sleep = func(context.Context, time.Duration) error { return nil }
	return a, &tokenCalls
}

func do(t *testing.T, h http.Handler, path, origin string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

const listingJSON = `{"kind":"Listing","data":{"after":"t3_def","children":[
 {"kind":"t3","data":{"id":"abc","author":"Tester","subreddit":"mycology","title":"Pilz","selftext":"x","created_utc":1700000000,"secret_field":"nope",
  "crosspost_parent_list":[{"id":"zzz","subreddit":"fungi","author":"Tester","title":"Orig","secret":"nope"}]}},
 {"kind":"t1","data":{"id":"c1","body":"Kommentar"}}]}}`

func TestHealthWithoutConfig(t *testing.T) {
	a := newAdapter(config{})
	rec := do(t, a.routes(), "/health", "")
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if rec.Code != 200 || body["configured"] != false {
		t.Fatalf("unerwartet: %d %v", rec.Code, body)
	}
	rec = do(t, a.routes(), "/reddit/search?author=x", "")
	if rec.Code != http.StatusPreconditionFailed {
		t.Fatalf("ohne Konfiguration erwartet 412, erhalten %d", rec.Code)
	}
}

func TestSearchFiltersFieldsAndComments(t *testing.T) {
	var gotQuery string
	a, tokens := fakeReddit(t, func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		if r.URL.Path != "/search" {
			t.Errorf("Pfad %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(listingJSON))
	})
	h := a.routes()
	rec := do(t, h, "/reddit/search?author=Tester", "http://127.0.0.1:8080")
	if rec.Code != 200 {
		t.Fatalf("Status %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(gotQuery, "q=author%3ATester") || !strings.Contains(gotQuery, "type=link") {
		t.Fatalf("Suchparameter fehlen: %s", gotQuery)
	}
	var body struct {
		Data  []map[string]any `json:"data"`
		After string           `json:"after"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Data) != 1 || body.After != "t3_def" {
		t.Fatalf("Kommentare müssen verworfen werden: %+v", body)
	}
	if _, leaked := body.Data[0]["secret_field"]; leaked {
		t.Fatal("nicht freigegebene Felder werden weitergereicht")
	}
	parents := body.Data[0]["crosspost_parent_list"].([]any)
	if _, leaked := parents[0].(map[string]any)["secret"]; leaked {
		t.Fatal("Crosspost-Elternfelder nicht gefiltert")
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "http://127.0.0.1:8080" {
		t.Fatal("CORS-Header für Loopback fehlt")
	}
	do(t, h, "/reddit/search?author=Tester", "")
	if atomic.LoadInt32(tokens) != 1 {
		t.Fatalf("Token sollte zwischengespeichert werden, Aufrufe: %d", *tokens)
	}
}

func TestValidation(t *testing.T) {
	a, _ := fakeReddit(t, func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(listingJSON)) })
	h := a.routes()
	for _, path := range []string{
		"/reddit/search?author=bad%20name",
		"/reddit/search?author=ok&after=xyz",
		"/reddit/submitted?author=" + strings.Repeat("a", 21),
		"/reddit/info?ids=abc",
		"/reddit/info?ids=",
	} {
		if rec := do(t, h, path, ""); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: erwartet 400, erhalten %d", path, rec.Code)
		}
	}
}

func TestForeignOriginRejected(t *testing.T) {
	a, _ := fakeReddit(t, func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(listingJSON)) })
	if rec := do(t, a.routes(), "/health", "https://evil.example"); rec.Code != http.StatusForbidden {
		t.Fatalf("fremder Ursprung muss abgelehnt werden, erhalten %d", rec.Code)
	}
	a.cfg.AllowedOrigins = []string{"http://hub.local:9000"}
	if rec := do(t, a.routes(), "/health", "http://hub.local:9000"); rec.Code != 200 {
		t.Fatalf("explizit erlaubter Ursprung abgelehnt: %d", rec.Code)
	}
}

func TestRateLimitIsForwarded(t *testing.T) {
	a, _ := fakeReddit(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "7")
		w.WriteHeader(http.StatusTooManyRequests)
	})
	rec := do(t, a.routes(), "/reddit/submitted?author=Tester", "")
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") != "7" {
		t.Fatalf("429 nicht weitergegeben: %d %q", rec.Code, rec.Header().Get("Retry-After"))
	}
	if !a.pausedUntil.After(time.Now()) {
		t.Fatal("Adapter muss nach 429 pausieren")
	}
}

func TestInfoAndUpstreamErrors(t *testing.T) {
	a, _ := fakeReddit(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("id") == "t3_aaa,t3_bbb" {
			_, _ = w.Write([]byte(`{"data":{"children":[{"kind":"t3","data":{"id":"aaa","removed_by_category":"moderator"}}]}}`))
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
	})
	h := a.routes()
	rec := do(t, h, "/reddit/info?ids=t3_aaa,t3_bbb", "")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "removed_by_category") {
		t.Fatalf("info: %d %s", rec.Code, rec.Body.String())
	}
	rec = do(t, h, "/reddit/info?ids=t3_ccc", "")
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("Upstream-500 sollte 502 ergeben, erhalten %d", rec.Code)
	}
}

func TestWrongCredentials(t *testing.T) {
	a, _ := fakeReddit(t, func(w http.ResponseWriter, r *http.Request) {})
	a.cfg.ClientSecret = "falsch"
	rec := do(t, a.routes(), "/reddit/search?author=Tester", "")
	if rec.Code != http.StatusFailedDependency || !strings.Contains(rec.Body.String(), `"kind":"auth"`) {
		t.Fatalf("falsche Zugangsdaten: %d %s", rec.Code, rec.Body.String())
	}
}

func TestOnlyGet(t *testing.T) {
	a := newAdapter(config{})
	req := httptest.NewRequest(http.MethodPost, "/health", nil)
	rec := httptest.NewRecorder()
	a.routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST muss abgelehnt werden: %d", rec.Code)
	}
}
