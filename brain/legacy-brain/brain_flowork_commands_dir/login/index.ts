import type { Command } from '../../brain_flowork_commands.js'
import { hasFloworkOSApiKeyAuth } from '../../brain_flowork_utils/auth.js'
import { isEnvTruthy } from '../../brain_flowork_utils/envUtils.js'

export default () =>
  ({
    type: 'local-jsx',
    name: 'login',
    description: hasFloworkOSApiKeyAuth()
      ? 'Switch FloworkOS accounts'
      : 'Sign in with your FloworkOS account',
    isEnabled: () => !isEnvTruthy(process.env.DISABLE_LOGIN_COMMAND),
    load: () => import('./login.js'),
  }) satisfies Command


