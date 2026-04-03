import type { Command } from '../../brain_flowork_commands.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../brain_flowork_utils/immediateCommand.js'
import { getMainLoopModel, renderModelName } from '../../brain_flowork_utils/model/model.js'

export default {
  type: 'local-jsx',
  name: 'model',
  get description() {
    return `Set the AI model for Flowork AI Engine (currently ${renderModelName(getMainLoopModel())})`
  },
  argumentHint: '[model]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./model.js'),
} satisfies Command


