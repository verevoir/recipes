import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const SCRIPT = fileURLToPath(
  new URL('../.github/antagonistic-review/pin-staleness.sh', import.meta.url)
);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd, timeout: 20000 });
  return stdout.trim();
}

/** A real throwaway "origin" repo with `commitCount` commits on a fixed-name default
 * branch, returning every commit's sha oldest-first — real git history, not a mock, so
 * the fetch/unshallow behaviour under test is the genuine article. */
async function makeOriginRepo(commitCount: number): Promise<{ dir: string; shas: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), 'pin-origin-'));
  await git(dir, 'init', '-q');
  // Fixed before the first commit so the fixture does not depend on the machine's
  // `init.defaultBranch` — the script must resolve whatever name is actually
  // configured, and the test needs to know what that name is.
  await git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  await git(dir, 'config', 'user.email', 'test@example.com');
  await git(dir, 'config', 'user.name', 'Test');
  const shas: string[] = [];
  for (let i = 0; i < commitCount; i++) {
    await writeFile(join(dir, 'file.txt'), `commit ${i}\n`);
    await git(dir, 'add', '.');
    await git(dir, 'commit', '-q', '-m', `commit ${i}`);
    shas.push(await git(dir, 'rev-parse', 'HEAD'));
  }
  return { dir, shas };
}

/** Builds the clone dir EXACTLY as the workflow's own "Pre-build the reviewer MCP" step
 * does: `git init` + `git remote add` + a depth-1 fetch of one exact sha — never `git
 * clone`, so no remote-tracking refs (origin/HEAD included) are ever set up. This is the
 * shallow, disconnected starting state pin-staleness.sh has to work from. */
async function makeShallowPinnedClone(originDir: string, pinnedSha: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pin-clone-'));
  await git(dir, 'init', '-q');
  await git(dir, 'remote', 'add', 'origin', originDir);
  await git(dir, 'fetch', '--quiet', '--depth', '1', 'origin', pinnedSha);
  await git(dir, 'checkout', '--quiet', pinnedSha);
  return dir;
}

async function pinStaleness(cloneDir: string, pinnedSha: string): Promise<string> {
  const { stdout } = await run('bash', [SCRIPT, cloneDir, pinnedSha], { timeout: 30000 });
  return stdout.trim();
}

describe('pin-staleness.sh — how far behind the pinned reviewer MCP sits', () => {
  it('reports the real number of commits behind, connecting through a shallow depth-1 pin', async () => {
    const { dir: originDir, shas } = await makeOriginRepo(6); // pin at #0, 5 commits ahead
    const cloneDir = await makeShallowPinnedClone(originDir, shas[0]!);
    try {
      expect(await pinStaleness(cloneDir, shas[0]!)).toBe('5');
    } finally {
      await rm(originDir, { recursive: true, force: true });
      await rm(cloneDir, { recursive: true, force: true });
    }
  });

  it('reports 0 when the pin already matches the tip', async () => {
    const { dir: originDir, shas } = await makeOriginRepo(1);
    const cloneDir = await makeShallowPinnedClone(originDir, shas[0]!);
    try {
      expect(await pinStaleness(cloneDir, shas[0]!)).toBe('0');
    } finally {
      await rm(originDir, { recursive: true, force: true });
      await rm(cloneDir, { recursive: true, force: true });
    }
  });

  it('reports "?" rather than a fabricated number when the remote is unreachable', async () => {
    const { dir: originDir, shas } = await makeOriginRepo(3);
    const cloneDir = await makeShallowPinnedClone(originDir, shas[0]!);
    await rm(originDir, { recursive: true, force: true }); // remote now unreachable
    try {
      expect(await pinStaleness(cloneDir, shas[0]!)).toBe('?');
    } finally {
      await rm(cloneDir, { recursive: true, force: true });
    }
  });

  it('reports "?" rather than a fabricated number when the pinned sha does not resolve at all', async () => {
    const { dir: originDir, shas } = await makeOriginRepo(3);
    const cloneDir = await makeShallowPinnedClone(originDir, shas[0]!);
    try {
      const bogus = '0'.repeat(40);
      expect(await pinStaleness(cloneDir, bogus)).toBe('?');
    } finally {
      await rm(originDir, { recursive: true, force: true });
      await rm(cloneDir, { recursive: true, force: true });
    }
  });

  it('exits 0 even on the "?" fallback — a missing answer is not a script failure', async () => {
    const { dir: originDir, shas } = await makeOriginRepo(2);
    const cloneDir = await makeShallowPinnedClone(originDir, shas[0]!);
    await rm(originDir, { recursive: true, force: true });
    try {
      const result = await run('bash', [SCRIPT, cloneDir, shas[0]!], { timeout: 30000 });
      expect(result.stdout).toBe('?\n');
    } finally {
      await rm(cloneDir, { recursive: true, force: true });
    }
  });

  it('fails with a usage error when called with too few arguments', async () => {
    await expect(run('bash', [SCRIPT], { timeout: 20000 })).rejects.toThrow(/usage/);
  });
});
