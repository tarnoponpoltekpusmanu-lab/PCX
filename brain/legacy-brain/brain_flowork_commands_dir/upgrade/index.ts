import type { Command } from '../../brain_flowork_commands.js'
import { getSubscriptionType } from '../../brain_flowork_utils/auth.js'
import { isEnvTruthy } from '../../brain_flowork_utils/envUtils.js'

const upgrade = {
  type: 'local-jsx',
  name: 'upgrade',
  description: 'Upgrade to Max for higher rate limits and more Opus',
  availability: ['claude-ai'],
  isEnabled: () =>
    !isEnvTruthy(process.env.DISABLE_UPGRADE_COMMAND) &&
    getSubscriptionType() !== 'enterprise',
  load: () => import('./upgrade.js'),
} satisfies Command

export default upgrade


