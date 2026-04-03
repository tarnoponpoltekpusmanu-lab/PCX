import type { Command } from '../../brain_flowork_commands.js'

const stickers = {
  type: 'local',
  name: 'stickers',
  description: 'Order Flowork AI Engine stickers',
  supportsNonInteractive: false,
  load: () => import('./stickers.js'),
} satisfies Command

export default stickers


