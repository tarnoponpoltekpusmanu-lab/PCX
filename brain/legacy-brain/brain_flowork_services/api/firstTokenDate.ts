import axios from 'axios'
import { getOauthConfig } from '../../brain_flowork_constants/oauth.js'
import { getGlobalConfig, saveGlobalConfig } from '../../brain_flowork_utils/config.js'
import { getAuthHeaders } from '../../brain_flowork_utils/http.js'
import { logError } from '../../brain_flowork_utils/log.js'
import { getFloworkEngineUserAgent } from '../../brain_flowork_utils/userAgent.js'

/**
 * Fetch the user's first Flowork AI Engine token date and store in config.
 * This is called after successful login to cache when they started using Flowork AI Engine.
 */
export async function fetchAndStoreFloworkEngineFirstTokenDate(): Promise<void> {
  try {
    const config = getGlobalConfig()

    if (config.floworkEngineFirstTokenDate !== undefined) {
      return
    }

    const authHeaders = getAuthHeaders()
    if (authHeaders.error) {
      logError(new Error(`Failed to get auth headers: ${authHeaders.error}`))
      return
    }

    const oauthConfig = getOauthConfig()
    const url = `${oauthConfig.BASE_API_URL}/api/organization/claude_code_first_token_date`

    const response = await axios.get(url, {
      headers: {
        ...authHeaders.headers,
        'User-Agent': getFloworkEngineUserAgent(),
      },
      timeout: 10000,
    })

    const firstTokenDate = response.data?.first_token_date ?? null

    // Validate the date if it's not null
    if (firstTokenDate !== null) {
      const dateTime = new Date(firstTokenDate).getTime()
      if (isNaN(dateTime)) {
        logError(
          new Error(
            `Received invalid first_token_date from API: ${firstTokenDate}`,
          ),
        )
        // Don't save invalid dates
        return
      }
    }

    saveGlobalConfig(current => ({
      ...current,
      floworkEngineFirstTokenDate: firstTokenDate,
    }))
  } catch (error) {
    logError(error)
  }
}

