export function repositoryLabel(remoteUrl: string): string {
  const value = remoteUrl.trim().replace(/\.git(?:\/)?$/, '');
  const github = value.match(/github\.com[/:]([^/]+\/[^/]+)$/i);
  return github?.[1] ?? value;
}

export function formatTree(paths: readonly string[]): string[] {
  type TreeNode = { readonly children: Map<string, TreeNode>; file: boolean };
  const root: TreeNode = { children: new Map(), file: false };
  for (const path of paths) {
    let node = root;
    for (const part of path.split('/')) {
      let child = node.children.get(part);
      if (child === undefined) {
        child = { children: new Map(), file: false };
        node.children.set(part, child);
      }
      node = child;
    }
    node.file = true;
  }

  const lines: string[] = [];
  const visit = (node: TreeNode, prefix: string): void => {
    for (const [name, child] of [...node.children.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const directory = child.children.size > 0;
      lines.push(`${prefix}|--- ${name}${directory ? '/' : ''}`);
      if (directory) visit(child, `${prefix}|    `);
    }
  };
  visit(root, '');
  return lines;
}
