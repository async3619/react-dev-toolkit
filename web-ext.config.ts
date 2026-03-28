import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { defineWebExtConfig } from 'wxt';

const chromeDataDir = resolve(homedir(), '.wxt/chrome-data');

export default defineWebExtConfig({
  chromiumArgs: [`--user-data-dir=${chromeDataDir}`],
});
