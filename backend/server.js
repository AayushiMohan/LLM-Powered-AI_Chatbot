const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fetch = (...args) =>
  import("node-fetch").then(({ default: f }) => f(...args));
require("dotenv").config();

const User = require("./models/User");
const Session = require("./models/Session");
const DocumentChunk = require("./models/DocumentChunk");
const { chunkText } = require("./services/textSplitter");
const { embedText, embedBatch } = require("./services/embeddingService");
const vectorStore = require("./services/vectorStore");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("❌ JWT_SECRET is missing. Add it to your .env (and to Render's environment variables).");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

// Uploaded files kept in memory only long enough to extract their text.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB connected");
    await vectorStore.loadCacheFromDB(); // warm the RAG cache on startup
  })
  .catch((err) => console.error("❌ MongoDB error:", err));

const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ---------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const signToken = (user) =>
  jwt.sign({ id: user._id.toString() }, JWT_SECRET, { expiresIn: "7d" });

const publicUser = (user) => ({ name: user.name, email: user.email });

// Protects a route: requires "Authorization: Bearer <token>"
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Please log in" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.id;
    next();
  } catch (e) {
    res.status(401).json({ error: "Session expired, please log in again" });
  }
}

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email" });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const normalized = email.trim().toLowerCase();
    if (await User.findOne({ email: normalized })) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: (name || "").trim() || normalized.split("@")[0],
      email: normalized,
      passwordHash,
    });

    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await User.findOne({ email: String(email).trim().toLowerCase() });
    const ok = user && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) return res.status(401).json({ error: "Invalid email or password" });

    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(401).json({ error: "Account not found" });
    res.json({ user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// PDF extraction (column-aware for two-column academic papers)
// ---------------------------------------------------------------------
async function renderPageText(pageData) {
  const textContent = await pageData.getTextContent();
  const items = textContent.items;
  if (items.length === 0) return "";

  const pageWidth = pageData.view ? pageData.view[2] : 612;
  const midX = pageWidth / 2;

  const left = [];
  const right = [];
  for (const item of items) {
    const x = item.transform[4];
    const y = item.transform[5];
    (x < midX ? left : right).push({ x, y, str: item.str });
  }

  // Not meaningfully split across both halves -> single column page.
  const minoritySize = Math.min(left.length, right.length);
  const isTwoColumn = minoritySize / items.length > 0.15;

  const byReadingOrder = (arr) => arr.sort((a, b) => (b.y - a.y) || (a.x - b.x));

  if (!isTwoColumn) {
    const all = byReadingOrder([...left, ...right]);
    return all.map((i) => i.str).join(" ");
  }

  byReadingOrder(left);
  byReadingOrder(right);
  return left.map((i) => i.str).join(" ") + "\n" + right.map((i) => i.str).join(" ");
}

async function extractPdfText(buffer) {
  const parsed = await pdfParse(buffer, { pagerender: renderPageText });
  return parsed.text;
}

// ---------------------------------------------------------------------
// Chats (many per user)
// ---------------------------------------------------------------------
const DEFAULT_TITLE = "New chat";
const MAX_CHATS_PER_USER = 100;

const makeTitle = (text) => {
  const t = String(text).replace(/\s+/g, " ").trim();
  return t.length > 40 ? t.slice(0, 40).trimEnd() + "…" : t;
};

// List the user's chats (newest first). Only the first message is loaded,
// just enough to name older chats that don't have a title yet.
app.get("/api/sessions", requireAuth, async (req, res) => {
  try {
    const sessions = await Session.find(
      { userId: req.userId },
      { messages: { $slice: 1 } }
    )
      .sort({ updatedAt: -1 })
      .limit(MAX_CHATS_PER_USER)
      .lean();

    res.json({
      sessions: sessions.map((s) => {
        const first = s.messages && s.messages[0];
        const title =
          s.title && s.title !== DEFAULT_TITLE
            ? s.title
            : first && first.role === "user"
            ? makeTitle(first.content)
            : DEFAULT_TITLE;
        return { sessionId: s.sessionId, title, updatedAt: s.updatedAt };
      }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start a new chat (re-uses an existing empty one instead of piling up blanks).
app.post("/api/sessions", requireAuth, async (req, res) => {
  try {
    let session = await Session.findOne({ userId: req.userId, messages: { $size: 0 } });
    if (!session) {
      const count = await Session.countDocuments({ userId: req.userId });
      if (count >= MAX_CHATS_PER_USER) {
        return res.status(400).json({ error: "Chat limit reached. Please delete some old chats." });
      }
      session = await Session.create({
        sessionId: uuidv4(),
        userId: req.userId,
        title: DEFAULT_TITLE,
        messages: [],
      });
    }
    res.json({
      sessionId: session.sessionId,
      title: session.title || DEFAULT_TITLE,
      updatedAt: session.updatedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Load one chat's messages.
app.get("/api/sessions/:sessionId", requireAuth, async (req, res) => {
  try {
    const session = await Session.findOne({ sessionId: req.params.sessionId, userId: req.userId });
    if (!session) return res.status(404).json({ error: "Chat not found" });
    res.json({ sessionId: session.sessionId, messages: session.messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Empty a chat but keep it in the list.
app.post("/api/sessions/:sessionId/clear", requireAuth, async (req, res) => {
  try {
    await Session.findOneAndUpdate(
      { sessionId: req.params.sessionId, userId: req.userId },
      { messages: [], title: DEFAULT_TITLE, updatedAt: new Date() }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a chat completely.
app.delete("/api/sessions/:sessionId", requireAuth, async (req, res) => {
  try {
    await Session.deleteOne({ sessionId: req.params.sessionId, userId: req.userId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// RAG: private per-user documents
// ---------------------------------------------------------------------
app.post("/api/documents/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const { originalname, buffer, mimetype } = req.file;
    const lowerName = originalname.toLowerCase();
    let text = "";

    if (mimetype === "application/pdf" || lowerName.endsWith(".pdf")) {
      text = await extractPdfText(buffer);
    } else if (
      lowerName.endsWith(".docx") ||
      mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else {
      text = buffer.toString("utf-8");
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      return res.status(400).json({ error: "Could not extract any text from this file" });
    }

    const embeddings = await embedBatch(chunks);

    // Re-uploading the same filename replaces the old copy instead of duplicating it.
    await DocumentChunk.deleteMany({ userId: req.userId, filename: originalname });
    vectorStore.removeFromCache(req.userId, originalname);

    const docs = await DocumentChunk.insertMany(
      chunks.map((chunk, i) => ({
        userId: req.userId,
        filename: originalname,
        chunkIndex: i,
        text: chunk,
        embedding: embeddings[i],
      }))
    );

    docs.forEach((d) => vectorStore.addToCache(d.toObject ? d.toObject() : d));

    res.json({ filename: originalname, chunks: chunks.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Upload failed: " + err.message });
  }
});

app.get("/api/documents", requireAuth, (req, res) => {
  res.json({ documents: vectorStore.listDocuments(req.userId) });
});

app.delete("/api/documents/:filename", requireAuth, async (req, res) => {
  try {
    await DocumentChunk.deleteMany({ userId: req.userId, filename: req.params.filename });
    vectorStore.removeFromCache(req.userId, req.params.filename);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// Chat - retrieval-augmented, streamed (SSE), only uses this user's documents
// ---------------------------------------------------------------------
app.post("/api/chat", requireAuth, async (req, res) => {
  const { message, sessionId } = req.body || {};

  if (!message || typeof message !== "string" || !sessionId) {
    return res.status(400).json({ error: "message and sessionId required" });
  }
  if (message.length > 4000) {
    return res.status(400).json({ error: "Message is too long (max 4000 characters)" });
  }

  try {
    // userId in the query makes sure nobody can chat into someone else's session
    const session = await Session.findOne({ sessionId, userId: req.userId });
    if (!session) return res.status(404).json({ error: "Session not found" });

    if (session.messages.length === 0) session.title = makeTitle(message);
    session.messages.push({ role: "user", content: message });

    const recentMessages = session.messages.slice(-20).map(m => ({
      role: m.role,
      content: m.content
    }));

    // --- RAG retrieval step (only this user's documents) ---
    let systemContent = "You are Shiva, a helpful and friendly AI assistant. You are knowledgeable, concise, and always try to give the most useful response possible. Format answers with Markdown when it helps readability.";

    // Skip the embedding model entirely if the user has no documents (faster plain chat).
    const queryEmbedding = vectorStore.hasDocuments(req.userId) ? await embedText(message) : null;
    const relevantChunks = vectorStore.search(req.userId, queryEmbedding, 4);

    if (relevantChunks.length > 0) {
      const contextBlock = relevantChunks
        .map((c, i) => `[${i + 1}] (from ${c.filename}): ${c.text}`)
        .join("\n\n");

      systemContent += `\n\nUse the following retrieved context to answer the user's question when it's relevant. If the context doesn't contain the answer, say so and answer from your own knowledge instead. Do not mention "chunks" or the retrieval mechanism to the user - just answer naturally.\n\nContext:\n${contextBlock}`;
    }

    const sources = [...new Set(relevantChunks.map((c) => c.filename))];

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: systemContent },
          ...recentMessages
        ],
        max_tokens: 1024,
        temperature: 0.8,
        stream: true
      })
    });

    if (!groqResponse.ok) {
      const errData = await groqResponse.json().catch(() => ({}));
      return res.status(500).json({ error: errData.error?.message || "Groq API error" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let fullReply = "";
    let buffer = "";

    for await (const chunk of groqResponse.body) {
      buffer += chunk.toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete line for next chunk

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;

        try {
          const parsed = JSON.parse(payload);
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) {
            fullReply += token;
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
          }
        } catch (e) {
          // ignore malformed partial JSON lines
        }
      }
    }

    session.messages.push({ role: "assistant", content: fullReply || "(no response)" });
    session.updatedAt = new Date();
    await session.save();

    res.write(`data: ${JSON.stringify({ done: true, sources })}\n\n`);
    res.end();

  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Server error: " + err.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
