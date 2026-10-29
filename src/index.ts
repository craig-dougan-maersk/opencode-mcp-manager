import { Plugin } from "@opencode/plugin"
import {
  measureServers,
  readOpencodeMcpSpecs,
  saveSnapshot,
  EMPTY_TOKEN_USAGE,
  DEFAULT_MODEL,
} from "@javilazaro/mcp-savings-core"

export default Plugin.define({
  id: "mcp.manager",
  async setup(ctx) {
    const run = async () => {
      try {
        // OpenCode stores MCP servers under a flat `mcp` map keyed by server
        // name (~/.config/opencode/opencode.json). readOpencodeMcpSpecs reads
        // exactly that shape and honours `enabled: false`. Disabled servers are
        // deliberately included so the realized savings can be measured; see
        // the measureServers doc for the spawn-side-effect tradeoff.
        const specs = readOpencodeMcpSpecs()
        const measurements = await measureServers(specs, DEFAULT_MODEL, 4)
        const serverWeights = measurements.map((m) => ({
          server: m.server,
          tools: m.tools.map((t) => ({ id: t.name, bytes: t.bytes })),
          bytes: m.bytes,
        }))
        const totalSchemaBytes = serverWeights.reduce((a, s) => a + s.bytes, 0)
        const snapshot = {
          timestamp: Date.now(),
          host: "opencode",
          serverWeights,
          totalSchemaBytes,
          sessionTokens: EMPTY_TOKEN_USAGE,
          mcpMeasurement: measurements,
          model: DEFAULT_MODEL,
        }
        saveSnapshot(snapshot)
      } catch (e) {
        console.error("mcp-savings metering failed", e)
      }
    }

    await run()
    const timer = setInterval(() => void run(), 60_000)
    return () => clearInterval(timer)
  },
})
