import type { Command } from '../../brain_flowork_commands.js'
import { isEnvTruthy } from '../../brain_flowork_utils/envUtils.js'

export default {
  type: 'local-jsx',
  name: 'logout',
  description: 'Sign out from your FloworkOS account',
  isEnabled: () => !isEnvTruthy(process.env.DISABLE_LOGOUT_COMMAND),
  load: () => import('./logout.js'),
} satisfies Command


