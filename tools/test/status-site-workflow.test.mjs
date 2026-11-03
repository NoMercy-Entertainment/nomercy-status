import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/status-site.yml", import.meta.url), "utf8");

test("status rebuild pushes with a token that can trigger Static Site CI", () => {
  assert.match(workflow, /id: app_token/);
  assert.match(workflow, /uses: actions\/create-github-app-token@v3/);
  assert.match(workflow, /token: \$\{\{ steps\.app_token\.outputs\.token \|\| secrets\.GH_PAT \|\| github\.token \}\}/);
});
