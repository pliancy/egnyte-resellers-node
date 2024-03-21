import {
    EgnyteConfig,
    EgnyteCustomer,
    EgnyteUpdateResponse,
    Feature,
    FeatureMap,
    Features,
    FeatureStat,
    Plans,
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
     * retrieves all customer data from multiple egnyte resellers API endpoints and models it to be actually readable
     * @returns array of customer objects containing useful stuff
     */
    async getAllCustomers(): Promise<EgnyteCustomer[]> {
        const { authCookie, csrfToken } = await this.authenticate()
        const planIds = await this.plans._getAllPlanIds(authCookie)

        const customers = []
        for (const planId of planIds) {
            const usageStatsRes = await this.http.get(
                `/msp/usage_stats/${this.resellerId}/${planId}/`,
                {
                    headers: { cookie: authCookie, 'X-CSRFToken': csrfToken },
                },
            )
            for (const customer of usageStatsRes.data) {
                const [customerEgnyteId, ref] = Object.entries(customer)[0] as [string, UsageStats]

                const obj: EgnyteCustomer = {
                    customerEgnyteId,
                    planId,
                    powerUsers: {
                        total: ref.power_user_stats.Used + ref.power_user_stats.Unused,
                        used: ref.power_user_stats.Used,
                        available: ref.power_user_stats.Available,
                        free: ref.power_user_stats.Unused,
                    },
                    storageGB: {
                        total: ref.storage_stats.Used + ref.storage_stats.Unused,
                        used: ref.storage_stats.Used,
                        available: ref.storage_stats.Available,
                        free: ref.storage_stats.Unused,
                    },
                    features: {} as Features,
                }

                // add any features present in ref.feature_stats to obj.features, transforming to
                // camelCase and adding the calculation for totalStandardUserPacks
                for (const k in ref.feature_stats) {
                    const key = k as FeatureStat
                    const mappedKey = FeatureMap.get(key) as Feature

                    if (mappedKey) {
                        obj.features[mappedKey] = ref.feature_stats[key]
                    } else {
                        const camelCasedKey = this.toCamelCase(key) as Feature
                        obj.features[camelCasedKey] = ref.feature_stats[key]
                    }

                    // Standard Users are charged in packs of 5 and the total number of packs is equal
                    // to addition_su - total_power_users. Rounding up to the nearest integer (e.g.,
                    // 3.0 -> 3, 3.1 -> 4
                    obj.features.totalStandardUserPacks = Math.ceil(
                        (ref.feature_stats.additional_su - ref.feature_stats.total_power_users) / 5,
                    )
                }

                customers.push(obj)
            }
        }
        return customers
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
     * @param autoAddToPool
     * @returns response object
     */
    async updateCustomerPowerUsers(
        customerId: string,
        numOfUsers: number,
        autoAddToPool?: boolean,
    ): Promise<any> {
        customerId = customerId.toLowerCase()
        const customer = await this.getOneCustomer(customerId)
        if (customer.powerUsers.available <= 0 && !autoAddToPool)
            throw new Error('No available licenses on customers reseller plan.')
        if (numOfUsers < customer.powerUsers.used && this.config.forceLicenseChange !== true) {
            return {
                result: 'NO_CHANGE',
                message: `customerId ${customerId} currently has ${customer.powerUsers.used} power users in use. Refusing to set to ${numOfUsers} power users.`,
            }
        } else if (numOfUsers === customer.powerUsers.total) {
            return {
                result: 'NO_CHANGE',
                message: `customerId ${customerId} is already set to ${numOfUsers} power users. Did not modify.`,
            }
        }
        if (autoAddToPool) {
            const plans = await this.plans.getPlans()
            const { planId, totalPowerUsers, availablePowerUsers } = plans.find(
                (e: any) => e.planId === customer.planId,
            )
            const usersNeeded = numOfUsers - customer.powerUsers.total
            if (usersNeeded > availablePowerUsers) {
                const licensesToAdd = Math.ceil((usersNeeded - availablePowerUsers) / 5) * 5
                const updatedLicenesTotal = licensesToAdd + totalPowerUsers

                await this.plans.UpdatePowerUserLicensing(planId, updatedLicenesTotal)
            }
        }
        const { authCookie, csrfToken } = await this.authenticate()

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
        const response: EgnyteUpdateResponse = {
            result: 'SUCCESS',
            message: `Updated customerId ${customerId} from ${customer.powerUsers.total} to ${numOfUsers} power users successfully.`,
        }
        if (result.msg === 'Plan updated successfully!') {
            return response
        } else if (
            result.msg === 'CFS plan upgrade failed. Please contact support.' &&
            this.config.forceLicenseChange &&
            res.status === 400
        ) {
            return response
        } else {
            throw new Error(result.msg)
        }
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
