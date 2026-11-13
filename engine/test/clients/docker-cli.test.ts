import { describe, expect, it } from 'vitest';
import { DockerCliClient, type ExecFn } from '../../src/clients/docker-cli.js';

const ID1 = 'a'.repeat(64);
const ID2 = 'b'.repeat(64);
const FOREIGN = 'c'.repeat(64);

interface FakeContainer {
  Id: string;
  Name: string;
  State: { Status: string; Paused?: boolean; Health?: { Status: string } };
  Config: { Labels: Record<string, string> };
}

function container(id: string, status: string, project = 'sandbox', health?: string): FakeContainer {
  return {
    Id: id,
    Name: `/sandbox-worker-${id[0]}`,
    State: { Status: status, Paused: status === 'paused', ...(health ? { Health: { Status: health } } : {}) },
    Config: { Labels: { 'com.docker.compose.project': project, 'com.docker.compose.service': 'worker' } },
  };
}

function fakeDocker(containers: FakeContainer[]): { exec: ExecFn; commands: string[][] } {
  const commands: string[][] = [];
  const exec: ExecFn = async (file, args) => {
    expect(file).toBe('docker');
    commands.push(args);
    if (args[0] === 'ps') return { stdout: containers.filter((c) => c.Config.Labels['com.docker.compose.project'] === 'sandbox').map((c) => c.Id).join('\n') };
    if (args[0] === 'inspect') return { stdout: JSON.stringify(containers.filter((c) => args.includes(c.Id))) };
    return { stdout: '' };
  };
  return { exec, commands };
}

describe('DockerCliClient', () => {
  it('lists only containers matching the sandbox project and service labels', async () => {
    const { exec, commands } = fakeDocker([container(ID1, 'running', 'sandbox', 'healthy'), container(ID2, 'exited')]);
    const list = await new DockerCliClient('sandbox', exec).listContainers('worker');
    expect(commands[0]).toEqual([
      'ps', '--all', '--quiet', '--no-trunc',
      '--filter', 'label=com.docker.compose.project=sandbox',
      '--filter', 'label=com.docker.compose.service=worker',
    ]);
    expect(list).toEqual([
      { id: ID1, name: 'sandbox-worker-a', state: 'running', health: 'healthy' },
      { id: ID2, name: 'sandbox-worker-b', state: 'stopped', health: 'none' },
    ]);
  });

  it.each([
    ['running', 'stopped', [['stop']]],
    ['running', 'paused', [['pause']]],
    ['paused', 'running', [['unpause']]],
    ['paused', 'stopped', [['unpause'], ['stop']]],
    ['exited', 'running', [['start']]],
    ['exited', 'paused', [['start'], ['pause']]],
    ['running', 'running', []],
  ] as const)('moves a container from %s to %s', async (from, to, expected) => {
    const { exec, commands } = fakeDocker([container(ID1, from)]);
    await new DockerCliClient('sandbox', exec).setState(ID1, to);
    expect(commands.filter((c) => c[0] !== 'inspect')).toEqual(expected.map(([cmd]) => [cmd, ID1]));
  });

  it('refuses to touch containers outside the sandbox project', async () => {
    const { exec, commands } = fakeDocker([container(FOREIGN, 'running', 'someone-elses-app')]);
    await expect(new DockerCliClient('sandbox', exec).setState(FOREIGN, 'stopped')).rejects.toThrow(/not in sandbox project/);
    expect(commands.some((c) => c[0] === 'stop')).toBe(false);
  });

  it('rejects malformed ids and names before calling docker', async () => {
    const { exec, commands } = fakeDocker([]);
    const client = new DockerCliClient('sandbox', exec);
    await expect(client.setState('abc; rm -rf /', 'stopped')).rejects.toThrow(/Invalid container id/);
    await expect(client.listContainers('worker --all')).rejects.toThrow(/Invalid service name/);
    expect(() => new DockerCliClient('Bad Project')).toThrow();
    expect(commands).toEqual([]);
  });
});
