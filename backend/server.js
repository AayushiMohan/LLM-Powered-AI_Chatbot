const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const fetch = (...args) =>
  import("node-fetch").then(({ default: f }) => f(...args));
require("dotenv").config();
console.log("MONGO_URI:", process.env.MONGO_URI); // debug

const Session = require("./models/Session");
const DocumentChunk = require("./models/DocumentChunk");
const { chunkText } = require("./services/textSplitter");
const { embedText, embedBatch } = require("./services/embeddingService");
const vectorStore = require("./services/vectorStore");

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

app.post("/api/session", async (req, res) => {
  try {
    const sessionId = uuidv4();
    await Session.create({ sessionId, messages: [] });
    res.json({ sessionId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/session/:sessionId", async (req, res) => {
  try {
    const session = await Session.findOne({ sessionId: req.params.sessionId });
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json({ messages: session.messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// RAG: document upload + ingestion
// ---------------------------------------------------------------------
app.post("/api/documents/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const { originalname, buffer, mimetype } = req.file;
    const lowerName = originalname.toLowerCase();
    let text = "";

    if (mimetype === "application/pdf" || lowerName.endsWith(".pdf")) {
      const parsed = await pdfParse(buffer);
      text = parsed.text;
    } else if (
      lowerName.endsWith(".docx") ||
      mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else {
      // .txt, .md, and anything else plain-text
      text = buffer.toString("utf-8");
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      return res.status(400).json({ error: "Could not extract any text from this file" });
    }

    const embeddings = await embedBatch(chunks);

    const docs = await DocumentChunk.insertMany(
      chunks.map((chunk, i) => ({
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

app.get("/api/documents", (req, res) => {
  res.json({ documents: vectorStore.listDocuments() });
});

app.delete("/api/documents/:filename", async (req, res) => {
  try {
    await DocumentChunk.deleteMany({ filename: req.params.filename });
    vectorStore.removeFromCache(req.params.filename);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// Chat - now retrieval-augmented
// ---------------------------------------------------------------------
// Streaming chat endpoint - sends tokens to the client as they arrive (SSE),
// and a final event with the list of sources used for RAG citations.
app.post("/api/chat", async (req, res) => {
  const { message, sessionId } = req.body;

  if (!message || !sessionId) {
    return res.status(400).json({ error: "message and sessionId required" });
  }

  try {
    const session = await Session.findOne({ sessionId });
    if (!session) return res.status(404).json({ error: "Session not found" });

    session.messages.push({ role: "user", content: message });

    const recentMessages = session.messages.slice(-20).map(m => ({
      role: m.role,
      content: m.content
    }));

    // --- RAG retrieval step ---
    let systemContent = "You are Shiva, a helpful and friendly AI assistant. You are knowledgeable, concise, and always try to give the most useful response possible.";

    const queryEmbedding = await embedText(message);
    const relevantChunks = vectorStore.search(queryEmbedding, 4);

    if (relevantChunks.length > 0) {
      const contextBlock = relevantChunks
        .map((c, i) => `[${i + 1}] (from ${c.filename}): ${c.text}`)
        .join("\n\n");

      systemContent += `\n\nUse the following retrieved context to answer the user's question when it's relevant. If the context doesn't contain the answer, say so and answer from your own knowledge instead. Do not mention "chunks" or the retrieval mechanism to the user - just answer naturally.\n\nContext:\n${contextBlock}`;
    }

    // Unique source filenames, in relevance order
    const sources = [...new Set(relevantChunks.map((c) => c.filename))];

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
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

    // Set up SSE response to the frontend
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

    session.messages.push({ role: "assistant", content: fullReply });
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

app.delete("/api/session/:sessionId", async (req, res) => {
  try {
    await Session.findOneAndUpdate(
      { sessionId: req.params.sessionId },
      { messages: [], updatedAt: new Date() }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));