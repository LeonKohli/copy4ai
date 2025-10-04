import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
	{
		files: ['**/*.ts'],
		ignores: ['out/**', 'dist/**', '**/*.d.ts'],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				ecmaVersion: 6,
				sourceType: 'module',
			},
		},
		plugins: {
			'@typescript-eslint': typescriptEslint,
		},
		rules: {
			'@typescript-eslint/naming-convention': 'warn',
			'curly': 'warn',
			'eqeqeq': 'warn',
			'no-throw-literal': 'warn',
			'semi': 'off',
		},
	},
];
