import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDocCache } from "../lib/docs.js";
import { USER_AGENT, VERSION } from "../lib/version.js";
import { INSTRUCTIONS } from "../server.js";
import {
  connect,
  fakeFetch,
  makeDeps,
  offline,
  text,
} from "./helpers/fakes.js";

const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
) as { name: string; version: string; bin: Record<string, string> };

beforeEach(() => resetDocCache());

describe("server", () => {
  it("MCP-01: registers exactly the documented tools, each with a title, description and JSON-schema input", async () => {
    const client = await connect(makeDeps());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "check_domain",
        "create_link",
        "explain_match_result",
        "get_setup_guide",
        "list_links",
        "migrate_from",
        "search_docs",
      ].sort()
    );
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.description?.length, tool.name).toBeGreaterThan(80);
      expect(tool.inputSchema.type).toBe("object");
    }
    const setup = tools.find((t) => t.name === "get_setup_guide");
    expect(setup?.inputSchema.properties?.platform).toMatchObject({
      enum: ["ios", "android", "react-native", "expo", "flutter"],
    });
    expect(setup?.inputSchema.required).toEqual(["platform"]);
    await client.close();
  });

  it("MCP-01: is published as @deeplinknow/mcp with a deeplinknow-mcp bin", () => {
    expect(pkg.name).toBe("@deeplinknow/mcp");
    expect(pkg.bin["deeplinknow-mcp"]).toBe("dist/index.js");
  });

  it("MCP-02: reports the package version and names itself in the User-Agent", async () => {
    expect(VERSION).toBe(pkg.version);
    expect(USER_AGENT).toContain(`DeepLinkNow-MCP/${pkg.version}`);
    const client = await connect(makeDeps());
    expect(client.getServerVersion()).toMatchObject({
      name: "deeplinknow",
      version: pkg.version,
    });
    await client.close();
  });

  it("MCP-04: marks every tool but create_link read-only", async () => {
    const client = await connect(makeDeps());
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(
        tool.name !== "create_link"
      );
      expect(tool.annotations?.destructiveHint, tool.name).toBe(false);
    }
    await client.close();
  });

  it("MCP-05: instructions say DeepLinkNow does deep linking only and the app holds only the public key", async () => {
    expect(INSTRUCTIONS).toMatch(/deep linking only/);
    expect(INSTRUCTIONS).toMatch(
      /No attribution, ad tracking or advertising IDs/
    );
    expect(INSTRUCTIONS).toMatch(/public key \(dln_pub_/);
    expect(INSTRUCTIONS).toMatch(/nothing has to be created first/);
    const client = await connect(makeDeps());
    expect(client.getInstructions()).toBe(INSTRUCTIONS);
    await client.close();
  });

  it("MCP-25: exposes llms.txt and each docs page as resources, live with a bundled fallback", async () => {
    const { fetch, calls } = fakeFetch((call) =>
      call.url === "https://deeplinknow.com/llms.txt"
        ? text("# DeepLinkNow live index", 200, "text/plain; charset=utf-8")
        : offline(call)
    );
    const client = await connect(makeDeps({ fetch }));
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain("deeplinknow://llms.txt");
    expect(uris).toContain("deeplinknow://docs/ios");
    expect(uris).toContain("deeplinknow://docs/firebase-migration");

    const llms = await client.readResource({ uri: "deeplinknow://llms.txt" });
    expect(llms.contents[0]).toMatchObject({
      text: "# DeepLinkNow live index",
    });

    const ios = await client.readResource({ uri: "deeplinknow://docs/ios" });
    const [page] = ios.contents;
    expect(page && "text" in page ? page.text : "").toMatch(
      /^# DeepLinkNow iOS SDK/
    );
    expect(
      calls.some((c) => c.url === "https://deeplinknow.com/docs/ios.md")
    ).toBe(true);

    await expect(
      client.readResource({ uri: "deeplinknow://docs/../../etc/passwd" })
    ).rejects.toThrow();
    await expect(
      client.readResource({ uri: "deeplinknow://docs/secrets" })
    ).rejects.toThrow(/Unknown docs page/);
    await client.close();
  });

  it("MCP-26: offers setup and migration prompts that drive the tools", async () => {
    const client = await connect(makeDeps());
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([
      "add_deferred_deep_linking",
      "migrate_to_deeplinknow",
    ]);
    const setup = await client.getPrompt({
      arguments: { platform: "expo" },
      name: "add_deferred_deep_linking",
    });
    const body = JSON.stringify(setup.messages);
    expect(body).toContain('get_setup_guide with platform \\"expo\\"');
    expect(body).toContain("never put the private key in the app");
    const migrate = await client.getPrompt({
      arguments: { platform: "ios", source: "branch" },
      name: "migrate_to_deeplinknow",
    });
    expect(JSON.stringify(migrate.messages)).toContain(
      "Keep branch if the app uses it for attribution"
    );
    await client.close();
  });
});
