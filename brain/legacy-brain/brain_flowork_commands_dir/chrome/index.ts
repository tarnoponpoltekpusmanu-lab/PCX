import { getIsNonInteractiveSession } from '../../brain_flowork_bootstrap/state.js'
import type { Command } from '../../brain_flowork_commands.js'

const command: Command = {
  name: 'chrome',
  description: 'Claude in Chrome (Beta) settings',
  availability: ['claude-ai'],
  isEnabled: () => !getIsNonInteractiveSession(),
  type: 'local-jsx',
  load: () => import('./chrome.js'),
}

export default command


