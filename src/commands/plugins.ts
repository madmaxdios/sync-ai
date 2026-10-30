import fs from 'node:fs/promises';
import path from 'node:path';
import type { CommandContext } from './context';
import { runProcess } from '../infra/run-process';

const MANIFEST = '.sync-ai-plugins.json';
const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9._-]*$/i;

export interface PluginSpec {
  readonly id: string;
  readonly source?: string;
}

interface PluginManifest {
  readonly version: 1;
  readonly plugins: readonly PluginSpec[];
}

function manifestPath(context: CommandContext): string {
  return path.join(context.agent.home, MANIFEST);
}

async function readJson(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function sourceFromMarketplace(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = (value as { source?: unknown }).source;
  if (!source || typeof source !== 'object') return undefined;
  const record = source as { repo?: unknown; url?: unknown; source?: unknown };
  if (typeof record.repo === 'string') return record.repo;
  if (typeof record.url === 'string') return record.url;
  if (typeof record.source === 'string') return record.source;
  return undefined;
}

function pluginSpec(id: string, source: string | undefined): PluginSpec {
  return source === undefined ? { id } : { id, source };
}

async function installedPlugins(context: CommandContext): Promise<PluginSpec[]> {
  if (context.agent.name === 'claude') {
    const registry = await readJson(path.join(context.agent.home, 'plugins', 'installed_plugins.json'));
    const marketplaces = await readJson(path.join(context.agent.home, 'plugins', 'known_marketplaces.json'));
    const plugins = registry?.plugins;
    if (!plugins || typeof plugins !== 'object') return [];
    return Object.keys(plugins)
      .filter((id) => PLUGIN_ID.test(id))
      .map((id) => pluginSpec(id, sourceFromMarketplace(marketplaces?.[id.split('@')[1] ?? ''])));
  }

  if (context.agent.name === 'codex') {
    try {
      const config = await fs.readFile(path.join(context.agent.home, 'config.toml'), 'utf8');
      return [...config.matchAll(/^\[plugins\."([^"]+)"\]/gm)]
        .map((match) => match[1])
        .filter((id): id is string => Boolean(id && PLUGIN_ID.test(id)))
        .map((id) => ({ id }));
    } catch {
      return [];
    }
  }

  return [];
}

async function readManifest(context: CommandContext): Promise<PluginManifest> {
  const value = await readJson(manifestPath(context));
  const plugins = Array.isArray(value?.plugins) ? value.plugins : [];
  const valid: PluginSpec[] = [];
  for (const plugin of plugins) {
    if (plugin === null || typeof plugin !== 'object') continue;
    const record = plugin as Record<string, unknown>;
    if (typeof record.id !== 'string' || !PLUGIN_ID.test(record.id)) continue;
    valid.push(pluginSpec(record.id, typeof record.source === 'string' ? record.source : undefined));
  }
  return { version: 1, plugins: valid };
}

function mergePlugins(...groups: readonly (readonly PluginSpec[])[]): PluginSpec[] {
  const merged = new Map<string, PluginSpec>();
  for (const group of groups) {
    for (const plugin of group) {
      const previous = merged.get(plugin.id);
      merged.set(plugin.id, pluginSpec(plugin.id, plugin.source ?? previous?.source));
    }
  }
  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/** Writes the portable plugin list before a push, without copying plugin caches. */
export async function ensurePluginManifest(context: CommandContext): Promise<void> {
  const current = await readManifest(context);
  const discovered = await installedPlugins(context);
  const plugins = mergePlugins(current.plugins, discovered);
  if (plugins.length === 0 && current.plugins.length === 0) return;
  const next = JSON.stringify({ version: 1, plugins }, null, 2) + '\n';
  let previous = '';
  try {
    previous = await fs.readFile(manifestPath(context), 'utf8');
  } catch {
    // The manifest is created below when a plugin is installed.
  }
  if (previous !== next) {
    await fs.writeFile(manifestPath(context), next, 'utf8');
    context.io.info(`Plugin manifest updated: ${plugins.length} plugin${plugins.length === 1 ? '' : 's'}.`);
  }
}

/** Installs plugins declared by the repository after its manifest is pulled. */
export async function installPluginManifest(context: CommandContext): Promise<void> {
  const manifest = await readManifest(context);
  if (manifest.plugins.length === 0) return;
  const installed = new Set((await installedPlugins(context)).map((plugin) => plugin.id));
  for (const plugin of manifest.plugins) {
    if (installed.has(plugin.id)) continue;
    const [marketplace] = plugin.id.split('@').slice(1);
    if (plugin.source) {
      const addMarketplace = context.agent.name === 'claude'
        ? await runProcess('claude', ['plugin', 'marketplace', 'add', plugin.source], context.env, { timeoutMs: 120_000 })
        : await runProcess('codex', ['plugin', 'marketplace', 'add', plugin.source], context.env, { timeoutMs: 120_000 });
      if (addMarketplace === undefined || addMarketplace.code !== 0) {
        context.io.warn(`Could not add marketplace for ${plugin.id}${marketplace ? ` (${marketplace})` : ''}.`);
        continue;
      }
    }
    const result = context.agent.name === 'claude'
      ? await runProcess('claude', ['plugin', 'install', plugin.id, '--yes'], context.env, { timeoutMs: 120_000 })
      : await runProcess('codex', ['plugin', 'add', plugin.id], context.env, { timeoutMs: 120_000 });
    if (result?.code === 0) context.io.info(`Installed plugin: ${plugin.id}`);
    else context.io.warn(`Could not install plugin: ${plugin.id}`);
  }
}
