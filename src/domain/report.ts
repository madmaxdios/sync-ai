export function formatList(prefix: string, items: readonly string[]): string[] {
  return items.map((item) => `  ${prefix} ${item}`);
}

export function describeRelation(ahead: number, behind: number): string {
  if (ahead === 0 && behind === 0) return 'up to date';
  if (behind === 0) return `${ahead} commit(s) to publish from the clone`;
  if (ahead === 0) return `${behind} new commit(s) on the remote (run 'pull')`;
  return `diverged (${ahead} to publish, ${behind} new on the remote)`;
}

/** Local-time stamp used in backup file names: YYYYMMDD-HHMMSS. */
export function formatStamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${day}-${time}`;
}
