import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import "./App.css";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";
const TOKEN_KEY = "shiva_token";

// fetch wrapper that attaches the login token
const authFetch = (token, path, options = {}) =>
  fetch(`${API_URL}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });

function TypingIndicator() {
  return (
    <div className="message assistant">
      <div className="avatar">S</div>
      <div className="bubble typing">
        <span></span><span></span><span></span>
      </div>
    </div>
  );
}

function Message({ msg }) {
  return (
    <div className={`message ${msg.role}`}>
      {msg.role === "assistant" && <div className="avatar">S</div>}
      <div>
        <div className="bubble">
          {msg.role === "assistant" ? (
            <div className="markdown">
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            </div>
          ) : (
            msg.content.split("\n").map((line, i, arr) => (
              <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
            ))
          )}
        </div>
        {msg.sources && msg.sources.length > 0 && (
          <div className="sources-row">
            Sources: {msg.sources.map((s) => (
              <span key={s} className="source-chip">{s}</span>
            ))}
          </div>
        )}
      </div>
      {msg.role === "user" && <div className="avatar user-avatar">U</div>}
    </div>
  );
}

function DocumentsBar({ documents, onUpload, onDelete, uploading }) {
  const fileInputRef = useRef(null);

  return (
    <div className="docs-bar">
      <button
        className="upload-btn"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        title="Upload a .pdf, .docx or .txt file for Shiva to reference"
      >
        {uploading ? "Uploading…" : "📎 Add knowledge"}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.txt,.md,.docx"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          e.target.value = "";
        }}
      />
      <div className="doc-pills">
        {documents.map((d) => (
          <span key={d.filename} className="doc-pill">
            {d.filename}
            <button onClick={() => onDelete(d.filename)} title="Remove this document">×</button>
          </span>
        ))}
      </div>
    </div>
  );
}

const DEFAULT_TITLE = "New chat";
const makeTitle = (text) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 40 ? t.slice(0, 40).trimEnd() + "…" : t;
};

function Sidebar({ chats, activeId, open, onSelect, onNew, onDelete, onClose }) {
  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-top">
        <button className="new-chat-btn" onClick={onNew}>＋ New chat</button>
        <button className="icon-btn sidebar-close" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="chat-list">
        {chats.length === 0 && <div className="chat-empty">No chats yet</div>}
        {chats.map((c) => (
          <div
            key={c.sessionId}
            className={`chat-item ${c.sessionId === activeId ? "active" : ""}`}
            onClick={() => onSelect(c.sessionId)}
            title={c.title}
          >
            <span className="chat-title">{c.title}</span>
            <button
              className="chat-del"
              onClick={(e) => onDelete(c.sessionId, e)}
              title="Delete chat"
            >
              🗑
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}

function AuthScreen({ onAuth, theme }) {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
      } else {
        onAuth(data.token, data.user);
      }
    } catch (err) {
      setError("Could not connect to server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app auth-app" data-theme={theme}>
      <div className="auth-wrap">
        <form className="auth-card" onSubmit={submit}>
          <div className="logo auth-logo">S</div>
          <h2>{mode === "login" ? "Welcome back" : "Create your account"}</h2>
          <p className="auth-sub">
            {mode === "login"
              ? "Log in to chat with Shiva and your documents."
              : "Your documents stay private to your account."}
          </p>

          {mode === "signup" && (
            <input
              className="auth-input"
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          )}
          <input
            className="auth-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <input
            className="auth-input"
            type="password"
            placeholder="Password (min 6 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
          />

          {error && <div className="auth-error">{error}</div>}

          <button className="auth-btn" type="submit" disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Log in" : "Sign up"}
          </button>
          {busy && (
            <div className="auth-hint">
              The server may take up to a minute to wake up on the first request.
            </div>
          )}

          <div className="auth-switch">
            {mode === "login" ? "New here? " : "Already have an account? "}
            <button
              type="button"
              onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}
            >
              {mode === "login" ? "Sign up" : "Log in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(null);
  const [chats, setChats] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const bottomRef = useRef(null);

  const welcome = (name) => ({
    role: "assistant",
    content: `Hey ${name || "there"}! I'm Shiva 👋 Ask me anything, or upload a document and I'll answer from it.`,
  });

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setChats([]);
    setMessages([]);
    setDocuments([]);
    setSessionId(null);
    setSidebarOpen(false);
  };

  const handleAuth = (newToken, newUser) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    setUser(newUser);
    setToken(newToken);
  };

  const refreshDocuments = async (tk = token) => {
    try {
      const res = await authFetch(tk, "/api/documents");
      if (res.status === 401) return logout();
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch (e) {}
  };

  // Open one chat: fetch its messages and make it the active chat
  const loadChat = async (tk, id, name) => {
    const res = await authFetch(tk, `/api/sessions/${id}`);
    if (res.status === 401) return logout();
    const data = await res.json();
    setSessionId(id);
    setMessages(data.messages && data.messages.length > 0 ? data.messages : [welcome(name)]);
  };

  // Ask the server for a new (or re-usable empty) chat
  const createChat = async () => {
    const res = await authFetch(token, "/api/sessions", { method: "POST" });
    if (res.status === 401) { logout(); return null; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessages(prev => [...prev, { role: "assistant", content: `⚠️ ${data.error || "Could not create a new chat"}` }]);
      return null;
    }
    return data;
  };

  // Load the user's chats + documents whenever we have a (new) token
  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const init = async () => {
      try {
        const [meRes, listRes] = await Promise.all([
          authFetch(token, "/api/auth/me"),
          authFetch(token, "/api/sessions"),
        ]);

        if (meRes.status === 401 || listRes.status === 401) {
          if (!cancelled) logout();
          return;
        }

        const me = await meRes.json();
        const list = await listRes.json();
        let sessions = list.sessions || [];

        if (sessions.length === 0) {
          const created = await authFetch(token, "/api/sessions", { method: "POST" });
          sessions = [await created.json()];
        }
        if (cancelled) return;

        setUser(me.user);
        setChats(sessions);
        await loadChat(token, sessions[0].sessionId, me.user.name);
        refreshDocuments(token);
      } catch (e) {
        if (!cancelled) {
          setMessages([{ role: "assistant", content: "⚠️ Could not connect to server." }]);
        }
      }
    };

    init();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const selectChat = async (id) => {
    if (loading) return;
    setSidebarOpen(false);
    if (id === sessionId) return;
    try {
      await loadChat(token, id, user?.name);
    } catch (e) {
      setMessages([{ role: "assistant", content: "⚠️ Could not open this chat." }]);
    }
  };

  const newChat = async () => {
    if (loading) return;
    setSidebarOpen(false);
    // already sitting on an empty chat - nothing to do
    if (messages.every(m => m.role === "assistant")) return;
    const chat = await createChat();
    if (!chat) return;
    setChats(prev => (prev.some(c => c.sessionId === chat.sessionId) ? prev : [chat, ...prev]));
    setSessionId(chat.sessionId);
    setMessages([welcome(user?.name)]);
  };

  const deleteChat = async (id, e) => {
    e.stopPropagation();
    if (loading) return;
    if (!window.confirm("Delete this chat? This can't be undone.")) return;
    try {
      await authFetch(token, `/api/sessions/${id}`, { method: "DELETE" });
    } catch (err) {
      return;
    }
    const remaining = chats.filter(c => c.sessionId !== id);
    setChats(remaining);

    if (id !== sessionId) return;
    if (remaining.length > 0) {
      await loadChat(token, remaining[0].sessionId, user?.name);
    } else {
      const chat = await createChat();
      if (!chat) return;
      setChats([chat]);
      setSessionId(chat.sessionId);
      setMessages([welcome(user?.name)]);
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading || !sessionId) return;

    // Each assistant message gets an id so streamed updates always hit the right one
    const assistantId = `a-${Date.now()}`;
    const updateAssistant = (patch) =>
      setMessages(prev => prev.map(m => (m.id === assistantId ? { ...m, ...patch } : m)));

    setMessages(prev => [
      ...prev,
      { role: "user", content: text },
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setInput("");
    setLoading(true);

    // Move this chat to the top of the list and name it from the first message
    setChats(prev => {
      const current = prev.find(c => c.sessionId === sessionId);
      const title = current && current.title !== DEFAULT_TITLE ? current.title : makeTitle(text);
      const rest = prev.filter(c => c.sessionId !== sessionId);
      return [{ sessionId, title, updatedAt: new Date().toISOString() }, ...rest];
    });

    try {
      const res = await authFetch(token, "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId }),
      });

      if (res.status === 401) return logout();

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        updateAssistant({ content: `⚠️ Error: ${data.error || "Something went wrong"}` });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";

      setLoading(false); // tokens now render live

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop();

        for (const event of events) {
          const trimmed = event.trim();
          if (!trimmed.startsWith("data:")) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;

          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.token) {
              content += parsed.token;
              updateAssistant({ content });
            }
            if (parsed.done) {
              updateAssistant({ content, sources: parsed.sources || [] });
            }
            if (parsed.error) {
              updateAssistant({ content: `⚠️ Error: ${parsed.error}` });
            }
          } catch (e) {
            // ignore partial/malformed SSE lines
          }
        }
      }
    } catch (err) {
      updateAssistant({ content: "⚠️ Could not connect to server." });
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = async () => {
    if (!sessionId || loading) return;
    await authFetch(token, `/api/sessions/${sessionId}/clear`, { method: "POST" });
    setMessages([{ role: "assistant", content: "Chat cleared! Start fresh 🚀" }]);
    setChats(prev => prev.map(c => (c.sessionId === sessionId ? { ...c, title: DEFAULT_TITLE } : c)));
  };

  const handleUpload = async (file) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await authFetch(token, "/api/documents/upload", {
        method: "POST",
        body: formData,
      });
      if (res.status === 401) return logout();
      const data = await res.json();
      if (data.error) {
        setMessages(prev => [...prev, { role: "assistant", content: `⚠️ Upload failed: ${data.error}` }]);
      } else {
        setMessages(prev => [...prev, { role: "assistant", content: `📎 Got it — I've read "${data.filename}" (${data.chunks} sections) and can now answer questions about it.` }]);
        refreshDocuments();
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: "⚠️ Upload failed - could not reach server." }]);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDoc = async (filename) => {
    try {
      await authFetch(token, `/api/documents/${encodeURIComponent(filename)}`, { method: "DELETE" });
      refreshDocuments();
    } catch (e) {}
  };

  const toggleTheme = () => setTheme(t => (t === "dark" ? "light" : "dark"));

  const exportChat = () => {
    const lines = messages.map(m => `${m.role === "user" ? "You" : "Shiva"}: ${m.content}`);
    const blob = new Blob([lines.join("\n\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shiva-chat-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!token) {
    return <AuthScreen onAuth={handleAuth} theme={theme} />;
  }

  return (
    <div className="app" data-theme={theme}>
      <Sidebar
        chats={chats}
        activeId={sessionId}
        open={sidebarOpen}
        onSelect={selectChat}
        onNew={newChat}
        onDelete={deleteChat}
        onClose={() => setSidebarOpen(false)}
      />
      {sidebarOpen && <div className="backdrop" onClick={() => setSidebarOpen(false)} />}

      <div className="chat-pane">
        <header className="header">
          <div className="header-left">
            <button className="icon-btn menu-btn" onClick={() => setSidebarOpen(o => !o)} title="Chats">☰</button>
            <div className="logo">S</div>
            <div>
              <h1>Shiva</h1>
              <span className="status">● {user ? user.name : "Online"}</span>
            </div>
          </div>
          <div className="header-actions">
            <button className="icon-btn" onClick={toggleTheme} title="Toggle theme">
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
            <button className="icon-btn" onClick={exportChat} title="Export chat">⬇️</button>
            <button className="clear-btn" onClick={clearChat}>Clear Chat</button>
            <button className="icon-btn" onClick={logout} title="Log out">🚪</button>
          </div>
        </header>

        <DocumentsBar
          documents={documents}
          onUpload={handleUpload}
          onDelete={handleDeleteDoc}
          uploading={uploading}
        />

        <main className="chat-area">
          {messages.map((msg, i) => <Message key={msg.id || i} msg={msg} />)}
          {loading && <TypingIndicator />}
          <div ref={bottomRef} />
        </main>

        <footer className="input-area">
          <textarea
            className="input"
            placeholder="Message Shiva... (Enter to send, Shift+Enter for new line)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            rows={1}
          />
          <button
            className={`send-btn ${loading ? "disabled" : ""}`}
            onClick={sendMessage}
            disabled={loading}
          >
            {loading ? "..." : "➤"}
          </button>
        </footer>
      </div>
    </div>
  );
}
