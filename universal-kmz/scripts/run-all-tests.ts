import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Regression = {
  name: string;
  file: string;
};

const require = createRequire(import.meta.url);
const tsxCli = require.resolve('tsx/cli');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const regressions: readonly Regression[] = [
  { name: 'precision', file: 'scripts/precision-regression.ts' },
  { name: 'provider-chain', file: 'scripts/provider-chain-regression.ts' },
  { name: 'cnefe', file: 'scripts/cnefe-regression.ts' },
  { name: 'cnefe-downloader', file: 'scripts/cnefe-downloader-regression.ts' },
  { name: 'cache-and-jobs', file: 'scripts/cache-and-jobs-regression.ts' },
  { name: 'upload-contract', file: 'scripts/upload-contract-regression.ts' },
  { name: 'export-contract', file: 'scripts/export-contract-regression.ts' },
  { name: 'config-and-sessions', file: 'scripts/config-and-sessions-regression.ts' },
  { name: 'trechos', file: 'scripts/trechos-regression.ts' },
  { name: 'pericial-merge', file: 'scripts/pericial-merge-regression.ts' },
  { name: 'harness/pericial-parse-contract', file: 'scripts/harness/pericial-parse-contract.ts' },
  { name: 'harness/pericial-export-contract', file: 'scripts/harness/pericial-export-contract.ts' }
];

function runRegression(regression: Regression): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    const complete = (passed: boolean) => {
      if (settled) return;
      settled = true;
      console.log(`${regression.name}: ${passed ? 'ok' : 'FALHOU'}`);
      resolve(passed);
    };

    const child = spawn(process.execPath, [tsxCli, path.resolve(projectRoot, regression.file)], {
      cwd: projectRoot,
      stdio: 'inherit'
    });

    child.once('error', error => {
      console.error(`Não foi possível iniciar a regressão: ${error.message}`);
      complete(false);
    });

    child.once('close', (code, signal) => {
      const passed = code === 0 && signal === null;
      complete(passed);
    });
  });
}

let failures = 0;

for (const regression of regressions) {
  if (!await runRegression(regression)) {
    failures++;
  }
}

if (failures > 0) {
  console.error(`${failures} regressão(ões) falharam.`);
  process.exitCode = 1;
}
