import { formatTotalCost } from '../../cost-tracker.js'
import { currentLimits } from '../../brain_flowork_services/claudeAiLimits.js'
import type { LocalCommandCall } from '../../brain_flowork_types/command.js'
import { isClaudeAISubscriber } from '../../brain_flowork_utils/auth.js'

export const call: LocalCommandCall = async () => {
  if (isClaudeAISubscriber()) {
    let value: string

    if (currentLimits.isUsingOverage) {
      value =
        'You are currently using your overages to power your Flowork AI Engine usage. We will automatically switch you back to your subscription rate limits when they reset'
    } else {
      value =
        'You are currently using your subscription to power your Flowork AI Engine usage'
    }

    if (process.env.USER_TYPE === 'ant') {
      value += `\n\n[ANT-ONLY] Showing cost anyway:\n ${formatTotalCost()}`
    }
    return { type: 'text', value }
  }
  return { type: 'text', value: formatTotalCost() }
}


