const test = require("node:test");
const assert = require("node:assert");
const vectorStore = require("../services/vectorStore");

const chunk = (userId, filename, chunkIndex, embedding = [1, 0]) => ({
  userId,
  filename,
  chunkIndex,
  text: `${filename} chunk ${chunkIndex}`,
  embedding,
});

test("users only ever see their own documents", () => {
  vectorStore.addToCache(chunk("alice", "alice.pdf", 0));
  vectorStore.addToCache(chunk("bob", "bob.pdf", 0));

  assert.deepStrictEqual(vectorStore.listDocuments("alice"), [{ filename: "alice.pdf", chunkCount: 1 }]);
  assert.deepStrictEqual(vectorStore.listDocuments("bob"), [{ filename: "bob.pdf", chunkCount: 1 }]);
  assert.deepStrictEqual(vectorStore.listDocuments("nobody"), []);

  const found = vectorStore.search("alice", [1, 0]);
  assert.ok(found.every((c) => c.userId === "alice"));
});

test("hasDocuments reflects whether a user uploaded anything", () => {
  vectorStore.addToCache(chunk("carol", "c.pdf", 0));
  assert.strictEqual(vectorStore.hasDocuments("carol"), true);
  assert.strictEqual(vectorStore.hasDocuments("someone-else"), false);
});

test("small knowledge bases are returned whole, in reading order", () => {
  vectorStore.addToCache(chunk("dave", "paper.pdf", 2));
  vectorStore.addToCache(chunk("dave", "paper.pdf", 0));
  vectorStore.addToCache(chunk("dave", "paper.pdf", 1));

  // even a query that matches nothing still gets full context
  const found = vectorStore.search("dave", [0, 1]);
  assert.deepStrictEqual(found.map((c) => c.chunkIndex), [0, 1, 2]);
});

test("large knowledge bases use similarity search and drop irrelevant chunks", () => {
  vectorStore.addToCache(chunk("erin", "big.pdf", 0, [1, 0])); // relevant
  for (let i = 1; i <= 14; i++) vectorStore.addToCache(chunk("erin", "big.pdf", i, [0, 1])); // unrelated

  const found = vectorStore.search("erin", [1, 0]);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].chunkIndex, 0);
});

test("large knowledge bases return at most k chunks", () => {
  for (let i = 0; i < 20; i++) vectorStore.addToCache(chunk("frank", "all-relevant.pdf", i, [1, 0]));

  const found = vectorStore.search("frank", [1, 0], 6);
  assert.strictEqual(found.length, 6);
});

test("removing a document only removes that user's copy", () => {
  vectorStore.addToCache(chunk("gina", "same-name.pdf", 0));
  vectorStore.addToCache(chunk("hari", "same-name.pdf", 0));

  vectorStore.removeFromCache("gina", "same-name.pdf");

  assert.deepStrictEqual(vectorStore.listDocuments("gina"), []);
  assert.deepStrictEqual(vectorStore.listDocuments("hari"), [{ filename: "same-name.pdf", chunkCount: 1 }]);
});
