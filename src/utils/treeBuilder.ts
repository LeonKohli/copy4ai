import * as fs from 'fs/promises';
import * as path from 'path';
import { isBinaryFile } from 'isbinaryfile';

export interface TreeNode {
  name: string;
  relativePath: string;
  type: 'file' | 'folder';
  ignored?: boolean;
  children?: TreeNode[];
}

export interface TreeBuildOptions {
  ig: any;
  isExcludedByAbsolutePath: (filePath: string) => boolean;
  shouldExcludeContent: (filePath: string) => boolean;
  maxFileSize: number;
  ignoreDotFiles: boolean;
  ignoreGitIgnore: boolean;
}

/**
 * Builds a tree structure for the file picker webview.
 * 
 * Traverses the directory recursively, marking files/folders as "ignored"
 * based on the same rules Copy4AI uses (.gitignore, exclude patterns, etc.)
 * so the picker UI can show them greyed out / unchecked by default.
 */
export class TreeBuilder {

  public static async buildTree(
    dir: string,
    rootDir: string,
    options: TreeBuildOptions,
    includeIgnored: boolean = false
  ): Promise<TreeNode[]> {
    const nodes: TreeNode[] = [];

    let items: import('fs').Dirent[];
    try {
      items = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return nodes;
    }

    // Sort: folders first, then files, both alphabetical
    items.sort((a, b) => {
      const aIsDir = a.isDirectory();
      const bIsDir = b.isDirectory();
      if (aIsDir && !bIsDir) { return -1; }
      if (!aIsDir && bIsDir) { return 1; }
      return a.name.localeCompare(b.name);
    });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      const relPath = path.relative(rootDir, fullPath);
      const relPosix = relPath.split(path.sep).join('/');

      // Determine if this entry is ignored by Copy4AI's rules
      const isIgnoredByPattern = this.safeIgnoreCheck(options.ig, relPosix);
      const isExcludedByPath = options.isExcludedByAbsolutePath(fullPath);
      const isIgnored = isIgnoredByPattern || isExcludedByPath;

      // Skip ignored entries entirely if user doesn't want to see them
      if (isIgnored && !includeIgnored) {
        continue;
      }

      if (item.isDirectory()) {
        const children = await this.buildTree(fullPath, rootDir, options, includeIgnored);
        // Only include folders that have at least one visible child
        if (children.length > 0 || includeIgnored) {
          nodes.push({
            name: item.name,
            relativePath: relPosix,
            type: 'folder',
            ignored: isIgnored,
            children,
          });
        }
      } else if (item.isFile()) {
        // Skip binary files — same logic as FileProcessor
        try {
          const binary = await isBinaryFile(fullPath);
          if (binary) { continue; }
        } catch {
          // If we can't check, include it
        }

        // Skip files over size limit
        try {
          const stat = await fs.stat(fullPath);
          if (stat.size > options.maxFileSize) { continue; }
        } catch {
          continue;
        }

        nodes.push({
          name: item.name,
          relativePath: relPosix,
          type: 'file',
          ignored: isIgnored,
        });
      }
    }

    return nodes;
  }

  /**
   * Collects all non-ignored file paths from a tree.
   * Used to determine the default selection set.
   */
  public static collectNonIgnoredFiles(nodes: TreeNode[]): string[] {
    const files: string[] = [];
    for (const node of nodes) {
      if (node.type === 'file' && !node.ignored) {
        files.push(node.relativePath);
      } else if (node.children) {
        files.push(...this.collectNonIgnoredFiles(node.children));
      }
    }
    return files;
  }

  private static safeIgnoreCheck(ig: any, relPath: string): boolean {
    try {
      return ig.ignores(relPath);
    } catch {
      return false;
    }
  }
}