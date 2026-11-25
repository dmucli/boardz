/// <reference types="node" />

/** Run only from trusted source. Notification delivery never needs the dashboard admin login. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  deliverDeploymentEvents,
  emptyDeploymentOutbox,
  githubRunUrl,
  parseDeploymentOutbox,
  queueDeploymentEvent,
} from './lib/ota-deployment-events.ts';
import type { DeploymentEvent, DeploymentOutbox } from './lib/ota-deployment-events.ts';
import { parseStableState } from './lib/ota-stable.ts';

export async function notifyCommand(argv: string[], environment = process.env): Promise<void> {
  const [command, ...rest] = argv;
  if (command !== 'record' && command !== 'deliver') throw new Error('Use record or deliver.');
  const flags = new Map<string, string>();
  const allowed = [
    '--events',
    '--state',
    '--kind',
    '--branch',
    '--commit',
    '--version',
    '--platform',
    '--runtime',
    '--percentage',
    '--reason',
    '--key',
  ];
  for (let index = 0; index < rest.length; index += 2) {
    const argument = rest[index + 1];
    if (!allowed.includes(rest[index]) || flags.has(rest[index]) || argument === undefined || argument.startsWith('--'))
      throw new Error(`Invalid notification argument: ${rest[index]}`);
    flags.set(rest[index], argument);
  }
  const path = flags.get('--state') ?? flags.get('--events');
  if (!path || (flags.has('--state') && flags.has('--events')))
    throw new Error('Provide exactly one --state or --events file.');
  const state = flags.has('--state') ? parseStableState(JSON.parse(readFileSync(path, 'utf8')) as unknown) : null;
  const outbox: DeploymentOutbox = state
    ? (state.notifications ??= emptyDeploymentOutbox())
    : existsSync(path)
      ? parseDeploymentOutbox(JSON.parse(readFileSync(path, 'utf8')) as unknown)
      : emptyDeploymentOutbox();
  const save = () => {
    mkdirSync(dirname(resolve(path)), { recursive: true });
    writeFileSync(`${path}.tmp`, `${JSON.stringify(state ?? outbox, null, 2)}\n`);
    renameSync(`${path}.tmp`, path);
  };
  if (command === 'record') {
    const event = {
      kind: flags.get('--kind') as DeploymentEvent['kind'],
      branch: flags.get('--branch') ?? 'production',
      commit: flags.get('--commit'),
      version: flags.get('--version'),
      platform: flags.get('--platform') as DeploymentEvent['platform'],
      runtimeVersion: flags.get('--runtime'),
      reason: flags.get('--reason'),
      runUrl: githubRunUrl(environment),
      ...(flags.has('--percentage') ? { percentage: Number(flags.get('--percentage')) } : {}),
    };
    queueDeploymentEvent(
      outbox,
      event,
      flags.get('--key') ?? `${environment.GITHUB_RUN_ID ?? new Date().toISOString()}:${JSON.stringify(event)}`,
    );
    save();
  } else await deliverDeploymentEvents({ outbox, webhook: environment.DISCORD_DEPLOY_WEBHOOK, save });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  notifyCommand(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
