import {
    EgnyteConfig,
    EgnyteCustomer,
    EgnyteUpdateResponse,
    Feature,
    FeatureMap,
    Features,
    FeatureStat,
    Plans,
    ResourceStats,
    StorageStats,
    UpdateCustomer,
    UsageStats,
} from '../../index'
import { Base } from '../base/base'

export class Customers extends Base {
    constructor(
        private readonly plans: Plans,
        _config: EgnyteConfig,
    ) {
        super(_config)
    }

    /**
     * Retrieves all customer data from multiple Egnyte resellers API endpoints and transforms it
     * into a readable format. Plans that throw errors during retrieval will be skipped but logged.
     *
     * @returns Promise resolving to an array of structured customer objects
     */
    async getAllCustomers(): Promise<EgnyteCustomer[]> {
        // Authenticate and retrieve necessary tokens
        const { authCookie, csrfToken } = await this.authenticate()

        // Retrieve all plan IDs
        const planIds = await this.plans._getAllPlanIds(authCookie)

        const customers: EgnyteCustomer[] = []
        let processedCount = 0

        // Process each plan sequentially
        for (const planId of planIds) {
            processedCount++

            // Fetch usage statistics for current plan
            let usageStats: EgnyteCustomer[]
            try {
                const res = await this.http.get(`/msp/usage_stats/${this.resellerId}/${planId}/`, {
                    headers: {
                        cookie: authCookie,
                        'X-CSRFToken': csrfToken,
                    },
                })
                usageStats = res.data
            } catch (error) {
                continue // Skip this plan and continue with the next one
            }

            // Transform each customer's data
            for (const customer of usageStats) {
                // Extract customer ID and stats from the customer object
                const entries = Object.entries(customer)
                if (entries.length === 0) {
                    continue
                }

                const [customerEgnyteId, ref] = entries[0] as [string, UsageStats]

                // Create structured customer object with resource usage stats
                const obj: EgnyteCustomer = {
                    customerEgnyteId,
                    planId,
                    powerUsers: this.extractResourceStats(ref.power_user_stats),
                    storageGB: this.extractResourceStats(ref.storage_stats),
                    features: this.processFeatures(ref.feature_stats),
                }

                customers.push(obj)
            }

            // Apply rate limiting with exponential backoff
            const delay = this.calculateBackoff(processedCount, this.config.backoffDelay ?? 1000)
            await this.delay(delay)
        }

        return customers
    }

    /**
     * Transforms resource statistics into a standardized format
     */
    private extractResourceStats(stats: any): ResourceStats {
        return {
            total: stats.Used + stats.Unused,
            used: stats.Used,
            available: stats.Available,
            free: stats.Unused,
        }
    }

    /**
     * Processes feature statistics and applies necessary transformations
     */
    private processFeatures(featureStats: Record<FeatureStat, number>): Features {
        const features = {} as Features

        // Process each feature statistic
        for (const [key, value] of Object.entries(featureStats)) {
            const typedKey = key as FeatureStat

            // Use predefined mapping if available, otherwise transform to camelCase
            const mappedKey = FeatureMap.get(typedKey) as Feature
            const targetKey = mappedKey || (this.toCamelCase(typedKey) as Feature)

            // Assign value to the appropriate key
            features[targetKey] = value
        }

        // Calculate standard user packs - special calculation required by business logic
        features.totalStandardUserPacks = Math.ceil(
            (featureStats.additional_su - featureStats.total_power_users) / 5,
        )

        return features
    }

    /**
     * Implements exponential backoff for rate limiting
     */
    private calculateBackoff(attempt: number, baseDelay: number): number {
        const maxDelay = 10000 // Maximum delay of 10 seconds
        const calculatedDelay = Math.min(
            baseDelay * Math.pow(1.5, attempt - 1), // Exponential increase
            maxDelay,
        )
        return calculatedDelay
    }

