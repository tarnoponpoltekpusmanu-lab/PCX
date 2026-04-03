import type { LocalCommandResult } from '../../brain_flowork_commands.js'
import type { ToolUseContext } from '../../brain_flowork_tool.js'

export async function call(
  _args: string,
  context: ToolUseContext,
): Promise<LocalCommandResult> {
  if (context.openMessageSelector) {
    context.openMessageSelector()
  }
  // Return a skip message to not append any messages.
  return { type: 'skip' }
}


