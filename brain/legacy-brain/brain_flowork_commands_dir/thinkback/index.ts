import type { Command } from '../../brain_flowork_commands.js'
import { checkStatsigFeatureGate_CACHED_MAY_BE_STALE } from '../../brain_flowork_services/analytics/growthbook.js'

const thinkback = {
  type: 'local-jsx',
  name: 'think-back',
  description: 'Your 2025 Flowork AI Engine Year in Review',
  isEnabled: () =>
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_thinkback'),
  load: () => import('./thinkback.js'),
} satisfies Command

export default thinkback


