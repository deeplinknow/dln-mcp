import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (file: string) =>
  readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

describe("package", () => {
  beforeAll(() => {
    // The stdio test runs the real build output.
    execFileSync("npx", ["tsc", "-p", "tsconfig.build.json"], {
      cwd: root,
      stdio: "pipe",
    });
  }, 60_000);

  it("MCP-03, MCP-71: the built bin starts over stdio, lists the tools and writes nothing else to stdout", async () => {
    const bin = `${root}dist/index.js`;
    expect(existsSync(bin)).toBe(true);
    expect(read("dist/index.js").startsWith("#!/usr/bin/env node")).toBe(true);
    const stderr: string[] = [];
    const transport = new StdioClientTransport({
      args: [bin],
      command: process.execPath,
      env: {
        DEEPLINKNOW_API_KEY: "dln_priv_stdiosecretstdiosecretstdiosecr",
        PATH: process.env.PATH ?? "",
      },
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk: Buffer) =>
      stderr.push(chunk.toString())
    );
    const client = new Client({ name: "package-test", version: "0.0.0" });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(7);
    const noKey = await client.callTool({
      arguments: { confidence_score: 80 },
      name: "explain_match_result",
    });
    expect(JSON.stringify(noKey)).toContain("HIGH");
    await client.close();
    expect(stderr.join("")).not.toContain("stdiosecret");
  }, 30_000);

  it("MCP-70: ships an MIT licence and README install snippets for Claude Code, Cursor, VS Code and Windsurf", () => {
    const licence = read("LICENSE");
    expect(licence).toContain("MIT License");
    expect(licence).toContain("Copyright (c) 2026 DeepLinkNow");
    const pkg = JSON.parse(read("package.json")) as {
      license: string;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.license).toBe("MIT");
    for (const version of [
      ...Object.values(pkg.dependencies),
      ...Object.values(pkg.devDependencies),
    ]) {
      expect(version, "dependencies are pinned to exact versions").toMatch(
        /^\d+\.\d+\.\d+$/
      );
    }

    const readme = read("README.md");
    expect(readme).toContain(
      "claude mcp add deeplinknow -- npx -y @deeplinknow/mcp"
    );
    for (const client of ["Cursor", "VS Code", "Windsurf"]) {
      expect(readme).toContain(`### ${client}`);
    }
    const blocks = [...readme.matchAll(/```json\n([\s\S]*?)```/g)].map(
      (m) => m[1] ?? ""
    );
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    for (const block of blocks) {
      const config = JSON.parse(block) as Record<string, unknown>;
      expect(JSON.stringify(config)).toContain(
        '"args":["-y","@deeplinknow/mcp"]'
      );
    }
    expect(
      statSync(new URL("../../AGENTS.md", import.meta.url)).size
    ).toBeGreaterThan(500);
  });
});
