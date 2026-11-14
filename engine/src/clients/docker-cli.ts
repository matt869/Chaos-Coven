import { execFile } from 'node:child_process';
import type { ContainerHealth, ContainerInfo, ContainerState, DockerClient } from './types.js';

export type ExecFn = (file: string, args: string[]) => Promise<{ stdout: string }>;

const defaultExec: ExecFn = (file, args) =>
  new Promise((resolve, reject) => {
    // execFile with an argument array: no shell is ever involved.
    execFile(file, args, { timeout: 60_000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${file} ${args.join(' ')} failed: ${stderr || err.message}`));
      else resolve({ stdout });
    });
  });

interface InspectResult {
  Id: string;
  Name: string;
  State: { Status: string; Paused?: boolean; Health?: { Status: string } };
  Config: { Labels?: Record<string, string> };
}

const PROJECT_LABEL = 'com.docker.compose.project';
const SERVICE_LABEL = 'com.docker.compose.service';

/**
 * Drives sandbox containers through the docker CLI. It only ever acts on containers
 * labeled with the sandbox compose project, and re-checks that label before every
 * state change.
 */
export class DockerCliClient implements DockerClient {
  constructor(
    private readonly project: string,
    private readonly exec: ExecFn = defaultExec,
  ) {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(project)) throw new Error(`Invalid compose project name: ${project}`);
  }

  async listContainers(service: string): Promise<ContainerInfo[]> {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(service)) throw new Error(`Invalid service name: ${service}`);
    const { stdout } = await this.exec('docker', [
      'ps',
      '--all',
      '--quiet',
      '--no-trunc',
      '--filter',
      `label=${PROJECT_LABEL}=${this.project}`,
      '--filter',
      `label=${SERVICE_LABEL}=${service}`,
    ]);
    const ids = stdout.split(/\s+/).filter(Boolean);
    if (ids.length === 0) return [];
    const inspected = await this.inspect(ids);
    return inspected.map(toInfo).sort((a, b) => a.name.localeCompare(b.name));
  }

  async setState(containerId: string, target: ContainerState): Promise<void> {
    const [info] = await this.inspect([containerId]);
    if (info === undefined) throw new Error(`Container ${containerId} not found`);
    if (info.Config.Labels?.[PROJECT_LABEL] !== this.project) {
      throw new Error(`Refusing to touch container ${containerId}: it is not in sandbox project "${this.project}"`);
    }
    const current = toInfo(info).state;
    if (current === target) return;

    const id = info.Id;
    const run = (cmd: string) => this.exec('docker', [cmd, id]);
    if (target === 'running') {
      await run(current === 'paused' ? 'unpause' : 'start');
    } else if (target === 'paused') {
      if (current === 'stopped') await run('start');
      await run('pause');
    } else {
      if (current === 'paused') await run('unpause');
      await run('stop');
    }
  }

  /** Restarts a sandbox container, as the player's `haunt restart` does. */
  async restart(containerId: string): Promise<void> {
    const [info] = await this.inspect([containerId]);
    if (info === undefined) throw new Error(`Container ${containerId} not found`);
    if (info.Config.Labels?.[PROJECT_LABEL] !== this.project) {
      throw new Error(`Refusing to touch container ${containerId}: it is not in sandbox project "${this.project}"`);
    }
    await this.exec('docker', ['restart', info.Id]);
  }

  private async inspect(ids: string[]): Promise<InspectResult[]> {
    for (const id of ids) {
      if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error(`Invalid container id: ${id}`);
    }
    const { stdout } = await this.exec('docker', ['inspect', ...ids]);
    return JSON.parse(stdout) as InspectResult[];
  }
}

function toInfo(r: InspectResult): ContainerInfo {
  const status = r.State.Status;
  let state: ContainerState;
  if (status === 'paused' || r.State.Paused === true) state = 'paused';
  else if (status === 'running' || status === 'restarting') state = 'running';
  else state = 'stopped';

  const h = r.State.Health?.Status;
  const health: ContainerHealth =
    h === 'healthy' || h === 'starting' || h === 'unhealthy' ? h : status === 'restarting' ? 'starting' : 'none';

  return { id: r.Id, name: r.Name.replace(/^\//, ''), state, health };
}
