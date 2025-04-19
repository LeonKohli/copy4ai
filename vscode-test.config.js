const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig({
  files: 'test/**/*.test.js',
  workspaceFolder: 'test/testWorkspace',
  mocha: {
    ui: 'tdd',
    timeout: 30000
  }
}); 