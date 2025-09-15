// @ts-check
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 * Problem matcher plugin for VS Code build task integration
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',
  setup(build) {
    build.onStart(() => {
      console.log('[tracelet] build started');
    });
    build.onEnd((result) => {
      if (result.errors.length > 0) {
        result.errors.forEach(({ text, location }) => {
          if (location) {
            console.error(`✘ [ERROR] ${text}`);
            console.error(`    ${location.file}:${location.line}:${location.column}:`);
          } else {
            console.error(`✘ [ERROR] ${text}`);
          }
        });
      } else {
        console.log(`[tracelet] build finished (${production ? 'production' : 'development'})`);
      }
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    target: 'node18',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'info',
    plugins: [esbuildProblemMatcherPlugin],
    // Tree shaking for smaller bundles
    treeShaking: true,
    // Keep names for better error stack traces
    keepNames: !production,
  });

  if (watch) {
    await ctx.watch();
    console.log('[tracelet] watching for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
