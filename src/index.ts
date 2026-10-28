import { Plugin } from "@opencode/plugin"
import {
  measureServers,
  toServerSpec,
  saveSnapshot,
  snapshotPath,
  EMPTY_TOKEN_USAGE,
  DEFAULT_MODEL,
} from "@javilazaro/mcp-savings-core"

export default Plugin.define({
  id: "mcp.manager",
  async setup(ctx) {
    const run = async () => {
      try {
        const fsMod: any = await import("node:fs")
        const home = process.env.HOME || "/home/craig"
        const cfg = JSON.parse(fsMod.readFileSync(`${home}/.config/opencode/opencode.json`, "utf8"))
        const servers = cfg?.mcp?.servers || {}
        const specs = Object.entries(servers).map(([name, entry]: any) =>
          toServerSpec(name, entry, entry?.disabled !== true)
        ).filter(Boolean)
        const measurements = await measureServers(specs as any, DEFAULT_MODEL, 4)
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
        saveSnapshot(snapshot as any)
      } catch (e) {
        console.error("mcp-savings metering failed", e)
      }
    }

    await run()
    const timer = setInterval(() => void run(), 60_000)
    return () => clearInterval(timer)
  },
})