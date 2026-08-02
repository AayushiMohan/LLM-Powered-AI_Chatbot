# 🤖 Shiva – AI Chatbot with RAG

A full-stack conversational AI chatbot powered by Groq's LLaMA 3.3 model, built with React and Node.js — now with **Retrieval-Augmented Generation (RAG)**, letting Shiva answer questions grounded in documents you upload.

![Tech Stack](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)
![Groq](https://img.shields.io/badge/Groq_API-F55036?style=for-the-badge&logo=groq&logoColor=white)

🔗 **Live Demo:** https://chat-shiva.vercel.app/

---

## Overview

Shiva is a responsive AI chatbot that uses the Groq API (LLaMA 3.3 70B) to generate intelligent, context-aware responses. It supports multi-turn conversations with full session memory, and can now ingest your own documents (PDF, DOCX, TXT) — retrieving the most relevant passages via local embeddings and injecting them into the LLM's context so answers are grounded in your actual content, not just the model's training data.

---

## Features

-  **Retrieval-Augmented Generation (RAG)** — upload PDF/DOCX/TXT files, Shiva answers using their content
-  Free, local embedding generation (`@xenova/transformers`, no API key required)
-  Cosine-similarity vector search over document chunks, stored in MongoDB
-  Real-time **streaming responses** — tokens appear as they're generated
-  **Source citations** — see which uploaded document each answer came from
-  Multi-turn conversation with full session memory
-  Dark/light theme toggle
-  Export chat history as a text file
-  Real-time typing indicator, Enter to send / Shift+Enter for new line
-  Clear chat and remove uploaded documents anytime

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React, CSS |
| Backend | Node.js, Express.js |
| Database | MongoDB (Atlas) — sessions & document chunks |
| AI Model | Groq API — LLaMA 3.3 70B |
| Embeddings | `@xenova/transformers` (Xenova/all-MiniLM-L6-v2), runs locally |
| Document Parsing | `pdf-parse` (PDF), `mammoth` (DOCX) |
| Deployment | Render (backend), Vercel (frontend) |
| Dev Tool | Nodemon |

---

## Getting Started

### Prerequisites
- Node.js (v18 or above)
- Free Groq API key from [console.groq.com](https://console.groq.com)
- A MongoDB connection string (local install or free [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) cluster)

### 1. Clone the repo
```bash
git clone https://github.com/AayushiMohan/LLM-Powered-AI_Chatbot.git
cd LLM-Powered-AI_Chatbot
```

### 2. Setup Backend
```bash
cd backend
npm install
```

Create a `.env` file inside `backend/`:
```
GROQ_API_KEY=your_groq_api_key_here
MONGO_URI=your_mongodb_connection_string_here
PORT=5000
```

Start the server:
```bash
npm run dev
```
> Server runs on http://localhost:5000
> First run downloads the local embedding model (~90MB) — needs internet once, then works offline.

---

### 3. Setup Frontend
Open a new terminal:
```bash
cd frontend
npm install
npm start
```
> App runs on http://localhost:3000

---

### 4. Open in browser
Visit **http://localhost:3000**, click **📎 Add knowledge** to upload a document, and start chatting!

> Both backend and frontend must be running at the same time for local development.

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GROQ_API_KEY` | Your Groq API key from console.groq.com |
| `MONGO_URI` | MongoDB connection string (sessions + document chunks are stored here) |
| `PORT` | Backend port (default: 5000) |

For the deployed frontend, set `REACT_APP_API_URL` to your deployed backend URL (e.g. on Vercel/Render environment variables).

---

## How RAG Works Here

1. **Ingest** — uploaded file → text extracted → split into overlapping chunks → each chunk embedded into a vector → stored in MongoDB and cached in memory.
2. **Retrieve** — user's message is embedded, compared via cosine similarity against cached chunk vectors, top matches selected.
3. **Augment** — matched chunks are injected into the system prompt as context.
4. **Generate** — the augmented prompt is sent to Groq's LLaMA 3.3, streamed back token by token, with source filenames attached to the response.

---

## Future Improvements
- Per-session (private) document uploads instead of a shared knowledge base
- User authentication
- Multiple AI personas
- Migrate vector search to MongoDB Atlas Vector Search for larger-scale corpora
---
