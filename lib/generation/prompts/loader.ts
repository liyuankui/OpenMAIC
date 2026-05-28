/**
 * Prompt Loader - Loads prompts from markdown files
 *
 * Supports:
 * - Bundled prompts (Workers runtime, no fs)
 * - Filesystem prompts (Node.js runtime)
 * - Snippet inclusion via {{snippet:name}} syntax
 * - Variable interpolation via {{variable}} syntax
 * - Caching for performance
 */

import fs from 'fs';
import path from 'path';
import type { PromptId, LoadedPrompt, SnippetId } from './types';
import { createLogger } from '@/lib/logger';
import { bundledPrompts, bundledSnippets } from './bundled-prompts';
const log = createLogger('PromptLoader');

// Cache for loaded prompts and snippets
const promptCache = new Map<string, LoadedPrompt>();
const snippetCache = new Map<string, string>();

function getPromptsDir(): string {
  return path.join(process.cwd(), 'lib', 'generation', 'prompts');
}

export function loadSnippet(snippetId: SnippetId): string {
  const cached = snippetCache.get(snippetId);
  if (cached) return cached;

  // Bundled first (Workers)
  const bundled = bundledSnippets[snippetId];
  if (bundled) {
    snippetCache.set(snippetId, bundled);
    return bundled;
  }

  // Filesystem fallback (Node.js)
  const snippetPath = path.join(getPromptsDir(), 'snippets', `${snippetId}.md`);
  try {
    const content = fs.readFileSync(snippetPath, 'utf-8').trim();
    snippetCache.set(snippetId, content);
    return content;
  } catch {
    log.warn(`Snippet not found: ${snippetId}`);
    return `{{snippet:${snippetId}}}`;
  }
}

function processSnippets(template: string): string {
  return template.replace(/\{\{snippet:(\w[\w-]*)\}\}/g, (_, snippetId) => {
    return loadSnippet(snippetId as SnippetId);
  });
}

export function loadPrompt(promptId: PromptId): LoadedPrompt | null {
  const cached = promptCache.get(promptId);
  if (cached) return cached;

  // Bundled first (Workers)
  const bundled = bundledPrompts[promptId];
  if (bundled) {
    const loaded: LoadedPrompt = {
      id: promptId,
      systemPrompt: processSnippets(bundled.system),
      userPromptTemplate: processSnippets(bundled.user),
    };
    promptCache.set(promptId, loaded);
    return loaded;
  }

  // Filesystem fallback (Node.js)
  const promptDir = path.join(getPromptsDir(), 'templates', promptId);
  try {
    const systemPath = path.join(promptDir, 'system.md');
    let systemPrompt = fs.readFileSync(systemPath, 'utf-8').trim();
    systemPrompt = processSnippets(systemPrompt);

    const userPath = path.join(promptDir, 'user.md');
    let userPromptTemplate = '';
    try {
      userPromptTemplate = fs.readFileSync(userPath, 'utf-8').trim();
      userPromptTemplate = processSnippets(userPromptTemplate);
    } catch {
      // user.md is optional
    }

    const loaded: LoadedPrompt = {
      id: promptId,
      systemPrompt,
      userPromptTemplate,
    };
    promptCache.set(promptId, loaded);
    return loaded;
  } catch (error) {
    log.error(`Failed to load prompt ${promptId}:`, error);
    return null;
  }
}

export function interpolateVariables(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = variables[key];
    if (value === undefined) return match;
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  });
}

export function buildPrompt(
  promptId: PromptId,
  variables: Record<string, unknown>,
): { system: string; user: string } | null {
  const prompt = loadPrompt(promptId);
  if (!prompt) return null;

  return {
    system: interpolateVariables(prompt.systemPrompt, variables),
    user: interpolateVariables(prompt.userPromptTemplate, variables),
  };
}

export function clearPromptCache(): void {
  promptCache.clear();
  snippetCache.clear();
}
