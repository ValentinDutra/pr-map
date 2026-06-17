import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dashboard/**', 'dist/**', 'node_modules/**', '.pr-map/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
