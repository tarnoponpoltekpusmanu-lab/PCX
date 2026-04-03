import type { Command } from '../../brain_flowork_commands.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../brain_flowork_services/analytics/growthbook.js'
import { isPolicyAllowed } from '../../brain_flowork_services/policyLimits/index.js'

const web = {
  type: 'local-jsx',
  name: 'web-setup',
  description:
    'Setup Flowork AI Engine on the web (requires connecting your GitHub account)',
  availability: ['claude-ai'],
  isEnabled: () =>
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_lantern', false) &&
    isPolicyAllowed('allow_remote_sessions'),
  get isHidden() {
    return !isPolicyAllowed('allow_remote_sessions')
  },
  load: () => import('./remote-setup.js'),
} satisfies Command

export default web


