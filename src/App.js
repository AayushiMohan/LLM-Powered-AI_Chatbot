/* eslint-disable no-loop-func */
import { useState, useRef, useEffect } from "react";
import "./App.css";

const API_URL = "http://localhost:5000";

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
          {msg.content.split("\n").map((line, i, arr) => (
            <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
          ))}
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
        title="Upload a .pdf or .txt file for Shiva to reference"
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

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [theme, setTheme] = useState("dark");
  const bottomRef = useRef(null);

  const refreshDocuments = async () => {
    try {
      const res = await fetch(`${API_URL}/api/documents`);
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch (e) {}
  };

  useEffect(() => {
    const initSession = async () => {
      let sid = localStorage.getItem("shiva_session_id");

      if (sid) {
        try {
          const res = await fetch(`${API_URL}/api/session/${sid}`);
          if (res.ok) {
            const data = await res.json();
            setSessionId(sid);
            setMessages(
              data.messages.length > 0
                ? data.messages
                : [{ role: "assistant", content: "Welcome back! I'm Shiva 👋 Ask me anything!" }]
            );
            refreshDocuments();
            return;
          }
        } catch (e) {}
      }

      try {
        const res = await fetch(`${API_URL}/api/session`, { method: "POST" });
        const data = await res.json();
        localStorage.setItem("shiva_session_id", data.sessionId);
        setSessionId(data.sessionId);
        setMessages([{ role: "assistant", content: "Hey! I'm Shiva 👋 Your AI assistant. Ask me anything! You can also upload a PDF or text file and I'll answer questions about it." }]);
        refreshDocuments();
      } catch (e) {
        setMessages([{ role: "assistant", content: "⚠️ Could not connect to server." }]);
      }
    };

    initSession();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading || !sessionId) return;

    setMessages(prev => [...prev, { role: "user", content: text }]);
    setInput("");
    setLoading(true);

    // Placeholder assistant message that we'll fill in as tokens stream in
    let assistantIndex;
    setMessages(prev => {
      assistantIndex = prev.length;
      return [...prev, { role: "assistant", content: "" }];
    });

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setMessages(prev => {
          const copy = [...prev];
          copy[assistantIndex] = { role: "assistant", content: `⚠️ Error: ${data.error || "Something went wrong"}` };
          return copy;
        });
        setLoading(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";

      setLoading(false); // typing indicator was for "waiting to start"; now tokens render live

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;

          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.token) {
              content += parsed.token;
              const snapshot = content;
              setMessages(prev => {
                const copy = [...prev];
                copy[assistantIndex] = { role: "assistant", content: snapshot };
                return copy;
              });
            }
            if (parsed.done) {
              const sources = parsed.sources || [];
              setMessages(prev => {
                const copy = [...prev];
                copy[assistantIndex] = { role: "assistant", content, sources };
                return copy;
              });
            }
            if (parsed.error) {
              setMessages(prev => {
                const copy = [...prev];
                copy[assistantIndex] = { role: "assistant", content: `⚠️ Error: ${parsed.error}` };
                return copy;
              });
            }
          } catch (e) {
            // ignore partial/malformed SSE lines
          }
        }
      }
    } catch (err) {
      setMessages(prev => {
        const copy = [...prev];
        copy[assistantIndex] = { role: "assistant", content: "⚠️ Could not connect to server." };
        return copy;
      });
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
    if (!sessionId) return;
    await fetch(`${API_URL}/api/session/${sessionId}`, { method: "DELETE" });
    setMessages([{ role: "assistant", content: "Chat cleared! Start fresh 🚀" }]);
  };

  const handleUpload = async (file) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${API_URL}/api/documents/upload`, {
        method: "POST",
        body: formData,
      });
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
      await fetch(`${API_URL}/api/documents/${encodeURIComponent(filename)}`, { method: "DELETE" });
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

  return (
    <div className="app" data-theme={theme}>
      <header className="header">
        <div className="header-left">
          <div className="logo">S</div>
          <div>
            <h1>Shiva</h1>
            <span className="status">● Online</span>
          </div>
        </div>
        <div className="header-actions">
          <button className="icon-btn" onClick={toggleTheme} title="Toggle theme">
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <button className="icon-btn" onClick={exportChat} title="Export chat">⬇️</button>
          <button className="clear-btn" onClick={clearChat}>Clear Chat</button>
        </div>
      </header>

      <DocumentsBar
        documents={documents}
        onUpload={handleUpload}
        onDelete={handleDeleteDoc}
        uploading={uploading}
      />

      <main className="chat-area">
        {messages.map((msg, i) => <Message key={i} msg={msg} />)}
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
  );
}