import type { Command } from '../../brain_flowork_commands.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../brain_flowork_utils/immediateCommand.js'

export default {
  type: 'local-jsx',
  name: 'effort',
  description: 'Set effort level for model usage',
  argumentHint: '[low|medium|high|max|auto]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./effort.js'),
} satisfies Command


