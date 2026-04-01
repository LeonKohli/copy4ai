import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigurationService } from './utils/configuration';
import { IgnoreUtils } from './utils/ignoreUtils';
import { FileProcessor } from './utils/fileProcessor';
import { OutputFormatter } from './utils/formatters';
import { TokenCounter } from './utils/tokenCounter';
import { TreeBuilder, TreeBuildOptions } from './utils/treeBuilder';
import { FileContent, ProcessFileOptions } from './types';

interface PickerToggles {
  showDotFiles: boolean;
  showGitIgnored: boolean;
}

export class FilePickerPanel {
  public static currentPanel: FilePickerPanel | undefined;
  private static readonly viewType = 'copy4aiFilePicker';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _folderPath: string;
  private readonly _workspaceRoot: string;
  private readonly _extensionUri: vscode.Uri;

  public static async createOrShow(
    extensionUri: vscode.Uri,
    folderPath: string
  ): Promise<void> {
    const column = vscode.ViewColumn.One;

    if (FilePickerPanel.currentPanel) {
      FilePickerPanel.currentPanel._panel.reveal(column);
      await FilePickerPanel.currentPanel._sendTree({
        showDotFiles: false,
        showGitIgnored: false,
      });
      return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(
      vscode.Uri.file(folderPath)
    );
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder found');
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      FilePickerPanel.viewType,
      `Select & Copy (Copy4AI) — ${path.basename(folderPath)}`,
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );

    FilePickerPanel.currentPanel = new FilePickerPanel(
      panel,
      folderPath,
      workspaceFolder.uri.fsPath,
      extensionUri
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    folderPath: string,
    workspaceRoot: string,
    extensionUri: vscode.Uri
  ) {
    this._panel = panel;
    this._folderPath = folderPath;
    this._workspaceRoot = workspaceRoot;
    this._extensionUri = extensionUri;

    this._panel.webview.html = this._getHtml();

    this._panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case 'ready':
          await this._sendTree({
            showDotFiles: false,
            showGitIgnored: false,
          });
          break;

        case 'refreshTree': {
          const toggles: PickerToggles = {
            showDotFiles: msg.showDotFiles ?? false,
            showGitIgnored: msg.showGitIgnored ?? false,
          };
          await this._sendTree(toggles, msg.currentSelection);
          break;
        }

        case 'copy': {
          const selectedPaths: string[] = msg.selectedPaths;
          await this._copySelected(selectedPaths);
          break;
        }

        case 'cancel':
          this._panel.dispose();
          break;
      }
    });

    this._panel.onDidDispose(() => {
      FilePickerPanel.currentPanel = undefined;
    });
  }

  /**
   * Builds the ignore instance with overrides from the picker toggles.
   * 
   * When "Show dot files" is checked, we skip adding dot file ignore rules.
   * When "Show .gitignore'd files" is checked, we skip loading .gitignore.
   * This lets the TreeBuilder actually see those files.
   */
  private async _buildIgnoreInstance(toggles: PickerToggles): Promise<any> {
    const config = ConfigurationService.getConfiguration();
    const excludeConfig = ConfigurationService.getExcludeConfig();

    // If user toggled "Show dot files", don't add the dot file ignore rule
    const effectiveIgnoreDotFiles = toggles.showDotFiles
      ? false
      : config.ignoreDotFiles;

    const ig = IgnoreUtils.createIgnoreInstance(
      excludeConfig.patterns,
      effectiveIgnoreDotFiles
    );

    // If user toggled "Show .gitignore'd files", don't load .gitignore rules
    const effectiveIgnoreGitIgnore = toggles.showGitIgnored
      ? false
      : config.ignoreGitIgnore;

    if (effectiveIgnoreGitIgnore) {
      await IgnoreUtils.addGitIgnoreRules(this._workspaceRoot, ig);
    }

    return ig;
  }

  private async _sendTree(
    toggles: PickerToggles,
    preserveSelection?: string[]
  ): Promise<void> {
    const config = ConfigurationService.getConfiguration();
    const excludeConfig = ConfigurationService.getExcludeConfig();

    const ig = await this._buildIgnoreInstance(toggles);

    const isExcludedByAbsolutePath = IgnoreUtils.createAbsolutePathExclusionFn(
      this._workspaceRoot,
      excludeConfig.paths
    );

    const shouldExcludeContent = IgnoreUtils.createContentExclusionFn(
      this._workspaceRoot,
      config.excludeContentPatterns
    );

    const options: TreeBuildOptions = {
      ig,
      isExcludedByAbsolutePath,
      shouldExcludeContent,
      maxFileSize: config.maxFileSize,
      ignoreDotFiles: toggles.showDotFiles ? false : config.ignoreDotFiles,
      ignoreGitIgnore: toggles.showGitIgnored ? false : config.ignoreGitIgnore,
    };

    // When toggles are active, we want to see everything including ignored files
    const includeIgnored = toggles.showDotFiles || toggles.showGitIgnored;

    const tree = await TreeBuilder.buildTree(
      this._folderPath,
      this._workspaceRoot,
      options,
      includeIgnored
    );

    const defaultSelected = TreeBuilder.collectNonIgnoredFiles(tree);

    this._panel.webview.postMessage({
      command: 'loadTree',
      tree,
      folderName: path.basename(this._folderPath),
      defaultSelected,
      preserveSelection: preserveSelection || null,
      settings: {
        ignoreDotFiles: config.ignoreDotFiles,
        ignoreGitIgnore: config.ignoreGitIgnore,
        outputFormat: config.outputFormat,
      },
    });
  }

  private async _copySelected(selectedPaths: string[]): Promise<void> {
    try {
      const config = ConfigurationService.getConfiguration();
      const excludeConfig = ConfigurationService.getExcludeConfig();

      const ig = IgnoreUtils.createIgnoreInstance(
        excludeConfig.patterns,
        config.ignoreDotFiles
      );
      if (config.ignoreGitIgnore) {
        await IgnoreUtils.addGitIgnoreRules(this._workspaceRoot, ig);
      }

      const isExcludedByAbsolutePath = IgnoreUtils.createAbsolutePathExclusionFn(
        this._workspaceRoot,
        excludeConfig.paths
      );
      const shouldExcludeContent = IgnoreUtils.createContentExclusionFn(
        this._workspaceRoot,
        config.excludeContentPatterns
      );

      // Use a permissive ignore instance since user explicitly selected these files
      const permissiveIg = IgnoreUtils.createIgnoreInstance([], false);

      const processOptions: ProcessFileOptions = {
        maxFileSize: config.maxFileSize,
        compressCode: config.compressCode,
        removeComments: config.removeComments,
        isExcludedByAbsolutePath: () => false,
        shouldExcludeContent,
      };

      const entries: FileContent[] = [];
      for (const relPath of selectedPaths) {
        const fullPath = path.join(this._workspaceRoot, relPath);
        const result = await FileProcessor.processFile(
          fullPath,
          this._workspaceRoot,
          permissiveIg,
          processOptions
        );
        if (result) {
          entries.push(result);
        }
      }

      let projectTree = '';
      if (config.includeProjectTree) {
        const { ProjectTreeGenerator } = await import('./utils/projectTree');
        projectTree = await ProjectTreeGenerator.generateProjectTree(
          this._folderPath,
          ig,
          config.maxDepth,
          0,
          '',
          isExcludedByAbsolutePath
        );
        const folderName = path.basename(this._folderPath) + '/';
        projectTree = folderName + '\n' + projectTree;
      }

      const formatted = OutputFormatter.formatOutput(
        config.outputFormat,
        projectTree,
        entries
      );

      await vscode.env.clipboard.writeText(formatted);

      if (config.enableTokenCounting) {
        await TokenCounter.showTokenInfo(
          formatted,
          config.llmModel,
          config.outputFormat,
          config.enableTokenWarning,
          config.maxTokens
        );
      } else {
        vscode.window.showInformationMessage(
          `Copied ${entries.length} files to clipboard (${config.outputFormat} format)`
        );
      }

      this._panel.dispose();
    } catch (e: any) {
      vscode.window.showErrorMessage(`Copy4AI Error: ${e.message}`);
    }
  }

  private _getHtml(): string {
    const htmlPath = path.join(this._extensionUri.fsPath, 'media', 'filePicker.html');
    return fs.readFileSync(htmlPath, 'utf-8');
  }
}