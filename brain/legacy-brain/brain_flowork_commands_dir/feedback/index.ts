import type { Command } from '../../brain_flowork_commands.js'
import { isPolicyAllowed } from '../../brain_flowork_services/policyLimits/index.js'
import { isEnvTruthy } from '../../brain_flowork_utils/envUtils.js'
import { isEssentialTrafficOnly } from '../../brain_flowork_utils/privacyLevel.js'

const feedback = {
  aliases: ['bug'],
  type: 'local-jsx',
  name: 'feedback',
  description: `Submit feedback about Flowork AI Engine`,
  argumentHint: '[report]',
  isEnabled: () =>
    !(
      isEnvTruthy(process.env.FLOWORK_ENGINE_USE_BEDROCK) ||
      isEnvTruthy(process.env.FLOWORK_ENGINE_USE_VERTEX) ||
      isEnvTruthy(process.env.FLOWORK_ENGINE_USE_FOUNDRY) ||
      isEnvTruthy(process.env.DISABLE_FEEDBACK_COMMAND) ||
      isEnvTruthy(process.env.DISABLE_BUG_COMMAND) ||
      isEssentialTrafficOnly() ||
      process.env.USER_TYPE === 'ant' ||
      !isPolicyAllowed('allow_product_feedback')
    ),
  load: () => import('./feedback.js'),
} satisfies Command

export default feedback


