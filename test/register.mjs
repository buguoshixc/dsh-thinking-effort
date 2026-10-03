/**
 * Install the stub resolver for `node --test`.
 *
 * Import this module before the test files with `--import`; the `test` script
 * already does. See `test/resolve-hook.mjs` for what is stubbed and why.
 *
 * @module dsh-thinking-effort/test/register
 */

import { register } from 'node:module'

register(new URL('./resolve-hook.mjs', import.meta.url))