    /**
     * Helper method to pause execution for specified milliseconds
     */
    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms))
    }
    /**
     * retrieves one customer's data from multiple egnyte resellers API endpoints and models it to be actually readable
     * @param customerId the egnyte customerId you want to return data on
     * @returns the customer object containing useful stuff
     */
    async getOneCustomer(customerId: string): Promise<EgnyteCustomer> {
        const allCustomers = await this.getAllCustomers()
        const customer = allCustomers.find((customer) => customer.customerEgnyteId === customerId)
        if (!customer) throw new Error(`unable to find egnyte customer: ${customerId}`)
        return customer
    }

    /**
     * Allows you to update a customer by using the model from getOneCustomer directly. This is the recommended way to update licensing
     * @param customerId the egnyte customerId you want to update
     * @param data the new desired state of the customer
     */
    async updateCustomer(customerId: string, data: UpdateCustomer) {
        const allCustomers = await this.getAllCustomers()
        const customer = allCustomers.find((customer) => customer.customerEgnyteId === customerId)
        if (!customer) throw new Error(`unable to find egnyte customer: ${customerId}`)
        if (data?.powerUsers?.total && data.powerUsers.total !== customer.powerUsers.total) {
            await this.updateCustomerPowerUsers(customerId, data.powerUsers.total)
            customer.powerUsers.total = data.powerUsers.total
            customer.powerUsers.free = data.powerUsers.total - customer.powerUsers.used
        }
        if (data?.storageGB?.total && data.storageGB.total !== customer.storageGB.total) {
            await this.updateCustomerStorage(customerId, data.storageGB.total)
            customer.storageGB.total = data.storageGB.total
            customer.storageGB.free = data.storageGB.total - customer.storageGB.used
        }
        return customer
    }

    /**
     * Updates a customer with a new storage size
     * @param customerId customer 'domain' key from getAllStorage()
     * @param storageSizeGB how much storage the customer should have in GB
     * @returns response object
     */
    async updateCustomerStorage(
        customerId: string,
        storageSizeGB: number,
    ): Promise<EgnyteUpdateResponse> {
        customerId = customerId.toLowerCase()
        const customer = await this.getOneCustomer(customerId)
        if (storageSizeGB < customer.storageGB.used) {
            const response: EgnyteUpdateResponse = {
                result: 'NO_CHANGE',
                message: `customerId ${customerId} currently has ${customer.storageGB.used}GB storage in use. Refusing to set to ${storageSizeGB}GB storage.`,
            }
            return response
        } else if (storageSizeGB === customer.storageGB.total) {
            const response: EgnyteUpdateResponse = {
                result: 'NO_CHANGE',
                message: `customerId ${customerId} is already set to ${storageSizeGB}GB storage. Did not modify.`,
            }
            return response
        }
        const { authCookie, csrfToken } = await this.authenticate()
        const response = await this.http.post(
            `/msp/change_storage/${this.resellerId}/`,
            {
                domain: customerId,
                storage: storageSizeGB.toString(),
            },
            {
                headers: {
                    Cookie: `${authCookie}; csrftoken=${csrfToken}`,
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-CSRFToken': csrfToken,
                },
            },
        )
        const result = response.data
        if (result.msg === 'Plan updated successfully!') {
            return {
                result: 'SUCCESS',
                message: `Updated customerId ${customerId} from ${customer.storageGB.total}GB to ${storageSizeGB}GB storage successfully.`,
            }
        } else {
            throw new Error(result.msg)
        }
    }

    /**
     * Updates a customer with a new power user count
     * @param customerId customer 'domain' key from getAllPowerUsers()
     * @param numOfUsers how many licenses to assign to customer
     * @param autoAddToPool whether to automatically add licenses to the pool if needed
     * @returns response object with result and message
     */
    async updateCustomerPowerUsers(
        customerId: string,
        numOfUsers: number,
        autoAddToPool?: boolean,
    ): Promise<EgnyteUpdateResponse> {
        // Normalize customer ID to lowercase
        customerId = customerId.toLowerCase()

        // Retrieve current customer data
        const customer = await this.getOneCustomer(customerId)

        // Early return if no change is needed
        if (numOfUsers === customer.powerUsers.total) {
            return {
                result: 'NO_CHANGE',
                message: `customerId ${customerId} is already set to ${numOfUsers} power users. Did not modify.`,
            }
        }

        // Check if requested change would reduce below currently used licenses
        if (numOfUsers < customer.powerUsers.used && this.config.forceLicenseChange !== true) {
            return {
                result: 'NO_CHANGE',
                message: `customerId ${customerId} currently has ${customer.powerUsers.used} power users in use. Refusing to set to ${numOfUsers} power users.`,
            }
        }

        // Check if there are available licenses for an increase
        const licensesNeeded = numOfUsers - customer.powerUsers.total
        if (
            licensesNeeded > 0 &&
            customer.powerUsers.available < licensesNeeded &&
            !autoAddToPool
        ) {
            throw new Error(
                `Not enough available licenses on customers reseller plan. Need ${licensesNeeded} but only ${customer.powerUsers.available} are available.`,
            )
        }

        // Handle auto-adding licenses to the pool if needed
        if (autoAddToPool && licensesNeeded > 0) {
            await this.ensureSufficientLicensesInPool(
                customer.planId,
                licensesNeeded,
                customer.powerUsers.available,
            )
        }

        // Get authentication tokens
        const { authCookie, csrfToken } = await this.authenticate()

        // Make the API request
        const res = await this.http.post(
            `/msp/change_power_users/${this.resellerId}/`,
            {
                domain: customerId,
                power_users: numOfUsers.toString(),
            },
            {
                headers: {
                    Cookie: `${authCookie}; csrftoken=${csrfToken}`,
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-CSRFToken': csrfToken,
                    Referer: 'https://resellers.egnyte.com',
                },
                validateStatus: (status) => (status >= 200 && status <= 303) || status === 400,
            },
        )

        const result = res.data

        // Check results
        if (result.msg === 'Plan updated successfully!') {
            return {
                result: 'SUCCESS',
                message: `Updated customerId ${customerId} from ${customer.powerUsers.total} to ${numOfUsers} power users successfully.`,
            }
        } else if (
            result.msg === 'CFS plan upgrade failed. Please contact support.' &&
            this.config.forceLicenseChange &&
            res.status === 400
        ) {
            return {
                result: 'SUCCESS',
                message: `Updated customerId ${customerId} from ${customer.powerUsers.total} to ${numOfUsers} power users successfully with force option.`,
            }
        } else {
            throw new Error(result.msg || 'Unknown error updating power users')
        }
    }

    /**
     * Ensures there are enough licenses in the pool for the requested change
     * @param planId the ID of the plan to modify
     * @param licensesNeeded number of additional licenses needed
     * @param availableLicenses current number of available licenses in the pool
     * @private
     */
    private async ensureSufficientLicensesInPool(
        planId: string,
        licensesNeeded: number,
        availableLicenses: number,
    ): Promise<void> {
        if (licensesNeeded <= availableLicenses) {
            return // Already have enough licenses
        }

        const plans = await this.plans.getPlans()
        const plan = plans.find((e: any) => e.planId === planId)

        if (!plan) {
            throw new Error(`Could not find plan with ID ${planId}`)
        }

        const additionalLicensesNeeded = licensesNeeded - availableLicenses

        // Licenses are added in packs of 5, rounded up
        const licensesToAdd = Math.ceil(additionalLicensesNeeded / 5) * 5
        const updatedLicensesTotal = licensesToAdd + plan.totalPowerUsers

        await this.plans.UpdatePowerUserLicensing(planId, updatedLicensesTotal)
    }
    /**
     * retrieves protect plan usage for a customer
     * @returns object containing the available usage data or null if the customer does not have protect
     */
    async getCustomerProtectPlanUsage(egnyteTenantId: string): Promise<StorageStats | null> {
        const { authCookie, csrfToken } = await this.authenticate()
        const { data: protectUsage } = await this.http.get(
            `/msp/usage_stats/${this.resellerId}/${this.config.protectPlanId}/`,
            {
                headers: { cookie: authCookie, 'X-CSRFToken': csrfToken },
            },
        )

        const id = `protect${egnyteTenantId.toLowerCase()}`

        for (const entry of protectUsage) {
            if (Object.keys(entry)[0] === id) {
                return entry[id].storage_stats
            }
        }

        return null
    }

    /**
     * Converts a string to camel case.
     * Shamelessly stolen from https://stackoverflow.com/questions/40710628/how-to-convert-snake-case-to-camelcase
     * @param {string} str - The input string.
     * @returns {string} - The camel case version of the input string.
     * @private
     */
    private toCamelCase(str: string): string {
        return str.toLowerCase().replace(/[-_][a-z]/g, (group) => group.slice(-1).toUpperCase())
    }
}
