import type { Command } from '../../brain_flowork_commands.js'

const stats = {
  type: 'local-jsx',
  name: 'stats',
  description: 'Show your Flowork AI Engine usage statistics and activity',
  load: () => import('./stats.js'),
} satisfies Command

export default stats


