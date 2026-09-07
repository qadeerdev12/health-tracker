import { readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from './config.js';

/**
 * Single-user, file-backed token store. Fine for testing the integration;
 * replace with a per-user database row before this becomes a real app.
 */
const path = resolve(process.cwd(), config.tokenStorePath);

let cached;

export async function loadTokens() {
  if (cached !== undefined) return cached;
  try {
    cached = JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    cached = null;
  }
  return cached;
}

export async function saveTokens(tokens) {
  cached = tokens;
  await writeFile(path, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  return tokens;
}

export async function clearTokens() {
  cached = null;
  await rm(path, { force: true });
}
