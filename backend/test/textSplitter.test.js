const test = require("node:test");
const assert = require("node:assert");
const { chunkText } = require("../services/textSplitter");

test("returns no chunks for empty or whitespace-only text", () => {
  assert.deepStrictEqual(chunkText(""), []);
  assert.deepStrictEqual(chunkText("   \n\t  "), []);
});

test("keeps short text as a single chunk", () => {
  const chunks = chunkText("Shiva is a RAG chatbot. It answers from your documents.");
  assert.strictEqual(chunks.length, 1);
  assert.match(chunks[0], /Shiva is a RAG chatbot/);
});

test("splits long text into several reasonably sized chunks", () => {
  const text = Array.from({ length: 200 }, (_, i) => `Sentence number ${i + 1} is here.`).join(" ");
  const chunks = chunkText(text);

  assert.ok(chunks.length > 1, "expected more than one chunk");
  assert.ok(chunks[0].startsWith("Sentence number 1 "), "first chunk should start at the beginning");
  for (const c of chunks) {
    assert.ok(c.length <= 1000, `chunk too long: ${c.length}`);
  }
});

test("neighbouring chunks overlap so ideas are not cut in half", () => {
  const text = Array.from({ length: 120 }, (_, i) => `Fact ${i + 1} about retrieval.`).join(" ");
  const chunks = chunkText(text, 400, 100);

  assert.ok(chunks.length > 2);
  const tailOfFirst = chunks[0].slice(-40);
  assert.ok(chunks[1].includes(tailOfFirst), "second chunk should repeat the end of the first");
});

test("normalises Windows line endings and repeated spaces", () => {
  const chunks = chunkText("Line one.\r\nLine   two.");
  assert.strictEqual(chunks.length, 1);
  assert.ok(!chunks[0].includes("\r"));
  assert.ok(!chunks[0].includes("  "));
});
