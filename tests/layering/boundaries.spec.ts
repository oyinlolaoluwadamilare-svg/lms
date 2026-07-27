import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// Proves the layering rule in docs/03-architecture.md is a real, enforced guardrail
// and not merely documentation: "domain imports nothing from data, services, app or
// ui." docs/08-prompt-playbook.md Session 1 asks for exactly this — a deliberate
// violation shown failing lint — kept here as a permanent regression test rather
// than a one-off manual check, so a future refactor can't quietly weaken the rule.

const root = path.resolve(__dirname, "../..");
const violationDir = path.join(root, "src/domain/__lint_fixture__");
const violationFile = path.join(violationDir, "violates_layering.ts");

describe("layering guardrail (boundaries/element-types)", () => {
  beforeAll(() => {
    mkdirSync(violationDir, { recursive: true });
    writeFileSync(
      violationFile,
      `import { _placeholder } from "../../data/_placeholder";\nexport const x = _placeholder;\n`,
    );
  });

  afterAll(() => {
    rmSync(violationDir, { recursive: true, force: true });
  });

  it("flags a domain module importing from data", async () => {
    const eslint = new ESLint({ cwd: root, overrideConfigFile: "eslint.config.mjs" });
    const [result] = await eslint.lintFiles([violationFile]);
    const violation = result?.messages.find((m) => m.ruleId === "boundaries/element-types");
    expect(
      violation,
      `expected boundaries/element-types to fire; got: ${JSON.stringify(result?.messages)}`,
    ).toBeDefined();
  });

  it("does not flag a domain module importing only from lib", async () => {
    writeFileSync(
      violationFile,
      `export const y = 1; // no cross-boundary import\n`,
    );
    const eslint = new ESLint({ cwd: root, overrideConfigFile: "eslint.config.mjs" });
    const [result] = await eslint.lintFiles([violationFile]);
    const violation = result?.messages.find((m) => m.ruleId === "boundaries/element-types");
    expect(violation).toBeUndefined();
  });
});
