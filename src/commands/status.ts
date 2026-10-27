import { ExitCode } from '../domain/exit-code';
import { describeRelation, formatList } from '../domain/report';
import type { CommandContext } from './context';
import { compareWithRepo, requireRepo } from './local-tree';
import { refreshRemote } from './remote-state';

export async function runStatus(context: CommandContext): Promise<ExitCode> {
  const { agent, io, repoDir } = context;
  await requireRepo(context);
  io.info(`Agent:       ${agent.name}`);
  io.info(`Local:       ${agent.home}`);
  io.info(`Repository:  ${repoDir}`);

  const remote = await refreshRemote(context.repoGit);
  if (remote.status === 'unreachable') {
    io.warn(`Remote:      unreachable (${remote.error})`);
  } else if (remote.status === 'empty') {
    io.info("Remote:      empty (use 'push' to publish)");
  } else {
    io.info(`Remote:      ${describeRelation(remote.ahead, remote.behind)}`);
  }

  const { onlyLocal, onlyRepo, modified } = await compareWithRepo(context);
  if (onlyLocal.length + onlyRepo.length + modified.length === 0) {
    io.info('Local and clone: no differences.');
    return ExitCode.Ok;
  }

  io.info('Differences between local and clone:');
  const lines = [
    ...formatList('+ local only     ', onlyLocal),
    ...formatList('~ modified       ', modified),
    ...formatList('- repo only      ', onlyRepo),
  ];
  for (const line of lines) io.info(line);
  return ExitCode.Ok;
}
