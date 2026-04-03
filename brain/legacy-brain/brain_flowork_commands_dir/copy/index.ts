/**
 * Copy command - minimal metadata only.
 * Implementation is lazy-loaded from copy.tsx to reduce startup time.
 */
import type { Command } from '../../brain_flowork_commands.js'

const copy = {
  type: 'local-jsx',
  name: 'copy',
  description:
    "Copy Flowork's last response to clipboard (or /copy N for the Nth-latest)",
  load: () => import('./copy.js'),
} satisfies Command

export default copy


