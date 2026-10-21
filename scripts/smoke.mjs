// Starts the built server over stdio, like an MCP client would, and lists its tools.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  args: [new URL("../dist/index.js", import.meta.url).pathname],
  command: process.execPath,
});
const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(transport);
const info = client.getServerVersion();
const { tools } = await client.listTools();
const { resources } = await client.listResources();
const { prompts } = await client.listPrompts();
console.log(`${info?.name} ${info?.version}`);
for (const tool of tools) {
  console.log(`tool      ${tool.name}: ${tool.title}`);
}
for (const resource of resources) {
  console.log(`resource  ${resource.uri}`);
}
for (const prompt of prompts) {
  console.log(`prompt    ${prompt.name}`);
}
const explained = await client.callTool({
  arguments: { confidence_score: 60 },
  name: "explain_match_result",
});
console.log(
  `\nexplain_match_result(60): ${explained.content[0].text.split("\n")[3]}`
);
await client.close();
