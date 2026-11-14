import { execFile } from 'node:child_process';
import { DockerCliClient, JsonHttp, ServiceAdminHttpClient, type ExecFn, type Scalar } from '@witching-hour/engine';
import type { ContainerRow, SandboxControl } from './executor.js';

const SERVICES = ['storefront', 'cart', 'payments', 'worker', 'postgres', 'queue', 'traffic'];

const defaultExec: ExecFn = (file, args) =>
  new Promise((resolve, reject) => {
    // An argument array, never a shell string.
    execFile(file, args, { timeout: 120_000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve({ stdout });
    });
  });

export interface DockerSandboxOptions {
  composeProject: string;
  composeFile: string;
  serviceAdminUrls: Record<string, string>;
  exec?: ExecFn;
}

/**
 * Player actions against the real Docker Compose sandbox. Containers are found by
 * compose labels, and the engine's DockerCliClient re-checks the project label
 * before each restart.
 */
export class DockerSandboxControl implements SandboxControl {
  private readonly docker: DockerCliClient;
  private readonly admin: ServiceAdminHttpClient;
  private readonly storefront: JsonHttp;
  private readonly exec: ExecFn;

  constructor(private readonly opts: DockerSandboxOptions) {
    this.exec = opts.exec ?? defaultExec;
    this.docker = new DockerCliClient(opts.composeProject, this.exec);
    this.admin = new ServiceAdminHttpClient(opts.serviceAdminUrls);
    const storefrontUrl = opts.serviceAdminUrls.storefront;
    if (storefrontUrl === undefined) throw new Error('serviceAdminUrls.storefront is required');
    this.storefront = new JsonHttp(storefrontUrl);
  }

  async status(): Promise<ContainerRow[]> {
    const rows: ContainerRow[] = [];
    for (const service of SERVICES) {
      for (const c of await this.docker.listContainers(service)) rows.push({ service, name: c.name, state: c.state, health: c.health });
    }
    return rows;
  }

  async restart(service: string): Promise<number> {
    const containers = await this.docker.listContainers(service);
    for (const c of containers) await this.docker.restart(c.id);
    return containers.length;
  }

  async scaleWorker(replicas: number): Promise<void> {
    if (!Number.isInteger(replicas) || replicas < 1 || replicas > 3) throw new RangeError('replicas must be 1-3');
    await this.exec('docker', [
      'compose',
      '--project-name',
      this.opts.composeProject,
      '--file',
      this.opts.composeFile,
      'up',
      '--detach',
      '--no-recreate',
      '--no-deps',
      '--scale',
      `worker=${replicas}`,
      'worker',
    ]);
  }

  async purgeOrders(): Promise<number> {
    const res = await this.storefront.request<{ dropped: number }>('POST', '/__admin/purge-queue/orders');
    return res?.dropped ?? 0;
  }

  configGet(service: string, key: string): Promise<Scalar | null> {
    return this.admin.getConfig(service, key);
  }

  configSet(service: string, key: string, value: Scalar): Promise<void> {
    return this.admin.setConfig(service, key, value);
  }
}
