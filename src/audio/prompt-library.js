import { readdirSync, readFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { wavToMulaw8k } from './wav.js';
import { logger } from '../obs/logger.js';

// Loads a directory of .wav prompts once at boot, converting each to 8 kHz mono
// µ-law held in memory. Keyed by filename without extension (e.g. "greeting").

export class PromptLibrary {
  constructor() {
    this.prompts = new Map(); // name -> Buffer (µ-law, 8 kHz)
  }

  loadDir(dir) {
    let files;
    try {
      files = readdirSync(dir);
    } catch {
      throw new Error(`prompt directory not found: ${dir}`);
    }

    let loaded = 0;
    for (const file of files) {
      if (extname(file).toLowerCase() !== '.wav') continue;
      const name = basename(file, extname(file));
      try {
        this.prompts.set(name, wavToMulaw8k(readFileSync(join(dir, file))));
        loaded++;
      } catch (err) {
        logger.error({ file, err: err.message }, 'failed to load prompt');
      }
    }

    logger.info({ dir, loaded, names: [...this.prompts.keys()] }, 'prompt library loaded');
    return loaded;
  }

  has(name) {
    return this.prompts.has(name);
  }

  get(name) {
    return this.prompts.get(name) ?? null;
  }

  /** Playback duration in ms (8 kHz µ-law = 1 byte/sample). */
  durationMs(name) {
    const buf = this.prompts.get(name);
    return buf ? (buf.length / 8000) * 1000 : 0;
  }

  get size() {
    return this.prompts.size;
  }
}
