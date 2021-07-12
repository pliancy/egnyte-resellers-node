import qs from 'querystring'
import axios, { AxiosRequestConfig } from 'axios'

interface EgnyteCustomer {
    customerEgnyteId: string
    planId: string
    powerUsers: {
        total: number
        used: number
        available: number
        free: number
    }
    storageGB: {
        total: number
        used: number
        available: number
        free: number
    }
}

interface EgnyteUpdateResponse {
    result: string
    message: string
}

interface EgnyteConfig {
    /** the egnyte resellers portal username */
    username: string
    /** the egnyte resellers portal password */
    password: string
    /** timeout threshold in milliseconds */
    timeoutMs?: number
    forceLicenseChange?: boolean
}

interface UpdateCustomer {
    powerUsers?: { total?: number }
    storageGB?: { total?: number }
}

class Egnyte {
    private readonly _config: EgnyteConfig
    private readonly httpConfig: AxiosRequestConfig
    private resellerId: string
    /**
     * Creates an instance of Egnyte.
     * @param config the config object
     * @memberof Egnyte
     */
    constructor(config: EgnyteConfig) {
        if (!config.username || !config.password) {
            throw new Error(
                'missing config values username or password when calling the Egnyte constructor',
            )
        }
        this._config = config

        // If timeoutMs is provided ensure it's a number or default to 20000
        const ms = this._config.timeoutMs ?? -1
        const n = parseInt(ms as any)
        const timeout = !isNaN(n) && Math.abs(n) > 1 ? n : 20000
        this.httpConfig = {
            baseURL: 'https://resellers.egnyte.com',
            timeout,
        }
        this.resellerId = ''
    }

    private async _egnyteRequest(url: string, axiosOptions?: AxiosRequestConfig) {
        const httpOptions: AxiosRequestConfig = {
            ...this.httpConfig,
            ...(axiosOptions ?? {}),
        }
        const res = await axios(url, httpOptions)
        return res
    }

    /**
     * Gets a csrf token and returns it
     * @returns the csrf token
     */
    private async _getCsrfToken(): Promise<string> {
        const { data: query } = await this._egnyteRequest(
            '/accounts/login/?next=/customer/browse/',
            this.httpConfig,
        )
        const csrfRegexp = query.match(/id='csrfmiddlewaretoken'.*value='([a-zA-Z0-9]+)'.*\n/)
        if (!csrfRegexp) throw new Error('unable to find CSRF token in egnyte resellers login page')
        return csrfRegexp[1]
    }

    /**
     * Gets the resellerId for the logged in reseller by parsing out of the 302 from server
     * @param authCookie authCookie from _authenticate() call
     * @returns resellerId in string form
     */
    private async _setResellerId(authCookie: string): Promise<string> {
        if (!authCookie) throw new Error('missing authCookie')
        const res = await this._egnyteRequest('/customer/browse/', {
            headers: { cookie: authCookie },
            maxRedirects: 0,
            validateStatus: (status) => status >= 200 && status <= 303,
        })
        if (res.status === 302) {
            const location = res.headers.location
            if (!location) throw new Error('unable to find location header in response')
            const resellerId = location.split('/')[5]
            this.resellerId = resellerId
            return resellerId
        } else {
            throw new Error('an error occurred attempting to get the resellerId')
        }
    }

    /**
     * gets all unique planIds
     * @param authCookie authCookie from _authenticate() call
     * @returns array of planIds
     */
    async _getAllPlanIds(authCookie: string): Promise<string[]> {
        if (!authCookie) throw new Error('missing authCookie')
        if (!this.resellerId) await this._setResellerId(authCookie)

        const { data: res } = await this._egnyteRequest(`/msp/customer_data/${this.resellerId}`, {
            headers: { cookie: authCookie },
        })
        const resultArray = res
            .filter((customer: any) => customer.status !== 'deleted')
            .map((customer: any) => customer.plan_id.toString())
            .filter((v: any, i: any, s: any) => s.indexOf(v) === i)
        return resultArray
    }

    /**
     * authenticate to egnyte api. gets auth cookie
     * @param username the username for auth
     * @param password the passworf for auth
     * @returns the auth cookie string
     */
    private async _authenticate(): Promise<string> {
        const csrfToken = await this._getCsrfToken()
        const auth = await this._egnyteRequest('/accounts/login/?next=/customer/browse/', {
            method: 'post',
            data: `csrfmiddlewaretoken=${csrfToken}&username=${qs.escape(
                this._config.username,
            )}&password=${qs.escape(this._config.password)}&this_is_the_login_form=1`,
            maxRedirects: 0,
            validateStatus: (status) => status >= 200 && status <= 303,
        })
        if (auth.status === 302) {
            const setCookieHeader = auth.headers['set-cookie']
            if (!setCookieHeader) throw new Error('unable to find set-cookie header in response')
            const authCookie = setCookieHeader[0].split(';')[0]
            await this._setResellerId(authCookie)
            return authCookie
        } else {
            throw new Error('Authentication failed. Bad username or password.')
        }
    }

