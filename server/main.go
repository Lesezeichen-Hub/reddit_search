// Reddit Investigator – optionaler lokaler Reddit-API-Adapter.
//
// Der Dienst stellt dem Browser-Modul einen eng begrenzten, schreibgeschützten
// Zugriff auf die offizielle Reddit-API bereit. Zugangsdaten werden nur aus
// Umgebungsvariablen gelesen und nie an den Browser übertragen. Der Dienst
// lauscht standardmäßig ausschließlich auf 127.0.0.1.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const version = "1.0.0"

var (
	authorPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,20}$`)
	cursorPattern = regexp.MustCompile(`^t3_[a-z0-9]{1,13}$`)
)

// Felder, die an den Browser weitergereicht werden (Datensparsamkeit).
var postFields = []string{
	"id", "name", "author", "subreddit", "subreddit_type", "created_utc", "title", "selftext",
	"is_self", "is_video", "is_gallery", "post_hint", "url", "url_overridden_by_dest", "domain",
	"permalink", "crosspost_parent", "preview", "media_metadata", "gallery_data", "thumbnail",
	"thumbnail_width", "thumbnail_height", "over_18", "spoiler", "score", "num_comments",
	"link_flair_text", "removed_by_category",
}

var parentFields = []string{"id", "author", "subreddit", "title", "preview", "thumbnail", "is_gallery", "media_metadata", "gallery_data"}

type config struct {
	ClientID       string
	ClientSecret   string
	UserAgent      string
	AllowedOrigins []string
	AuthURL        string
	APIURL         string
	MinInterval    time.Duration
}

type adapter struct {
	cfg    config
	client *http.Client

	tokenMu     sync.Mutex
	token       string
	tokenExpiry time.Time

	reqMu       sync.Mutex
	lastRequest time.Time
	pausedUntil time.Time
	now         func() time.Time
	sleep       func(context.Context, time.Duration) error
}

type apiError struct {
	Status     int
	Kind       string
	Message    string
	RetryAfter int
}

func (e *apiError) Error() string { return e.Message }

func loadConfig() config {
	origins := strings.TrimSpace(os.Getenv("RI_ALLOWED_ORIGINS"))
	var list []string
	if origins != "" {
		for _, o := range strings.Split(origins, ",") {
			if o = strings.TrimSpace(o); o != "" {
				list = append(list, strings.TrimRight(o, "/"))
			}
		}
	}
	return config{
		ClientID:       strings.TrimSpace(os.Getenv("REDDIT_CLIENT_ID")),
		ClientSecret:   strings.TrimSpace(os.Getenv("REDDIT_CLIENT_SECRET")),
		UserAgent:      strings.TrimSpace(os.Getenv("REDDIT_USER_AGENT")),
		AllowedOrigins: list,
		AuthURL:        "https://www.reddit.com/api/v1/access_token",
		APIURL:         "https://oauth.reddit.com",
		MinInterval:    time.Second,
	}
}

func newAdapter(cfg config) *adapter {
	return &adapter{
		cfg:    cfg,
		client: &http.Client{Timeout: 25 * time.Second},
		now:    time.Now,
		sleep: func(ctx context.Context, d time.Duration) error {
			if d <= 0 {
				return nil
			}
			t := time.NewTimer(d)
			defer t.Stop()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-t.C:
				return nil
			}
		},
	}
}

func (a *adapter) configured() bool {
	return a.cfg.ClientID != "" && a.cfg.ClientSecret != "" && a.cfg.UserAgent != ""
}

// originAllowed erlaubt standardmäßig nur Loopback-Ursprünge (z. B. den Lesezeichen-Hub).
func (a *adapter) originAllowed(origin string) bool {
	if origin == "" {
		return false
	}
	if len(a.cfg.AllowedOrigins) > 0 {
		for _, o := range a.cfg.AllowedOrigins {
			if strings.EqualFold(o, origin) {
				return true
			}
		}
		return false
	}
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	host := u.Hostname()
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (a *adapter) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", a.handleHealth)
	mux.HandleFunc("/reddit/search", a.handleSearch)
	mux.HandleFunc("/reddit/submitted", a.handleSubmitted)
	mux.HandleFunc("/reddit/info", a.handleInfo)
	return a.withHeaders(mux)
}

func (a *adapter) withHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Cache-Control", "no-store")
		h.Set("Referrer-Policy", "no-referrer")
		h.Add("Vary", "Origin")
		origin := r.Header.Get("Origin")
		if origin != "" {
			if !a.originAllowed(origin) {
				writeJSON(w, http.StatusForbidden, map[string]any{"error": "Ursprung nicht erlaubt", "kind": "client"})
				return
			}
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Allow-Methods", "GET, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Accept")
			h.Set("Access-Control-Max-Age", "600")
			if r.Header.Get("Access-Control-Request-Private-Network") == "true" {
				h.Set("Access-Control-Allow-Private-Network", "true")
			}
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "Nur GET ist erlaubt", "kind": "client"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *adapter) handleHealth(w http.ResponseWriter, r *http.Request) {
	msg := "Lokaler Reddit-Adapter ist bereit."
	if !a.configured() {
		msg = "REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET und REDDIT_USER_AGENT sind nicht gesetzt."
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "configured": a.configured(), "version": version, "message": msg})
}

func (a *adapter) handleSearch(w http.ResponseWriter, r *http.Request) {
	author, after, ok := a.listingParams(w, r)
	if !ok {
		return
	}
	q := url.Values{}
	q.Set("q", "author:"+author)
	q.Set("type", "link")
	q.Set("sort", "new")
	q.Set("limit", "100")
	q.Set("restrict_sr", "false")
	q.Set("include_over_18", "on")
	q.Set("raw_json", "1")
	if after != "" {
		q.Set("after", after)
	}
	a.serveListing(w, r, "/search", q)
}

func (a *adapter) handleSubmitted(w http.ResponseWriter, r *http.Request) {
	author, after, ok := a.listingParams(w, r)
	if !ok {
		return
	}
	q := url.Values{}
	q.Set("sort", "new")
	q.Set("limit", "100")
	q.Set("raw_json", "1")
	if after != "" {
		q.Set("after", after)
	}
	a.serveListing(w, r, "/user/"+url.PathEscape(author)+"/submitted", q)
}

func (a *adapter) handleInfo(w http.ResponseWriter, r *http.Request) {
	if !a.requireConfig(w) {
		return
	}
	raw := strings.TrimSpace(r.URL.Query().Get("ids"))
	ids := strings.Split(raw, ",")
	if raw == "" || len(ids) > 100 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "1 bis 100 IDs im Format t3_xxx erforderlich", "kind": "client"})
		return
	}
	for _, id := range ids {
		if !cursorPattern.MatchString(id) {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Ungültige Post-ID", "kind": "client"})
			return
		}
	}
	q := url.Values{}
	q.Set("id", strings.Join(ids, ","))
	q.Set("raw_json", "1")
	a.serveListing(w, r, "/api/info", q)
}

func (a *adapter) listingParams(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	if !a.requireConfig(w) {
		return "", "", false
	}
	author := strings.TrimSpace(r.URL.Query().Get("author"))
	after := strings.TrimSpace(r.URL.Query().Get("after"))
	if !authorPattern.MatchString(author) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Ungültiger Benutzername", "kind": "client"})
		return "", "", false
	}
	if after != "" && !cursorPattern.MatchString(after) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Ungültiger Cursor", "kind": "client"})
		return "", "", false
	}
	return author, after, true
}

func (a *adapter) requireConfig(w http.ResponseWriter) bool {
	if a.configured() {
		return true
	}
	writeJSON(w, http.StatusPreconditionFailed, map[string]any{"error": "Der Adapter ist nicht mit Reddit-API-Zugangsdaten konfiguriert.", "kind": "auth"})
	return false
}

func (a *adapter) serveListing(w http.ResponseWriter, r *http.Request, path string, q url.Values) {
	body, err := a.get(r.Context(), path, q)
	if err != nil {
		var ae *apiError
		if errors.As(err, &ae) {
			if ae.RetryAfter > 0 {
				w.Header().Set("Retry-After", strconv.Itoa(ae.RetryAfter))
			}
			writeJSON(w, ae.Status, map[string]any{"error": ae.Message, "kind": ae.Kind})
			return
		}
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "Reddit ist nicht erreichbar", "kind": "server"})
		return
	}
	posts, after, err := parseListing(body)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "Unerwartete Antwort von Reddit", "kind": "invalid-response"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": posts, "after": after})
}

type listing struct {
	Data struct {
		After    *string `json:"after"`
		Children []struct {
			Kind string                     `json:"kind"`
			Data map[string]json.RawMessage `json:"data"`
		} `json:"children"`
	} `json:"data"`
}

func parseListing(body []byte) ([]map[string]json.RawMessage, string, error) {
	var l listing
	if err := json.Unmarshal(body, &l); err != nil {
		return nil, "", err
	}
	posts := make([]map[string]json.RawMessage, 0, len(l.Data.Children))
	for _, child := range l.Data.Children {
		if child.Kind != "t3" {
			continue
		}
		posts = append(posts, pick(child.Data, postFields, true))
	}
	after := ""
	if l.Data.After != nil && cursorPattern.MatchString(*l.Data.After) {
		after = *l.Data.After
	}
	return posts, after, nil
}

func pick(src map[string]json.RawMessage, fields []string, withParents bool) map[string]json.RawMessage {
	out := make(map[string]json.RawMessage, len(fields)+1)
	for _, f := range fields {
		if v, ok := src[f]; ok {
			out[f] = v
		}
	}
	if withParents {
		if raw, ok := src["crosspost_parent_list"]; ok {
			var parents []map[string]json.RawMessage
			if json.Unmarshal(raw, &parents) == nil {
				reduced := make([]map[string]json.RawMessage, 0, len(parents))
				for _, p := range parents {
					reduced = append(reduced, pick(p, parentFields, false))
				}
				if b, err := json.Marshal(reduced); err == nil {
					out["crosspost_parent_list"] = b
				}
			}
		}
	}
	return out
}

// get führt eine Reddit-API-Anfrage aus, serialisiert Anfragen und beachtet die Rate-Limit-Header.
func (a *adapter) get(ctx context.Context, path string, q url.Values) ([]byte, error) {
	a.reqMu.Lock()
	defer a.reqMu.Unlock()
	wait := a.cfg.MinInterval - a.now().Sub(a.lastRequest)
	if until := a.pausedUntil.Sub(a.now()); until > wait {
		wait = until
	}
	if err := a.sleep(ctx, wait); err != nil {
		return nil, err
	}
	token, err := a.accessToken(ctx)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(a.cfg.APIURL, "/")+path+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "bearer "+token)
	req.Header.Set("User-Agent", a.cfg.UserAgent)
	req.Header.Set("Accept", "application/json")
	a.lastRequest = a.now()
	resp, err := a.client.Do(req)
	if err != nil {
		return nil, &apiError{Status: http.StatusBadGateway, Kind: "server", Message: "Reddit ist nicht erreichbar"}
	}
	defer resp.Body.Close()
	a.trackRateLimit(resp.Header)
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, &apiError{Status: http.StatusBadGateway, Kind: "server", Message: "Antwort von Reddit unvollständig"}
	}
	switch {
	case resp.StatusCode == http.StatusOK:
		return body, nil
	case resp.StatusCode == http.StatusTooManyRequests:
		retry := retrySeconds(resp.Header)
		a.pausedUntil = a.now().Add(time.Duration(retry) * time.Second)
		return nil, &apiError{Status: http.StatusTooManyRequests, Kind: "rate-limit", Message: "Reddit-Rate-Limit erreicht", RetryAfter: retry}
	case resp.StatusCode == http.StatusUnauthorized:
		a.tokenMu.Lock()
		a.token = ""
		a.tokenMu.Unlock()
		return nil, &apiError{Status: http.StatusFailedDependency, Kind: "auth", Message: "Reddit hat das Zugriffstoken abgelehnt"}
	case resp.StatusCode == http.StatusForbidden:
		return nil, &apiError{Status: http.StatusFailedDependency, Kind: "auth", Message: "Reddit verweigert den Zugriff (privat, gesperrt oder nicht freigegeben)"}
	case resp.StatusCode == http.StatusNotFound:
		return nil, &apiError{Status: http.StatusNotFound, Kind: "client", Message: "Bei Reddit nicht gefunden"}
	case resp.StatusCode >= 500:
		return nil, &apiError{Status: http.StatusBadGateway, Kind: "server", Message: fmt.Sprintf("Reddit meldet Status %d", resp.StatusCode)}
	default:
		return nil, &apiError{Status: http.StatusBadGateway, Kind: "client", Message: fmt.Sprintf("Reddit meldet Status %d", resp.StatusCode)}
	}
}

func (a *adapter) trackRateLimit(h http.Header) {
	remaining, err1 := strconv.ParseFloat(h.Get("X-Ratelimit-Remaining"), 64)
	reset, err2 := strconv.ParseFloat(h.Get("X-Ratelimit-Reset"), 64)
	if err1 == nil && err2 == nil && remaining < 2 {
		a.pausedUntil = a.now().Add(time.Duration(reset) * time.Second)
	}
}

func retrySeconds(h http.Header) int {
	for _, name := range []string{"Retry-After", "X-Ratelimit-Reset"} {
		if v, err := strconv.ParseFloat(h.Get(name), 64); err == nil && v > 0 {
			if v > 600 {
				v = 600
			}
			return int(v + 0.999)
		}
	}
	return 60
}

// accessToken holt ein App-Token (client_credentials) und hält es bis kurz vor Ablauf vor.
func (a *adapter) accessToken(ctx context.Context) (string, error) {
	a.tokenMu.Lock()
	defer a.tokenMu.Unlock()
	if a.token != "" && a.now().Before(a.tokenExpiry) {
		return a.token, nil
	}
	form := url.Values{"grant_type": {"client_credentials"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.AuthURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.SetBasicAuth(a.cfg.ClientID, a.cfg.ClientSecret)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", a.cfg.UserAgent)
	resp, err := a.client.Do(req)
	if err != nil {
		return "", &apiError{Status: http.StatusBadGateway, Kind: "server", Message: "Reddit-Anmeldung nicht erreichbar"}
	}
	defer resp.Body.Close()
	var payload struct {
		AccessToken string  `json:"access_token"`
		ExpiresIn   float64 `json:"expires_in"`
		Error       string  `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&payload); err != nil || resp.StatusCode != http.StatusOK || payload.AccessToken == "" {
		return "", &apiError{Status: http.StatusFailedDependency, Kind: "auth", Message: "Reddit-Anmeldung fehlgeschlagen – Zugangsdaten prüfen"}
	}
	expires := time.Duration(payload.ExpiresIn) * time.Second
	if expires <= 0 {
		expires = time.Hour
	}
	a.token = payload.AccessToken
	a.tokenExpiry = a.now().Add(expires - time.Minute)
	return a.token, nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func main() {
	addr := flag.String("addr", envOr("RI_ADDR", "127.0.0.1:8791"), "Adresse, auf der der Adapter lauscht")
	flag.Parse()
	host, _, err := net.SplitHostPort(*addr)
	if err != nil {
		log.Fatalf("ungültige Adresse: %v", err)
	}
	if ip := net.ParseIP(host); host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		log.Fatalf("aus Sicherheitsgründen nur Loopback-Adressen erlaubt (z. B. 127.0.0.1:8791)")
	}
	a := newAdapter(loadConfig())
	if !a.configured() {
		log.Printf("Hinweis: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET und REDDIT_USER_AGENT fehlen – nur /health ist nutzbar.")
	}
	srv := &http.Server{Addr: *addr, Handler: a.routes(), ReadHeaderTimeout: 10 * time.Second, WriteTimeout: 60 * time.Second}
	log.Printf("Reddit-Investigator-Adapter %s lauscht auf http://%s", version, *addr)
	log.Fatal(srv.ListenAndServe())
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}
