import type { FileNode } from "../../types";

export type VisibleTreeItem = {
  id: string;
  node: FileNode;
};

export function getVisibleTreeItems(nodes: FileNode[]): VisibleTreeItem[] {
  const items: VisibleTreeItem[] = [];

  const walk = (treeNodes: FileNode[]): void => {
    for (const node of treeNodes) {
      items.push({ id: node.id, node });
      if (node.kind === "folder" && node.expanded) {
        walk(node.children);
      }
    }
  };

  walk(nodes);
  return items;
}

export function getNextTreeFocusId(
  items: VisibleTreeItem[],
  currentId: string | null,
  direction: 1 | -1,
): string | null {
  if (items.length === 0) {
    return null;
  }

  const currentIndex = currentId
    ? items.findIndex((item) => item.id === currentId)
    : -1;

  const nextIndex =
    currentIndex === -1
      ? direction === 1
        ? 0
        : items.length - 1
      : (currentIndex + direction + items.length) % items.length;

  return items[nextIndex]?.id ?? null;
}
