/**
 * Example: buggy fetch script for testing slog.
 *
 * Run:  node examples/buggy-fetch.mjs
 *
 * Bug: the response body is consumed twice — once via .json() and once via
 * .text() — which throws "body already consumed". The error is posted to slog
 * so you can query it with `slog query`.
 */

const SLOG_URL = "http://localhost:4526/log";

async function postToSlog(entry) {
  try {
    await fetch(SLOG_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
  } catch {
    // slog server not running — silently skip
  }
}

async function main() {
  const url = "https://jsonplaceholder.typicode.com/todos/1";

  await postToSlog({ message: "fetching todo", level: "info", url });

  try {
    const res = await fetch(url);

    // Bug: consuming the body twice — .json() reads the stream, then .text()
    // tries to read it again and throws.
    const data = await res.json();
    const raw = await res.text(); // 💥 TypeError: body already consumed

    console.log("data:", data);
    console.log("raw:", raw);
  } catch (err) {
    console.error("caught error:", err.message);

    await postToSlog({
      message: err.message,
      level: "error",
      source: "buggy-fetch.mjs",
      "error.type": err.constructor.name,
      url,
    });
  }
}

main();
