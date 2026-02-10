#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cwd } from 'node:process';

const commonArgs = [
  'scan',
  '--config', '.semgrep.yml',
  '--exclude', 'node_modules',
  '--exclude', 'data',
  '--exclude', '.git',
  '.'
];

const remoteArgs = [
  'scan',
  '--config', 'p/ci',
  '--config', '.semgrep.yml',
  '--exclude', 'node_modules',
  '--exclude', 'data',
  '--exclude', '.git',
  '.'
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options
  });
  if (typeof result.status === 'number') {
    return result.status;
  }
  return 1;
}

function commandExists(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return result.status === 0;
}

function runWithFallback(executor) {
  const primaryStatus = executor(remoteArgs);
  if (primaryStatus === 0) return 0;
  console.warn('[security:semgrep] Falling back to local `.semgrep.yml` rules (remote rules unavailable).');
  return executor(commonArgs);
}

function main() {
  if (commandExists('semgrep')) {
    process.exit(runWithFallback((args) => run('semgrep', args)));
  }

  if (commandExists('docker')) {
    process.exit(runWithFallback((args) => {
      const dockerArgs = [
        'run', '--rm',
        '-v', `${cwd()}:/src`,
        '-w', '/src',
        'returntocorp/semgrep:latest',
        'semgrep',
        ...args
      ];
      return run('docker', dockerArgs);
    }));
  }

  console.warn('[security:semgrep] Semgrep not found. Install semgrep or docker to run the scan.');
  process.exit(0);
}

main();