    /**
     * retrieves all customer data from multiple egnyte resellers API endpoints and models it to be actually readable
     * @returns array of customer objects containing useful stuff
     */
    async getAllCustomers(): Promise<EgnyteCustomer[]> {
        const authCookie = await this._authenticate()
        const planIds = await this._getAllPlanIds(authCookie)

        const customers = []
        for (const planId of planIds) {
            const usageStatsRes = await this._egnyteRequest(
                `/msp/usage_stats/${this.resellerId}/${planId}/`,
                {
                    headers: { cookie: authCookie },
                },
            )
            for (const customer of usageStatsRes.data) {
                const [customerEgnyteId, ref]: [string, any] = Object.entries(customer)[0]

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
     * retrieves available global licensing for both user and storage that isn't assigned to customers
     * @returns object containing the available user and storage data
     */
    async getPlans(): Promise<any> {
        const authCookie = await this._authenticate()
        const planIds = await this._getAllPlanIds(authCookie)

        const results = await Promise.all(
            planIds.map(async (id) => {
                const [planDataRes, planPowerUserDataRes] = await Promise.all([
                    this._egnyteRequest(`/msp/usage_stats/${this.resellerId}/${id}/`, {
                        headers: { cookie: authCookie },
                    }),
                    this._egnyteRequest(`/msp/get_plan_pu_data/${this.resellerId}/${id}/`, {
                        headers: { cookie: authCookie },
                    }),
                ])

                const planData = planDataRes.data
                const planPowerUserData = planPowerUserDataRes.data

                const ref: any = Object.entries(planData[0])[0][1]

                return {
                    planId: id,
                    totalPowerUsers: planPowerUserData.purchased,
                    usedPowerUsers: planPowerUserData.purchased - ref.power_user_stats.Available,
                    availablePowerUsers: ref.power_user_stats.Available,
                    availableStorage: ref.storage_stats.Available,
                    customers: planData.map((customer: object) => Object.keys(customer)[0]),
                }
            }),
        )

        return results
    }

    /**
     * Updates a plan's power user licensing count. This will result in a billing change from egnyte. Must be increased in increments of 5
     * @param planId the planId to update licensing for
     * @param newTotalLicenses the new total in increments of 5. Use getPlans() to find current total for given plan
     */
    async UpdatePowerUserLicensing(planId: string, newTotalLicenses: number) {
        const authCookie = await this._authenticate()
        const { data: res } = await this._egnyteRequest(
            `https://resellers.egnyte.com/msp/change_plan_power_users/${this.resellerId}/`,
            {
                method: 'post',
                headers: {
                    Cookie: authCookie,
                    'X-Requested-With': 'XMLHttpRequest',
                },
                data: {
                    plan_id: planId,
                    plan_power_users: newTotalLicenses.toString(),
                },
            },
        )

        if (res.success !== true) throw new Error(res.msg)
        return (await this.getPlans()).filter((e: any) => e.planId === planId)
    }

    /**
     * Updates a customer with a new power user count
     * @param customerId customer 'domain' key from getAllPowerUsers()
     * @param numOfUsers how many licenses to assign to customer
     * @returns response object
     */
    async updateCustomerPowerUsers(
        customerId: string,
        numOfUsers: number,
    ): Promise<EgnyteUpdateResponse> {
        customerId = customerId.toLowerCase()
        const customer = await this.getOneCustomer(customerId)
        if (customer.powerUsers.available <= 0)
            throw new Error('No available licenses on customers reseller plan.')
        if (numOfUsers < customer.powerUsers.used && this._config.forceLicenseChange !== true) {
            const response: EgnyteUpdateResponse = {
                result: 'NO_CHANGE',
                message: `customerId ${customerId} currently has ${customer.powerUsers.used} power users in use. Refusing to set to ${numOfUsers} power users.`,
            }
            return response
        } else if (numOfUsers === customer.powerUsers.total) {
            const response: EgnyteUpdateResponse = {
                result: 'NO_CHANGE',
                message: `customerId ${customerId} is already set to ${numOfUsers} power users. Did not modify.`,
            }
            return response
        }
        const authCookie = await this._authenticate()
        const res = await this._egnyteRequest(`/msp/change_power_users/${this.resellerId}/`, {
            method: 'post',
            headers: {
                Cookie: authCookie,
                'X-Requested-With': 'XMLHttpRequest',
            },
            data: {
                domain: customerId,
                power_users: numOfUsers.toString(),
            },
            validateStatus: (status) => (status >= 200 && status <= 303) || status === 400,
        })
        const result = res.data
        const response: EgnyteUpdateResponse = {
            result: 'SUCCESS',
            message: `Updated customerId ${customerId} from ${customer.powerUsers.total} to ${numOfUsers} power users successfully.`,
        }
        if (result.msg === 'Plan updated successfully!') {
            return response
        } else if (
            result.msg === 'CFS plan upgrade failed. Please contact support.' &&
            this._config.forceLicenseChange &&
            res.status === 400
        ) {
            return response
        } else {
            throw new Error(result.msg)
        }
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
        const authCookie = await this._authenticate()
        const response = await this._egnyteRequest(`/msp/change_storage/${this.resellerId}/`, {
            method: 'post',
            headers: {
                Cookie: authCookie,
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
            },
            data: {
                domain: customerId,
                storage: storageSizeGB.toString(),
            },
        })
        const result = response.data
        if (result.msg === 'Plan updated successfully!') {
            const response: EgnyteUpdateResponse = {
                result: 'SUCCESS',
                message: `Updated customerId ${customerId} from ${customer.storageGB.total}GB to ${storageSizeGB}GB storage successfully.`,
            }
            return response
        } else {
            throw new Error(result.msg)
        }
    }
}

export = Egnyte
