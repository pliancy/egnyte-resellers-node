export interface EgnyteConfig {
    /** the egnyte resellers portal username */
    username: string
    /** the egnyte resellers portal password */
    password: string
    /**
     * Protect planId
     */
    protectPlanId?: number
    /** timeout threshold in milliseconds */
    timeoutMs?: number
    forceLicenseChange?: boolean
    /** delay between API calls in milliseconds */
    backoffDelay?: number
}

export interface EgnyteUpdateResponse {
    result: string
    message: string
}

export interface StorageStats {
    Used: number
    Unused: number
    Available: number
}

export interface UsageStats {
    power_user_stats: StorageStats
    storage_stats: StorageStats
    feature_stats: FeatureStats
}

/**
 * Egnyte has tons of possible values in feature_stats, most of which can be transformed to camelCase
 * and be easily understood. Everything below is for mapping the oddballs to more readable values
 */

export type FeatureStat =
    | 'elc'
    | 'adv_branding'
    | 'sf_integration_2'
    | 'tfa_integration'
    | 'tfa_voice_calls'
    | 'tfa_sms'
    | 'used_su'
    | 'additional_su'
    | 'total_power_users'

export type FeatureStats = {
    [index in FeatureStat & string]: number
}

export type Feature =
    | 'twoFactorAuthVoice'
    | 'twoFactorAuthIntegration'
    | 'twoFactorAuthSms'
    | 'totalStandardUserPacks'
    | 'turboOrStorageSync'
    | 'salesForceIntegration'
    | 'usedStandardUsers'
    | 'additionalStandardUsers'

export type Features = {
    [index in Feature & string]: number
}

export const FeatureMap = new Map<FeatureStat, Feature>([
    ['elc', 'turboOrStorageSync'],
    ['tfa_integration', 'twoFactorAuthIntegration'],
    ['sf_integration_2', 'salesForceIntegration'],
    ['tfa_voice_calls', 'twoFactorAuthVoice'],
    ['tfa_sms', 'twoFactorAuthSms'],
    ['used_su', 'usedStandardUsers'],
    ['additional_su', 'additionalStandardUsers'],
])
