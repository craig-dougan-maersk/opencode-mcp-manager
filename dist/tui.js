import { createTextNode as _$createTextNode } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { createSignal, createResource, For, Show } from "solid-js";
import { TextAttributes } from "@opentui/core";
function asLocation(context) {
  return context.location ?? context.data.location.default();
}
async function call(client, method, payload) {
  // method like "mcp.add"
  const parts = method.split(".");
  let obj = client;
  for (const p of parts) {
    if (!obj || typeof obj[p] === "undefined") return undefined;
    obj = obj[p];
  }
  if (typeof obj !== "function") return undefined;
  return obj(payload);
}
async function getConfigDoc(client, location) {
  const entries = await client.config.get({
    location
  });
  const docs = (Array.isArray(entries) ? entries : []).filter(e => e && e.type === "document");
  const doc = docs.length ? docs[docs.length - 1] : null;
  if (doc && doc.path) return doc;
  // fallback global
  return {
    path: "/home/craig/.config/opencode/opencode.json",
    info: {}
  };
}
async function writeFile(client, path, content, location) {
  // Try common generated-client shapes.
  const attempts = [() => client.fs.write({
    path,
    location,
    body: content
  }), () => client.fs.write({
    path,
    location,
    content
  }), () => client.fs.write({
    path,
    location
  }, content), () => client.experimental?.fs?.write?.({
    path,
    location,
    body: content
  })];
  let lastErr = null;
  for (const fn of attempts) {
    try {
      if (!fn) continue;
      const r = await fn();
      return r;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("Unable to write file");
}
async function persistServer(client, location, name, config, remove = false) {
  const doc = await getConfigDoc(client, location);
  const path = doc.path;
  const info = doc.info && typeof doc.info === "object" ? {
    ...doc.info
  } : {};
  if (!info.mcp || typeof info.mcp !== "object") info.mcp = {};
  if (!info.mcp.servers || typeof info.mcp.servers !== "object") info.mcp.servers = {};
  if (remove) {
    delete info.mcp.servers[name];
  } else {
    info.mcp.servers[name] = config;
  }
  const content = JSON.stringify(info, null, 2) + "\n";
  await writeFile(client, path, content, location);
  return path;
}
async function getServerConfig(client, location, name) {
  const doc = await getConfigDoc(client, location);
  const servers = doc?.info?.mcp?.servers;
  if (servers && typeof servers === "object" && servers[name]) return servers[name];
  return null;
}
async function addServer(context, location) {
  const client = context.client;
  const name = await context.ui.dialog.prompt({
    title: "Add MCP server",
    placeholder: "server-name"
  });
  if (!name) return;
  const type = await context.ui.dialog.select({
    title: "Server type",
    current: "remote",
    options: [{
      title: "Remote (HTTP)",
      value: "remote"
    }, {
      title: "Local (stdio)",
      value: "local"
    }]
  });
  if (!type) return;
  let config;
  if (type === "local") {
    const cmd = await context.ui.dialog.prompt({
      title: "Command",
      placeholder: "npx -y @modelcontextprotocol/server-everything"
    });
    if (!cmd) return;
    config = {
      type: "local",
      command: cmd.trim().split(/\s+/)
    };
    const cwd = await context.ui.dialog.prompt({
      title: "Working directory (optional)",
      placeholder: "."
    });
    if (cwd && cwd.trim()) config.cwd = cwd.trim();
  } else {
    const url = await context.ui.dialog.prompt({
      title: "URL",
      placeholder: "https://mcp.example.com/mcp"
    });
    if (!url) return;
    config = {
      type: "remote",
      url: url.trim()
    };
    const headersJson = await context.ui.dialog.prompt({
      title: "Headers JSON (optional)",
      placeholder: '{"Authorization":"Bearer {env:MCP_API_KEY}"}'
    });
    if (headersJson && headersJson.trim()) {
      try {
        config.headers = JSON.parse(headersJson);
      } catch {
        context.ui.toast.show({
          message: "Invalid headers JSON",
          variant: "error"
        });
        return;
      }
    }
    const disableOauth = await context.ui.dialog.confirm({
      title: "Disable OAuth?",
      message: "Disable OAuth for this server?"
    });
    if (disableOauth) config.oauth = false;
  }
  const extra = await context.ui.dialog.prompt({
    title: "Extra config JSON (optional)",
    placeholder: '{"disabled":false}'
  });
  if (extra && extra.trim()) {
    try {
      Object.assign(config, JSON.parse(extra));
    } catch {
      context.ui.toast.show({
        message: "Invalid extra JSON",
        variant: "error"
      });
      return;
    }
  }
  try {
    await persistServer(client, location, name, config, false);
    await call(client, "mcp.add", {
      server: name,
      location,
      config
    });
    await context.data.location.mcp.server.sync(location);
    context.data.location.mcp.server.invalidate(location);
    context.ui.toast.show({
      title: "MCP",
      message: `Added ${name}`,
      variant: "success"
    });
  } catch (e) {
    context.ui.toast.show({
      title: "MCP",
      message: `Add failed: ${e?.message ?? e}`,
      variant: "error"
    });
  }
}
async function configureServer(context, location, name) {
  const client = context.client;
  const current = await getServerConfig(client, location, name);
  const currentJson = current ? JSON.stringify(current, null, 2) : "{}";
  const edited = await context.ui.dialog.prompt({
    title: `Configure ${name}`,
    placeholder: currentJson
  });
  if (!edited || !edited.trim()) return;
  let config;
  try {
    config = JSON.parse(edited);
  } catch {
    context.ui.toast.show({
      message: "Invalid JSON",
      variant: "error"
    });
    return;
  }
  try {
    await persistServer(client, location, name, config, false);
    await call(client, "mcp.add", {
      server: name,
      location,
      config
    });
    await context.data.location.mcp.server.sync(location);
    context.data.location.mcp.server.invalidate(location);
    context.ui.toast.show({
      title: "MCP",
      message: `Configured ${name}`,
      variant: "success"
    });
  } catch (e) {
    context.ui.toast.show({
      title: "MCP",
      message: `Configure failed: ${e?.message ?? e}`,
      variant: "error"
    });
  }
}
async function setDisabled(context, location, name, disabled) {
  const client = context.client;
  const current = (await getServerConfig(client, location, name)) || {};
  const config = {
    ...current,
    disabled
  };
  try {
    await persistServer(client, location, name, config, false);
    if (disabled) {
      await call(client, "mcp.disconnect", {
        server: name,
        location
      });
    } else {
      await call(client, "mcp.connect", {
        server: name,
        location
      });
    }
    await context.data.location.mcp.server.sync(location);
    context.data.location.mcp.server.invalidate(location);
    context.ui.toast.show({
      title: "MCP",
      message: `${name} ${disabled ? "disabled" : "enabled"}`,
      variant: "success"
    });
  } catch (e) {
    context.ui.toast.show({
      title: "MCP",
      message: `Update failed: ${e?.message ?? e}`,
      variant: "error"
    });
  }
}
async function removeServer(context, location, name) {
  const client = context.client;
  const confirmed = await context.ui.dialog.confirm({
    title: "Remove server",
    message: `Remove ${name}?`
  });
  if (!confirmed) return;
  try {
    await persistServer(client, location, name, null, true);
    await call(client, "mcp.remove", {
      server: name,
      location
    });
    await context.data.location.mcp.server.sync(location);
    context.data.location.mcp.server.invalidate(location);
    context.ui.toast.show({
      title: "MCP",
      message: `Removed ${name}`,
      variant: "success"
    });
  } catch (e) {
    context.ui.toast.show({
      title: "MCP",
      message: `Remove failed: ${e?.message ?? e}`,
      variant: "error"
    });
  }
}
async function manageServer(context, location, name) {
  const action = await context.ui.dialog.select({
    title: `MCP: ${name}`,
    options: [{
      title: "Configure (JSON)",
      value: "config"
    }, {
      title: "Enable",
      value: "enable"
    }, {
      title: "Disable",
      value: "disable"
    }, {
      title: "Remove",
      value: "remove"
    }]
  });
  if (!action) return;
  if (action === "config") await configureServer(context, location, name);else if (action === "enable") await setDisabled(context, location, name, false);else if (action === "disable") await setDisabled(context, location, name, true);else if (action === "remove") await removeServer(context, location, name);
}
async function openManager(context) {
  const location = asLocation(context);
  try {
    await context.data.location.mcp.server.sync(location);
  } catch {}
  const run = async () => {
    const servers = context.data.location.mcp.server.list(location) ?? [];
    const options = servers.map(s => ({
      title: `${s.name}  (${s.status?.status ?? "unknown"})`,
      value: s.name,
      description: s.title
    }));
    options.push({
      title: "➕ Add server",
      value: "__add__",
      description: "Add a new MCP server"
    });
    const choice = await context.ui.dialog.select({
      title: "MCP Servers",
      options,
      actions: [{
        bind: "a",
        title: "Add",
        selection: "none",
        onTrigger: () => context.ui.dialog.clear()
      }]
    });
    if (choice === "__add__") {
      await addServer(context, location);
      return run();
    }
    if (choice) {
      await manageServer(context, location, choice);
      return run();
    }
  };
  await run();
}
const SNAPSHOT_PATH = () => {
  const home = globalThis?.process?.env?.HOME || "/home/craig";
  return `${home}/.config/mcp-savings/snapshot.json`;
};
function McpCost(props) {
  const context = usePlugin();
  const [open, setOpen] = createSignal(false);
  const [snapshot] = createResource(props.refresh, async () => {
    try {
      const fsMod = await import("node:fs");
      return JSON.parse(fsMod.readFileSync(SNAPSHOT_PATH(), "utf8"));
    } catch {
      return null;
    }
  });
  // `mcpMeasurement` is the live per-server schema measurement written by the
  // server-side half of this plugin; fall back to the older serverWeights shape.
  const servers = () => snapshot()?.mcpMeasurement ?? snapshot()?.serverWeights ?? [];
  return (() => {
    var _el$ = _$createElement("box"),
      _el$2 = _$createElement("box"),
      _el$3 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$setProp(_el$, "flexDirection", "column");
    _$setProp(_el$, "marginTop", 1);
    _$insertNode(_el$2, _el$3);
    _$setProp(_el$2, "onMouseDown", e => {
      try {
        e?.stopPropagation?.();
      } catch {}
      setOpen(!open());
    });
    _$insert(_el$3, () => (open() ? "▼ " : "▶ ") + "MCP cost/request");
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return open();
      },
      get children() {
        var _el$4 = _$createElement("box");
        _$setProp(_el$4, "flexDirection", "column");
        _$setProp(_el$4, "paddingLeft", 1);
        _$insert(_el$4, _$createComponent(Show, {
          get when() {
            return snapshot();
          },
          get fallback() {
            return (() => {
              var _el$7 = _$createElement("text");
              _$insertNode(_el$7, _$createTextNode(`No snapshot`));
              _$effect(_$p => _$setProp(_el$7, "fg", context.theme.text.muted, _$p));
              return _el$7;
            })();
          },
          get children() {
            return [(() => {
              var _el$5 = _$createElement("text");
              _$insert(_el$5, () => `Updated: ${new Date(snapshot().timestamp).toLocaleString()}`);
              _$effect(_$p => _$setProp(_el$5, "fg", context.theme.text.muted, _$p));
              return _el$5;
            })(), _$createComponent(For, {
              get each() {
                return servers();
              },
              children: m => (() => {
                var _el$9 = _$createElement("text");
                _$insert(_el$9, () => `${m.server}: ${m.tokens != null ? m.tokens + " tok" : "n/a"}  (${m.bytes} B)`);
                _$effect(_$p => _$setProp(_el$9, "fg", context.theme.text.base, _$p));
                return _el$9;
              })()
            }), (() => {
              var _el$6 = _$createElement("text");
              _$insert(_el$6, () => `Total: ${snapshot()?.totalSchemaBytes ?? 0} B`);
              _$effect(_$p => _$setProp(_el$6, "fg", context.theme.text.muted, _$p));
              return _el$6;
            })()];
          }
        }));
        return _el$4;
      }
    }), null);
    _$effect(_p$ => {
      var _v$ = context.theme.text.base,
        _v$2 = TextAttributes.BOLD;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$3, "fg", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$3, "attributes", _v$2, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$;
  })();
}
export default Plugin.define({
  id: "mcp.manager",
  setup(context) {
    const location = asLocation(context);
    const [mcpOpen, setMcpOpen] = createSignal(false);
    const [tick, setTick] = createSignal(0);
    const [costTick, setCostTick] = createSignal(0);
    const [servers] = createResource(tick, async () => {
      try {
        await context.data.location.mcp.server.sync(location);
      } catch {}
      return context.data.location.mcp.server.list(location) ?? [];
    });
    const disposeSlot = context.ui.slot({
      append: "sidebar.content",
      render: () => _$createComponent(McpCost, {
        refresh: costTick
      })
    });
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "mcp.manager.open",
        title: "Manage MCP servers",
        group: "MCP",
        palette: true,
        slash: {
          name: "mcps-manage",
          aliases: ["mcpm"]
        },
        run: async () => {
          await openManager(context);
        }
      }, {
        id: "mcp.manager.cost.refresh",
        title: "Refresh MCP cost snapshot",
        group: "MCP",
        palette: true,
        run: () => setCostTick(n => n + 1)
      }],
      bindings: ["mcp.manager.open"]
    }));
    context.ui.toast.show({
      message: "MCP Manager loaded",
      variant: "success",
      duration: 2000
    });
    return () => {
      try {
        disposeSlot?.();
      } catch {}
    };
  }
});
