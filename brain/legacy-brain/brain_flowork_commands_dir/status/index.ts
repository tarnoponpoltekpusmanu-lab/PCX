import type { Command } from '../../brain_flowork_commands.js'

const status = {
  type: 'local-jsx',
  name: 'status',
  description:
    'Show Flowork AI Engine status including version, model, account, API connectivity, and tool statuses',
  immediate: true,
  load: () => import('./status.js'),
} satisfies Command

export default status


