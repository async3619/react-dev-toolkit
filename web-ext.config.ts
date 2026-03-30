import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { defineWebExtConfig } from 'wxt';

const chromeDataDir = resolve(homedir(), '.wxt/chrome-data');

const startUrls = process.env.REACT_DEV_TOOLKIT_START_URLS?.split(',');

export default defineWebExtConfig({
  chromiumArgs: [`--user-data-dir=${chromeDataDir}`, '--auto-open-devtools-for-tabs'],
  ...(startUrls && { startUrls }),
});
