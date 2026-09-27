import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// Architecture boundaries (SPEC.md "Architecture and code layout").
//
// Flat config replaces a rule's options wholesale when several blocks match a
// file, so each layer below lists every restriction that applies to it.

const CORE_ONLY = {
  // core/ is flat: only sibling imports (./x) and `tonal`, the one package
  // allowed in core (chord-symbol parsing).
  regex: '^(?!\\./)(?!tonal(/|$))',
  message: 'core/ may only import other core/ modules (./x) or `tonal`.',
};
const NO_PARENT = {
  regex: '(^|/)\\.\\.(/|$)',
  message: 'core/ may not reach outside core/.',
};
const NO_ENGINE = {
  regex: '(^|/)engine(/|$)',
  message: 'views/ never import engine/. Go through state/ commands and selectors.',
};
const NO_MUTATE = {
  regex: '(^|/)mutate$',
  message: 'Only state/commands.ts may mutate the sketch. Dispatch a command instead.',
};

const restrict = (...patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
});

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },

  js.configs.recommended,
  ...tseslint.configs.strict,

  {
    files: ['src/**/*.{ts,tsx}', 'spike/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/**/*.tsx'],
    ...reactHooks.configs.flat.recommended,
  },
  {
    files: ['tests/**/*.ts', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },

  // Boundary rules, most general first.
  { files: ['src/**/*.{ts,tsx}'], rules: restrict(NO_MUTATE) },
  { files: ['src/views/**/*.{ts,tsx}'], rules: restrict(NO_ENGINE, NO_MUTATE) },
  { files: ['src/core/**/*.ts'], rules: restrict(CORE_ONLY, NO_PARENT) },
  { files: ['src/state/commands.ts', 'src/state/mutate.ts'], rules: restrict() },
);
