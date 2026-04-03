import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../brain_flowork_services/analytics/index.js'
import { isEnvTruthy } from '../envUtils.js'

export type APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry'

export function getAPIProvider(): APIProvider {
  return isEnvTruthy(process.env.FLOWORK_ENGINE_USE_BEDROCK)
    ? 'bedrock'
    : isEnvTruthy(process.env.FLOWORK_ENGINE_USE_VERTEX)
      ? 'vertex'
      : isEnvTruthy(process.env.FLOWORK_ENGINE_USE_FOUNDRY)
        ? 'foundry'
        : 'firstParty'
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Check if FLOWORKOS_BASE_URL is a first-party FloworkOS API URL.
 * Returns true if not set (default API) or points to api.floworkos.com
 * (or api-staging.floworkos.com for ant users).
 */
export function isFirstPartyFloworkOSBaseUrl(): boolean {
  const baseUrl = process.env.FLOWORKOS_BASE_URL
  if (!baseUrl) {
    return true
  }
  try {
    const host = new URL(baseUrl).host
    const allowedHosts = ['api.floworkos.com']
    if (process.env.USER_TYPE === 'ant') {
      allowedHosts.push('api-staging.floworkos.com')
    }
    return allowedHosts.includes(host)
  } catch {
    return false
  }
}

