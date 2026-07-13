import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // dist/ 构建产物 + coverage/ 测试覆盖率报告 不纳入 lint
  { ignores: ['dist', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // no-unused-vars 配置：
      // - ignoreRestSiblings: 解构时为剥离属性而提取的变量不报错
      //   （如 react-markdown 组件 ({ node, ...props }) → node 仅用于排除，不传入 DOM）
      // - argsIgnorePattern / varsIgnorePattern: 下划线前缀的变量/参数不报错
      //   （约定：故意未使用的标识符用 _ 前缀标记）
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
)
