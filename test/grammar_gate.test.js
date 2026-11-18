import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Il correttore vero (LanguageTool) non gira nei test: si usa un server finto con la stessa API /v2/check.
test("grammar_gate raccoglie le segnalazioni del correttore", async () => {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const text = new URLSearchParams(body).get("text") || "";
      const matches = / sono /.test(text) ? [{ message: "finto", rule: { id: "FINTA" }, context: { text }, replacements: [] }] : [];
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ matches }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const out = mkdtempSync(join(tmpdir(), "gate-"));
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    // Asincrono: il server finto gira in questo processo e deve poter rispondere.
    await run(process.execPath, [join(root, "tools/grammar_gate.mjs"), "--backend", "lt", "--url", `http://localhost:${port}`, "--limit", "60", "--out", out], { timeout: 100000 });
  } finally {
    server.close();
  }
  const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
  assert.equal(report.total, 60);
  assert.equal(report.byRule.FINTA, report.flagged);
});
